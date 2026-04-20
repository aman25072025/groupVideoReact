import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import MediaSoupClient from './services/mediasoupClient';
import VideoElement from './VideoElement';
import './App.css';

const App = () => {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [participantId, setParticipantId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  const mediaClientRef = useRef(null);
  const subscribedProducers = useRef(new Set());
  const localStreamRef = useRef(null);

  /* ---------------- SOCKET INIT ---------------- */
  useEffect(() => {
    const s = io('https://groupvideonode.onrender.com', {
      transports: ['polling'],
      timeout: 30000
    });

    setSocket(s);

    s.on('connect', () => setConnectionStatus('connected'));
    s.on('disconnect', () => setConnectionStatus('disconnected'));
    s.on('connect_error', () => setConnectionStatus('error'));

    return () => s.close();
  }, []);

  /* ---------------- SOCKET EVENTS ---------------- */
  useEffect(() => {
    if (!socket) return;

    const handleRoomJoined = async ({ roomId, participantId }) => {
      setRoomId(roomId);
      setParticipantId(participantId);
      setIsJoined(true);

      const client = new MediaSoupClient(socket);
      mediaClientRef.current = client;

      await client.init(roomId);
      console.log('MediaSoup ready');
    };

    const handleParticipantJoined = ({ participantId, userName }) => {
      setParticipants(prev => {
        if (prev.some(p => p.id === participantId)) return prev;
        return [...prev, { id: participantId, name: userName }];
      });
    };

    const handleParticipantLeft = ({ participantId }) => {
      setParticipants(prev => prev.filter(p => p.id !== participantId));
    };

    const handleNewProducer = async ({ producerId, participantId: producerPid }) => {
      const client = mediaClientRef.current;

      if (!client) return;
      if (producerPid === participantId) return;

      // ❗ prevent duplicate consume
      if (subscribedProducers.current.has(producerId)) return;
      subscribedProducers.current.add(producerId);

      try {
        const stream = await client.subscribeToProducer(
          producerId,
          roomId,
          participantId
        );

        setParticipants(prev => {
          let found = false;

          const updated = prev.map(p => {
            if (p.id === producerPid) {
              found = true;
              return { ...p, stream };
            }
            return p;
          });

          // if participant not yet added (race condition fix)
          if (!found) {
            updated.push({
              id: producerPid,
              name: 'User',
              stream
            });
          }

          return updated;
        });

      } catch (err) {
        console.error('Consume failed:', err);
      }
    };

    socket.on('room-joined', handleRoomJoined);
    socket.on('participant-joined', handleParticipantJoined);
    socket.on('participant-left', handleParticipantLeft);
    socket.on('new-producer', handleNewProducer);

    return () => {
      socket.off('room-joined', handleRoomJoined);
      socket.off('participant-joined', handleParticipantJoined);
      socket.off('participant-left', handleParticipantLeft);
      socket.off('new-producer', handleNewProducer);
    };
  }, [socket, roomId, participantId]);

  /* ---------------- ACTIONS ---------------- */
  const createRoom = () => {
    if (!socket || !userName.trim()) return;
    socket.emit('create-room');
  };

  const joinRoom = () => {
    if (!socket || !roomId || !userName) return;
    socket.emit('join-room', { roomId, userName });
  };

  /* ---------------- VIDEO ---------------- */
  const startLocalVideo = useCallback(async () => {
    const client = mediaClientRef.current;
    if (!client) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      await client.publishLocalStream(stream, roomId, participantId);

    } catch (err) {
      console.error(err);
    }
  }, [roomId, participantId]);

  const stopLocalVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
  };

  const leaveRoom = () => {
    socket.emit('leave-room', { roomId, participantId });

    mediaClientRef.current?.close();
    mediaClientRef.current = null;

    subscribedProducers.current.clear();

    stopLocalVideo();

    setIsJoined(false);
    setParticipants([]);
  };

  useEffect(() => {
    if (isJoined) startLocalVideo();
  }, [isJoined]);

  /* ---------------- UI ---------------- */
  return (
    <div className="App">
      {!isJoined ? (
        <>
          <input
            placeholder="Name"
            value={userName}
            onChange={e => setUserName(e.target.value)}
          />

          <button onClick={createRoom}>Create</button>

          <input
            placeholder="Room ID"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
          />

          <button onClick={joinRoom}>Join</button>
        </>
      ) : (
        <>
          <h3>Room: {roomId}</h3>

          {localStream && (
            <VideoElement stream={localStream} muted label="You" />
          )}

          {participants.map(p => (
            <VideoElement
              key={p.id}
              stream={p.stream}
              label={p.name}
            />
          ))}

          <button onClick={leaveRoom}>Leave</button>
        </>
      )}
    </div>
  );
};

export default App;