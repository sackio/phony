import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { callsApi } from '../services/api';
import { socketService } from '../services/socket';
import './CallPage.css';

interface Transcript {
  speaker: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  isPartial: boolean;
  isInterruption?: boolean;
}

export function CallPage() {
  const { callSid } = useParams<{ callSid: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [contextInput, setContextInput] = useState('');

  const { data: call, isLoading } = useQuery({
    queryKey: ['call', callSid],
    queryFn: async () => {
      const response = await callsApi.get(callSid!);
      return response.data;
    },
    refetchInterval: 2000,
  });

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
      queryClient.invalidateQueries({ queryKey: ['call', callSid] });
    },
  });

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
          return [...prev.filter((t) => !t.isPartial || t.speaker !== data.speaker), data];
        });
      }
    });

    socketService.on('call_status_changed', (data: any) => {
      if (data.callSid === callSid) {
        queryClient.invalidateQueries({ queryKey: ['call', callSid] });
      }
    });

    return () => {
      socketService.unsubscribeFromCall(callSid!);
      socketService.off('transcript_update');
      socketService.off('call_status_changed');
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
          <h1>{call.toNumber}</h1>
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
                  <div key={idx} className={`transcript-item ${t.role}`}>
                    <span className="speaker-label">{t.role}</span>
                    <span className="transcript-text">{t.content}</span>
                    <span className="transcript-time">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {transcripts.map((t, idx) => (
                  <div key={`live-${idx}`} className={`transcript-item ${t.speaker} ${t.isPartial ? 'partial' : ''} ${t.isInterruption ? 'interruption' : ''}`}>
                    {t.isInterruption ? (
                      <span className="interruption-marker">
                        <span className="interruption-icon">✂️</span>
                        <span className="transcript-text">{t.text}</span>
                      </span>
                    ) : (
                      <>
                        <span className="speaker-label">{t.speaker}</span>
                        <span className="transcript-text">{t.text}</span>
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

          {['active', 'in-progress', 'on_hold'].includes(call.status) && (
            <div className="context-injection-section">
              <h3>Inject Context</h3>
              <textarea
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
        </div>
      </div>
    </div>
  );
}
