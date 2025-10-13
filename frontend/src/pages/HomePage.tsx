import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { callsApi } from '../services/api';
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
  const [callContext, setCallContext] = useState(
    `GOAL: Have a friendly check-in conversation with the person.

APPROACH:
- Greet them warmly and introduce yourself as an AI assistant
- Ask how they're doing and what they've been up to
- Have a natural back-and-forth conversation
- Listen actively and respond to what they share
- When the conversation naturally concludes, thank them and say goodbye

REMEMBER: This is a casual, friendly conversation - be warm, authentic, and genuinely interested in what they have to say.`
  );
  const [lastCallSid, setLastCallSid] = useState<string | null>(null);
  const [lastCallStatus, setLastCallStatus] = useState<string | null>(null);

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

  const handleCreateCall = (e: React.FormEvent) => {
    e.preventDefault();

    if (!toNumber) {
      alert('Please enter a phone number');
      return;
    }

    if (!callContext) {
      alert('Please enter call context/instructions');
      return;
    }

    createCallMutation.mutate({
      toNumber,
      callContext,
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

          <div className="form-group">
            <label>Call Context / Instructions</label>
            <textarea
              value={callContext}
              onChange={(e) => setCallContext(e.target.value)}
              placeholder="Enter instructions for the AI assistant..."
              rows={8}
              required
            />
            <small>This will be the AI's system prompt for the call</small>
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

      <div className="info-section">
        <h3>How It Works</h3>
        <ul>
          <li>Enter the recipient's phone number in E.164 format (e.g., +15551234567)</li>
          <li>Customize the AI's instructions and personality</li>
          <li>Click "Start Call" to initiate the outbound call</li>
          <li>The AI will use OpenAI's Realtime API for natural conversation</li>
          <li>Voice Activity Detection (VAD) allows natural interruptions</li>
        </ul>
      </div>
    </div>
  );
}
