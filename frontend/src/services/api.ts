import axios from 'axios';

// Use current origin for API calls (works on both localhost and public domain)
// @ts-ignore - Vite env variables
const API_BASE_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3004');
// @ts-ignore - Vite env variables
const API_SECRET = import.meta.env.VITE_API_SECRET || 'test-secret-12345';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface CreateCallRequest {
  toNumber: string;
  systemInstructions: string;
  callInstructions: string;
  voice?: string;
}

export interface CreateCallResponse {
  callSid: string;
  status: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface TwilioEvent {
  type: string;
  timestamp: string;
  data: any;
}

export interface OpenAIEvent {
  type: string;
  timestamp: string;
  data: any;
}

export interface Call {
  _id: string;
  callSid: string;
  fromNumber: string;
  toNumber: string;
  callType: 'inbound' | 'outbound';
  voice: string;
  callContext: string;
  conversationHistory: ConversationMessage[];
  twilioEvents?: TwilioEvent[];
  openaiEvents?: OpenAIEvent[];
  systemInstructions?: string;
  callInstructions?: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  status: 'initiated' | 'in-progress' | 'completed' | 'failed' | 'on_hold' | 'active';
  errorMessage?: string;
}

export const callsApi = {
  list: async () => {
    const response = await api.get('/api/calls');
    return response;
  },

  create: async (data: CreateCallRequest) => {
    const response = await api.post<CreateCallResponse>(
      `/api/calls/create?apiSecret=${API_SECRET}`,
      {
        To: data.toNumber,
        systemInstructions: data.systemInstructions,
        callInstructions: data.callInstructions,
        voice: data.voice,
      }
    );
    return response;
  },

  get: async (callSid: string) => {
    const response = await api.get(`/api/calls/${callSid}`);
    return response;
  },

  hold: async (callSid: string) => {
    const response = await api.post(`/api/calls/${callSid}/hold`);
    return response;
  },

  resume: async (callSid: string) => {
    const response = await api.post(`/api/calls/${callSid}/resume`);
    return response;
  },

  hangup: async (callSid: string) => {
    const response = await api.post(`/api/calls/${callSid}/hangup`);
    return response;
  },

  injectContext: async (callSid: string, context: string) => {
    const response = await api.post(`/api/calls/${callSid}/inject-context`, {
      context,
    });
    return response;
  },
};

export interface IncomingConfig {
  phoneNumber: string;
  name: string;
  systemInstructions: string;
  callInstructions: string;
  voice: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIncomingConfigRequest {
  phoneNumber: string;
  name: string;
  systemInstructions: string;
  callInstructions: string;
  voice?: string;
  enabled?: boolean;
}

export interface UpdateIncomingConfigRequest {
  name?: string;
  systemInstructions?: string;
  callInstructions?: string;
  voice?: string;
  enabled?: boolean;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  sid: string;
  voiceUrl: string | null;
  hasVoiceWebhook: boolean;
  isConfigured: boolean;
  config: IncomingConfig | null;
}

export const incomingConfigsApi = {
  listAvailableNumbers: async () => {
    const response = await api.get<AvailableNumber[]>('/api/incoming-configs/available-numbers');
    return response;
  },

  list: async () => {
    const response = await api.get<IncomingConfig[]>('/api/incoming-configs');
    return response;
  },

  create: async (data: CreateIncomingConfigRequest) => {
    const response = await api.post<IncomingConfig>('/api/incoming-configs', data);
    return response;
  },

  update: async (phoneNumber: string, data: UpdateIncomingConfigRequest) => {
    const response = await api.put<IncomingConfig>(`/api/incoming-configs/${encodeURIComponent(phoneNumber)}`, data);
    return response;
  },

  delete: async (phoneNumber: string) => {
    const response = await api.delete(`/api/incoming-configs/${encodeURIComponent(phoneNumber)}`);
    return response;
  },
};

export interface Context {
  _id: string;
  name: string;
  description?: string;
  systemInstructions: string;
  exampleCallInstructions?: string;
  contextType: 'incoming' | 'outgoing' | 'both';
  createdAt: string;
  updatedAt: string;
}

export interface CreateContextRequest {
  name: string;
  description?: string;
  systemInstructions: string;
  exampleCallInstructions?: string;
  contextType: 'incoming' | 'outgoing' | 'both';
}

export interface UpdateContextRequest {
  name?: string;
  description?: string;
  systemInstructions?: string;
  exampleCallInstructions?: string;
  contextType?: 'incoming' | 'outgoing' | 'both';
}

export const contextsApi = {
  list: async (type?: 'incoming' | 'outgoing' | 'both') => {
    const params = type ? `?type=${type}` : '';
    const response = await api.get<Context[]>(`/api/contexts${params}`);
    return response;
  },

  get: async (id: string) => {
    const response = await api.get<Context>(`/api/contexts/${id}`);
    return response;
  },

  create: async (data: CreateContextRequest) => {
    const response = await api.post<Context>('/api/contexts', data);
    return response;
  },

  update: async (id: string, data: UpdateContextRequest) => {
    const response = await api.put<Context>(`/api/contexts/${id}`, data);
    return response;
  },

  delete: async (id: string) => {
    const response = await api.delete(`/api/contexts/${id}`);
    return response;
  },
};
