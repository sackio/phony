import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { smsApi, SmsMessage } from '../services/api';
import './MessagesPage.css';

interface Conversation {
  phoneNumber: string;
  lastMessage: SmsMessage;
  messageCount: number;
  unreadCount: number;
}

export function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [filter]);

  const loadMessages = async () => {
    try {
      const filters: any = {};
      if (filter === 'sent') {
        filters.direction = 'outbound';
      } else if (filter === 'received') {
        filters.direction = 'inbound';
      }

      const response = await smsApi.list(filters);
      const messages = response.data;

      // Group messages by conversation (unique phone number pairs)
      const conversationMap = new Map<string, SmsMessage[]>();

      messages.forEach((msg: SmsMessage) => {
        // Determine the other party's number
        const otherNumber = msg.direction === 'outbound' ? msg.toNumber : msg.fromNumber;

        if (!conversationMap.has(otherNumber)) {
          conversationMap.set(otherNumber, []);
        }
        conversationMap.get(otherNumber)!.push(msg);
      });

      // Convert to conversation list
      const convos: Conversation[] = Array.from(conversationMap.entries()).map(([phoneNumber, msgs]) => {
        // Sort by date descending to get latest message
        const sortedMsgs = msgs.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        return {
          phoneNumber,
          lastMessage: sortedMsgs[0],
          messageCount: msgs.length,
          unreadCount: 0 // TODO: Implement read/unread tracking
        };
      });

      // Sort conversations by last message date
      convos.sort((a, b) =>
        new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
      );

      setConversations(convos);
      setError('');
    } catch (err: any) {
      console.error('Error loading messages:', err);
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  const formatPhoneNumber = (phoneNumber: string) => {
    // Basic US phone number formatting
    const cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      const areaCode = cleaned.substring(1, 4);
      const middle = cleaned.substring(4, 7);
      const last = cleaned.substring(7);
      return `+1 (${areaCode}) ${middle}-${last}`;
    }
    return phoneNumber;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
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

  if (loading) {
    return (
      <div className="messages-page">
        <div className="loading">Loading messages...</div>
      </div>
    );
  }

  return (
    <div className="messages-page">
      <div className="page-header">
        <h1>💬 Messages</h1>
        <Link to="/sms/send" className="btn btn-primary">
          ✉️ New Message
        </Link>
      </div>

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          {error}
        </div>
      )}

      <div className="filter-tabs">
        <button
          className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={`filter-tab ${filter === 'sent' ? 'active' : ''}`}
          onClick={() => setFilter('sent')}
        >
          Sent
        </button>
        <button
          className={`filter-tab ${filter === 'received' ? 'active' : ''}`}
          onClick={() => setFilter('received')}
        >
          Received
        </button>
      </div>

      {conversations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <h3>No messages yet</h3>
          <p>Start a conversation by sending your first message</p>
          <Link to="/sms/send" className="btn btn-primary">
            Send Message
          </Link>
        </div>
      ) : (
        <div className="conversations-list">
          {conversations.map((convo) => (
            <Link
              key={convo.phoneNumber}
              to={`/sms/conversation/${encodeURIComponent(convo.phoneNumber)}`}
              className="conversation-item"
            >
              <div className="conversation-avatar">
                {convo.phoneNumber.slice(-4)}
              </div>
              <div className="conversation-content">
                <div className="conversation-header">
                  <span className="conversation-number">
                    {formatPhoneNumber(convo.phoneNumber)}
                  </span>
                  <span className="conversation-time">
                    {formatTimestamp(convo.lastMessage.createdAt)}
                  </span>
                </div>
                <div className="conversation-preview">
                  <span className={`message-direction ${convo.lastMessage.direction}`}>
                    {convo.lastMessage.direction === 'outbound' ? 'You: ' : ''}
                  </span>
                  <span className="message-text">
                    {convo.lastMessage.body.substring(0, 100)}
                    {convo.lastMessage.body.length > 100 ? '...' : ''}
                  </span>
                  {convo.lastMessage.direction === 'outbound' && (
                    <span className="message-status">
                      {getStatusIcon(convo.lastMessage.status)}
                    </span>
                  )}
                </div>
                {convo.messageCount > 1 && (
                  <div className="conversation-count">
                    {convo.messageCount} messages
                  </div>
                )}
              </div>
              {convo.unreadCount > 0 && (
                <div className="unread-badge">{convo.unreadCount}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
