/**
 * Tests for the API service module
 */

import { api } from '../services/api';
import { Agent } from '../types/Agent';

// Mock fetch globally
global.fetch = jest.fn();
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('API Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  describe('Agent API', () => {
    const mockAgent: Agent = {
      id: 'agent123',
      name: 'Test Agent',
      type: 'inbound',
      system_prompt: 'You are a test assistant.',
      voice: 'alloy',
      context_data: { department: 'support' },
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      total_calls: 10,
      total_minutes: 120,
      last_call_at: '2024-01-01T12:00:00Z'
    };

    describe('getAgents', () => {
      it('fetches agents successfully', async () => {
        const mockResponse = [mockAgent];
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

        const result = await api.getAgents();

        expect(mockFetch).toHaveBeenCalledWith('/api/agents');
        expect(result).toEqual(mockResponse);
      });

      it('handles fetch error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        await expect(api.getAgents()).rejects.toThrow('Network error');
      });

      it('handles non-ok response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        } as Response);

        await expect(api.getAgents()).rejects.toThrow();
      });
    });

    describe('getAgent', () => {
      it('fetches single agent successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockAgent,
        } as Response);

        const result = await api.getAgent('agent123');

        expect(mockFetch).toHaveBeenCalledWith('/api/agents/agent123');
        expect(result).toEqual(mockAgent);
      });

      it('handles agent not found', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response);

        await expect(api.getAgent('nonexistent')).rejects.toThrow();
      });
    });

    describe('createAgent', () => {
      const createAgentData = {
        name: 'New Agent',
        type: 'inbound' as const,
        system_prompt: 'You are a helpful assistant.',
        voice: 'alloy' as const,
        context_data: {}
      };

      it('creates agent successfully', async () => {
        const createdAgent = { ...mockAgent, ...createAgentData, id: 'new-agent' };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => createdAgent,
        } as Response);

        const result = await api.createAgent(createAgentData);

        expect(mockFetch).toHaveBeenCalledWith('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createAgentData),
        });
        expect(result).toEqual(createdAgent);
      });

      it('handles validation errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
        } as Response);

        await expect(api.createAgent(createAgentData)).rejects.toThrow();
      });
    });

    describe('updateAgent', () => {
      const updateData = { name: 'Updated Agent' };

      it('updates agent successfully', async () => {
        const updatedAgent = { ...mockAgent, ...updateData };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => updatedAgent,
        } as Response);

        const result = await api.updateAgent('agent123', updateData);

        expect(mockFetch).toHaveBeenCalledWith('/api/agents/agent123', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });
        expect(result).toEqual(updatedAgent);
      });
    });

    describe('deleteAgent', () => {
      it('deletes agent successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
        } as Response);

        await api.deleteAgent('agent123');

        expect(mockFetch).toHaveBeenCalledWith('/api/agents/agent123', {
          method: 'DELETE',
        });
      });

      it('handles agent not found on delete', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response);

        await expect(api.deleteAgent('nonexistent')).rejects.toThrow();
      });
    });
  });

  describe('Phone Number API', () => {
    const mockPhoneNumber = {
      phone_number: '+15551234567',
      twilio_sid: 'PN123456789',
      friendly_name: 'Test Number',
      capabilities: ['voice', 'sms'],
      status: 'available' as const
    };

    describe('getAvailablePhoneNumbers', () => {
      it('fetches available phone numbers', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [mockPhoneNumber],
        } as Response);

        const result = await api.getAvailablePhoneNumbers();

        expect(mockFetch).toHaveBeenCalledWith('/api/phone-numbers/available');
        expect(result).toEqual([mockPhoneNumber]);
      });
    });

    describe('assignPhoneNumber', () => {
      it('assigns phone number successfully', async () => {
        const response = { message: 'Phone number assigned successfully' };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => response,
        } as Response);

        const result = await api.assignPhoneNumber('+15551234567', 'agent123');

        expect(mockFetch).toHaveBeenCalledWith('/api/phone-numbers/+15551234567/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: 'agent123' }),
        });
        expect(result).toEqual(response);
      });

      it('handles assignment failure', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
        } as Response);

        await expect(api.assignPhoneNumber('+15551234567', 'agent123')).rejects.toThrow();
      });
    });

    describe('unassignPhoneNumber', () => {
      it('unassigns phone number successfully', async () => {
        const response = { message: 'Phone number unassigned successfully' };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => response,
        } as Response);

        const result = await api.unassignPhoneNumber('+15551234567');

        expect(mockFetch).toHaveBeenCalledWith('/api/phone-numbers/+15551234567/unassign', {
          method: 'POST',
        });
        expect(result).toEqual(response);
      });
    });
  });

  describe('Call Context API', () => {
    const mockContext = {
      id: 'context123',
      agent_id: 'agent123',
      call_sid: 'CA123456',
      context_data: { customer_name: 'John Doe' },
      notes: 'VIP customer',
      call_status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    };

    describe('getContextByAgent', () => {
      it('fetches context by agent ID', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockContext,
        } as Response);

        const result = await api.getContextByAgent('agent123');

        expect(mockFetch).toHaveBeenCalledWith('/api/contexts/agent/agent123');
        expect(result).toEqual(mockContext);
      });
    });

    describe('updateContext', () => {
      const updateData = {
        notes: 'Updated notes',
        context_data: { priority: 'high' }
      };

      it('updates context successfully', async () => {
        const updatedContext = { ...mockContext, ...updateData };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => updatedContext,
        } as Response);

        const result = await api.updateContext('CA123456', updateData);

        expect(mockFetch).toHaveBeenCalledWith('/api/contexts/CA123456', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });
        expect(result).toEqual(updatedContext);
      });
    });
  });

  describe('Call Session API', () => {
    const mockSession = {
      id: 'session123',
      call_sid: 'CA123456',
      agent_id: 'agent123',
      from_number: '+15551111111',
      to_number: '+15552222222',
      direction: 'inbound' as const,
      status: 'active' as const,
      started_at: '2024-01-01T00:00:00Z',
      system_prompt: 'Test prompt',
      voice: 'alloy',
      context_data: {},
      transcript_count: 5,
      command_count: 2,
      override_count: 0,
      estimated_cost: 1.25,
      openai_tokens: 150,
      twilio_cost: 0.75
    };

    describe('getActiveCalls', () => {
      it('fetches active calls', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [mockSession],
        } as Response);

        const result = await api.getActiveCalls();

        expect(mockFetch).toHaveBeenCalledWith('/api/calls/active');
        expect(result).toEqual([mockSession]);
      });
    });

    describe('getCallSession', () => {
      it('fetches call session by SID', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockSession,
        } as Response);

        const result = await api.getCallSession('CA123456');

        expect(mockFetch).toHaveBeenCalledWith('/api/calls/CA123456');
        expect(result).toEqual(mockSession);
      });
    });

    describe('makeOutboundCall', () => {
      const callData = {
        to_number: '+15559999999',
        context_override: { priority: 'high' }
      };

      it('initiates outbound call successfully', async () => {
        const response = { call_sid: 'CA987654321', status: 'queued' };
        
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => response,
        } as Response);

        const result = await api.makeOutboundCall('agent123', callData);

        expect(mockFetch).toHaveBeenCalledWith('/api/agents/agent123/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(callData),
        });
        expect(result).toEqual(response);
      });
    });
  });

  describe('Agent Stats API', () => {
    const mockStats = [
      {
        agent_id: 'agent123',
        name: 'Test Agent',
        type: 'inbound',
        total_calls: 10,
        total_minutes: 120,
        status: 'active',
        phone_number: '+15551234567'
      }
    ];

    describe('getAgentStats', () => {
      it('fetches agent statistics', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockStats,
        } as Response);

        const result = await api.getAgentStats();

        expect(mockFetch).toHaveBeenCalledWith('/api/agents/stats');
        expect(result).toEqual(mockStats);
      });
    });
  });

  describe('Error Handling', () => {
    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      await expect(api.getAgents()).rejects.toThrow('Failed to fetch');
    });

    it('handles HTTP error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(api.getAgents()).rejects.toThrow();
    });

    it('handles JSON parsing errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Response);

      await expect(api.getAgents()).rejects.toThrow('Invalid JSON');
    });
  });

  describe('Request Configuration', () => {
    it('uses correct base URL and headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

      await api.getAgents();

      expect(mockFetch).toHaveBeenCalledWith('/api/agents');
    });

    it('includes proper headers for POST requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({}),
      } as Response);

      await api.createAgent({
        name: 'Test',
        type: 'inbound',
        system_prompt: 'Test',
        voice: 'alloy',
        context_data: {}
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String),
      });
    });
  });
});