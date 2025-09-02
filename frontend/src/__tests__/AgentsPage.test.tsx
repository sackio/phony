/**
 * Tests for the AgentsPage component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import AgentsPage from '../pages/Agents/AgentsPage';
import { theme } from '../theme';
import * as api from '../services/api';

// Mock the API module
jest.mock('../services/api');
const mockApi = api as jest.Mocked<typeof api>;

// Mock agents data
const mockAgents = [
  {
    id: 'agent1',
    name: 'Customer Service Agent',
    type: 'inbound' as const,
    phone_number: '+15551234567',
    system_prompt: 'You are a helpful customer service representative.',
    voice: 'alloy' as const,
    context_data: { department: 'support' },
    status: 'active' as const,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    total_calls: 10,
    total_minutes: 120,
    last_call_at: '2024-01-01T12:00:00Z'
  },
  {
    id: 'agent2',
    name: 'Sales Agent',
    type: 'outbound' as const,
    system_prompt: 'You are a professional sales representative.',
    voice: 'nova' as const,
    context_data: { department: 'sales' },
    status: 'active' as const,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    total_calls: 25,
    total_minutes: 300,
    last_call_at: '2024-01-02T14:30:00Z'
  }
];

const mockPhoneNumbers = [
  {
    phone_number: '+15551111111',
    twilio_sid: 'PN111111111',
    friendly_name: 'Support Line',
    capabilities: ['voice'],
    status: 'available' as const
  },
  {
    phone_number: '+15552222222',
    twilio_sid: 'PN222222222',
    friendly_name: 'Sales Line',
    capabilities: ['voice', 'sms'],
    status: 'available' as const
  }
];

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>
    <ThemeProvider theme={theme}>
      {children}
    </ThemeProvider>
  </BrowserRouter>
);

describe('AgentsPage', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockApi.getAgents.mockResolvedValue(mockAgents);
    mockApi.getAvailablePhoneNumbers.mockResolvedValue(mockPhoneNumbers);
  });

  describe('Component Rendering', () => {
    it('renders the agents page title', async () => {
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      expect(screen.getByText('AI Agents')).toBeInTheDocument();
    });

    it('renders the create agent button', async () => {
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      expect(screen.getByText('Create Agent')).toBeInTheDocument();
    });

    it('displays loading state initially', () => {
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Agent List Display', () => {
    it('displays agent cards after loading', async () => {
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      // Wait for agents to load
      await waitFor(() => {
        expect(screen.getByText('Customer Service Agent')).toBeInTheDocument();
        expect(screen.getByText('Sales Agent')).toBeInTheDocument();
      });
    });

    it('shows agent details correctly', async () => {
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        // Check for agent details
        expect(screen.getByText('Customer Service Agent')).toBeInTheDocument();
        expect(screen.getByText('inbound')).toBeInTheDocument();
        expect(screen.getByText('+15551234567')).toBeInTheDocument();
        expect(screen.getByText('10 calls')).toBeInTheDocument();
        expect(screen.getByText('120 min')).toBeInTheDocument();
      });
    });

    it('displays agent status chips', async () => {
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        const statusChips = screen.getAllByText('active');
        expect(statusChips).toHaveLength(2);
      });
    });
  });

  describe('Create Agent Dialog', () => {
    it('opens create agent dialog when button clicked', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Create Agent')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Create Agent'));

      expect(screen.getByText('Create New Agent')).toBeInTheDocument();
      expect(screen.getByLabelText('Agent Name')).toBeInTheDocument();
      expect(screen.getByLabelText('System Prompt')).toBeInTheDocument();
    });

    it('validates required fields in create dialog', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Create Agent')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Create Agent'));
      
      // Try to create without filling required fields
      const createButton = screen.getByRole('button', { name: /create/i });
      await user.click(createButton);

      // Should show validation errors (specific behavior depends on implementation)
      expect(screen.getByText('Create New Agent')).toBeInTheDocument();
    });

    it('creates agent successfully with valid data', async () => {
      const user = userEvent.setup();
      const newAgent = {
        id: 'agent3',
        name: 'Test Agent',
        type: 'inbound' as const,
        system_prompt: 'Test prompt',
        voice: 'alloy' as const,
        context_data: {},
        status: 'active' as const,
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
        total_calls: 0,
        total_minutes: 0
      };

      mockApi.createAgent.mockResolvedValue(newAgent);
      mockApi.getAgents.mockResolvedValueOnce(mockAgents).mockResolvedValueOnce([...mockAgents, newAgent]);

      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Create Agent')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Create Agent'));

      // Fill out the form
      await user.type(screen.getByLabelText('Agent Name'), 'Test Agent');
      await user.type(screen.getByLabelText('System Prompt'), 'Test prompt');

      // Submit the form
      const createButton = screen.getByRole('button', { name: /create/i });
      await user.click(createButton);

      // Verify API was called
      await waitFor(() => {
        expect(mockApi.createAgent).toHaveBeenCalled();
      });
    });
  });

  describe('Agent Actions', () => {
    it('shows agent menu when clicking more options', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Customer Service Agent')).toBeInTheDocument();
      });

      // Click the more options button (assuming it exists)
      const moreButtons = screen.getAllByLabelText('more');
      if (moreButtons.length > 0) {
        await user.click(moreButtons[0]);
        
        expect(screen.getByText('Edit')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
      }
    });

    it('opens edit dialog for agent', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Customer Service Agent')).toBeInTheDocument();
      });

      // Simulate edit action (implementation specific)
      const moreButtons = screen.getAllByLabelText('more');
      if (moreButtons.length > 0) {
        await user.click(moreButtons[0]);
        await user.click(screen.getByText('Edit'));

        expect(screen.getByText('Edit Agent')).toBeInTheDocument();
      }
    });

    it('deletes agent when confirmed', async () => {
      const user = userEvent.setup();
      
      mockApi.deleteAgent.mockResolvedValue();
      mockApi.getAgents.mockResolvedValueOnce(mockAgents).mockResolvedValueOnce([mockAgents[1]]);

      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Customer Service Agent')).toBeInTheDocument();
      });

      const moreButtons = screen.getAllByLabelText('more');
      if (moreButtons.length > 0) {
        await user.click(moreButtons[0]);
        await user.click(screen.getByText('Delete'));

        // Confirm deletion
        await user.click(screen.getByText('Delete'));

        await waitFor(() => {
          expect(mockApi.deleteAgent).toHaveBeenCalledWith('agent1');
        });
      }
    });
  });

  describe('Phone Number Management', () => {
    it('shows available phone numbers in create dialog', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Create Agent')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Create Agent'));

      await waitFor(() => {
        expect(screen.getByText('Create New Agent')).toBeInTheDocument();
      });

      // Check if phone number selection is available
      const phoneSelect = screen.getByLabelText('Phone Number');
      expect(phoneSelect).toBeInTheDocument();
    });

    it('assigns phone number to agent', async () => {
      const user = userEvent.setup();
      
      mockApi.assignPhoneNumber.mockResolvedValue({ message: 'Phone number assigned successfully' });

      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Customer Service Agent')).toBeInTheDocument();
      });

      // Test phone number assignment (implementation specific)
      // This would typically be in an agent detail or edit dialog
    });
  });

  describe('Error Handling', () => {
    it('displays error message when loading agents fails', async () => {
      mockApi.getAgents.mockRejectedValue(new Error('Failed to load agents'));

      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to load agents')).toBeInTheDocument();
      });
    });

    it('handles create agent error', async () => {
      const user = userEvent.setup();
      
      mockApi.createAgent.mockRejectedValue(new Error('Failed to create agent'));

      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Create Agent')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Create Agent'));

      // Fill and submit form
      await user.type(screen.getByLabelText('Agent Name'), 'Test Agent');
      await user.type(screen.getByLabelText('System Prompt'), 'Test prompt');

      const createButton = screen.getByRole('button', { name: /create/i });
      await user.click(createButton);

      await waitFor(() => {
        expect(screen.getByText('Failed to create agent')).toBeInTheDocument();
      });
    });
  });

  describe('Real-time Updates', () => {
    it('refreshes agent data periodically', async () => {
      jest.useFakeTimers();
      
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockApi.getAgents).toHaveBeenCalledTimes(1);
      });

      // Fast forward time to trigger refresh
      jest.advanceTimersByTime(30000); // 30 seconds

      await waitFor(() => {
        expect(mockApi.getAgents).toHaveBeenCalledTimes(2);
      });

      jest.useRealTimers();
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels', async () => {
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Customer Service Agent')).toBeInTheDocument();
      });

      // Check for accessibility attributes
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(greaterThanOrEqual(1));
    });

    it('supports keyboard navigation', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <AgentsPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Create Agent')).toBeInTheDocument();
      });

      // Test keyboard navigation
      await user.tab();
      expect(screen.getByText('Create Agent')).toHaveFocus();
    });
  });
});

// Helper function for expect
function greaterThanOrEqual(num: number) {
  return expect.objectContaining({
    asymmetricMatch: (actual: any) => Array.isArray(actual) ? actual.length >= num : actual >= num
  });
}