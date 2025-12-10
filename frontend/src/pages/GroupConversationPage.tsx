import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { conversationsApi, Conversation, SmsMessage, incomingConfigsApi, AvailableNumber } from '../services/api';
import './GroupConversationPage.css';

export function GroupConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [fromNumber, setFromNumber] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showManageModal, setShowManageModal] = useState(false);

  useEffect(() => {
    loadAvailableNumbers();
  }, []);

  useEffect(() => {
    if (conversationId && fromNumber) {
      loadConversationDetails();
      loadMessages();
      const interval = setInterval(() => {
        loadMessages();
      }, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [conversationId, fromNumber]);

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

  const loadConversationDetails = async () => {
    if (!conversationId) return;

    try {
      const response = await conversationsApi.get(conversationId);
      setConversation(response.data);
      setError('');
    } catch (err: any) {
      console.error('Error loading conversation:', err);
      setError('Failed to load conversation details');
    }
  };

  const loadMessages = async () => {
    if (!conversationId) return;

    try {
      const response = await conversationsApi.getMessages(conversationId, 200);
      setMessages(response.data);
      setError('');
    } catch (err: any) {
      console.error('Error loading messages:', err);
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversationId || sending) return;

    setSending(true);
    setError('');

    try {
      await conversationsApi.sendGroupMessage(conversationId, {
        body: newMessage.trim(),
        fromNumber
      });

      setNewMessage('');
      // Reload messages to show the new message
      await loadMessages();
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

  const getConversationTitle = () => {
    if (!conversation) return 'Loading...';

    if (conversation.type === 'group' && conversation.name) {
      return conversation.name;
    }

    if (conversation.type === 'group') {
      return `Group (${conversation.participants.length})`;
    }

    // For 1-to-1, show the other participant
    const otherParticipant = conversation.participants.find(p => p !== fromNumber);
    return otherParticipant ? formatPhoneNumber(otherParticipant) : 'Unknown';
  };

  const characterCount = newMessage.length;
  const maxLength = 1600;

  if (loading) {
    return (
      <div className="group-conversation-page">
        <div className="loading">Loading conversation...</div>
      </div>
    );
  }

  return (
    <div className="group-conversation-page">
      <div className="conversation-header">
        <button onClick={() => navigate('/sms/messages')} className="back-button">
          ← Back
        </button>
        <div className="conversation-title">
          <div className="title-row">
            <h2>{getConversationTitle()}</h2>
            {conversation?.type === 'group' && (
              <span className="group-badge">👥 Group</span>
            )}
          </div>
          {conversation && (
            <span className="message-count">
              {conversation.participants.length} participants • {messages.length} messages
            </span>
          )}
        </div>
        <div className="header-actions">
          <select
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            className="from-number-select"
          >
            {availableNumbers.map((num) => (
              <option key={num.phoneNumber} value={num.phoneNumber}>
                {formatPhoneNumber(num.phoneNumber)}
              </option>
            ))}
          </select>
          {conversation?.type === 'group' && (
            <button
              onClick={() => setShowManageModal(true)}
              className="manage-button"
            >
              Manage
            </button>
          )}
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
                  {conversation?.type === 'group' && msg.direction === 'inbound' && (
                    <div className="message-sender">
                      {formatPhoneNumber(msg.fromNumber)}
                    </div>
                  )}
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

      {showManageModal && conversation && (
        <ManageGroupModal
          conversation={conversation}
          currentNumber={fromNumber}
          onClose={() => setShowManageModal(false)}
          onUpdated={() => {
            setShowManageModal(false);
            loadConversationDetails();
          }}
        />
      )}
    </div>
  );
}

interface ManageGroupModalProps {
  conversation: Conversation;
  currentNumber: string;
  onClose: () => void;
  onUpdated: () => void;
}

function ManageGroupModal({ conversation, currentNumber, onClose, onUpdated }: ManageGroupModalProps) {
  const [groupName, setGroupName] = useState(conversation.name || '');
  const [newParticipant, setNewParticipant] = useState('');
  const [participants, setParticipants] = useState(conversation.participants);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  const handleUpdateName = async () => {
    if (!groupName.trim()) {
      setError('Group name cannot be empty');
      return;
    }

    setUpdating(true);
    setError('');

    try {
      await conversationsApi.updateName(conversation.conversationId, groupName.trim());
      onUpdated();
    } catch (err: any) {
      console.error('Error updating group name:', err);
      setError(err.response?.data?.error || 'Failed to update group name');
    } finally {
      setUpdating(false);
    }
  };

  const handleAddParticipant = async () => {
    const cleaned = newParticipant.trim();
    if (!cleaned) return;

    if (!cleaned.match(/^\+?[1-9]\d{1,14}$/)) {
      setError('Please enter a valid phone number');
      return;
    }

    if (participants.includes(cleaned)) {
      setError('This number is already in the group');
      return;
    }

    setUpdating(true);
    setError('');

    try {
      const response = await conversationsApi.addParticipant(conversation.conversationId, cleaned);
      setParticipants(response.data.participants);
      setNewParticipant('');
    } catch (err: any) {
      console.error('Error adding participant:', err);
      setError(err.response?.data?.error || 'Failed to add participant');
    } finally {
      setUpdating(false);
    }
  };

  const handleRemoveParticipant = async (phoneNumber: string) => {
    if (phoneNumber === currentNumber) {
      setError('Cannot remove yourself from the group');
      return;
    }

    if (participants.length <= 2) {
      setError('Group must have at least 2 participants');
      return;
    }

    setUpdating(true);
    setError('');

    try {
      const response = await conversationsApi.removeParticipant(conversation.conversationId, phoneNumber);
      setParticipants(response.data.participants);
    } catch (err: any) {
      console.error('Error removing participant:', err);
      setError(err.response?.data?.error || 'Failed to remove participant');
    } finally {
      setUpdating(false);
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage Group</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="alert alert-error">
              <span className="alert-icon">⚠️</span>
              {error}
            </div>
          )}

          <div className="form-group">
            <label>Group Name</label>
            <div className="name-input-group">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter group name"
                className="form-input"
              />
              <button
                onClick={handleUpdateName}
                disabled={updating || !groupName.trim() || groupName === conversation.name}
                className="btn btn-primary btn-sm"
              >
                Update
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Add Participant</label>
            <div className="participant-input">
              <input
                type="tel"
                value={newParticipant}
                onChange={(e) => setNewParticipant(e.target.value)}
                placeholder="+1234567890"
                className="form-input"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddParticipant();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleAddParticipant}
                disabled={updating}
                className="btn btn-secondary"
              >
                Add
              </button>
            </div>
          </div>

          <div className="participants-list">
            <label>Participants ({participants.length})</label>
            {participants.map((participant) => (
              <div key={participant} className="participant-item">
                <span>{formatPhoneNumber(participant)}</span>
                <div className="participant-actions">
                  {participant === currentNumber ? (
                    <span className="you-badge">You</span>
                  ) : (
                    <button
                      onClick={() => handleRemoveParticipant(participant)}
                      disabled={updating}
                      className="remove-button"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
