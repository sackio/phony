import axios, { AxiosResponse } from 'axios';
import {
  Agent,
  CallContext,
  PhoneNumber,
  CallSession,
  AgentStats,
  OutboundCallRequest,
  ContextUpdateRequest,
  ActiveCall
} from '../types/Agent';

const API_BASE_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:24187';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// Request interceptor for logging
api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export class AgentAPI {
  // Agent Management
  static async getAgents(): Promise<Agent[]> {
    const response: AxiosResponse<Agent[]> = await api.get('/agents/');
    return response.data;
  }

  static async getAgent(agentId: string): Promise<Agent> {
    const response: AxiosResponse<Agent> = await api.get(`/agents/${agentId}`);
    return response.data;
  }

  static async createAgent(agentData: Partial<Agent>): Promise<Agent> {
    const response: AxiosResponse<Agent> = await api.post('/agents/', agentData);
    return response.data;
  }

  static async updateAgent(agentId: string, updates: Partial<Agent>): Promise<Agent> {
    const response: AxiosResponse<Agent> = await api.put(`/agents/${agentId}`, updates);
    return response.data;
  }

  static async deleteAgent(agentId: string): Promise<void> {
    await api.delete(`/agents/${agentId}`);
  }

  static async getAgentStats(agentId: string): Promise<AgentStats> {
    const response: AxiosResponse<AgentStats> = await api.get(`/agents/${agentId}/stats`);
    return response.data;
  }

  // Context Management
  static async getAgentContext(agentId: string): Promise<CallContext> {
    const response: AxiosResponse<CallContext> = await api.get(`/agents/${agentId}/context`);
    return response.data;
  }

  static async updateAgentContext(agentId: string, contextData: ContextUpdateRequest): Promise<CallContext> {
    const response: AxiosResponse<CallContext> = await api.put(`/agents/${agentId}/context`, contextData);
    return response.data;
  }

  static async updateCallContext(callSid: string, contextData: ContextUpdateRequest): Promise<CallContext> {
    const response: AxiosResponse<CallContext> = await api.put(`/agents/call/${callSid}/context`, contextData);
    return response.data;
  }

  // Phone Number Management
  static async getAvailablePhoneNumbers(): Promise<PhoneNumber[]> {
    const response: AxiosResponse<PhoneNumber[]> = await api.get('/agents/phone-numbers/available');
    return response.data;
  }

  static async getAllPhoneNumbers(): Promise<PhoneNumber[]> {
    const response: AxiosResponse<PhoneNumber[]> = await api.get('/agents/phone-numbers/all');
    return response.data;
  }

  static async assignPhoneNumber(phoneNumber: string, agentId: string): Promise<void> {
    await api.post('/agents/phone-numbers/assign', {
      phone_number: phoneNumber,
      agent_id: agentId
    });
  }

  static async unassignPhoneNumber(phoneNumber: string): Promise<void> {
    await api.post(`/agents/phone-numbers/${encodeURIComponent(phoneNumber)}/unassign`);
  }

  // Call Management
  static async makeOutboundCall(callRequest: OutboundCallRequest): Promise<any> {
    const response = await api.post('/agents/call/outbound', callRequest);
    return response.data;
  }

  static async getActiveCalls(): Promise<Record<string, ActiveCall>> {
    const response: AxiosResponse<Record<string, ActiveCall>> = await api.get('/agents/calls/active');
    return response.data;
  }

  static async updateActiveCallContext(callSid: string, contextData: ContextUpdateRequest): Promise<CallContext> {
    const response: AxiosResponse<CallContext> = await api.post(`/agents/calls/${callSid}/context`, contextData);
    return response.data;
  }

  static async endCall(callSid: string): Promise<void> {
    await api.post(`/agents/calls/${callSid}/end`);
  }

  static async getCallStatus(callSid: string): Promise<any> {
    const response = await api.get(`/agents/calls/${callSid}/status`);
    return response.data;
  }
}

export default AgentAPI;