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
  callContext: string;
  voice?: string;
}

export interface CreateCallResponse {
  callSid: string;
  status: string;
}

export const callsApi = {
  list: async () => {
    const response = await api.get('/api/calls');
    return response;
  },

  create: async (data: CreateCallRequest) => {
    const queryParams = new URLSearchParams({
      apiSecret: API_SECRET,
      callContext: data.callContext,
    });

    if (data.voice) {
      queryParams.append('voice', data.voice);
    }

    const response = await api.post<CreateCallResponse>(
      `/api/calls/create?${queryParams.toString()}`,
      {
        To: data.toNumber,
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
