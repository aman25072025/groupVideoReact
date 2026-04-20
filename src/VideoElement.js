import React, { useEffect, useRef } from 'react';

const VideoElement = ({ 
  stream, 
  muted = false, 
  label, 
  participantId, 
  videoRefs 
}) => {
  const videoRef = useRef(null);
  const previousStreamRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    
    if (!video) return;

    // Only update srcObject if the stream has actually changed
    if (stream !== previousStreamRef.current) {
      // Stop the old stream if it exists
      if (previousStreamRef.current && video.srcObject !== stream) {
        const oldStream = video.srcObject;
        if (oldStream) {
          oldStream.getTracks().forEach(track => track.stop());
        }
      }

      // Set the new stream
      video.srcObject = stream || null;
      
      // Store the current stream for comparison
      previousStreamRef.current = stream || null;
    }

    // Store video reference if participantId is provided
    if (participantId && videoRefs) {
      videoRefs.current[participantId] = video;
    }

    // Cleanup
    return () => {
      if (video.srcObject) {
        const currentStream = video.srcObject;
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream, participantId, videoRefs]);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          backgroundColor: stream ? 'transparent' : '#000'
        }}
      />
      <div className="video-label">{label}</div>
    </>
  );
};

export default VideoElement;
