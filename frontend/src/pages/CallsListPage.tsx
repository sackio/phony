import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { callsApi } from '../services/api';
import './CallsListPage.css';

interface Call {
  callSid: string;
  toNumber: string;
  fromNumber: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export function CallsListPage() {
  const navigate = useNavigate();

  const { data: calls, isLoading } = useQuery({
    queryKey: ['calls'],
    queryFn: async () => {
      const response = await callsApi.list();
      return response.data as Call[];
    },
    refetchInterval: 5000,
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatDuration = (start: string, end?: string) => {
    if (!end) return 'In progress';
    const duration = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}m ${seconds}s`;
  };

  const getTranscriptPreview = (conversationHistory?: Array<{ role: string; content: string }>) => {
    if (!conversationHistory || conversationHistory.length === 0) {
      return 'No transcript available';
    }
    const firstMessage = conversationHistory[0];
    return firstMessage.content.length > 100
      ? firstMessage.content.substring(0, 100) + '...'
      : firstMessage.content;
  };

  if (isLoading) {
    return <div className="calls-list-page">Loading calls...</div>;
  }

  return (
    <div className="calls-list-page">
      <div className="calls-header">
        <h1>📞 Call History</h1>
        <p className="calls-subtitle">View all past calls and transcripts</p>
      </div>

      <div className="calls-table-container">
        {!calls || calls.length === 0 ? (
          <div className="no-calls">
            <p>No calls yet. Start by creating a call from the home page.</p>
          </div>
        ) : (
          <table className="calls-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Phone Number</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Preview</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr
                  key={call.callSid}
                  onClick={() => navigate(`/call/${call.callSid}`)}
                  className="call-row"
                >
                  <td className="call-date">{formatDate(call.startedAt)}</td>
                  <td className="call-number">{call.toNumber}</td>
                  <td>
                    <span className={`status-badge ${call.status}`}>
                      {call.status}
                    </span>
                  </td>
                  <td className="call-duration">
                    {formatDuration(call.startedAt, call.endedAt)}
                  </td>
                  <td className="call-preview">
                    {getTranscriptPreview(call.conversationHistory)}
                  </td>
                  <td className="call-actions">
                    <button
                      className="btn-view"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/call/${call.callSid}`);
                      }}
                    >
                      View Details →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
