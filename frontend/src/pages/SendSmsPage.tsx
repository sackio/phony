import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { smsApi, conversationsApi, incomingConfigsApi, AvailableNumber, Conversation, SmsMessage } from '../services/api';
import './SendSmsPage.css';

export function SendSmsPage() {
  const navigate = useNavigate();
  const [fromNumber, setFromNumber] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [message, setMessage] = useState('');
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [existingConversation, setExistingConversation] = useState<Conversation | null>(null);
  const [conversationMessages, setConversationMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAvailableNumbers();
  }, []);

  useEffect(() => {
    if (fromNumber && recipients.length > 0) {
      checkForExistingConversation();
    } else {
      setExistingConversation(null);
      setConversationMessages([]);
    }
  }, [fromNumber, recipients]);

  useEffect(() => {
    scrollToBottom();
  }, [conversationMessages]);

  const loadAvailableNumbers = async () => {
    try {
      const response = await incomingConfigsApi.listAvailableNumbers();
      setAvailableNumbers(response.data);
      if (response.data.length > 0) {
        setFromNumber(response.data[0].phoneNumber);
      }
    } catch (err: any) {
      console.error('Error loading available numbers:', err);
      setError('Failed to load available phone numbers');
    }
  };

  const checkForExistingConversation = async () => {
    if (!fromNumber || recipients.length === 0) return;

    try {
      // Get all participants including sender
      const allParticipants = [fromNumber, ...recipients].sort();

      // Try to find conversation by participants
      const response = await conversationsApi.list(fromNumber);
      const conversations = response.data;

      // Find matching conversation
      const match = conversations.find(conv => {
        const convParticipants = [...conv.participants].sort();
        return (
          convParticipants.length === allParticipants.length &&
          convParticipants.every((p, i) => p === allParticipants[i])
        );
      });

      if (match) {
        setExistingConversation(match);
        // Load messages
        const messagesResponse = await conversationsApi.getMessages(match.conversationId, 50);
        setConversationMessages(messagesResponse.data);
      } else {
        setExistingConversation(null);
        setConversationMessages([]);
      }
    } catch (err: any) {
      console.error('Error checking for conversation:', err);
      // Don't show error to user, just no conversation found
      setExistingConversation(null);
      setConversationMessages([]);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const addRecipient = () => {
    const cleaned = currentInput.trim();
    if (!cleaned) return;

    // Basic E.164 validation
    if (!cleaned.match(/^\+?[1-9]\d{1,14}$/)) {
      setError('Please enter a valid phone number in E.164 format');
      return;
    }

    // Ensure starts with +
    const formatted = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;

    if (recipients.includes(formatted)) {
      setError('This number is already added');
      return;
    }

    if (formatted === fromNumber) {
      setError('Cannot send to yourself');
      return;
    }

    setRecipients([...recipients, formatted]);
    setCurrentInput('');
    setError('');
  };

  const removeRecipient = (number: string) => {
    setRecipients(recipients.filter(r => r !== number));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addRecipient();
    } else if (e.key === 'Backspace' && currentInput === '' && recipients.length > 0) {
      // Remove last recipient on backspace when input is empty
      setRecipients(recipients.slice(0, -1));
    }
  };

  const handleSendSms = async (e: React.FormEvent) => {
    e.preventDefault();

    if (recipients.length === 0) {
      setError('Please add at least one recipient');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (existingConversation) {
        // Send to existing conversation
        await conversationsApi.sendGroupMessage(existingConversation.conversationId, {
          body: message,
          fromNumber
        });
        setSuccess(`Message sent to ${recipients.length} recipient${recipients.length > 1 ? 's' : ''} in existing conversation!`);
      } else if (recipients.length > 1) {
        // Create new group conversation and send
        const newConv = await conversationsApi.create({
          participants: [fromNumber, ...recipients],
          createdBy: fromNumber
        });

        await conversationsApi.sendGroupMessage(newConv.data.conversationId, {
          body: message,
          fromNumber
        });
        setSuccess(`Message sent to ${recipients.length} recipients! New group conversation created.`);
      } else {
        // Single recipient - send regular SMS
        await smsApi.send({
          toNumber: recipients[0],
          body: message,
          fromNumber
        });
        setSuccess(`Message sent successfully to ${recipients[0]}!`);
      }

      // Clear form
      setMessage('');
      setRecipients([]);
      setCurrentInput('');

      // Optionally navigate to conversation
      setTimeout(() => {
        if (existingConversation) {
          navigate(`/sms/conversations/${existingConversation.conversationId}`);
        }
      }, 2000);
    } catch (err: any) {
      console.error('Error sending SMS:', err);
      setError(err.response?.data?.error || 'Failed to send SMS');
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

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const characterCount = message.length;
  const maxLength = 1600;
  const segments = Math.ceil(characterCount / 160) || 1;

  const isGroup = recipients.length > 1;

  return (
    <div className="send-sms-page">
      <div className="send-sms-container">
        <div className="main-panel">
          <div className="page-header">
            <h1>📱 Send SMS</h1>
            <p>Send text messages to one or multiple recipients</p>
          </div>

          {error && (
            <div className="alert alert-error">
              <span className="alert-icon">⚠️</span>
              {error}
            </div>
          )}

          {success && (
            <div className="alert alert-success">
              <span className="alert-icon">✅</span>
              {success}
            </div>
          )}

          <form onSubmit={handleSendSms} className="sms-form">
            <div className="form-group">
              <label htmlFor="fromNumber">From Number</label>
              <select
                id="fromNumber"
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                required
                disabled={loading}
                className="form-select"
              >
                <option value="">Select a number...</option>
                {availableNumbers.map((num) => (
                  <option key={num.phoneNumber} value={num.phoneNumber}>
                    {formatPhoneNumber(num.phoneNumber)} {num.friendlyName && `(${num.friendlyName})`}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="recipients">
                To Numbers {isGroup && <span className="group-badge">👥 Group ({recipients.length})</span>}
              </label>
              <div className="recipients-input-container">
                <div className="recipients-tags">
                  {recipients.map((recipient) => (
                    <div key={recipient} className="recipient-tag">
                      <span>{formatPhoneNumber(recipient)}</span>
                      <button
                        type="button"
                        onClick={() => removeRecipient(recipient)}
                        className="remove-tag"
                        disabled={loading}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <input
                    type="tel"
                    id="recipients"
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={recipients.length === 0 ? "+1234567890" : "Add another..."}
                    disabled={loading}
                    className="recipient-input"
                  />
                </div>
                <button
                  type="button"
                  onClick={addRecipient}
                  disabled={loading || !currentInput.trim()}
                  className="btn-add-recipient"
                >
                  Add
                </button>
              </div>
              <small className="form-help">
                Enter phone numbers in E.164 format. Press Enter or click Add after each number.
              </small>
            </div>

            {existingConversation && (
              <div className="conversation-notice">
                <span className="notice-icon">💬</span>
                <div className="notice-content">
                  <strong>Existing Conversation Found</strong>
                  <p>
                    {existingConversation.type === 'group' && existingConversation.name
                      ? `Group: ${existingConversation.name}`
                      : `${existingConversation.messageCount} previous messages`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/sms/conversations/${existingConversation.conversationId}`)}
                  className="btn-view-conversation"
                >
                  View
                </button>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="message">Message</label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
                required
                disabled={loading}
                rows={6}
                maxLength={maxLength}
                className="form-textarea"
              />
              <div className="message-stats">
                <span className={characterCount > maxLength ? 'text-danger' : ''}>
                  {characterCount} / {maxLength} characters
                </span>
                <span>
                  {segments} segment{segments !== 1 ? 's' : ''}
                </span>
                {isGroup && (
                  <span className="recipients-count">
                    Will send to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !fromNumber || recipients.length === 0 || !message}
              className="btn btn-primary btn-send"
            >
              {loading ? 'Sending...' : `Send ${isGroup ? 'Group ' : ''}Message`}
            </button>
          </form>

          <div className="sms-info">
            <h3>SMS Information</h3>
            <ul>
              <li>Add multiple recipients to send group messages</li>
              <li>Messages are limited to 1600 characters</li>
              <li>Messages over 160 characters will be sent as multiple segments</li>
              <li>Phone numbers must be in E.164 format (+country code + number)</li>
              <li>Group messages will create or use existing conversations</li>
            </ul>
          </div>
        </div>

        {existingConversation && conversationMessages.length > 0 && (
          <div className="conversation-sidebar">
            <div className="sidebar-header">
              <h3>
                {existingConversation.type === 'group' && existingConversation.name
                  ? existingConversation.name
                  : 'Conversation History'}
              </h3>
              <span className="message-count">{conversationMessages.length} messages</span>
            </div>

            <div className="sidebar-messages">
              {conversationMessages.map((msg) => (
                <div
                  key={msg.messageSid}
                  className={`sidebar-message ${msg.direction === 'outbound' ? 'outbound' : 'inbound'}`}
                >
                  {existingConversation.type === 'group' && msg.direction === 'inbound' && (
                    <div className="message-sender">{formatPhoneNumber(msg.fromNumber)}</div>
                  )}
                  <div className="message-body">{msg.body}</div>
                  <div className="message-time">{formatTimestamp(msg.createdAt)}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <button
              onClick={() => navigate(`/sms/conversations/${existingConversation.conversationId}`)}
              className="btn btn-secondary btn-full-conversation"
            >
              Open Full Conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
