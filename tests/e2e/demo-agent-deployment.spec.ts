/**
 * Playwright Demo Tests for Agent Deployment System
 * Full end-to-end demonstration of agent management functionality
 */

import { test, expect, Page } from '@playwright/test';

// Demo data for realistic testing scenarios
const demoAgents = [
  {
    name: 'Customer Support Agent',
    type: 'inbound',
    systemPrompt: 'You are a friendly and helpful customer support representative. Always greet customers warmly and assist them with their inquiries about our products and services.',
    voice: 'alloy',
    department: 'support',
    phoneNumber: '+15551234567'
  },
  {
    name: 'Sales Outreach Agent',
    type: 'outbound',
    systemPrompt: 'You are a professional sales representative. Your goal is to introduce potential customers to our services and qualify leads. Be consultative, not pushy.',
    voice: 'nova',
    department: 'sales',
    phoneNumber: '+15552345678'
  },
  {
    name: 'Technical Support Agent',
    type: 'inbound',
    systemPrompt: 'You are a technical support specialist. Help customers troubleshoot issues with our software. Be patient and provide step-by-step guidance.',
    voice: 'echo',
    department: 'technical',
    phoneNumber: '+15553456789'
  }
];

const demoPhoneNumbers = [
  { number: '+15551234567', name: 'Support Hotline', capabilities: ['voice', 'sms'] },
  { number: '+15552345678', name: 'Sales Line', capabilities: ['voice'] },
  { number: '+15553456789', name: 'Tech Support', capabilities: ['voice', 'sms'] },
  { number: '+15554567890', name: 'General Inquiries', capabilities: ['voice'] }
];

// Page Object Model for Agent Management
class AgentManagementDemo {
  constructor(private page: Page) {}

  async navigateToDashboard() {
    await this.page.goto('/dashboard');
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToAgents() {
    await this.page.goto('/agents');
    await this.page.waitForLoadState('networkidle');
    // Wait for agents page to load
    await this.page.waitForSelector('[data-testid="agents-page"]', { timeout: 10000 });
  }

  async createAgent(agent: typeof demoAgents[0]) {
    // Click create agent button
    await this.page.click('[data-testid="create-agent-button"]');
    await this.page.waitForSelector('[data-testid="create-agent-dialog"]');

    // Fill agent details
    await this.page.fill('[data-testid="agent-name-input"]', agent.name);
    await this.page.selectOption('[data-testid="agent-type-select"]', agent.type);
    await this.page.fill('[data-testid="system-prompt-input"]', agent.systemPrompt);
    await this.page.selectOption('[data-testid="voice-select"]', agent.voice);
    
    // Add context data
    await this.page.click('[data-testid="add-context-button"]');
    await this.page.fill('[data-testid="context-key-input"]', 'department');
    await this.page.fill('[data-testid="context-value-input"]', agent.department);

    // Submit form
    await this.page.click('[data-testid="create-agent-submit"]');
    
    // Wait for success message
    await this.page.waitForSelector('[data-testid="success-message"]', { timeout: 5000 });
  }

  async assignPhoneNumber(agentName: string, phoneNumber: string) {
    // Find agent card and open menu
    const agentCard = this.page.locator(`[data-testid="agent-card"]:has-text("${agentName}")`);
    await agentCard.locator('[data-testid="agent-menu-button"]').click();
    
    // Click assign phone option
    await this.page.click('[data-testid="assign-phone-option"]');
    await this.page.waitForSelector('[data-testid="assign-phone-dialog"]');
    
    // Select phone number
    await this.page.selectOption('[data-testid="phone-number-select"]', phoneNumber);
    await this.page.click('[data-testid="assign-phone-submit"]');
    
    // Wait for success
    await this.page.waitForSelector('[data-testid="success-message"]');
  }

  async makeOutboundCall(agentName: string, targetNumber: string) {
    // Find agent and open menu
    const agentCard = this.page.locator(`[data-testid="agent-card"]:has-text("${agentName}")`);
    await agentCard.locator('[data-testid="agent-menu-button"]').click();
    
    // Click make call option
    await this.page.click('[data-testid="make-call-option"]');
    await this.page.waitForSelector('[data-testid="outbound-call-dialog"]');
    
    // Fill target number
    await this.page.fill('[data-testid="to-number-input"]', targetNumber);
    
    // Add call context
    await this.page.fill('[data-testid="call-notes-input"]', `Outbound call demonstration to ${targetNumber}`);
    
    // Initiate call
    await this.page.click('[data-testid="initiate-call-button"]');
    
    // Wait for call initiated message
    await this.page.waitForSelector('[data-testid="call-initiated-message"]');
  }

  async updateCallContext(callSid: string, notes: string, contextData: Record<string, any>) {
    // Navigate to active calls
    await this.page.goto('/calls');
    await this.page.waitForLoadState('networkidle');
    
    // Find the call session
    const callSession = this.page.locator(`[data-testid="call-session"][data-call-sid="${callSid}"]`);
    await callSession.locator('[data-testid="edit-context-button"]').click();
    
    // Update notes
    await this.page.fill('[data-testid="context-notes-input"]', notes);
    
    // Update context data
    for (const [key, value] of Object.entries(contextData)) {
      await this.page.click('[data-testid="add-context-field"]');
      await this.page.fill('[data-testid="context-key-input"]:last-of-type', key);
      await this.page.fill('[data-testid="context-value-input"]:last-of-type', String(value));
    }
    
    // Save changes
    await this.page.click('[data-testid="save-context-button"]');
    await this.page.waitForSelector('[data-testid="context-updated-message"]');
  }

  async verifyAgentStats(expectedAgents: number, expectedCalls: number) {
    await this.navigateToDashboard();
    
    // Check agent count
    const agentCount = await this.page.locator('[data-testid="total-agents-count"]').textContent();
    expect(agentCount).toBe(expectedAgents.toString());
    
    // Check calls count (if any)
    if (expectedCalls > 0) {
      const callsCount = await this.page.locator('[data-testid="total-calls-count"]').textContent();
      expect(parseInt(callsCount || '0')).toBeGreaterThanOrEqual(expectedCalls);
    }
  }
}

test.describe('Agent Deployment System - Full Demo', () => {
  let agentDemo: AgentManagementDemo;

  test.beforeEach(async ({ page }) => {
    agentDemo = new AgentManagementDemo(page);
    
    // Setup mock API responses for demo
    await page.route('**/api/agents', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        // Return demo agents if they exist, empty array initially
        await route.fulfill({ json: [] });
      } else if (method === 'POST') {
        const body = JSON.parse(await route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          json: {
            id: `agent-${Date.now()}`,
            ...body,
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            total_calls: 0,
            total_minutes: 0
          }
        });
      }
    });

    // Mock phone numbers API
    await page.route('**/api/phone-numbers/available', async (route) => {
      await route.fulfill({
        json: demoPhoneNumbers.map(phone => ({
          phone_number: phone.number,
          twilio_sid: `PN${Date.now()}`,
          friendly_name: phone.name,
          capabilities: phone.capabilities,
          status: 'available'
        }))
      });
    });

    // Mock phone assignment
    await page.route('**/api/phone-numbers/*/assign', async (route) => {
      await route.fulfill({
        json: { message: 'Phone number assigned successfully' }
      });
    });

    // Mock outbound calls
    await page.route('**/api/agents/*/call', async (route) => {
      await route.fulfill({
        json: {
          call_sid: `CA${Date.now()}`,
          status: 'queued',
          message: 'Call initiated successfully'
        }
      });
    });
  });

  test('Complete Agent Deployment Demo - Customer Support Setup', async ({ page }) => {
    // Step 1: Navigate to agents page
    await agentDemo.navigateToAgents();
    
    // Verify we start with no agents
    await expect(page.locator('[data-testid="no-agents-message"]')).toBeVisible();
    
    // Step 2: Create Customer Support Agent
    await agentDemo.createAgent(demoAgents[0]);
    
    // Verify agent was created
    await expect(page.locator(`text=${demoAgents[0].name}`)).toBeVisible();
    await expect(page.locator('text=inbound')).toBeVisible();
    await expect(page.locator('text=alloy')).toBeVisible();
    
    // Step 3: Assign phone number
    await agentDemo.assignPhoneNumber(demoAgents[0].name, demoAgents[0].phoneNumber);
    
    // Verify phone assignment
    await expect(page.locator(`text=${demoAgents[0].phoneNumber}`)).toBeVisible();
    
    // Step 4: Verify agent is ready for inbound calls
    const agentCard = page.locator(`[data-testid="agent-card"]:has-text("${demoAgents[0].name}")`);
    await expect(agentCard.locator('[data-testid="agent-status"]')).toHaveText('active');
    await expect(agentCard.locator('[data-testid="agent-phone"]')).toHaveText(demoAgents[0].phoneNumber);
  });

  test('Sales Agent Outbound Call Demo', async ({ page }) => {
    // Setup: Create sales agent first
    await agentDemo.navigateToAgents();
    await agentDemo.createAgent(demoAgents[1]); // Sales agent
    await agentDemo.assignPhoneNumber(demoAgents[1].name, demoAgents[1].phoneNumber);
    
    // Demo: Make outbound call
    const targetNumber = '+15559876543';
    await agentDemo.makeOutboundCall(demoAgents[1].name, targetNumber);
    
    // Verify call initiation
    await expect(page.locator('[data-testid="call-initiated-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="call-initiated-message"]')).toContainText('Call initiated successfully');
    
    // Verify call appears in active calls (navigate to calls page)
    await page.goto('/calls');
    await page.waitForLoadState('networkidle');
    
    // Should see the outbound call in progress
    await expect(page.locator(`text=${targetNumber}`)).toBeVisible();
    await expect(page.locator('text=outbound')).toBeVisible();
  });

  test('Multi-Agent Enterprise Setup Demo', async ({ page }) => {
    await agentDemo.navigateToAgents();
    
    // Create multiple agents to demonstrate enterprise setup
    for (const agent of demoAgents) {
      await agentDemo.createAgent(agent);
      
      // Verify each agent was created
      await expect(page.locator(`text=${agent.name}`)).toBeVisible();
    }
    
    // Assign phone numbers to each agent
    for (const agent of demoAgents) {
      await agentDemo.assignPhoneNumber(agent.name, agent.phoneNumber);
    }
    
    // Verify all agents are properly configured
    await expect(page.locator('[data-testid="agent-card"]')).toHaveCount(3);
    
    // Check each agent has correct configuration
    for (const agent of demoAgents) {
      const agentCard = page.locator(`[data-testid="agent-card"]:has-text("${agent.name}")`);
      await expect(agentCard.locator(`text=${agent.type}`)).toBeVisible();
      await expect(agentCard.locator(`text=${agent.voice}`)).toBeVisible();
      await expect(agentCard.locator(`text=${agent.phoneNumber}`)).toBeVisible();
    }
    
    // Navigate to dashboard and verify summary statistics
    await agentDemo.verifyAgentStats(3, 0);
  });

  test('Real-time Call Context Management Demo', async ({ page }) => {
    // Setup: Create technical support agent
    await agentDemo.navigateToAgents();
    await agentDemo.createAgent(demoAgents[2]); // Technical support
    await agentDemo.assignPhoneNumber(demoAgents[2].name, demoAgents[2].phoneNumber);
    
    // Simulate an incoming call (mock active call)
    const mockCallSid = 'CA123456789';
    await page.route('**/api/calls/active', async (route) => {
      await route.fulfill({
        json: [{
          id: 'session123',
          call_sid: mockCallSid,
          agent_id: 'agent-tech',
          from_number: '+15559999999',
          to_number: demoAgents[2].phoneNumber,
          direction: 'inbound',
          status: 'active',
          started_at: new Date().toISOString(),
          agent: {
            name: demoAgents[2].name,
            type: demoAgents[2].type
          },
          context: {
            customer_name: 'Demo Customer',
            issue_type: 'software_bug',
            priority: 'medium'
          }
        }]
      });
    });
    
    // Navigate to active calls
    await page.goto('/calls');
    await page.waitForLoadState('networkidle');
    
    // Verify active call is displayed
    await expect(page.locator(`[data-call-sid="${mockCallSid}"]`)).toBeVisible();
    await expect(page.locator('text=Demo Customer')).toBeVisible();
    await expect(page.locator('text=software_bug')).toBeVisible();
    
    // Demo: Update call context in real-time
    await agentDemo.updateCallContext(mockCallSid, 'Customer reported login issues with version 2.1.0', {
      software_version: '2.1.0',
      error_code: 'AUTH_FAIL_001',
      resolution_status: 'in_progress'
    });
    
    // Verify context update
    await expect(page.locator('[data-testid="context-updated-message"]')).toBeVisible();
  });

  test('Agent Performance Analytics Demo', async ({ page }) => {
    // Setup: Create agents and simulate call history
    await agentDemo.navigateToAgents();
    
    // Mock agents with call statistics
    await page.route('**/api/agents/stats', async (route) => {
      await route.fulfill({
        json: [
          {
            agent_id: 'agent-support',
            name: 'Customer Support Agent',
            type: 'inbound',
            total_calls: 45,
            total_minutes: 320,
            status: 'active',
            phone_number: '+15551234567',
            last_call_at: new Date().toISOString()
          },
          {
            agent_id: 'agent-sales',
            name: 'Sales Outreach Agent', 
            type: 'outbound',
            total_calls: 28,
            total_minutes: 180,
            status: 'active',
            phone_number: '+15552345678',
            last_call_at: new Date(Date.now() - 3600000).toISOString()
          },
          {
            agent_id: 'agent-tech',
            name: 'Technical Support Agent',
            type: 'inbound',
            total_calls: 12,
            total_minutes: 95,
            status: 'active',
            phone_number: '+15553456789',
            last_call_at: new Date(Date.now() - 7200000).toISOString()
          }
        ]
      });
    });
    
    // Navigate to dashboard
    await agentDemo.navigateToDashboard();
    
    // Verify analytics are displayed
    await expect(page.locator('[data-testid="agent-stats-card"]')).toBeVisible();
    await expect(page.locator('text=45 calls')).toBeVisible(); // Support agent
    await expect(page.locator('text=320 min')).toBeVisible();
    await expect(page.locator('text=28 calls')).toBeVisible(); // Sales agent
    await expect(page.locator('text=180 min')).toBeVisible();
    
    // Check total statistics
    await expect(page.locator('[data-testid="total-agents-count"]')).toHaveText('3');
    await expect(page.locator('[data-testid="total-calls-count"]')).toHaveText('85'); // 45+28+12
    
    // Navigate to agents page to see individual performance
    await page.click('[data-testid="view-all-agents-button"]');
    await page.waitForLoadState('networkidle');
    
    // Verify individual agent statistics
    const supportCard = page.locator('[data-testid="agent-card"]:has-text("Customer Support Agent")');
    await expect(supportCard.locator('[data-testid="calls-count"]')).toHaveText('45 calls');
    await expect(supportCard.locator('[data-testid="minutes-count"]')).toHaveText('320 min');
    
    const salesCard = page.locator('[data-testid="agent-card"]:has-text("Sales Outreach Agent")');
    await expect(salesCard.locator('[data-testid="calls-count"]')).toHaveText('28 calls');
    await expect(salesCard.locator('[data-testid="minutes-count"]')).toHaveText('180 min');
  });

  test('Error Handling and Edge Cases Demo', async ({ page }) => {
    await agentDemo.navigateToAgents();
    
    // Test 1: Invalid phone number assignment
    await page.route('**/api/phone-numbers/*/assign', async (route) => {
      await route.fulfill({
        status: 400,
        json: { detail: 'Phone number is already assigned to another agent' }
      });
    });
    
    await agentDemo.createAgent(demoAgents[0]);
    
    // Try to assign phone number (should fail)
    const agentCard = page.locator(`[data-testid="agent-card"]:has-text("${demoAgents[0].name}")`);
    await agentCard.locator('[data-testid="agent-menu-button"]').click();
    await page.click('[data-testid="assign-phone-option"]');
    await page.selectOption('[data-testid="phone-number-select"]', '+15551234567');
    await page.click('[data-testid="assign-phone-submit"]');
    
    // Verify error message is displayed
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('text=already assigned')).toBeVisible();
    
    // Test 2: Network error during agent creation
    await page.route('**/api/agents', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          json: { detail: 'Internal server error' }
        });
      }
    });
    
    // Try to create another agent (should fail)
    await page.click('[data-testid="create-agent-button"]');
    await page.fill('[data-testid="agent-name-input"]', 'Test Agent');
    await page.selectOption('[data-testid="agent-type-select"]', 'inbound');
    await page.fill('[data-testid="system-prompt-input"]', 'Test prompt');
    await page.selectOption('[data-testid="voice-select"]', 'alloy');
    await page.click('[data-testid="create-agent-submit"]');
    
    // Verify error handling
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('text=Internal server error')).toBeVisible();
    
    // Dialog should remain open for retry
    await expect(page.locator('[data-testid="create-agent-dialog"]')).toBeVisible();
  });

  test('Accessibility and Keyboard Navigation Demo', async ({ page }) => {
    await agentDemo.navigateToAgents();
    
    // Test keyboard navigation
    await page.keyboard.press('Tab'); // Focus on create button
    await expect(page.locator('[data-testid="create-agent-button"]')).toBeFocused();
    
    await page.keyboard.press('Enter'); // Open create dialog
    await expect(page.locator('[data-testid="create-agent-dialog"]')).toBeVisible();
    
    // Navigate form with keyboard
    await page.keyboard.press('Tab'); // Focus name input
    await page.keyboard.type('Keyboard Test Agent');
    
    await page.keyboard.press('Tab'); // Focus type select
    await page.keyboard.press('ArrowDown'); // Select option
    
    await page.keyboard.press('Tab'); // Focus system prompt
    await page.keyboard.type('This agent was created using keyboard navigation');
    
    // Check ARIA labels and roles
    await expect(page.locator('[data-testid="agent-name-input"]')).toHaveAttribute('aria-label');
    await expect(page.locator('[data-testid="create-agent-dialog"]')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('[data-testid="create-agent-submit"]')).toHaveAttribute('type', 'submit');
    
    // Test high contrast and screen reader compatibility
    const nameInput = page.locator('[data-testid="agent-name-input"]');
    await expect(nameInput).toHaveAttribute('aria-required', 'true');
    
    // Verify focus indicators are visible
    await nameInput.focus();
    // Focus should be clearly visible (this would need visual regression testing in real scenarios)
  });
});

// Performance and Load Testing Demo
test.describe('Agent System Performance Demo', () => {
  test('Large Dataset Handling Demo', async ({ page }) => {
    // Mock a large number of agents
    const largeAgentList = Array.from({ length: 50 }, (_, i) => ({
      id: `agent-${i}`,
      name: `Demo Agent ${i + 1}`,
      type: i % 2 === 0 ? 'inbound' : 'outbound',
      phone_number: `+1555${String(i).padStart(7, '0')}`,
      system_prompt: `Demo system prompt for agent ${i + 1}`,
      voice: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'][i % 6],
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      total_calls: Math.floor(Math.random() * 100),
      total_minutes: Math.floor(Math.random() * 500)
    }));

    await page.route('**/api/agents', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: largeAgentList });
      }
    });

    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    // Verify all agents are rendered
    await expect(page.locator('[data-testid="agent-card"]')).toHaveCount(50);

    // Test search/filter functionality with large dataset
    await page.fill('[data-testid="agent-search-input"]', 'Demo Agent 1');
    await page.waitForTimeout(500); // Wait for debounced search

    // Should show filtered results
    const visibleCards = page.locator('[data-testid="agent-card"]:visible');
    await expect(visibleCards).toHaveCount(11); // Agents 1, 10, 11, 12, ..., 19

    // Test pagination if implemented
    if (await page.locator('[data-testid="pagination"]').isVisible()) {
      await page.click('[data-testid="next-page-button"]');
      await page.waitForLoadState('networkidle');
      // Verify pagination works correctly
    }

    // Performance check - page should load within reasonable time
    const loadTime = await page.evaluate(() => performance.now());
    expect(loadTime).toBeLessThan(5000); // 5 seconds max
  });
});