class MediaSoupClient {
  constructor(socket) {
    this.socket = socket;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.producers = new Map();
    this.consumers = new Map();
    this.consumingProducers = new Set();
    this.localStream = null;
    this.roomId = null;
    this.participantId = null;
  }

  async loadDevice() {
    const mediasoupClient = await import('mediasoup-client');
    this.device = new mediasoupClient.Device();
  }

  async init(roomId) {
    await this.loadDevice();

    const routerRtpCapabilities = await new Promise((resolve) => {
      this.socket.emit('get-router-rtp-capabilities', { roomId }, resolve);
    });

    if (routerRtpCapabilities?.error || !routerRtpCapabilities?.codecs?.length) {
      throw new Error(routerRtpCapabilities?.error || 'Invalid router RTP capabilities');
    }

    await this.device.load({ routerRtpCapabilities });
    this.roomId = roomId;
  }

  waitForTransportConnect(transport, label, timeoutMs = 15000) {
    if (transport.connectionState === 'connected') {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} transport connect timeout`));
      }, timeoutMs);

      const onStateChange = (state) => {
        if (state === 'connected') {
          clearTimeout(timer);
          transport.off('connectionstatechange', onStateChange);
          resolve();
        } else if (state === 'failed' || state === 'closed') {
          clearTimeout(timer);
          transport.off('connectionstatechange', onStateChange);
          reject(new Error(`${label} transport ${state}`));
        }
      };

      transport.on('connectionstatechange', onStateChange);
    });
  }

  async createSendTransport(roomId, participantId) {
    if (this.sendTransport) return;

    this.roomId = roomId;
    this.participantId = participantId;

    const data = await new Promise((resolve) => {
      this.socket.emit(
        'create-transport',
        { roomId, participantId, direction: 'send' },
        resolve
      );
    });

    if (data?.error) throw new Error(data.error);

    this.sendTransport = this.device.createSendTransport(data);

    this.sendTransport.on('connect', ({ dtlsParameters }, cb, errback) => {
      this.socket.emit(
        'connect-transport',
        {
          roomId: this.roomId,
          participantId: this.participantId,
          transportId: this.sendTransport.id,
          dtlsParameters
        },
        (response) => {
          if (response?.error) {
            errback(new Error(response.error));
            return;
          }
          cb();
        }
      );
    });

    this.sendTransport.on('produce', async ({ kind, rtpParameters }, cb, errback) => {
      try {
        const res = await new Promise((resolve) => {
          this.socket.emit(
            'produce',
            {
              roomId: this.roomId,
              participantId: this.participantId,
              transportId: this.sendTransport.id,
              kind,
              rtpParameters
            },
            resolve
          );
        });

        if (res?.error) throw new Error(res.error);
        cb({ id: res.id });
      } catch (err) {
        console.error('Produce failed:', err);
        if (typeof errback === 'function') errback(err);
      }
    });

    this.sendTransport.on('connectionstatechange', (state) => {
      console.log('Send transport:', state);
    });
  }

  async createRecvTransport(roomId, participantId) {
    if (this.recvTransport) return;

    this.roomId = roomId;
    this.participantId = participantId;

    const data = await new Promise((resolve) => {
      this.socket.emit(
        'create-transport',
        { roomId, participantId, direction: 'recv' },
        resolve
      );
    });

    if (data?.error) throw new Error(data.error);

    this.recvTransport = this.device.createRecvTransport(data);

    this.recvTransport.on('connect', ({ dtlsParameters }, cb, errback) => {
      this.socket.emit(
        'connect-transport',
        {
          roomId: this.roomId,
          participantId: this.participantId,
          transportId: this.recvTransport.id,
          dtlsParameters
        },
        (response) => {
          if (response?.error) {
            errback(new Error(response.error));
            return;
          }
          cb();
        }
      );
    });

    this.recvTransport.on('connectionstatechange', (state) => {
      console.log('Recv transport:', state);
    });
  }

  getPreferredVideoCodec() {
    return this.device.rtpCapabilities.codecs.find(
      (codec) => codec.mimeType.toLowerCase() === 'video/h264'
    );
  }

  async produceTrack(track) {
    if (track.kind === 'video') {
      const h264 = this.getPreferredVideoCodec();
      const options = {
        track,
        encodings: [
          {
            maxBitrate: 2_500_000,
            scaleResolutionDownBy: 1
          }
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1500
        }
      };

      if (h264) {
        options.codec = h264;
      }

      return this.sendTransport.produce(options);
    }

    return this.sendTransport.produce({
      track,
      encodings: [{ maxBitrate: 128_000 }]
    });
  }

  async publishLocalStream(stream, roomId, participantId) {
    this.localStream = stream;
    await this.createSendTransport(roomId, participantId);

    const tracks = [...stream.getVideoTracks(), ...stream.getAudioTracks()];

    for (const track of tracks) {
      const producer = await this.produceTrack(track);
      this.producers.set(producer.kind, producer);
    }

    await this.waitForTransportConnect(this.sendTransport, 'Send');
  }

  setMediaEnabled(kind, enabled) {
    const track = this.localStream?.getTracks().find((t) => t.kind === kind);
    if (track) track.enabled = enabled;

    const producer = this.producers.get(kind);
    if (!producer) return;

    if (enabled) producer.resume();
    else producer.pause();
  }

  async subscribeToProducer(producerId, roomId, participantId) {
    if (this.consumingProducers.has(producerId)) {
      return null;
    }
    this.consumingProducers.add(producerId);

    try {
      await this.createRecvTransport(roomId, participantId);

      const data = await new Promise((resolve) => {
        this.socket.emit(
          'consume',
          {
            roomId,
            participantId,
            producerId,
            transportId: this.recvTransport.id,
            rtpCapabilities: this.device.rtpCapabilities
          },
          resolve
        );
      });

      if (data?.error) {
        console.error('Consume error:', data.error);
        return null;
      }

      const consumer = await this.recvTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters
      });

      this.consumers.set(producerId, consumer);

      await this.waitForTransportConnect(this.recvTransport, 'Recv');
      await consumer.resume();

      const mediaStream = new MediaStream([consumer.track]);
      console.log(
        `Remote ${data.kind} track ready:`,
        consumer.track.readyState,
        'muted:',
        consumer.track.muted
      );

      return mediaStream;
    } catch (err) {
      console.error('subscribeToProducer failed:', err);
      return null;
    } finally {
      if (!this.consumers.has(producerId)) {
        this.consumingProducers.delete(producerId);
      }
    }
  }

  close() {
    this.producers.forEach((p) => p.close());
    this.consumers.forEach((c) => c.close());

    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;

    this.producers.clear();
    this.consumers.clear();
    this.consumingProducers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
  }
}

export default MediaSoupClient;
