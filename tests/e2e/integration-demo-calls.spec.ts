/**
 * Integration Demo Tests - Full Call Handling Workflow
 * Tests the complete integration between agents, calls, and real-time features
 */

import { test, expect, Page } from '@playwright/test';

// Mock call scenarios for comprehensive testing
const callScenarios = [
  {
    id: 'support-inbound',
    type: 'inbound',
    agentName: 'Customer Support Agent',
    callerNumber: '+15559876543',
    agentNumber: '+15551234567',
    duration: 180,
    scenario: 'billing_inquiry',
    context: {
      customer_id: 'CUST_12345',
      account_type: 'premium',
      issue_category: 'billing',
      priority: 'medium'
    }
  },
  {
    id: 'sales-outbound',
    type: 'outbound',
    agentName: 'Sales Outreach Agent',
    callerNumber: '+15552345678',
    targetNumber: '+15558765432',
    duration: 420,
    scenario: 'lead_qualification',
    context: {
      lead_source: 'website',
      interest_level: 'high',
      company_size: '50-100',
      budget_range: '10k-25k'
    }
  },
  {
    id: 'tech-support',
    type: 'inbound',
    agentName: 'Technical Support Agent',
    callerNumber: '+15559999888',
    agentNumber: '+15553456789',
    duration: 600,
    scenario: 'technical_issue',
    context: {
      software_version: '2.1.0',
      error_code: 'AUTH_FAIL_001',
      user_tier: 'enterprise',
      urgency: 'high'
    }
  }
];

class CallHandlingDemo {
  constructor(private page: Page) {}

  async setupMockAgent(agentData: any) {
    // Mock agent creation and phone assignment
    await this.page.route('**/api/agents', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: [{
            id: agentData.id,
            name: agentData.name,
            type: agentData.type,
            phone_number: agentData.phone_number,
            system_prompt: agentData.system_prompt,
            voice: agentData.voice,
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            total_calls: agentData.total_calls || 0,
            total_minutes: agentData.total_minutes || 0
          }]
        });
      }
    });
  }

  async simulateInboundCall(scenario: typeof callScenarios[0]) {
    const callSid = `CA${Date.now()}`;
    
    // Mock incoming call webhook
    await this.page.route('**/api/calls/active', async (route) => {
      await route.fulfill({
        json: [{
          id: `session_${callSid}`,
          call_sid: callSid,
          agent_id: 'agent_support',
          from_number: scenario.callerNumber,
          to_number: scenario.agentNumber,
          direction: scenario.type,
          status: 'active',
          started_at: new Date().toISOString(),
          system_prompt: 'You are a helpful customer support representative.',
          voice: 'alloy',
          context_data: scenario.context,
          transcript_count: 0,
          command_count: 0,
          override_count: 0,
          estimated_cost: 0.15,
          openai_tokens: 45,
          twilio_cost: 0.013
        }]
      });
    });

    return callSid;
  }

  async simulateCallProgression(callSid: string, scenario: typeof callScenarios[0]) {
    // Simulate transcript updates
    const transcripts = [
      { speaker: 'caller', text: 'Hello, I need help with my billing statement', confidence: 0.95 },
      { speaker: 'assistant', text: 'Hello! I\'d be happy to help you with your billing inquiry. Can you please provide your account number?', confidence: 0.98 },
      { speaker: 'caller', text: 'Sure, it\'s account number 12345', confidence: 0.92 },
      { speaker: 'assistant', text: 'Thank you. I can see your premium account here. What specific billing question do you have?', confidence: 0.97 }
    ];

    // Mock real-time transcript updates
    for (let i = 0; i < transcripts.length; i++) {
      await this.page.route('**/api/calls/*/transcripts', async (route) => {
        await route.fulfill({
          json: transcripts.slice(0, i + 1).map((t, index) => ({
            id: `transcript_${index}`,
            session_id: `session_${callSid}`,
            call_sid: callSid,
            speaker: t.speaker,
            text: t.text,
            confidence: t.confidence,
            timestamp: new Date(Date.now() - (transcripts.length - index) * 10000).toISOString()
          }))
        });
      });
    }
  }

  async verifyRealTimeUpdates(callSid: string) {
    // Navigate to active calls page
    await this.page.goto('/calls');
    await this.page.waitForLoadState('networkidle');

    // Verify call appears in active calls
    const callSession = this.page.locator(`[data-testid="call-session"][data-call-sid="${callSid}"]`);
    await expect(callSession).toBeVisible();

    // Verify real-time transcript updates
    await expect(callSession.locator('[data-testid="latest-transcript"]')).toBeVisible();
    
    // Check that transcript is updating
    await expect(callSession.locator('text=Hello, I need help')).toBeVisible();
  }

  async demonstrateContextEditing(callSid: string) {
    const callSession = this.page.locator(`[data-testid="call-session"][data-call-sid="${callSid}"]`);
    
    // Click edit context button
    await callSession.locator('[data-testid="edit-context-button"]').click();
    await this.page.waitForSelector('[data-testid="context-edit-dialog"]');

    // Add resolution notes
    await this.page.fill('[data-testid="context-notes-input"]', 
      'Customer called about billing discrepancy. Issue identified in monthly charges. Refund processed.');

    // Add structured context data
    await this.page.click('[data-testid="add-context-field"]');
    await this.page.fill('[data-testid="context-key-input"]:last-of-type', 'resolution_type');
    await this.page.fill('[data-testid="context-value-input"]:last-of-type', 'refund_processed');

    await this.page.click('[data-testid="add-context-field"]');
    await this.page.fill('[data-testid="context-key-input"]:last-of-type', 'refund_amount');
    await this.page.fill('[data-testid="context-value-input"]:last-of-type', '45.99');

    await this.page.click('[data-testid="add-context-field"]');
    await this.page.fill('[data-testid="context-key-input"]:last-of-type', 'customer_satisfaction');
    await this.page.fill('[data-testid="context-value-input"]:last-of-type', 'satisfied');

    // Save context changes
    await this.page.click('[data-testid="save-context-button"]');
    
    // Verify success message
    await expect(this.page.locator('[data-testid="context-updated-message"]')).toBeVisible();
    await expect(this.page.locator('text=Context updated successfully')).toBeVisible();

    // Verify context appears in call session
    await expect(callSession.locator('text=refund_processed')).toBeVisible();
    await expect(callSession.locator('text=45.99')).toBeVisible();
  }

  async simulateCallCompletion(callSid: string, scenario: typeof callScenarios[0]) {
    // Mock call completion
    await this.page.route(`**/api/calls/${callSid}/complete`, async (route) => {
      await route.fulfill({
        json: {
          call_sid: callSid,
          status: 'completed',
          duration_seconds: scenario.duration,
          final_cost: 0.45,
          summary: 'Call completed successfully'
        }
      });
    });

    // Update active calls to show as completed
    await this.page.route('**/api/calls/active', async (route) => {
      await route.fulfill({ json: [] });
    });

    // Mock call history
    await this.page.route('**/api/calls/history', async (route) => {
      await route.fulfill({
        json: [{
          id: `session_${callSid}`,
          call_sid: callSid,
          agent_id: 'agent_support',
          from_number: scenario.callerNumber,
          to_number: scenario.agentNumber,
          direction: scenario.type,
          status: 'completed',
          started_at: new Date(Date.now() - scenario.duration * 1000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: scenario.duration,
          estimated_cost: 0.45,
          transcript_count: 8,
          resolution: 'Issue resolved - refund processed'
        }]
      });
    });
  }
}

test.describe('Call Handling Integration Demo', () => {
  let callDemo: CallHandlingDemo;

  test.beforeEach(async ({ page }) => {
    callDemo = new CallHandlingDemo(page);
    
    // Setup base agent data
    await callDemo.setupMockAgent({
      id: 'agent_support',
      name: 'Customer Support Agent',
      type: 'inbound',
      phone_number: '+15551234567',
      system_prompt: 'You are a helpful customer support representative.',
      voice: 'alloy',
      total_calls: 15,
      total_minutes: 240
    });
  });

  test('Complete Inbound Call Lifecycle Demo', async ({ page }) => {
    const scenario = callScenarios[0];
    
    // Step 1: Simulate incoming call
    const callSid = await callDemo.simulateInboundCall(scenario);
    
    // Step 2: Verify call appears in system
    await callDemo.verifyRealTimeUpdates(callSid);
    
    // Step 3: Simulate conversation progression
    await callDemo.simulateCallProgression(callSid, scenario);
    
    // Step 4: Demonstrate real-time context editing
    await callDemo.demonstrateContextEditing(callSid);
    
    // Step 5: Complete the call
    await callDemo.simulateCallCompletion(callSid, scenario);
    
    // Step 6: Verify call moved to history
    await page.goto('/calls/history');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator(`[data-call-sid="${callSid}"]`)).toBeVisible();
    await expect(page.locator('text=completed')).toBeVisible();
    await expect(page.locator('text=Issue resolved - refund processed')).toBeVisible();
  });

  test('Multi-Channel Call Management Demo', async ({ page }) => {
    // Simulate multiple concurrent calls
    const activeCallSids: string[] = [];
    
    for (const scenario of callScenarios) {
      const callSid = await callDemo.simulateInboundCall(scenario);
      activeCallSids.push(callSid);
      
      // Add small delay to simulate real timing
      await page.waitForTimeout(100);
    }

    // Mock multiple active calls
    await page.route('**/api/calls/active', async (route) => {
      const activeCalls = callScenarios.map((scenario, index) => ({
        id: `session_${activeCallSids[index]}`,
        call_sid: activeCallSids[index],
        agent_id: `agent_${index}`,
        from_number: scenario.callerNumber,
        to_number: scenario.agentNumber || scenario.callerNumber,
        direction: scenario.type,
        status: 'active',
        started_at: new Date(Date.now() - (index + 1) * 30000).toISOString(),
        agent: { name: scenario.agentName, type: scenario.type },
        context_data: scenario.context,
        duration: (index + 1) * 30 // seconds
      }));
      
      await route.fulfill({ json: activeCalls });
    });

    // Navigate to active calls
    await page.goto('/calls');
    await page.waitForLoadState('networkidle');

    // Verify all calls are displayed
    await expect(page.locator('[data-testid="call-session"]')).toHaveCount(3);

    // Verify different call types are shown
    await expect(page.locator('text=inbound')).toHaveCount(2);
    await expect(page.locator('text=outbound')).toHaveCount(1);

    // Verify agent names are displayed
    await expect(page.locator('text=Customer Support Agent')).toBeVisible();
    await expect(page.locator('text=Sales Outreach Agent')).toBeVisible();
    await expect(page.locator('text=Technical Support Agent')).toBeVisible();

    // Test filtering by call type
    await page.click('[data-testid="filter-inbound"]');
    await expect(page.locator('[data-testid="call-session"]')).toHaveCount(2);

    await page.click('[data-testid="filter-outbound"]');
    await expect(page.locator('[data-testid="call-session"]')).toHaveCount(1);

    await page.click('[data-testid="filter-all"]');
    await expect(page.locator('[data-testid="call-session"]')).toHaveCount(3);
  });

  test('Supervisor Override Demo', async ({ page }) => {
    const scenario = callScenarios[2]; // Technical support scenario
    const callSid = await callDemo.simulateInboundCall(scenario);

    // Navigate to active calls
    await page.goto('/calls');
    await page.waitForLoadState('networkidle');

    const callSession = page.locator(`[data-testid="call-session"][data-call-sid="${callSid}"]`);
    
    // Mock supervisor override capability
    await page.route('**/api/calls/*/override', async (route) => {
      const body = JSON.parse(await route.request().postData() || '{}');
      await route.fulfill({
        json: {
          success: true,
          action: body.action,
          message: `Override ${body.action} executed successfully`
        }
      });
    });

    // Test text override
    await callSession.locator('[data-testid="supervisor-controls-button"]').click();
    await expect(page.locator('[data-testid="supervisor-panel"]')).toBeVisible();

    // Send text message to call
    await page.fill('[data-testid="override-text-input"]', 
      'Hello, this is a supervisor message. I see you\'re having login issues. Let me transfer you to our senior technical team.');
    await page.click('[data-testid="send-text-override"]');

    // Verify override was sent
    await expect(page.locator('[data-testid="override-success-message"]')).toBeVisible();
    await expect(page.locator('text=Override text executed successfully')).toBeVisible();

    // Test call transfer
    await page.fill('[data-testid="transfer-number-input"]', '+15558888999');
    await page.click('[data-testid="transfer-call-button"]');

    // Verify transfer initiated
    await expect(page.locator('text=Override transfer executed successfully')).toBeVisible();

    // Test call termination
    await page.click('[data-testid="end-call-button"]');
    await page.click('[data-testid="confirm-end-call"]'); // Confirmation dialog

    // Verify call ended
    await expect(page.locator('text=Override end executed successfully')).toBeVisible();
  });

  test('Real-Time Analytics Demo', async ({ page }) => {
    // Mock real-time call statistics
    await page.route('**/api/analytics/realtime', async (route) => {
      await route.fulfill({
        json: {
          active_calls: 12,
          calls_today: 156,
          average_duration: 240,
          agent_utilization: {
            'Customer Support Agent': 85,
            'Sales Outreach Agent': 72,
            'Technical Support Agent': 93
          },
          call_outcomes: {
            resolved: 89,
            transferred: 12,
            callback_scheduled: 8,
            escalated: 3
          },
          peak_hours: [
            { hour: 9, calls: 24 },
            { hour: 10, calls: 31 },
            { hour: 11, calls: 28 },
            { hour: 14, calls: 33 },
            { hour: 15, calls: 27 }
          ]
        }
      });
    });

    // Navigate to analytics dashboard
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');

    // Verify real-time metrics
    await expect(page.locator('[data-testid="active-calls-metric"]')).toHaveText('12');
    await expect(page.locator('[data-testid="calls-today-metric"]')).toHaveText('156');
    await expect(page.locator('[data-testid="avg-duration-metric"]')).toHaveText('4m 0s');

    // Verify agent utilization chart
    await expect(page.locator('[data-testid="utilization-chart"]')).toBeVisible();
    await expect(page.locator('text=85%')).toBeVisible(); // Support agent
    await expect(page.locator('text=72%')).toBeVisible(); // Sales agent
    await expect(page.locator('text=93%')).toBeVisible(); // Tech support

    // Verify call outcomes pie chart
    await expect(page.locator('[data-testid="outcomes-chart"]')).toBeVisible();
    await expect(page.locator('text=89 resolved')).toBeVisible();
    await expect(page.locator('text=12 transferred')).toBeVisible();

    // Test real-time updates (simulate data refresh)
    await page.route('**/api/analytics/realtime', async (route) => {
      await route.fulfill({
        json: {
          active_calls: 14, // Increased
          calls_today: 158,
          average_duration: 235,
          agent_utilization: {
            'Customer Support Agent': 88,
            'Sales Outreach Agent': 75,
            'Technical Support Agent': 95
          },
          call_outcomes: {
            resolved: 91,
            transferred: 12,
            callback_scheduled: 8,
            escalated: 3
          }
        }
      });
    });

    // Trigger refresh (simulate real-time update)
    await page.click('[data-testid="refresh-analytics"]');
    await page.waitForTimeout(1000);

    // Verify updated metrics
    await expect(page.locator('[data-testid="active-calls-metric"]')).toHaveText('14');
    await expect(page.locator('[data-testid="calls-today-metric"]')).toHaveText('158');
  });

  test('Agent Performance Comparison Demo', async ({ page }) => {
    // Mock detailed agent performance data
    await page.route('**/api/agents/performance', async (route) => {
      await route.fulfill({
        json: [
          {
            agent_id: 'agent_support',
            name: 'Customer Support Agent',
            calls_today: 28,
            calls_this_week: 145,
            avg_call_duration: 185,
            customer_satisfaction: 4.7,
            first_call_resolution: 87,
            response_time_avg: 12,
            active_time_minutes: 420,
            efficiency_score: 92
          },
          {
            agent_id: 'agent_sales',
            name: 'Sales Outreach Agent',
            calls_today: 35,
            calls_this_week: 189,
            avg_call_duration: 310,
            conversion_rate: 23,
            lead_qualification: 78,
            response_time_avg: 8,
            active_time_minutes: 380,
            efficiency_score: 88
          },
          {
            agent_id: 'agent_tech',
            name: 'Technical Support Agent',
            calls_today: 18,
            calls_this_week: 98,
            avg_call_duration: 425,
            issue_resolution: 91,
            escalation_rate: 8,
            response_time_avg: 15,
            active_time_minutes: 470,
            efficiency_score: 95
          }
        ]
      });
    });

    await page.goto('/agents/performance');
    await page.waitForLoadState('networkidle');

    // Verify performance comparison table
    await expect(page.locator('[data-testid="performance-table"]')).toBeVisible();

    // Check individual agent metrics
    const supportRow = page.locator('[data-testid="agent-row"][data-agent-id="agent_support"]');
    await expect(supportRow.locator('[data-testid="calls-today"]')).toHaveText('28');
    await expect(supportRow.locator('[data-testid="satisfaction"]')).toHaveText('4.7');
    await expect(supportRow.locator('[data-testid="efficiency"]')).toHaveText('92%');

    const salesRow = page.locator('[data-testid="agent-row"][data-agent-id="agent_sales"]');
    await expect(salesRow.locator('[data-testid="conversion-rate"]')).toHaveText('23%');
    await expect(salesRow.locator('[data-testid="efficiency"]')).toHaveText('88%');

    const techRow = page.locator('[data-testid="agent-row"][data-agent-id="agent_tech"]');
    await expect(techRow.locator('[data-testid="resolution-rate"]')).toHaveText('91%');
    await expect(techRow.locator('[data-testid="efficiency"]')).toHaveText('95%');

    // Test sorting functionality
    await page.click('[data-testid="sort-by-efficiency"]');
    
    // Verify sorting order (Technical > Support > Sales)
    const sortedRows = page.locator('[data-testid="agent-row"]');
    await expect(sortedRows.first()).toHaveAttribute('data-agent-id', 'agent_tech');
    await expect(sortedRows.nth(1)).toHaveAttribute('data-agent-id', 'agent_support');
    await expect(sortedRows.nth(2)).toHaveAttribute('data-agent-id', 'agent_sales');

    // Test filtering by agent type
    await page.selectOption('[data-testid="filter-by-type"]', 'inbound');
    await expect(page.locator('[data-testid="agent-row"]')).toHaveCount(2);

    await page.selectOption('[data-testid="filter-by-type"]', 'outbound');
    await expect(page.locator('[data-testid="agent-row"]')).toHaveCount(1);
  });
});