import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { callsApi, contextsApi } from '../services/api';
import './HomePage.css';

// Available OpenAI Realtime API voices
// Supported voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar
const AVAILABLE_VOICES = [
  { value: 'alloy', label: 'Alloy (Neutral)' },
  { value: 'ash', label: 'Ash (Warm)' },
  { value: 'ballad', label: 'Ballad (Storytelling)' },
  { value: 'coral', label: 'Coral (Bright)' },
  { value: 'echo', label: 'Echo (Male)' },
  { value: 'sage', label: 'Sage (Mature)' },
  { value: 'shimmer', label: 'Shimmer (Soft Female)' },
  { value: 'verse', label: 'Verse (Expressive)' },
  { value: 'marin', label: 'Marin (Clear)' },
  { value: 'cedar', label: 'Cedar (Deep)' },
];

export function HomePage() {
  const navigate = useNavigate();
  const [toNumber, setToNumber] = useState('');
  const [voice, setVoice] = useState('sage');
  const [systemInstructions, setSystemInstructions] = useState(
    `You are an AI assistant making an outbound phone call.

IDENTITY & ROLE:
- You represent [Your Company/Organization]
- Your purpose is to [state specific purpose]
- You have access to [relevant information/capabilities]

COMMUNICATION STYLE:
- Speak naturally in short, conversational sentences
- Be warm, friendly, and professional
- Use active listening - acknowledge what they say before responding
- Ask ONE question at a time and wait for their response
- Never interrupt or talk over the person

CONVERSATION FLOW:
1. Greet them warmly and introduce yourself/purpose
2. Confirm you're speaking with the right person
3. [State your specific conversation goals]
4. Listen actively and respond to their needs
5. Handle objections respectfully
6. Close naturally with next steps (if applicable)

IMPORTANT RULES:
- If they ask to be removed from calls, apologize and confirm removal
- If they're busy, offer to call back at a better time
- Never be pushy or aggressive
- Always be truthful and transparent
- End the call politely when the conversation concludes

Remember: This system prompt FULLY defines your behavior. Follow these instructions exactly.`
  );
  const [callInstructions, setCallInstructions] = useState('');
  const [lastCallSid, setLastCallSid] = useState<string | null>(null);
  const [lastCallStatus, setLastCallStatus] = useState<string | null>(null);

  // Fetch contexts for outgoing calls (type: outgoing or both)
  const { data: contextsResponse } = useQuery({
    queryKey: ['contexts', 'outgoing'],
    queryFn: () => contextsApi.list(),
  });

  const contexts = (contextsResponse?.data || []).filter(
    (ctx) => ctx.contextType === 'outgoing' || ctx.contextType === 'both'
  );

  const createCallMutation = useMutation({
    mutationFn: callsApi.create,
    onSuccess: (response) => {
      setLastCallSid(response.data.callSid);
      setLastCallStatus(response.data.status);
      setToNumber('');
      // Navigate to call page after 1 second
      setTimeout(() => {
        navigate(`/call/${response.data.callSid}`);
      }, 1000);
    },
    onError: (error: any) => {
      alert(`Error: ${error.response?.data?.error || error.message}`);
    },
  });

  const handleLoadContext = (contextId: string) => {
    if (!contextId) return;

    const context = contexts.find((ctx) => ctx._id === contextId);
    if (context) {
      setSystemInstructions(context.systemInstructions);
      // Context template doesn't have call-specific instructions, user will provide them
      setCallInstructions('');
    }
  };

  const handleCreateCall = (e: React.FormEvent) => {
    e.preventDefault();

    if (!toNumber) {
      alert('Please enter a phone number');
      return;
    }

    if (!systemInstructions) {
      alert('Please enter system instructions');
      return;
    }

    createCallMutation.mutate({
      toNumber,
      systemInstructions,
      callInstructions,
      voice,
    });
  };

  return (
    <div className="home-page">
      <div className="create-call-section">
        <h2>Make a New Call</h2>
        <form onSubmit={handleCreateCall} className="call-form">
          <div className="form-group">
            <label>Phone Number</label>
            <input
              type="tel"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              placeholder="+15551234567"
              required
            />
          </div>

          <div className="form-group">
            <label>AI Voice</label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              required
            >
              {AVAILABLE_VOICES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          {contexts.length > 0 && (
            <div className="form-group">
              <label>Load from Template</label>
              <select
                onChange={(e) => handleLoadContext(e.target.value)}
                defaultValue=""
              >
                <option value="">-- Select a context template --</option>
                {contexts.map((ctx) => (
                  <option key={ctx._id} value={ctx._id}>
                    {ctx.name} ({ctx.contextType})
                  </option>
                ))}
              </select>
              <small>Optional: Load a saved context template (you can edit after loading)</small>
            </div>
          )}

          <div className="form-group">
            <label>System Instructions</label>
            <textarea
              value={systemInstructions}
              onChange={(e) => setSystemInstructions(e.target.value)}
              placeholder="Enter system instructions for the AI assistant..."
              rows={6}
              required
            />
            <small>The AI's system prompt/role for the call</small>
          </div>

          <div className="form-group">
            <label>Call Instructions</label>
            <input
              type="text"
              value={callInstructions}
              onChange={(e) => setCallInstructions(e.target.value)}
              placeholder="This is a follow-up call about order #12345"
              required
            />
            <small>Specific instructions for the AI about this particular call (context, purpose, etc.)</small>
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={createCallMutation.isPending}
          >
            {createCallMutation.isPending ? 'Starting Call...' : 'Start Call'}
          </button>
        </form>

        {lastCallSid && (
          <div className="call-result">
            <h3>✅ Call Initiated!</h3>
            <p><strong>Call SID:</strong> {lastCallSid}</p>
            <p><strong>Status:</strong> {lastCallStatus}</p>
            <p>The AI will call the number shortly.</p>
          </div>
        )}
      </div>
    </div>
  );
}
