import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

export class SocketService {
    private static instance: SocketService;
    private io: SocketIOServer | null = null;

    private constructor() {}

    public static getInstance(): SocketService {
        if (!SocketService.instance) {
            SocketService.instance = new SocketService();
        }
        return SocketService.instance;
    }

    public initialize(httpServer: HTTPServer): void {
        if (this.io) {
            console.log('[Socket.IO] Already initialized');
            return;
        }

        this.io = new SocketIOServer(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            },
            transports: ['websocket', 'polling']
        });

        this.io.on('connection', (socket) => {
            console.log(`[Socket.IO] Client connected: ${socket.id}`);

            socket.on('subscribe_call', (data: { callSid: string }) => {
                console.log(`[Socket.IO] Client ${socket.id} subscribing to call: ${data.callSid}`);
                socket.join(`call:${data.callSid}`);
            });

            socket.on('unsubscribe_call', (data: { callSid: string }) => {
                console.log(`[Socket.IO] Client ${socket.id} unsubscribing from call: ${data.callSid}`);
                socket.leave(`call:${data.callSid}`);
            });

            socket.on('disconnect', () => {
                console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
            });
        });

        console.log('[Socket.IO] Initialized successfully');
    }

    public emitTranscriptUpdate(callSid: string, data: {
        speaker: 'user' | 'assistant';
        text: string;
        timestamp: Date;
        isPartial: boolean;
    }): void {
        if (!this.io) {
            console.warn('[Socket.IO] Not initialized, cannot emit transcript update');
            return;
        }

        this.io.to(`call:${callSid}`).emit('transcript_update', {
            callSid,
            ...data
        });
    }

    public emitCallStatusChanged(callSid: string, status: string, extraData?: any): void {
        if (!this.io) {
            console.warn('[Socket.IO] Not initialized, cannot emit status change');
            return;
        }

        this.io.to(`call:${callSid}`).emit('call_status_changed', {
            callSid,
            status,
            ...extraData
        });
    }

    public emitContextInjection(callSid: string, context: string, conversationHistory: any[]): void {
        if (!this.io) {
            console.warn('[Socket.IO] Not initialized, cannot emit context injection');
            return;
        }

        console.log(`[Socket.IO] Emitting context injection for call: ${callSid}`);
        this.io.to(`call:${callSid}`).emit('context_injection', {
            callSid,
            context,
            conversationHistory
        });
    }

    public emitContextRequest(callSid: string, question: string, requestedBy: 'agent' | 'system'): void {
        if (!this.io) {
            console.warn('[Socket.IO] Not initialized, cannot emit context request');
            return;
        }

        console.log(`[Socket.IO] Emitting context request for call: ${callSid}, question: ${question}`);
        this.io.to(`call:${callSid}`).emit('context_request', {
            callSid,
            question,
            requestedBy,
            timestamp: new Date()
        });
    }

    public getIO(): SocketIOServer | null {
        return this.io;
    }
}
