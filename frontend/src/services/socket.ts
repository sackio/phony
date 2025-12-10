import { io, Socket } from 'socket.io-client';

// @ts-ignore - Vite env variables
const SOCKET_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3004');

class SocketService {
  private socket: Socket | null = null;

  connect() {
    if (!this.socket) {
      this.socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
      });

      this.socket.on('connect', () => {
        console.log('Socket connected');
      });

      this.socket.on('disconnect', () => {
        console.log('Socket disconnected');
      });
    }

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  subscribeToCall(callSid: string) {
    if (this.socket) {
      this.socket.emit('subscribe_call', { callSid });
    }
  }

  unsubscribeFromCall(callSid: string) {
    if (this.socket) {
      this.socket.emit('unsubscribe_call', { callSid });
    }
  }

  on(event: string, callback: (data: any) => void) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event: string) {
    if (this.socket) {
      this.socket.off(event);
    }
  }
}

export const socketService = new SocketService();
