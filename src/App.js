import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getSocket } from './services/socket';
import MediaSoupClient from './services/mediasoupClient';
import VideoElement from './VideoElement';
import './App.css';

const App = () => {
  const socket = useMemo(() => getSocket(), []);
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [participantId, setParticipantId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);

  const mediaClientRef = useRef(null);
  const subscribedProducers = useRef(new Set());
  const localStreamRef = useRef(null);
  const pendingUserNameRef = useRef('');
  const joinTimeoutRef = useRef(null);
  const roomIdRef = useRef('');
  const participantIdRef = useRef('');

  const clearJoinTimeout = useCallback(() => {
    if (joinTimeoutRef.current) {
      clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
  }, []);

  const resetCallState = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    mediaClientRef.current?.close();
    mediaClientRef.current = null;
    subscribedProducers.current.clear();

    setLocalStream(null);
    setParticipants([]);
    setParticipantId('');
    roomIdRef.current = '';
    participantIdRef.current = '';
    setIsJoined(false);
    setIsLoading(false);
    setIsMicOn(true);
    setIsCameraOn(true);
    clearJoinTimeout();
  }, [clearJoinTimeout]);

  const mergeParticipantStream = useCallback((existingStream, incomingStream) => {
    if (!incomingStream) return existingStream || null;
    if (!existingStream) return incomingStream;

    const trackByKind = new Map();

    for (const track of existingStream.getTracks()) {
      trackByKind.set(track.kind, track);
    }
    for (const track of incomingStream.getTracks()) {
      trackByKind.set(track.kind, track);
    }

    const merged = new MediaStream();
    for (const track of trackByKind.values()) {
      merged.addTrack(track);
    }

    return merged;
  }, []);

  const consumeRemoteProducers = useCallback(
    async (client, room, selfParticipantId) => {
      if (!client || !room || !selfParticipantId) return;

      const producerList = await new Promise((resolve) => {
        socket.emit('get-producers', { roomId: room }, (list) => {
          resolve(Array.isArray(list) ? list : []);
        });
      });

      for (const producer of producerList) {
        if (!producer?.producerId || producer.participantId === selfParticipantId) {
          continue;
        }
        if (subscribedProducers.current.has(producer.producerId)) {
          continue;
        }

        subscribedProducers.current.add(producer.producerId);

        try {
          const remoteStream = await client.subscribeToProducer(
            producer.producerId,
            room,
            selfParticipantId
          );

          if (!remoteStream) {
            subscribedProducers.current.delete(producer.producerId);
            continue;
          }

          setParticipants((prev) => {
            const idx = prev.findIndex((p) => p.id === producer.participantId);
            const name = prev.find((p) => p.id === producer.participantId)?.name || 'User';

            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                stream: mergeParticipantStream(updated[idx].stream, remoteStream)
              };
              return updated;
            }

            return [...prev, { id: producer.participantId, name, stream: remoteStream }];
          });
        } catch (consumeErr) {
          subscribedProducers.current.delete(producer.producerId);
          console.error('Failed to consume producer:', consumeErr);
        }
      }
    },
    [socket, mergeParticipantStream]
  );

  useEffect(() => {
    const onConnect = () => setConnectionStatus('connected');
    const onDisconnect = () => setConnectionStatus('disconnected');
    const onConnectError = () => setConnectionStatus('error');

    if (socket.connected) {
      setConnectionStatus('connected');
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, [socket]);

  const startLocalVideo = useCallback(async () => {
    const client = mediaClientRef.current;
    const activeRoomId = roomIdRef.current;
    const activeParticipantId = participantIdRef.current;

    if (!client || !activeRoomId || !activeParticipantId || localStreamRef.current) return;

    setIsLoading(true);
    setError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2
        }
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        try {
          await videoTrack.applyConstraints({
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          });
        } catch {
          // Use best effort from getUserMedia if applyConstraints fails.
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      await client.publishLocalStream(stream, activeRoomId, activeParticipantId);

      await consumeRemoteProducers(client, activeRoomId, activeParticipantId);
      setTimeout(() => {
        consumeRemoteProducers(client, activeRoomId, activeParticipantId);
      }, 1500);
    } catch (err) {
      console.error('Failed to access camera/microphone:', err);
      setError('Failed to access camera/microphone.');
    } finally {
      setIsLoading(false);
    }
  }, [consumeRemoteProducers]);

  const toggleMic = useCallback(() => {
    const client = mediaClientRef.current;
    if (!client || !localStreamRef.current) return;

    const next = !isMicOn;
    client.setMediaEnabled('audio', next);
    setIsMicOn(next);
  }, [isMicOn]);

  const toggleCamera = useCallback(() => {
    const client = mediaClientRef.current;
    if (!client || !localStreamRef.current) return;

    const next = !isCameraOn;
    client.setMediaEnabled('video', next);
    setIsCameraOn(next);
  }, [isCameraOn]);

  const leaveRoom = useCallback(() => {
    if (roomIdRef.current && participantIdRef.current) {
      socket.emit('leave-room', {
        roomId: roomIdRef.current,
        participantId: participantIdRef.current
      });
    }
    resetCallState();
  }, [socket, resetCallState]);

  useEffect(() => {
    const handleRoomJoined = async ({ roomId: joinedRoomId, participantId: joinedParticipantId }) => {
      setIsLoading(true);
      setError('');

      try {
        const client = new MediaSoupClient(socket);
        await client.init(joinedRoomId);
        mediaClientRef.current = client;

        roomIdRef.current = joinedRoomId;
        participantIdRef.current = joinedParticipantId;

        setRoomId(joinedRoomId);
        setParticipantId(joinedParticipantId);
        setIsJoined(true);
        clearJoinTimeout();

        await consumeRemoteProducers(client, joinedRoomId, joinedParticipantId);
      } catch (err) {
        console.error('Failed to initialize mediasoup:', err);
        setError('Failed to join room. Please try again.');
        clearJoinTimeout();
      } finally {
        setIsLoading(false);
      }
    };

    const handleParticipantJoined = ({ participantId: joinedPid, userName: joinedUserName }) => {
      setParticipants((prev) => {
        if (prev.some((p) => p.id === joinedPid)) return prev;
        return [...prev, { id: joinedPid, name: joinedUserName }];
      });

      setTimeout(() => {
        const client = mediaClientRef.current;
        if (client && roomIdRef.current && participantIdRef.current) {
          consumeRemoteProducers(client, roomIdRef.current, participantIdRef.current);
        }
      }, 2000);
    };

    const handleParticipantLeft = ({ participantId: leftPid }) => {
      setParticipants((prev) => prev.filter((p) => p.id !== leftPid));
    };

    const handleRoomCreated = ({ roomId: createdRoomId }) => {
      if (!createdRoomId) {
        setIsLoading(false);
        setError('Failed to create room.');
        clearJoinTimeout();
        return;
      }

      setRoomId(createdRoomId);
      socket.emit('join-room', {
        roomId: createdRoomId,
        userName: pendingUserNameRef.current || userName.trim()
      });
    };

    const handleSocketError = (payload) => {
      setIsLoading(false);
      setError(payload?.message || 'Server error. Please try again.');
      clearJoinTimeout();
    };

    const handleNewProducer = async ({ producerId, participantId: producerPid }) => {
      const client = mediaClientRef.current;
      const activeRoomId = roomIdRef.current;
      const activeParticipantId = participantIdRef.current;

      if (!client || !activeRoomId || !activeParticipantId || producerPid === activeParticipantId) {
        return;
      }
      if (subscribedProducers.current.has(producerId)) return;

      subscribedProducers.current.add(producerId);

      try {
        const stream = await client.subscribeToProducer(
          producerId,
          activeRoomId,
          activeParticipantId
        );
        if (!stream) {
          subscribedProducers.current.delete(producerId);
          return;
        }

        setParticipants((prev) => {
          const existingIndex = prev.findIndex((p) => p.id === producerPid);
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              stream: mergeParticipantStream(updated[existingIndex].stream, stream)
            };
            return updated;
          }

          return [...prev, { id: producerPid, name: 'User', stream }];
        });
      } catch (err) {
        subscribedProducers.current.delete(producerId);
        console.error('Consume failed:', err);
      }
    };

    socket.on('room-joined', handleRoomJoined);
    socket.on('room-created', handleRoomCreated);
    socket.on('error', handleSocketError);
    socket.on('participant-joined', handleParticipantJoined);
    socket.on('participant-left', handleParticipantLeft);
    socket.on('new-producer', handleNewProducer);

    return () => {
      socket.off('room-joined', handleRoomJoined);
      socket.off('room-created', handleRoomCreated);
      socket.off('error', handleSocketError);
      socket.off('participant-joined', handleParticipantJoined);
      socket.off('participant-left', handleParticipantLeft);
      socket.off('new-producer', handleNewProducer);
    };
  }, [socket, userName, clearJoinTimeout, consumeRemoteProducers, mergeParticipantStream]);

  useEffect(() => {
    if (isJoined) {
      startLocalVideo();
    }
  }, [isJoined, startLocalVideo]);

  const createRoom = () => {
    if (!socket || !userName.trim()) {
      setError('Please enter your name.');
      return;
    }

    pendingUserNameRef.current = userName.trim();
    setIsLoading(true);
    setError('');
    socket.emit('create-room');
    clearJoinTimeout();
    joinTimeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      setError('Create room timed out. Please try again.');
    }, 10000);
  };

  const joinRoom = () => {
    if (!socket || !roomId.trim() || !userName.trim()) {
      setError('Please enter room ID and your name.');
      return;
    }

    setIsLoading(true);
    setError('');
    socket.emit('join-room', { roomId: roomId.trim(), userName: userName.trim() });
    clearJoinTimeout();
    joinTimeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      setError('Join room timed out. Please try again.');
    }, 10000);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Group Video Cal1l2</h1>
      </header>

      {!isJoined ? (
        <div className="join-form">
          <div className="form-group">
            <label htmlFor="name">Your Name</label>
            <input
              id="name"
              placeholder="Enter your name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="form-actions">
            <button onClick={createRoom} disabled={isLoading}>
              {isLoading ? 'Working...' : 'Create Room'}
            </button>

            <div className="join-existing">
              <input
                placeholder="Enter room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                disabled={isLoading}
              />
              <button onClick={joinRoom} disabled={isLoading}>
                Join Room
              </button>
            </div>
          </div>

          {error && (
            <div className="room-info">
              <p>{error}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="video-call">
          <div className="room-info">
            <p>
              Room ID: <strong>{roomId}</strong>
            </p>
            <p>Connection: {connectionStatus}</p>
            <p>Participants: {participants.length + (localStream ? 1 : 0)}</p>
            {error && <p>{error}</p>}
          </div>

          <div className="video-grid">
            {participants.map((participant) => (
              <div className="video-item" key={participant.id}>
                <VideoElement
                  stream={participant.stream}
                  label={participant.name}
                  trackKey={
                    participant.stream
                      ? participant.stream.getTracks().map((t) => t.id).join('-')
                      : 'none'
                  }
                />
              </div>
            ))}

            {localStream && (
              <div className="video-item local-video">
                <VideoElement stream={localStream} muted label="You" />
                {!isCameraOn && <div className="media-off-overlay">Camera off</div>}
                {!isMicOn && <div className="media-off-badge">Muted</div>}
              </div>
            )}
          </div>

          <div className="call-controls">
            <button
              type="button"
              className={`control-btn ${isMicOn ? 'control-btn--active' : 'control-btn--off'}`}
              onClick={toggleMic}
              disabled={!localStream}
              aria-pressed={isMicOn}
            >
              {isMicOn ? 'Mute' : 'Unmute'}
            </button>
            <button
              type="button"
              className={`control-btn ${isCameraOn ? 'control-btn--active' : 'control-btn--off'}`}
              onClick={toggleCamera}
              disabled={!localStream}
              aria-pressed={isCameraOn}
            >
              {isCameraOn ? 'Stop Video' : 'Start Video'}
            </button>
            <button type="button" className="control-btn control-btn--leave" onClick={leaveRoom}>
              Leave Room
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;