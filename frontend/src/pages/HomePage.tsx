import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { callsApi } from '../services/api';
import './HomePage.css';

// Available OpenAI Realtime API voices
const AVAILABLE_VOICES = [
  { value: 'alloy', label: 'Alloy (Neutral)' },
  { value: 'echo', label: 'Echo (Male)' },
  { value: 'fable', label: 'Fable (British Male)' },
  { value: 'onyx', label: 'Onyx (Deep Male)' },
  { value: 'nova', label: 'Nova (Female)' },
  { value: 'shimmer', label: 'Shimmer (Soft Female)' },
  { value: 'sage', label: 'Sage (Mature)' },
];

export function HomePage() {
  const [toNumber, setToNumber] = useState('');
  const [voice, setVoice] = useState('sage');
  const [callContext, setCallContext] = useState(
    `You are a friendly AI assistant calling to have a conversation.
Start by greeting the person warmly and introducing yourself as Claude, an AI voice assistant.
Have a natural, conversational interaction.
When the conversation naturally winds down or they say goodbye, wish them a great day and end the call.`
  );
  const [lastCallSid, setLastCallSid] = useState<string | null>(null);
  const [lastCallStatus, setLastCallStatus] = useState<string | null>(null);

  const createCallMutation = useMutation({
    mutationFn: callsApi.create,
    onSuccess: (response) => {
      setLastCallSid(response.data.callSid);
      setLastCallStatus(response.data.status);
      setToNumber('');
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
