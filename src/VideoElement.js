import React, { useEffect, useRef } from 'react';

const VideoElement = ({ stream, muted = false, label, trackKey = '' }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const start = async () => {
      if (!stream) {
        video.srcObject = null;
        return;
      }

      video.srcObject = stream;

      try {
        await video.play();
      } catch {
        // Retry when tracks start receiving media
      }
    };

    const onTrackChange = () => start();

    start();

    stream?.addEventListener('addtrack', onTrackChange);
    stream?.addEventListener('removetrack', onTrackChange);

    for (const track of stream?.getTracks() || []) {
      track.onunmute = () => start();
    }

    return () => {
      stream?.removeEventListener('addtrack', onTrackChange);
      stream?.removeEventListener('removetrack', onTrackChange);
    };
  }, [stream, trackKey]);

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
          backgroundColor: '#1a1a1a'
        }}
      />
      <div className="video-label">{label}</div>
    </>
  );
};

export default VideoElement;
