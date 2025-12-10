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

  sendDTMF: async (callSid: string, digits: string) => {
    const response = await api.post(`/api/calls/${callSid}/dtmf`, {
      digits,
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

export interface SmsMessage {
  _id: string;
  messageSid: string;
  fromNumber: string;
  toNumber: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'received';
  twilioStatus?: string;
  errorMessage?: string;
  errorCode?: string;
  numMedia?: number;
  mediaUrls?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SendSmsRequest {
  toNumber: string;
  body: string;
  fromNumber?: string;
}

export interface SendSmsResponse {
  messageSid: string;
  status: string;
}

export interface ListMessagesFilters {
  direction?: 'inbound' | 'outbound';
  fromNumber?: string;
  toNumber?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export const smsApi = {
  send: async (data: SendSmsRequest) => {
    const response = await api.post<SendSmsResponse>('/api/sms/send', data);
    return response;
  },

  list: async (filters?: ListMessagesFilters) => {
    const params = new URLSearchParams();
    if (filters?.direction) params.append('direction', filters.direction);
    if (filters?.fromNumber) params.append('fromNumber', filters.fromNumber);
    if (filters?.toNumber) params.append('toNumber', filters.toNumber);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const queryString = params.toString();
    const url = queryString ? `/api/sms/messages?${queryString}` : '/api/sms/messages';
    const response = await api.get<SmsMessage[]>(url);
    return response;
  },

  get: async (messageSid: string) => {
    const response = await api.get<SmsMessage>(`/api/sms/messages/${messageSid}`);
    return response;
  },

  getConversation: async (phoneNumber1: string, phoneNumber2: string, limit?: number) => {
    const params = new URLSearchParams();
    params.append('phoneNumber1', phoneNumber1);
    params.append('phoneNumber2', phoneNumber2);
    if (limit) params.append('limit', limit.toString());

    const response = await api.get<SmsMessage[]>(`/api/sms/conversation?${params.toString()}`);
    return response;
  },
};

export interface Conversation {
  _id: string;
  conversationId: string;
  type: '1-to-1' | 'group';
  participants: string[];
  name?: string;
  createdBy: string;
  messageCount: number;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationRequest {
  participants: string[];
  createdBy: string;
  name?: string;
}

export interface UpdateConversationNameRequest {
  name: string;
}

export interface SendGroupSmsRequest {
  body: string;
  fromNumber: string;
}

export interface SendGroupSmsResponse {
  status: string;
  recipientCount: number;
  successCount: number;
  failCount: number;
  results: Array<{
    toNumber: string;
    messageSid?: string;
    status: string;
    error?: string;
  }>;
}

export const conversationsApi = {
  create: async (data: CreateConversationRequest) => {
    const response = await api.post<Conversation>('/api/conversations', data);
    return response;
  },

  list: async (phoneNumber: string, limit?: number) => {
    const params = new URLSearchParams();
    params.append('phoneNumber', phoneNumber);
    if (limit) params.append('limit', limit.toString());

    const response = await api.get<Conversation[]>(`/api/conversations?${params.toString()}`);
    return response;
  },

  get: async (conversationId: string) => {
    const response = await api.get<Conversation>(`/api/conversations/${conversationId}`);
    return response;
  },

  getMessages: async (conversationId: string, limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit.toString());

    const queryString = params.toString();
    const url = queryString
      ? `/api/conversations/${conversationId}/messages?${queryString}`
      : `/api/conversations/${conversationId}/messages`;

    const response = await api.get<SmsMessage[]>(url);
    return response;
  },

  addParticipant: async (conversationId: string, phoneNumber: string) => {
    const response = await api.post<Conversation>(
      `/api/conversations/${conversationId}/participants`,
      { phoneNumber }
    );
    return response;
  },

  removeParticipant: async (conversationId: string, phoneNumber: string) => {
    const response = await api.delete<Conversation>(
      `/api/conversations/${conversationId}/participants/${encodeURIComponent(phoneNumber)}`
    );
    return response;
  },

  updateName: async (conversationId: string, name: string) => {
    const response = await api.put<Conversation>(
      `/api/conversations/${conversationId}/name`,
      { name }
    );
    return response;
  },

  sendGroupMessage: async (conversationId: string, data: SendGroupSmsRequest) => {
    const response = await api.post<SendGroupSmsResponse>(
      `/api/conversations/${conversationId}/send`,
      data
    );
    return response;
  },
};
