import { Socket } from 'socket.io-client';

export interface TransportOptions {
  id: string;
  iceParameters: any;
  iceCandidates: any[];
  dtlsParameters: any;
}

export interface ProducerOptions {
  id: string;
  kind: 'audio' | 'video';
  rtpParameters: any;
}

export interface ConsumerOptions {
  id: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: any;
}

export class MediaSoupClient {
  private socket: Socket;
  private device: any;
  private sendTransport: any = null;
  private recvTransport: any = null;
  private producers: Map<string, any> = new Map();
  private consumers: Map<string, any> = new Map();
  private localStream: MediaStream | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    this.loadDevice();
  }

  private async loadDevice() {
    try {
      // Import mediasoup-client dynamically
      const mediasoupClient = await import('mediasoup-client');
      this.device = new mediasoupClient.Device();
    } catch (error) {
      console.error('Failed to load mediasoup-client:', error);
    }
  }

  async init(roomId: string, participantId: string) {
    try {
      // Get router RTP capabilities
      const routerRtpCapabilities = await new Promise<any>((resolve) => {
        this.socket.emit('get-router-rtp-capabilities', { roomId }, resolve);
      });

      await this.device.load({ routerRtpCapabilities });
    } catch (error) {
      console.error('Failed to initialize device:', error);
      throw error;
    }
  }

  async createSendTransport(roomId: string, participantId: string): Promise<TransportOptions> {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-transport', 
        { roomId, participantId, direction: 'send' }, 
        async (response: any) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }

          try {
            const transport = this.device.createSendTransport(response);
            
            transport.on('connect', ({ dtlsParameters }: any) => {
              this.socket.emit('connect-transport', {
                roomId,
                participantId,
                transportId: transport.id,
                dtlsParameters
              });
            });

            transport.on('produce', async ({ kind, rtpParameters, appData }: any, callback: any) => {
              try {
                const response = await new Promise<any>((resolve) => {
                  this.socket.emit('produce', {
                    roomId,
                    participantId,
                    transportId: transport.id,
                    kind,
                    rtpParameters
                  }, resolve);
                });

                if (response.error) {
                  throw new Error(response.error);
                }

                callback({ id: response.id });
              } catch (error) {
                callback({ error: 'Failed to produce' });
              }
            });

            this.sendTransport = transport;
            resolve(response);
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }

  async createRecvTransport(roomId: string, participantId: string): Promise<TransportOptions> {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-transport', 
        { roomId, participantId, direction: 'recv' }, 
        async (response: any) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }

          try {
            const transport = this.device.createRecvTransport(response);
            
            transport.on('connect', ({ dtlsParameters }: any) => {
              this.socket.emit('connect-transport', {
                roomId,
                participantId,
                transportId: transport.id,
                dtlsParameters
              });
            });

            this.recvTransport = transport;
            resolve(response);
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }

  async produce(track: MediaStreamTrack, roomId: string, participantId: string): Promise<string> {
    if (!this.sendTransport) {
      throw new Error('Send transport not created');
    }

    try {
      const producer = await this.sendTransport.produce({ track });
      this.producers.set(producer.id, producer);
      return producer.id;
    } catch (error) {
      console.error('Failed to produce:', error);
      throw error;
    }
  }

  async consume(producerId: string, roomId: string, participantId: string): Promise<MediaStream> {
    if (!this.recvTransport) {
      throw new Error('Receive transport not created');
    }

    try {
      const consumerOptions = await new Promise<ConsumerOptions>((resolve, reject) => {
        this.socket.emit('consume', {
          roomId,
          participantId,
          producerId,
          transportId: this.recvTransport.id,
          rtpCapabilities: this.device.rtpCapabilities
        }, (response: any) => {
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });

      const consumer = await this.recvTransport.consume(consumerOptions);
      this.consumers.set(consumer.id, consumer);
      
      const stream = new MediaStream();
      stream.addTrack(consumer.track);
      
      return stream;
    } catch (error) {
      console.error('Failed to consume:', error);
      throw error;
    }
  }

  async publishLocalStream(stream: MediaStream, roomId: string, participantId: string) {
    this.localStream = stream;
    
    // Create send transport if not exists
    if (!this.sendTransport) {
      await this.createSendTransport(roomId, participantId);
    }

    // Produce audio and video tracks
    const tracks = stream.getTracks();
    const producerPromises = tracks.map(track => this.produce(track, roomId, participantId));
    
    try {
      await Promise.all(producerPromises);
    } catch (error) {
      console.error('Failed to publish local stream:', error);
      throw error;
    }
  }

  async subscribeToProducer(producerId: string, roomId: string, participantId: string): Promise<MediaStream> {
    // Create receive transport if not exists
    if (!this.recvTransport) {
      await this.createRecvTransport(roomId, participantId);
    }

    return this.consume(producerId, roomId, participantId);
  }

  closeProducer(producerId: string) {
    const producer = this.producers.get(producerId);
    if (producer) {
      producer.close();
      this.producers.delete(producerId);
    }
  }

  closeConsumer(consumerId: string) {
    const consumer = this.consumers.get(consumerId);
    if (consumer) {
      consumer.close();
      this.consumers.delete(consumerId);
    }
  }

  close() {
    // Close all producers
    this.producers.forEach(producer => producer.close());
    this.producers.clear();

    // Close all consumers
    this.consumers.forEach(consumer => consumer.close());
    this.consumers.clear();

    // Close transports
    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }

    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
