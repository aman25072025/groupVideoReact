import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { MediaSoupClient } from './services/mediasoupClient';
import './App.css';

interface Participant {
  id: string;
  name: string;
  stream?: MediaStream;
}

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isJoined, setIsJoined] = useState<boolean>(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState<boolean>(false);
  const [participantId, setParticipantId] = useState<string>('');
  const [mediaSoupClient, setMediaSoupClient] = useState<MediaSoupClient | null>(null);
  const videoRefs = useRef<{ [key: string]: HTMLVideoElement | null }>({});

  useEffect(() => {
    const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:8000';
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    newSocket.on('room-created', ({ roomId }: { roomId: string }) => {
      setRoomId(roomId);
      setIsCreatingRoom(false);
    });

    newSocket.on('room-joined', async ({ roomId, participantId }: { roomId: string; participantId: string }) => {
      setRoomId(roomId);
      setParticipantId(participantId);
      setIsJoined(true);

      // Initialize MediaSoup client
      const client = new MediaSoupClient(newSocket);
      setMediaSoupClient(client);

      try {
        await client.init(roomId, participantId);
      } catch (error) {
        console.error('Failed to initialize MediaSoup client:', error);
      }
    });

    newSocket.on('participant-joined', ({ participantId, userName }: { participantId: string; userName: string }) => {
      setParticipants(prev => [...prev, { id: participantId, name: userName }]);
    });

    newSocket.on('participant-left', ({ participantId }: { participantId: string }) => {
      setParticipants(prev => prev.filter(p => p.id !== participantId));
    });

    newSocket.on('new-producer', async ({ producerId, participantId: producerParticipantId, kind }: { producerId: string; participantId: string; kind: string }) => {
      if (mediaSoupClient && producerParticipantId !== participantId) {
        try {
          const stream = await mediaSoupClient.subscribeToProducer(producerId, roomId, participantId);
          setParticipants(prev => prev.map(p =>
            p.id === producerParticipantId ? { ...p, stream } : p
          ));
        } catch (error) {
          console.error('Failed to subscribe to producer:', error);
        }
      }
    });

    newSocket.on('error', ({ message }: { message: string }) => {
      alert(message);
    });

    return () => {
      newSocket.close();
    };
  }, [mediaSoupClient, participantId, roomId]);

  const createRoom = async () => {
    if (!socket || !userName.trim()) return;

    setIsCreatingRoom(true);
    socket.emit('create-room', {});
  };

  const joinRoom = async () => {
    if (!socket || !roomId.trim() || !userName.trim()) return;

    socket.emit('join-room', { roomId, userName });
  };

  const startLocalVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      setLocalStream(stream);

      // Publish stream through MediaSoup if joined
      if (mediaSoupClient && roomId && participantId) {
        try {
          await mediaSoupClient.publishLocalStream(stream, roomId, participantId);
        } catch (error) {
          console.error('Failed to publish local stream:', error);
        }
      }
    } catch (error) {
      console.error('Failed to get local stream:', error);
      alert('Failed to access camera/microphone');
    }
  };

  const stopLocalVideo = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
  };

  const leaveRoom = () => {
    if (socket && roomId && participantId) {
      socket.emit('leave-room', { roomId, participantId });
    }

    // Close MediaSoup client
    if (mediaSoupClient) {
      mediaSoupClient.close();
      setMediaSoupClient(null);
    }

    // Stop local video
    stopLocalVideo();

    // Reset state
    setIsJoined(false);
    setRoomId('');
    setParticipantId('');
    setParticipants([]);

    // Clear video refs
    Object.keys(videoRefs.current).forEach(key => {
      const video = videoRefs.current[key];
      if (video) {
        video.srcObject = null;
      }
    });
    videoRefs.current = {};
  };

  useEffect(() => {
    if (isJoined) {
      startLocalVideo();
    } else {
      stopLocalVideo();
    }
  }, [isJoined, startLocalVideo, stopLocalVideo]);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Group Video Call</h1>
      </header>

      {!isJoined ? (
        <div className="join-form">
          <div className="form-group">
            <label>Your Name:</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
            />
          </div>

          <div className="form-actions">
            <button onClick={createRoom} disabled={!userName.trim() || isCreatingRoom}>
              {isCreatingRoom ? 'Creating...' : 'Create Room'}
            </button>

            <div className="join-existing">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter Room ID"
              />
              <button onClick={joinRoom} disabled={!userName.trim() || !roomId.trim()}>
                Join Room
              </button>
            </div>
          </div>

          {roomId && (
            <div className="room-info">
              <p>Room ID: <strong>{roomId}</strong></p>
              <p>Share this ID with others to join the call</p>
            </div>
          )}
        </div>
      ) : (
        <div className="video-call">
          <div className="video-grid">
            {localStream && (
              <div className="video-item local-video">
                <video
                  ref={(video) => {
                    if (video && localStream) {
                      video.srcObject = localStream;
                    }
                  }}
                  autoPlay
                  muted
                  playsInline
                />
                <div className="video-label">You ({userName})</div>
              </div>
            )}

            {participants.map((participant) => (
              <div key={participant.id} className="video-item">
                <video
                  ref={(video) => {
                    if (video) {
                      videoRefs.current[participant.id] = video;
                      if (participant.stream) {
                        video.srcObject = participant.stream;
                      }
                    }
                  }}
                  autoPlay
                  playsInline
                />
                <div className="video-label">{participant.name}</div>
              </div>
            ))}
          </div>

          <div className="call-controls">
            <button onClick={leaveRoom}>
              Leave Call
            </button>
            <button onClick={stopLocalVideo}>
              {localStream ? 'Stop Video' : 'Start Video'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
