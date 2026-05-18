import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:8000';

  if (!socket) {
    socket = io(serverUrl, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 30000
    });
  }

  return socket;
}

export function resetSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
