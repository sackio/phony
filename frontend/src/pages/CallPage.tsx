import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { callsApi, Call } from '../services/api';
import { socketService } from '../services/socket';
import './CallPage.css';

interface Transcript {
  speaker: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  isPartial: boolean;
  isInterruption?: boolean;
  truncated?: boolean;
  truncatedAt?: number;
}

export function CallPage() {
  const { callSid } = useParams<{ callSid: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [contextInput, setContextInput] = useState('');
  const [contextRequest, setContextRequest] = useState<{ question: string; requestedBy: string; timestamp: string } | null>(null);

  // Expandable sections state
  const [showSystemInstructions, setShowSystemInstructions] = useState(false);
  const [showCallInstructions, setShowCallInstructions] = useState(false);
  const [showTwilioEvents, setShowTwilioEvents] = useState(false);
  const [showOpenAIEvents, setShowOpenAIEvents] = useState(false);
  const [twilioEventFilter, setTwilioEventFilter] = useState<string>('all');
  const [openAIEventFilter, setOpenAIEventFilter] = useState<string>('all');

  const { data: call, isLoading } = useQuery<Call>({
    queryKey: ['call', callSid],
    queryFn: async () => {
      const response = await callsApi.get(callSid!);
      return response.data as Call;
    },
    refetchInterval: 2000,
  });

  // Helper functions for filtering events
  const getFilteredTwilioEvents = () => {
    if (!call?.twilioEvents) return [];
    if (twilioEventFilter === 'all') return call.twilioEvents;
    return call.twilioEvents.filter((event) => event.type === twilioEventFilter);
  };

  const getFilteredOpenAIEvents = () => {
    if (!call?.openaiEvents) return [];
    if (openAIEventFilter === 'all') return call.openaiEvents;
    return call.openaiEvents.filter((event) => event.type === openAIEventFilter);
  };

  const getTwilioEventTypes = () => {
    if (!call?.twilioEvents) return [];
    const types = new Set(call.twilioEvents.map((e) => e.type));
    return Array.from(types).sort();
  };

  const getOpenAIEventTypes = () => {
    if (!call?.openaiEvents) return [];
    const types = new Set(call.openaiEvents.map((e) => e.type));
    return Array.from(types).sort();
  };

  const holdMutation = useMutation({
    mutationFn: () => callsApi.hold(callSid!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['call', callSid] }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => callsApi.resume(callSid!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['call', callSid] }),
  });

  const hangupMutation = useMutation({
    mutationFn: () => callsApi.hangup(callSid!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call', callSid] });
      setTimeout(() => navigate('/'), 2000);
    },
  });

  const injectContextMutation = useMutation({
    mutationFn: (context: string) => callsApi.injectContext(callSid!, context),
    onSuccess: () => {
      setContextInput('');
      setContextRequest(null); // Clear the pending context request
      queryClient.invalidateQueries({ queryKey: ['call', callSid] });
    },
  });

  const sendDTMFMutation = useMutation({
    mutationFn: (digits: string) => callsApi.sendDTMF(callSid!, digits),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call', callSid] });
    },
  });

  const handleDTMFClick = (digit: string) => {
    sendDTMFMutation.mutate(digit);
  };

  useEffect(() => {
    socketService.connect();
    socketService.subscribeToCall(callSid!);

    socketService.on('transcript_update', (data: any) => {
      if (data.callSid === callSid) {
        setTranscripts((prev) => {
          if (data.isPartial) {
            const filtered = prev.filter((t) => !t.isPartial || t.speaker !== data.speaker);
            return [...filtered, data];
          }

          // Check if this is an update to an existing transcript (e.g., truncation update)
          // Match by speaker, text, and timestamp
          const existingIndex = prev.findIndex(
            (t) => t.speaker === data.speaker &&
                   t.text === data.text &&
                   new Date(t.timestamp).getTime() === new Date(data.timestamp).getTime()
          );

          if (existingIndex >= 0) {
            // Update existing transcript
            const updated = [...prev];
            updated[existingIndex] = { ...updated[existingIndex], ...data };
            return updated;
          }

          // New transcript - add it
          return [...prev.filter((t) => !t.isPartial || t.speaker !== data.speaker), data];
        });
      }
    });

    socketService.on('call_status_changed', (data: any) => {
      if (data.callSid === callSid) {
        queryClient.invalidateQueries({ queryKey: ['call', callSid] });
      }
    });

    socketService.on('context_request', (data: any) => {
      if (data.callSid === callSid) {
        setContextRequest({
          question: data.question,
          requestedBy: data.requestedBy,
          timestamp: data.timestamp
        });
        // Scroll to context input
        document.getElementById('context-input')?.scrollIntoView({ behavior: 'smooth' });
      }
    });

    return () => {
      socketService.unsubscribeFromCall(callSid!);
      socketService.off('transcript_update');
      socketService.off('call_status_changed');
      socketService.off('context_request');
    };
  }, [callSid, queryClient]);

  if (isLoading || !call) {
    return <div className="call-page">Loading...</div>;
  }

  return (
    <div className="call-page">
      <div className="call-header-section">
        <button onClick={() => navigate('/')} className="btn-back">← Back</button>
        <div className="call-info">
          <div className="call-info-main">
            <h1>
              {call.callType === 'inbound' ? '📞 Incoming Call' : '📱 Outgoing Call'}
            </h1>
            <div className="call-numbers">
              <span className="call-number-label">From:</span>
              <span className="call-number-value">{call.fromNumber}</span>
              <span className="call-number-separator">→</span>
              <span className="call-number-label">To:</span>
              <span className="call-number-value">{call.toNumber}</span>
            </div>
          </div>
          <span className={`status-badge ${call.status}`}>{call.status}</span>
        </div>
      </div>

      <div className="call-content">
        <div className="transcript-section">
          <h2>Conversation</h2>
          <div className="transcript-container">
            {transcripts.length === 0 && call.conversationHistory?.length === 0 ? (
              <p className="no-transcripts">No transcripts yet...</p>
            ) : (
              <>
                {call.conversationHistory?.map((t: any, idx: number) => (
                  <div key={idx} className={`transcript-item ${t.role} ${t.truncated ? 'truncated' : ''}`}>
                    <span className="speaker-label">{t.role}</span>
                    <span className={`transcript-text ${t.truncated ? 'strikethrough' : ''}`}>
                      {t.content}
                      {t.truncated && <span className="interruption-marker"> (interrupted)</span>}
                    </span>
                    <span className="transcript-time">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {transcripts.map((t, idx) => (
                  <div key={`live-${idx}`} className={`transcript-item ${t.speaker} ${t.isPartial ? 'partial' : ''} ${t.isInterruption ? 'interruption' : ''} ${t.truncated ? 'truncated' : ''}`}>
                    {t.isInterruption ? (
                      <span className="interruption-marker">
                        <span className="interruption-icon">✂️</span>
                        <span className="transcript-text">{t.text}</span>
                      </span>
                    ) : (
                      <>
                        <span className="speaker-label">{t.speaker}</span>
                        <span className={`transcript-text ${t.truncated ? 'strikethrough' : ''}`}>
                          {t.text}
                          {t.truncated && <span className="interruption-marker"> (interrupted)</span>}
                        </span>
                      </>
                    )}
                    <span className="transcript-time">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="controls-section">
          <h2>Call Controls</h2>

          <div className="call-status-info">
            <strong>Status:</strong> <span className={`status-badge ${call.status}`}>{call.status}</span>
          </div>

          <div className="control-buttons">
            {['active', 'in-progress', 'initiated'].includes(call.status) && (
              <button
                onClick={() => holdMutation.mutate()}
                disabled={holdMutation.isPending}
                className="btn-control btn-hold"
              >
                ⏸ Hold
              </button>
            )}

            {call.status === 'on_hold' && (
              <button
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
                className="btn-control btn-resume"
              >
                ▶️ Resume
              </button>
            )}

            {['active', 'in-progress', 'initiated', 'on_hold'].includes(call.status) && (
              <button
                onClick={() => hangupMutation.mutate()}
                disabled={hangupMutation.isPending}
                className="btn-control btn-hangup"
              >
                📞 Hangup
              </button>
            )}
          </div>

          {['active', 'in-progress', 'on_hold', 'initiated'].includes(call.status) && (
            <div className="context-injection-section">
              {contextRequest && (
                <div className="context-request-alert">
                  <div className="alert-header">
                    <span className="alert-icon">🤖</span>
                    <strong>Agent Requesting Context</strong>
                  </div>
                  <div className="alert-body">
                    <p className="request-question">{contextRequest.question}</p>
                    <p className="request-meta">
                      Requested by: {contextRequest.requestedBy} • Call is on hold until you respond
                    </p>
                  </div>
                </div>
              )}
              <h3>Inject Context</h3>
              <textarea
                id="context-input"
                className="context-input"
                placeholder="Enter instructions or context to inject into the conversation..."
                value={contextInput}
                onChange={(e) => setContextInput(e.target.value)}
                rows={4}
              />
              <button
                onClick={() => contextInput.trim() && injectContextMutation.mutate(contextInput)}
                disabled={injectContextMutation.isPending || !contextInput.trim()}
                className="btn-control btn-inject-context"
              >
                💬 Send Context
              </button>
            </div>
          )}

          {['active', 'in-progress', 'initiated'].includes(call.status) && (
            <div className="dtmf-keypad-section">
              <h3>📞 DTMF Keypad</h3>
              <p className="dtmf-description">Send phone keypad tones (for IVR navigation, entering codes, etc.)</p>
              <div className="dtmf-keypad">
                <button onClick={() => handleDTMFClick('1')} className="dtmf-button">1</button>
                <button onClick={() => handleDTMFClick('2')} className="dtmf-button">2</button>
                <button onClick={() => handleDTMFClick('3')} className="dtmf-button">3</button>
                <button onClick={() => handleDTMFClick('4')} className="dtmf-button">4</button>
                <button onClick={() => handleDTMFClick('5')} className="dtmf-button">5</button>
                <button onClick={() => handleDTMFClick('6')} className="dtmf-button">6</button>
                <button onClick={() => handleDTMFClick('7')} className="dtmf-button">7</button>
                <button onClick={() => handleDTMFClick('8')} className="dtmf-button">8</button>
                <button onClick={() => handleDTMFClick('9')} className="dtmf-button">9</button>
                <button onClick={() => handleDTMFClick('*')} className="dtmf-button dtmf-special">*</button>
                <button onClick={() => handleDTMFClick('0')} className="dtmf-button">0</button>
                <button onClick={() => handleDTMFClick('#')} className="dtmf-button dtmf-special">#</button>
              </div>
              {sendDTMFMutation.isPending && (
                <div className="dtmf-status">Sending...</div>
              )}
              {sendDTMFMutation.isError && (
                <div className="dtmf-status error">Failed to send DTMF</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Debug Information Section */}
      <div className="debug-section">
        <h2 className="debug-section-title">🔍 Debug Information</h2>

        {/* Call Metadata */}
        <div className="debug-card">
          <h3>Call Metadata</h3>
          <div className="metadata-grid">
            <div className="metadata-item">
              <span className="metadata-label">Call SID:</span>
              <span className="metadata-value">{call.callSid}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Voice:</span>
              <span className="metadata-value">{call.voice}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Started:</span>
              <span className="metadata-value">
                {new Date(call.startedAt).toLocaleString()}
              </span>
            </div>
            {call.endedAt && (
              <>
                <div className="metadata-item">
                  <span className="metadata-label">Ended:</span>
                  <span className="metadata-value">
                    {new Date(call.endedAt).toLocaleString()}
                  </span>
                </div>
                <div className="metadata-item">
                  <span className="metadata-label">Duration:</span>
                  <span className="metadata-value">
                    {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : 'N/A'}
                  </span>
                </div>
              </>
            )}
            {call.errorMessage && (
              <div className="metadata-item error">
                <span className="metadata-label">Error:</span>
                <span className="metadata-value">{call.errorMessage}</span>
              </div>
            )}
          </div>
        </div>

        {/* System Instructions */}
        {call.systemInstructions && (
          <div className="debug-card">
            <button
              className="debug-card-header"
              onClick={() => setShowSystemInstructions(!showSystemInstructions)}
            >
              <span>📋 System Instructions</span>
              <span className="expand-icon">{showSystemInstructions ? '▼' : '▶'}</span>
            </button>
            {showSystemInstructions && (
              <div className="debug-card-content">
                <pre className="instructions-text">{call.systemInstructions}</pre>
              </div>
            )}
          </div>
        )}

        {/* Call Instructions */}
        {call.callInstructions && (
          <div className="debug-card">
            <button
              className="debug-card-header"
              onClick={() => setShowCallInstructions(!showCallInstructions)}
            >
              <span>📝 Call-Specific Instructions</span>
              <span className="expand-icon">{showCallInstructions ? '▼' : '▶'}</span>
            </button>
            {showCallInstructions && (
              <div className="debug-card-content">
                <pre className="instructions-text">{call.callInstructions}</pre>
              </div>
            )}
          </div>
        )}

        {/* Twilio Events */}
        {call.twilioEvents && call.twilioEvents.length > 0 && (
          <div className="debug-card">
            <button
              className="debug-card-header"
              onClick={() => setShowTwilioEvents(!showTwilioEvents)}
            >
              <span>📡 Twilio Events ({call.twilioEvents.length})</span>
              <span className="expand-icon">{showTwilioEvents ? '▼' : '▶'}</span>
            </button>
            {showTwilioEvents && (
              <div className="debug-card-content">
                <div className="event-filter">
                  <label>Filter by type:</label>
                  <select
                    value={twilioEventFilter}
                    onChange={(e) => setTwilioEventFilter(e.target.value)}
                    className="event-filter-select"
                  >
                    <option value="all">All ({call.twilioEvents.length})</option>
                    {getTwilioEventTypes().map((type) => (
                      <option key={type} value={type}>
                        {type} ({call.twilioEvents!.filter((e) => e.type === type).length})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="events-list">
                  {getFilteredTwilioEvents().map((event, idx) => (
                    <div key={idx} className="event-item">
                      <div className="event-header">
                        <span className="event-type">{event.type}</span>
                        <span className="event-time">
                          {new Date(event.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <pre className="event-data">
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* OpenAI Events */}
        {call.openaiEvents && call.openaiEvents.length > 0 && (
          <div className="debug-card">
            <button
              className="debug-card-header"
              onClick={() => setShowOpenAIEvents(!showOpenAIEvents)}
            >
              <span>🤖 OpenAI Events ({call.openaiEvents.length})</span>
              <span className="expand-icon">{showOpenAIEvents ? '▼' : '▶'}</span>
            </button>
            {showOpenAIEvents && (
              <div className="debug-card-content">
                <div className="event-filter">
                  <label>Filter by type:</label>
                  <select
                    value={openAIEventFilter}
                    onChange={(e) => setOpenAIEventFilter(e.target.value)}
                    className="event-filter-select"
                  >
                    <option value="all">All ({call.openaiEvents.length})</option>
                    {getOpenAIEventTypes().map((type) => (
                      <option key={type} value={type}>
                        {type} ({call.openaiEvents!.filter((e) => e.type === type).length})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="events-list">
                  {getFilteredOpenAIEvents().map((event, idx) => (
                    <div key={idx} className="event-item">
                      <div className="event-header">
                        <span className="event-type">{event.type}</span>
                        <span className="event-time">
                          {new Date(event.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <pre className="event-data">
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
