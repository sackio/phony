import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { conversationsApi, Conversation, incomingConfigsApi, AvailableNumber } from '../services/api';
import './ConversationsListPage.css';

export function ConversationsListPage() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadAvailableNumbers();
  }, []);

  useEffect(() => {
    if (selectedNumber) {
      loadConversations();
      const interval = setInterval(loadConversations, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [selectedNumber]);

  const loadAvailableNumbers = async () => {
    try {
      const response = await incomingConfigsApi.listAvailableNumbers();
      setAvailableNumbers(response.data);
      if (response.data.length > 0) {
        setSelectedNumber(response.data[0].phoneNumber);
      }
    } catch (err: any) {
      console.error('Error loading available numbers:', err);
      setError('Failed to load available numbers');
    }
  };

  const loadConversations = async () => {
    if (!selectedNumber) return;

    try {
      const response = await conversationsApi.list(selectedNumber);
      setConversations(response.data);
      setError('');
    } catch (err: any) {
      console.error('Error loading conversations:', err);
      setError('Failed to load conversations');
    } finally {
      setLoading(false);
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

  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return 'Never';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  };

  const getConversationName = (conversation: Conversation) => {
    if (conversation.type === 'group' && conversation.name) {
      return conversation.name;
    }

    // For 1-to-1, show the other participant
    const otherParticipant = conversation.participants.find(p => p !== selectedNumber);
    if (otherParticipant) {
      return formatPhoneNumber(otherParticipant);
    }

    return 'Unknown';
  };

  const getConversationSubtitle = (conversation: Conversation) => {
    if (conversation.type === 'group') {
      return `${conversation.participants.length} participants`;
    }
    return conversation.type;
  };

  const handleConversationClick = (conversation: Conversation) => {
    navigate(`/sms/conversations/${conversation.conversationId}`);
  };

  const handleCreateGroup = () => {
    setShowCreateModal(true);
  };

  if (loading) {
    return (
      <div className="conversations-list-page">
        <div className="loading">Loading conversations...</div>
      </div>
    );
  }

  return (
    <div className="conversations-list-page">
      <div className="page-header">
        <div className="header-title">
          <h1>💬 Messages</h1>
          <p className="header-subtitle">
            View and manage all your SMS conversations
          </p>
        </div>
        <div className="header-actions">
          <select
            value={selectedNumber}
            onChange={(e) => setSelectedNumber(e.target.value)}
            className="number-select"
          >
            {availableNumbers.map((num) => (
              <option key={num.phoneNumber} value={num.phoneNumber}>
                {formatPhoneNumber(num.phoneNumber)}
              </option>
            ))}
          </select>
          <button onClick={handleCreateGroup} className="btn btn-primary">
            + Create Group
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          {error}
        </div>
      )}

      <div className="conversations-container">
        {conversations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <h3>No conversations yet</h3>
            <p>Start a new conversation or create a group</p>
            <button onClick={handleCreateGroup} className="btn btn-primary">
              Create Group
            </button>
          </div>
        ) : (
          <div className="conversations-list">
            {conversations.map((conv) => (
              <div
                key={conv.conversationId}
                className="conversation-item"
                onClick={() => handleConversationClick(conv)}
              >
                <div className="conversation-icon">
                  {conv.type === 'group' ? '👥' : '👤'}
                </div>
                <div className="conversation-info">
                  <div className="conversation-name">
                    {getConversationName(conv)}
                  </div>
                  <div className="conversation-meta">
                    <span className="conversation-type">
                      {getConversationSubtitle(conv)}
                    </span>
                    <span className="conversation-count">
                      {conv.messageCount} messages
                    </span>
                  </div>
                </div>
                <div className="conversation-time">
                  {formatTimestamp(conv.lastMessageAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateGroupModal
          selectedNumber={selectedNumber}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadConversations();
          }}
        />
      )}
    </div>
  );
}

interface CreateGroupModalProps {
  selectedNumber: string;
  onClose: () => void;
  onCreated: () => void;
}

function CreateGroupModal({ selectedNumber, onClose, onCreated }: CreateGroupModalProps) {
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState('');
  const [participants, setParticipants] = useState<string[]>([selectedNumber]);
  const [newParticipant, setNewParticipant] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const addParticipant = () => {
    const cleaned = newParticipant.trim();
    if (!cleaned) return;

    // Basic validation
    if (!cleaned.match(/^\+?[1-9]\d{1,14}$/)) {
      setError('Please enter a valid phone number');
      return;
    }

    if (participants.includes(cleaned)) {
      setError('This number is already in the group');
      return;
    }

    setParticipants([...participants, cleaned]);
    setNewParticipant('');
    setError('');
  };

  const removeParticipant = (number: string) => {
    if (number === selectedNumber) {
      setError('Cannot remove yourself from the group');
      return;
    }
    setParticipants(participants.filter(p => p !== number));
  };

  const handleCreate = async () => {
    if (participants.length < 2) {
      setError('A group must have at least 2 participants');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const response = await conversationsApi.create({
        participants,
        createdBy: selectedNumber,
        name: groupName.trim() || undefined
      });

      // Navigate to the new conversation
      navigate(`/sms/conversations/${response.data.conversationId}`);
      onCreated();
    } catch (err: any) {
      console.error('Error creating group:', err);
      setError(err.response?.data?.error || 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create Group Conversation</h2>
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
            <label>Group Name (optional)</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Enter group name"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>Add Participants</label>
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
                    addParticipant();
                  }
                }}
              />
              <button
                type="button"
                onClick={addParticipant}
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
                <span>{participant}</span>
                {participant !== selectedNumber && (
                  <button
                    onClick={() => removeParticipant(participant)}
                    className="remove-button"
                  >
                    ×
                  </button>
                )}
                {participant === selectedNumber && (
                  <span className="you-badge">You</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || participants.length < 2}
            className="btn btn-primary"
          >
            {creating ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
}
