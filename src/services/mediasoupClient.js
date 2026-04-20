class MediaSoupClient {
  constructor(socket) {
    this.socket = socket;

    this.device = null;

    this.sendTransport = null;
    this.recvTransport = null;

    this.producers = new Map();
    this.consumers = new Map();

    this.consumingProducers = new Set(); // جلوگیری duplicate consume
    this.localStream = null;

    this.deviceLoaded = false;
  }

  /* ---------------- DEVICE ---------------- */
  async loadDevice() {
    if (this.deviceLoaded) return;

    const mediasoupClient = await import('mediasoup-client');
    this.device = new mediasoupClient.Device();

    this.deviceLoaded = true;
  }

  async init(roomId) {
    await this.loadDevice();

    const routerRtpCapabilities = await new Promise((resolve) => {
      this.socket.emit(
        'get-router-rtp-capabilities',
        { roomId },
        resolve
      );
    });

    if (!routerRtpCapabilities || routerRtpCapabilities.error) {
      throw new Error('Router RTP capabilities failed');
    }

    await this.device.load({ routerRtpCapabilities });
  }

  /* ---------------- SEND TRANSPORT ---------------- */
  async createSendTransport(roomId, participantId) {
    if (this.sendTransport) return;

    const data = await new Promise((resolve) => {
      this.socket.emit(
        'create-transport',
        { roomId, participantId, direction: 'send' },
        resolve
      );
    });

    if (data.error) throw new Error(data.error);

    this.sendTransport = this.device.createSendTransport(data);

    this.sendTransport.on('connect', ({ dtlsParameters }, cb) => {
      this.socket.emit('connect-transport', {
        roomId,
        participantId,
        transportId: this.sendTransport.id,
        dtlsParameters
      });
      cb();
    });

    this.sendTransport.on('produce', async ({ kind, rtpParameters }, cb) => {
      const res = await new Promise((resolve) => {
        this.socket.emit(
          'produce',
          {
            roomId,
            participantId,
            transportId: this.sendTransport.id,
            kind,
            rtpParameters
          },
          resolve
        );
      });

      if (res.error) return cb({ error: res.error });

      cb({ id: res.id });
    });
  }

  /* ---------------- RECV TRANSPORT ---------------- */
  async createRecvTransport(roomId, participantId) {
    if (this.recvTransport) return;

    const data = await new Promise((resolve) => {
      this.socket.emit(
        'create-transport',
        { roomId, participantId, direction: 'recv' },
        resolve
      );
    });

    if (data.error) throw new Error(data.error);

    this.recvTransport = this.device.createRecvTransport(data);

    this.recvTransport.on('connect', ({ dtlsParameters }, cb) => {
      this.socket.emit('connect-transport', {
        roomId,
        participantId,
        transportId: this.recvTransport.id,
        dtlsParameters
      });
      cb();
    });
  }

  /* ---------------- PRODUCE ---------------- */
  async publishLocalStream(stream, roomId, participantId) {
    this.localStream = stream;

    await this.createSendTransport(roomId, participantId);

    for (const track of stream.getTracks()) {
      const producer = await this.sendTransport.produce({ track });
      this.producers.set(producer.id, producer);
    }
  }

  /* ---------------- CONSUME ---------------- */
  async subscribeToProducer(producerId, roomId, participantId) {
    if (this.consumingProducers.has(producerId)) return;
    this.consumingProducers.add(producerId);

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

    if (data.error) {
      console.error('Consume error:', data.error);
      return;
    }

    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters
    });

    this.consumers.set(consumer.id, consumer);

    // ❗ VERY IMPORTANT (MOST PEOPLE MISS THIS)
    this.socket.emit('resume-consumer', {
      consumerId: consumer.id
    });

    const stream = new MediaStream();
    stream.addTrack(consumer.track);

    return stream;
  }

  /* ---------------- CLEANUP ---------------- */
  close() {
    this.producers.forEach(p => p.close());
    this.consumers.forEach(c => c.close());

    this.sendTransport?.close();
    this.recvTransport?.close();

    this.producers.clear();
    this.consumers.clear();
    this.consumingProducers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
  }
}

export default MediaSoupClient;