# Video Call Client

React frontend for group video calling application with WebRTC and MediaSoup integration.

## Features

- **Group Video Calls**: Multi-participant video conferencing
- **WebRTC Integration**: Real-time audio/video streaming
- **MediaSoup Client**: SFU-based media transport
- **Responsive UI**: Mobile-friendly video grid layout
- **Room Management**: Create and join video call rooms
- **Real-time Communication**: Socket.io integration

## Installation

```bash
npm install
```

## Usage

### Development
```bash
npm start
```

### Production Build
```bash
npm run build
```

The app runs on port 3000 by default and connects to the server at `http://localhost:8000`.

## Configuration

### Environment Variables
- `REACT_APP_SERVER_URL`: WebSocket server URL (default: http://localhost:8000)

### Browser Requirements
- **HTTPS**: Required for camera/microphone access in production
- **WebRTC Support**: Chrome, Firefox, Safari, Edge
- **Permissions**: Camera and microphone access required

## Architecture

### Components
- **App**: Main application component with video call logic
- **MediaSoupClient**: Wrapper for mediasoup-client library
- **Video Grid**: Responsive layout for participant videos
- **Room Management**: Create/join room functionality

### WebRTC Flow
1. Connect to server via Socket.io
2. Create/join room
3. Initialize MediaSoup device
4. Create WebRTC transports
5. Get local media stream
6. Publish media to SFU
7. Subscribe to remote participants

## Dependencies

- **react**: UI framework
- **socket.io-client**: Real-time communication
- **mediasoup-client**: WebRTC SFU client
- **typescript**: Type safety

## Development

### Project Structure
```
client/
  src/
    App.tsx             # Main application component
    App.css             # Application styles
    services/
      mediasoupClient.ts # MediaSoup client wrapper
  package.json          # Dependencies and scripts
  README.md             # This file
```

### Scripts
- `npm start` - Development server
- `npm run build` - Production build
- `npm test` - Run tests

## Usage Guide

### Creating a Room
1. Enter your name
2. Click "Create Room"
3. Share the Room ID with others
4. Allow camera/microphone access

### Joining a Room
1. Enter your name and Room ID
2. Click "Join Room"
3. Allow camera/microphone access

### During Call
- **Video Grid**: See all participants
- **Local Video**: Your feed with blue border
- **Leave Call**: Exit the room
- **Toggle Video**: Start/stop your video

## Production Deployment

### Build for Production
```bash
npm run build
```

### Deploy to Static Hosting
The `build` folder contains the static files ready for deployment to any static hosting service (Netlify, Vercel, S3, etc.).

### Environment Configuration
```bash
# Production environment
REACT_APP_SERVER_URL=https://your-server.com
```

## Browser Compatibility

- **Chrome**: Full support
- **Firefox**: Full support
- **Safari**: WebRTC support (HTTPS required)
- **Edge**: Full support

## Troubleshooting

### Camera/Microphone Issues
- Check browser permissions
- Ensure HTTPS in production
- Use supported browsers

### Connection Issues
- Verify server is running
- Check firewall settings
- Ensure correct server URL

## License

MIT License
