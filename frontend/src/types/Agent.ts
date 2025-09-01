export interface Agent {
  id: string;
  name: string;
  type: 'inbound' | 'outbound';
  phone_number?: string;
  twilio_sid?: string;
  system_prompt: string;
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  personality?: string;
  context_data: Record<string, any>;
  greeting_message?: string;
  status: 'active' | 'inactive' | 'disabled';
  created_at: string;
  updated_at: string;
  total_calls: number;
  total_minutes: number;
  last_call_at?: string;
}

export interface CallContext {
  id: string;
  agent_id: string;
  call_sid?: string;
  context_data: Record<string, any>;
  notes: string;
  caller_number?: string;
  call_direction?: 'inbound' | 'outbound';
  call_status: string;
  created_at: string;
  updated_at: string;
}

export interface PhoneNumber {
  phone_number: string;
  twilio_sid: string;
  friendly_name?: string;
  assigned_agent_id?: string;
  capabilities: string[];
  status: 'available' | 'assigned' | 'disabled';
}

export interface CallSession {
  id: string;
  call_sid: string;
  agent_id: string;
  from_number: string;
  to_number: string;
  direction: 'inbound' | 'outbound';
  status: 'initiated' | 'ringing' | 'active' | 'completed' | 'failed';
  started_at: string;
  answered_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  system_prompt: string;
  voice: string;
  context_data: Record<string, any>;
  transcript_count: number;
  command_count: number;
  override_count: number;
  estimated_cost: number;
  openai_tokens: number;
  twilio_cost: number;
}

export interface AgentStats {
  agent_id: string;
  name: string;
  type: string;
  total_calls: number;
  total_minutes: number;
  last_call_at?: string;
  status: string;
  phone_number?: string;
}

export interface OutboundCallRequest {
  agent_id: string;
  to_number: string;
  from_number?: string;
  context_override?: Record<string, any>;
}

export interface ContextUpdateRequest {
  context_data?: Record<string, any>;
  notes?: string;
}

export interface ActiveCall {
  session: CallSession;
  agent: Agent | null;
  context: CallContext | null;
  duration: number;
}