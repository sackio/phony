/**
 * End-to-end tests for agent management workflows
 * Uses Playwright to test the complete user journey
 */

import { test, expect, Page } from '@playwright/test';

// Test data
const mockAgent = {
  name: 'E2E Test Agent',
  type: 'inbound',
  systemPrompt: 'You are a helpful customer service representative for E2E testing.',
  voice: 'alloy',
  department: 'support'
};

const mockPhoneNumber = '+15551234567';

// Page Object Model
class AgentsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/agents');
  }

  async waitForLoad() {
    await this.page.waitForSelector('[data-testid="agents-page"]');
    await this.page.waitForLoadState('networkidle');
  }

  async clickCreateAgent() {
    await this.page.click('[data-testid="create-agent-button"]');
  }

  async fillAgentForm(agent: typeof mockAgent) {
    await this.page.fill('[data-testid="agent-name-input"]', agent.name);
    await this.page.selectOption('[data-testid="agent-type-select"]', agent.type);
    await this.page.fill('[data-testid="system-prompt-input"]', agent.systemPrompt);
    await this.page.selectOption('[data-testid="voice-select"]', agent.voice);
  }

  async submitAgentForm() {
    await this.page.click('[data-testid="create-agent-submit"]');
  }

  async getAgentCard(name: string) {
    return this.page.locator(`[data-testid="agent-card"]:has-text("${name}")`);
  }

  async openAgentMenu(name: string) {
    const card = await this.getAgentCard(name);
    await card.locator('[data-testid="agent-menu-button"]').click();
  }

  async clickEditAgent(name: string) {
    await this.openAgentMenu(name);
    await this.page.click('[data-testid="edit-agent-option"]');
  }

  async clickDeleteAgent(name: string) {
    await this.openAgentMenu(name);
    await this.page.click('[data-testid="delete-agent-option"]');
  }

  async confirmDelete() {
    await this.page.click('[data-testid="confirm-delete-button"]');
  }

  async assignPhoneNumber(agentName: string, phoneNumber: string) {
    await this.openAgentMenu(agentName);
    await this.page.click('[data-testid="assign-phone-option"]');
    await this.page.selectOption('[data-testid="phone-number-select"]', phoneNumber);
    await this.page.click('[data-testid="assign-phone-submit"]');
  }

  async makeOutboundCall(agentName: string, toNumber: string) {
    await this.openAgentMenu(agentName);
    await this.page.click('[data-testid="make-call-option"]');
    await this.page.fill('[data-testid="to-number-input"]', toNumber);
    await this.page.click('[data-testid="initiate-call-button"]');
  }
}

class DashboardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/dashboard');
  }

  async waitForLoad() {
    await this.page.waitForSelector('[data-testid="dashboard-page"]');
  }

  async getAgentStats() {
    return this.page.locator('[data-testid="agent-stats-card"]');
  }

  async getActiveCallsCount() {
    const element = await this.page.locator('[data-testid="active-calls-count"]');
    return await element.textContent();
  }
}

class ActiveCallsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/calls');
  }

  async waitForLoad() {
    await this.page.waitForSelector('[data-testid="active-calls-page"]');
  }

  async getCallSession(callSid: string) {
    return this.page.locator(`[data-testid="call-session"][data-call-sid="${callSid}"]`);
  }

  async updateCallContext(callSid: string, notes: string) {
    const session = await this.getCallSession(callSid);
    await session.locator('[data-testid="edit-context-button"]').click();
    await this.page.fill('[data-testid="context-notes-input"]', notes);
    await this.page.click('[data-testid="save-context-button"]');
  }
}

// Test suite
test.describe('Agent Management Workflows', () => {
  let agentsPage: AgentsPage;
  let dashboardPage: DashboardPage;
  let activeCallsPage: ActiveCallsPage;

  test.beforeEach(async ({ page }) => {
    agentsPage = new AgentsPage(page);
    dashboardPage = new DashboardPage(page);
    activeCallsPage = new ActiveCallsPage(page);
    
    // Mock API responses to avoid real backend dependency
    await page.route('**/api/agents', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          json: []  // Start with empty agents list
        });
      } else if (method === 'POST') {
        const body = await route.request().postData();
        const agentData = JSON.parse(body || '{}');
        await route.fulfill({
          status: 201,
          json: {
            id: 'agent-123',
            ...agentData,
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            total_calls: 0,
            total_minutes: 0
          }
        });
      }
    });

    await page.route('**/api/phone-numbers/available', async (route) => {
      await route.fulfill({
        json: [
          {
            phone_number: mockPhoneNumber,
            twilio_sid: 'PN123456789',
            friendly_name: 'Test Line',
            capabilities: ['voice'],
            status: 'available'
          }
        ]
      });
    });
  });

  test('Complete agent creation workflow', async ({ page }) => {
    await agentsPage.goto();
    await agentsPage.waitForLoad();

    // Verify empty state
    await expect(page.locator('[data-testid="no-agents-message"]')).toBeVisible();

    // Create new agent
    await agentsPage.clickCreateAgent();
    await expect(page.locator('[data-testid="create-agent-dialog"]')).toBeVisible();

    await agentsPage.fillAgentForm(mockAgent);
    await agentsPage.submitAgentForm();

    // Verify agent was created
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(agentsPage.getAgentCard(mockAgent.name)).toBeVisible();

    // Verify agent details
    const agentCard = await agentsPage.getAgentCard(mockAgent.name);
    await expect(agentCard.locator(`text=${mockAgent.type}`)).toBeVisible();
    await expect(agentCard.locator(`text=${mockAgent.voice}`)).toBeVisible();
  });

  test('Agent editing workflow', async ({ page }) => {
    // Setup: Create an agent first
    await page.route('**/api/agents', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: [{
            id: 'agent-123',
            name: mockAgent.name,
            type: mockAgent.type,
            system_prompt: mockAgent.systemPrompt,
            voice: mockAgent.voice,
            context_data: { department: mockAgent.department },
            status: 'active',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            total_calls: 5,
            total_minutes: 25
          }]
        });
      }
    });

    await page.route('**/api/agents/agent-123', async (route) => {
      if (route.request().method() === 'PUT') {
        const body = await route.request().postData();
        const updateData = JSON.parse(body || '{}');
        await route.fulfill({
          json: {
            id: 'agent-123',
            name: updateData.name || mockAgent.name,
            type: mockAgent.type,
            system_prompt: updateData.system_prompt || mockAgent.systemPrompt,
            voice: updateData.voice || mockAgent.voice,
            context_data: updateData.context_data || { department: mockAgent.department },
            status: 'active',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: new Date().toISOString(),
            total_calls: 5,
            total_minutes: 25
          }
        });
      }
    });

    await agentsPage.goto();
    await agentsPage.waitForLoad();

    // Edit agent
    await agentsPage.clickEditAgent(mockAgent.name);
    await expect(page.locator('[data-testid="edit-agent-dialog"]')).toBeVisible();

    // Update agent name
    const newName = 'Updated Agent Name';
    await page.fill('[data-testid="agent-name-input"]', '');
    await page.fill('[data-testid="agent-name-input"]', newName);
    await page.click('[data-testid="save-agent-button"]');

    // Verify update
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(agentsPage.getAgentCard(newName)).toBeVisible();
  });

  test('Phone number assignment workflow', async ({ page }) => {
    // Setup existing agent
    await page.route('**/api/agents', async (route) => {
      await route.fulfill({
        json: [{
          id: 'agent-123',
          name: mockAgent.name,
          type: mockAgent.type,
          system_prompt: mockAgent.systemPrompt,
          voice: mockAgent.voice,
          context_data: { department: mockAgent.department },
          status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          total_calls: 0,
          total_minutes: 0
        }]
      });
    });

    await page.route(`**/api/phone-numbers/${encodeURIComponent(mockPhoneNumber)}/assign`, async (route) => {
      await route.fulfill({
        json: { message: 'Phone number assigned successfully' }
      });
    });

    await agentsPage.goto();
    await agentsPage.waitForLoad();

    // Assign phone number
    await agentsPage.assignPhoneNumber(mockAgent.name, mockPhoneNumber);
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();

    // Verify assignment in UI
    const agentCard = await agentsPage.getAgentCard(mockAgent.name);
    await expect(agentCard.locator(`text=${mockPhoneNumber}`)).toBeVisible();
  });

  test('Outbound call initiation workflow', async ({ page }) => {
    // Setup existing agent with phone number
    await page.route('**/api/agents', async (route) => {
      await route.fulfill({
        json: [{
          id: 'agent-123',
          name: mockAgent.name,
          type: 'outbound',
          phone_number: mockPhoneNumber,
          system_prompt: mockAgent.systemPrompt,
          voice: mockAgent.voice,
          context_data: { department: mockAgent.department },
          status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          total_calls: 0,
          total_minutes: 0
        }]
      });
    });

    await page.route('**/api/agents/agent-123/call', async (route) => {
      await route.fulfill({
        json: {
          call_sid: 'CA123456789',
          status: 'queued',
          message: 'Call initiated successfully'
        }
      });
    });

    await agentsPage.goto();
    await agentsPage.waitForLoad();

    // Initiate outbound call
    const targetNumber = '+15559999999';
    await agentsPage.makeOutboundCall(mockAgent.name, targetNumber);
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.locator('text=Call initiated successfully')).toBeVisible();
  });

  test('Agent deletion workflow', async ({ page }) => {
    // Setup existing agent
    await page.route('**/api/agents', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: [{
            id: 'agent-123',
            name: mockAgent.name,
            type: mockAgent.type,
            system_prompt: mockAgent.systemPrompt,
            voice: mockAgent.voice,
            context_data: { department: mockAgent.department },
            status: 'active',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            total_calls: 0,
            total_minutes: 0
          }]
        });
      }
    });

    await page.route('**/api/agents/agent-123', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 204 });
      }
    });

    // Mock empty response after deletion
    await page.route('**/api/agents', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [] });
      }
    }, { times: 1 });

    await agentsPage.goto();
    await agentsPage.waitForLoad();

    // Delete agent
    await agentsPage.clickDeleteAgent(mockAgent.name);
    await expect(page.locator('[data-testid="delete-confirmation-dialog"]')).toBeVisible();
    await agentsPage.confirmDelete();

    // Verify deletion
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(agentsPage.getAgentCard(mockAgent.name)).not.toBeVisible();
    await expect(page.locator('[data-testid="no-agents-message"]')).toBeVisible();
  });

  test('Dashboard integration workflow', async ({ page }) => {
    // Setup agents with stats
    await page.route('**/api/agents/stats', async (route) => {
      await route.fulfill({
        json: [
          {
            agent_id: 'agent-123',
            name: mockAgent.name,
            type: mockAgent.type,
            total_calls: 15,
            total_minutes: 180,
            status: 'active',
            phone_number: mockPhoneNumber
          }
        ]
      });
    });

    await page.route('**/api/calls/active', async (route) => {
      await route.fulfill({ json: [] });
    });

    await dashboardPage.goto();
    await dashboardPage.waitForLoad();

    // Verify agent stats are displayed
    const statsCard = await dashboardPage.getAgentStats();
    await expect(statsCard).toBeVisible();
    await expect(statsCard.locator(`text=${mockAgent.name}`)).toBeVisible();
    await expect(statsCard.locator('text=15 calls')).toBeVisible();
    await expect(statsCard.locator('text=180 min')).toBeVisible();

    // Navigate to agents page from dashboard
    await page.click('[data-testid="view-all-agents-button"]');
    await expect(page).toHaveURL(/.*\/agents/);
  });

  test('Real-time call context editing workflow', async ({ page }) => {
    const callSid = 'CA123456789';
    
    // Setup active call
    await page.route('**/api/calls/active', async (route) => {
      await route.fulfill({
        json: [{
          id: 'session-123',
          call_sid: callSid,
          agent_id: 'agent-123',
          from_number: '+15551111111',
          to_number: mockPhoneNumber,
          direction: 'inbound',
          status: 'active',
          started_at: new Date().toISOString(),
          system_prompt: mockAgent.systemPrompt,
          voice: mockAgent.voice,
          context_data: { customer_name: 'John Doe' },
          transcript_count: 5,
          command_count: 0,
          override_count: 0,
          estimated_cost: 1.25,
          openai_tokens: 150,
          twilio_cost: 0.75
        }]
      });
    });

    await page.route(`**/api/contexts/${callSid}`, async (route) => {
      if (route.request().method() === 'PUT') {
        const body = await route.request().postData();
        const updateData = JSON.parse(body || '{}');
        await route.fulfill({
          json: {
            id: 'context-123',
            agent_id: 'agent-123',
            call_sid: callSid,
            context_data: updateData.context_data || { customer_name: 'John Doe' },
            notes: updateData.notes || 'Updated notes',
            call_status: 'active',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: new Date().toISOString()
          }
        });
      }
    });

    await activeCallsPage.goto();
    await activeCallsPage.waitForLoad();

    // Verify active call is displayed
    const callSession = await activeCallsPage.getCallSession(callSid);
    await expect(callSession).toBeVisible();
    await expect(callSession.locator('text=John Doe')).toBeVisible();

    // Update call context
    const newNotes = 'Customer issue resolved, very satisfied';
    await activeCallsPage.updateCallContext(callSid, newNotes);

    // Verify update
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(callSession.locator(`text=${newNotes}`)).toBeVisible();
  });

  test('Error handling workflow', async ({ page }) => {
    // Setup API error responses
    await page.route('**/api/agents', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          json: { error: 'Internal server error' }
        });
      } else {
        await route.fulfill({ json: [] });
      }
    });

    await agentsPage.goto();
    await agentsPage.waitForLoad();

    // Attempt to create agent with server error
    await agentsPage.clickCreateAgent();
    await agentsPage.fillAgentForm(mockAgent);
    await agentsPage.submitAgentForm();

    // Verify error message is displayed
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('text=Internal server error')).toBeVisible();

    // Verify dialog remains open for retry
    await expect(page.locator('[data-testid="create-agent-dialog"]')).toBeVisible();
  });

  test('Navigation and routing workflow', async ({ page }) => {
    await dashboardPage.goto();
    await dashboardPage.waitForLoad();

    // Test navigation between pages
    await page.click('[data-testid="nav-agents"]');
    await expect(page).toHaveURL(/.*\/agents/);

    await page.click('[data-testid="nav-phone-numbers"]');
    await expect(page).toHaveURL(/.*\/phone-numbers/);

    await page.click('[data-testid="nav-active-calls"]');
    await expect(page).toHaveURL(/.*\/calls/);

    await page.click('[data-testid="nav-dashboard"]');
    await expect(page).toHaveURL(/.*\/dashboard/);

    // Test browser back/forward
    await page.goBack();
    await expect(page).toHaveURL(/.*\/calls/);

    await page.goForward();
    await expect(page).toHaveURL(/.*\/dashboard/);
  });
});