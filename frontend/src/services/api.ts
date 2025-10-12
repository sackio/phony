import axios from 'axios';

// @ts-ignore - Vite env variables
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3004';
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
  create: async (data: CreateCallRequest) => {
    const queryParams = new URLSearchParams({
      apiSecret: API_SECRET,
      callContext: data.callContext,
    });

    if (data.voice) {
      queryParams.append('voice', data.voice);
    }

    const response = await api.post<CreateCallResponse>(
      `/call/outgoing?${queryParams.toString()}`,
      {
        From: process.env.TWILIO_NUMBER || '+18578167225',
        To: data.toNumber,
      }
    );
    return response;
  },
};
