import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { smsApi, SmsMessage, incomingConfigsApi, AvailableNumber } from '../services/api';
import './ConversationPage.css';

export function ConversationPage() {
  const { phoneNumber } = useParams<{ phoneNumber: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [fromNumber, setFromNumber] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAvailableNumbers();
  }, []);

  useEffect(() => {
    if (phoneNumber && fromNumber) {
      loadConversation();
      const interval = setInterval(loadConversation, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [phoneNumber, fromNumber]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadAvailableNumbers = async () => {
    try {
      const response = await incomingConfigsApi.listAvailableNumbers();
      setAvailableNumbers(response.data);
      if (response.data.length > 0) {
        setFromNumber(response.data[0].phoneNumber);
      }
    } catch (err: any) {
      console.error('Error loading available numbers:', err);
    }
  };

  const loadConversation = async () => {
    if (!phoneNumber || !fromNumber) return;

    try {
      const response = await smsApi.getConversation(
        fromNumber,
        decodeURIComponent(phoneNumber),
        200
      );
      setMessages(response.data);
      setError('');
    } catch (err: any) {
      console.error('Error loading conversation:', err);
      setError('Failed to load conversation');
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !phoneNumber || sending) return;

    setSending(true);
    setError('');

    try {
      await smsApi.send({
        toNumber: decodeURIComponent(phoneNumber),
        body: newMessage.trim(),
        fromNumber
      });

      setNewMessage('');
      // Reload conversation to show the new message
      await loadConversation();
    } catch (err: any) {
      console.error('Error sending message:', err);
      setError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const formatPhoneNumber = (num: string) => {
    const cleaned = num.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      const areaCode = cleaned.substring(1, 4);
      const middle = cleaned.substring(4, 7);
      const last = cleaned.substring(7);
      return `+1 (${areaCode}) ${middle}-${last}`;
    }
    return num;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'delivered': return '✓✓';
      case 'sent': return '✓';
      case 'failed': return '✗';
      case 'queued':
      case 'sending': return '⋯';
      default: return '';
    }
  };

  const characterCount = newMessage.length;
  const maxLength = 1600;

  if (loading) {
    return (
      <div className="conversation-page">
        <div className="loading">Loading conversation...</div>
      </div>
    );
  }

  return (
    <div className="conversation-page">
      <div className="conversation-header">
        <button onClick={() => navigate('/sms/messages')} className="back-button">
          ← Back
        </button>
        <div className="conversation-title">
          <h2>{formatPhoneNumber(decodeURIComponent(phoneNumber || ''))}</h2>
          <span className="message-count">{messages.length} messages</span>
        </div>
        <div className="header-actions">
          <select
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            className="from-number-select"
          >
            {availableNumbers.map((num) => (
              <option key={num.phoneNumber} value={num.phoneNumber}>
                {num.phoneNumber}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          {error}
        </div>
      )}

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-conversation">
            <div className="empty-icon">💬</div>
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((msg) => (
              <div
                key={msg.messageSid}
                className={`message ${msg.direction === 'outbound' ? 'outbound' : 'inbound'}`}
              >
                <div className="message-bubble">
                  <div className="message-body">{msg.body}</div>
                  <div className="message-meta">
                    <span className="message-time">
                      {formatTimestamp(msg.createdAt)}
                    </span>
                    {msg.direction === 'outbound' && (
                      <span className={`message-status status-${msg.status}`}>
                        {getStatusIcon(msg.status)}
                      </span>
                    )}
                  </div>
                  {msg.errorMessage && (
                    <div className="message-error">
                      Error: {msg.errorMessage}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSendMessage} className="message-input-form">
        <div className="input-container">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            rows={1}
            maxLength={maxLength}
            disabled={sending}
            className="message-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
              }
            }}
          />
          <div className="input-meta">
            <span className={characterCount > maxLength ? 'text-danger' : ''}>
              {characterCount} / {maxLength}
            </span>
          </div>
        </div>
        <button
          type="submit"
          disabled={sending || !newMessage.trim()}
          className="send-button"
        >
          {sending ? '⋯' : '➤'}
        </button>
      </form>
    </div>
  );
}
