import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { incomingConfigsApi, contextsApi, type AvailableNumber } from '../services/api';
import './IncomingConfigsPage.css';

// Available OpenAI Realtime API voices
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

export function IncomingConfigsPage() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<AvailableNumber | null>(null);

  // Form state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [name, setName] = useState('');
  const [systemInstructions, setSystemInstructions] = useState(`You are an AI assistant answering incoming calls.

IDENTITY & ROLE:
- You represent [Your Company/Organization]
- You handle incoming calls for [department/purpose]
- You have access to [relevant information/capabilities]

COMMUNICATION STYLE:
- Answer warmly and professionally
- Speak clearly in short, natural sentences
- Be patient and empathetic
- Use active listening - confirm understanding before responding
- Never interrupt the caller

CALL HANDLING:
1. Wait for caller to speak (if callInstructions is empty)
   OR Greet them warmly (if callInstructions provided)
2. Listen carefully to understand their need
3. Ask clarifying questions to fully understand
4. Provide clear, helpful information or assistance
5. Confirm they have what they need
6. Thank them for calling before ending

IMPORTANT RULES:
- If you don't know something, be honest and offer alternatives
- If they need human help, explain how to reach someone
- Stay calm and professional even if caller is frustrated
- Protect sensitive information - never share credentials/private data
- End calls politely and ensure caller satisfaction

Remember: This system prompt FULLY defines your behavior. Follow these instructions exactly.`);
  const [callInstructions, setCallInstructions] = useState('');
  const [voice, setVoice] = useState('sage');
  const [enabled, setEnabled] = useState(true);

  // Fetch available numbers with their configuration status
  const { data: numbersResponse, isLoading } = useQuery({
    queryKey: ['availableNumbers'],
    queryFn: incomingConfigsApi.listAvailableNumbers,
  });

  const availableNumbers = numbersResponse?.data || [];

  // Fetch contexts for incoming calls (type: incoming or both)
  const { data: contextsResponse } = useQuery({
    queryKey: ['contexts', 'incoming'],
    queryFn: () => contextsApi.list(),
  });

  const contexts = (contextsResponse?.data || []).filter(
    (ctx) => ctx.contextType === 'incoming' || ctx.contextType === 'both'
  );

  // Create mutation
  const createMutation = useMutation({
    mutationFn: incomingConfigsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availableNumbers'] });
      resetForm();
      setShowCreateForm(false);
      setSelectedNumber(null);
    },
    onError: (error: any) => {
      alert(`Error creating config: ${error.response?.data?.error || error.message}`);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ phoneNumber, data }: { phoneNumber: string; data: any }) =>
      incomingConfigsApi.update(phoneNumber, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availableNumbers'] });
      setSelectedNumber(null);
      resetForm();
      setShowCreateForm(false);
    },
    onError: (error: any) => {
      alert(`Error updating config: ${error.response?.data?.error || error.message}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: incomingConfigsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availableNumbers'] });
    },
    onError: (error: any) => {
      alert(`Error deleting config: ${error.response?.data?.error || error.message}`);
    },
  });

  const resetForm = () => {
    setPhoneNumber('');
    setName('');
    setSystemInstructions(`You are an AI assistant answering incoming calls.

IDENTITY & ROLE:
- You represent [Your Company/Organization]
- You handle incoming calls for [department/purpose]
- You have access to [relevant information/capabilities]

COMMUNICATION STYLE:
- Answer warmly and professionally
- Speak clearly in short, natural sentences
- Be patient and empathetic
- Use active listening - confirm understanding before responding
- Never interrupt the caller

CALL HANDLING:
1. Wait for caller to speak (if callInstructions is empty)
   OR Greet them warmly (if callInstructions provided)
2. Listen carefully to understand their need
3. Ask clarifying questions to fully understand
4. Provide clear, helpful information or assistance
5. Confirm they have what they need
6. Thank them for calling before ending

IMPORTANT RULES:
- If you don't know something, be honest and offer alternatives
- If they need human help, explain how to reach someone
- Stay calm and professional even if caller is frustrated
- Protect sensitive information - never share credentials/private data
- End calls politely and ensure caller satisfaction

Remember: This system prompt FULLY defines your behavior. Follow these instructions exactly.`);
    setCallInstructions('');
    setVoice('sage');
    setEnabled(true);
  };

  const handleLoadContext = (contextId: string) => {
    if (!contextId) return;

    const context = contexts.find((ctx) => ctx._id === contextId);
    if (context) {
      setSystemInstructions(context.systemInstructions);
      // Context template doesn't have call-specific instructions, usually empty for incoming
      setCallInstructions('');
    }
  };

  const handleConfigureNumber = (number: AvailableNumber) => {
    console.log('Configuring number:', number);

    if (number.config) {
      // Editing existing config
      setSelectedNumber(number);
      setPhoneNumber(number.phoneNumber);
      setName(number.config.name);
      setSystemInstructions(number.config.systemInstructions);
      setCallInstructions(number.config.callInstructions);
      setVoice(number.config.voice);
      setEnabled(number.config.enabled);
    } else {
      // Creating new config - reset to defaults but keep phone number
      resetForm();
      setSelectedNumber(number);
      setPhoneNumber(number.phoneNumber);
      setName(number.friendlyName || '');
    }

    setShowCreateForm(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber || !name || !systemInstructions) {
      alert('Please fill in all required fields');
      return;
    }
    createMutation.mutate({ phoneNumber, name, systemInstructions, callInstructions: callInstructions || '', voice, enabled });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNumber?.config) return;
    updateMutation.mutate({
      phoneNumber: selectedNumber.phoneNumber,
      data: { name, systemInstructions, callInstructions, voice, enabled },
    });
  };

  const handleCancelEdit = () => {
    setSelectedNumber(null);
    setShowCreateForm(false);
    resetForm();
  };

  const handleDelete = (phoneNumber: string) => {
    if (window.confirm('Are you sure you want to delete this configuration?')) {
      deleteMutation.mutate(phoneNumber);
    }
  };

  const getStatusBadge = (number: AvailableNumber) => {
    if (number.isConfigured && number.config?.enabled) {
      return <span className="status-badge configured">✓ Active</span>;
    } else if (number.isConfigured && !number.config?.enabled) {
      return <span className="status-badge disabled">○ Disabled</span>;
    } else {
      return <span className="status-badge unconfigured">+ Configure</span>;
    }
  };

  return (
    <div className="incoming-configs-page">
      <div className="page-header">
        <h2>📞 Incoming Call Configurations</h2>
        <p className="page-subtitle">Manage AI handlers for your Twilio phone numbers</p>
      </div>

      {showCreateForm && (
        <div className="config-form-section">
          <h3>{selectedNumber?.config ? 'Edit Configuration' : 'New Configuration'}</h3>
          <form onSubmit={selectedNumber?.config ? handleUpdate : handleCreate} className="config-form">
            <div className="form-group">
              <label>Phone Number *</label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+15551234567"
                disabled={true}
                required
              />
              <small>Phone number from your Twilio account</small>
            </div>

            <div className="form-group">
              <label>Configuration Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer Support Line"
                required
              />
              <small>A friendly name to identify this configuration</small>
            </div>

            <div className="form-group">
              <label>AI Voice</label>
              <select value={voice} onChange={(e) => setVoice(e.target.value)} required>
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
              <label>System Instructions *</label>
              <textarea
                value={systemInstructions}
                onChange={(e) => setSystemInstructions(e.target.value)}
                placeholder="Enter system instructions for how the AI should handle incoming calls..."
                rows={8}
                required
              />
              <small>System prompt that defines the AI's role and behavior</small>
            </div>

            <div className="form-group">
              <label>Call Instructions</label>
              <input
                type="text"
                value={callInstructions}
                onChange={(e) => setCallInstructions(e.target.value)}
                placeholder="Leave empty for standard handling, or add specific context"
              />
              <small>Optional: Additional instructions for the AI about how to handle these calls</small>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span>Enabled (accept incoming calls)</span>
              </label>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {selectedNumber?.config ? 'Update Configuration' : 'Create Configuration'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="numbers-list">
        <h3>Your Twilio Phone Numbers</h3>
        {isLoading ? (
          <p>Loading phone numbers...</p>
        ) : availableNumbers.length === 0 ? (
          <div className="empty-state">
            <p>No phone numbers found in your Twilio account.</p>
          </div>
        ) : (
          <div className="numbers-grid">
            {availableNumbers.map((number: AvailableNumber) => (
              <div key={number.phoneNumber} className={`number-card ${number.isConfigured ? 'configured' : 'unconfigured'}`}>
                <div className="number-header">
                  <div>
                    <h4>{number.phoneNumber}</h4>
                    <p className="friendly-name">{number.friendlyName}</p>
                  </div>
                  {getStatusBadge(number)}
                </div>

                {number.isConfigured && number.config ? (
                  <div className="config-details">
                    <div className="detail-row">
                      <strong>Config Name:</strong>
                      <span>{number.config.name}</span>
                    </div>
                    <div className="detail-row">
                      <strong>Voice:</strong>
                      <span>{AVAILABLE_VOICES.find(v => v.value === number.config!.voice)?.label || number.config.voice}</span>
                    </div>
                    <div className="instructions-preview">
                      <strong>Instructions:</strong>
                      <p>{number.config.systemInstructions.substring(0, 150)}...</p>
                    </div>
                    {number.config.callInstructions && (
                      <div className="instructions-preview">
                        <strong>Call Instructions:</strong>
                        <p>{number.config.callInstructions}</p>
                      </div>
                    )}
                    <p className="timestamps">
                      Updated: {new Date(number.config.updatedAt).toLocaleString()}
                    </p>
                  </div>
                ) : (
                  <div className="unconfigured-info">
                    <p>Click "Configure" below to set up an AI voice handler for this number.</p>
                  </div>
                )}

                <div className="number-actions">
                  <button
                    className="btn-primary"
                    onClick={() => handleConfigureNumber(number)}
                  >
                    {number.isConfigured ? '✏️ Edit' : '⚙️ Configure'}
                  </button>
                  {number.isConfigured && (
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(number.phoneNumber)}
                      disabled={deleteMutation.isPending}
                    >
                      🗑️ Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
