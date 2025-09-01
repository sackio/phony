import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
  Alert,
  Box,
  Grid,
} from '@mui/material';
import { Agent } from '../../types/Agent';
import { AgentAPI } from '../../services/api';

interface OutboundCallDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agent?: Agent | null;
}

export const OutboundCallDialog: React.FC<OutboundCallDialogProps> = ({
  open,
  onClose,
  onSuccess,
  agent,
}) => {
  const [formData, setFormData] = useState({
    to_number: '',
    from_number: '',
    context_override: '{}',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setFormData({
        to_number: '',
        from_number: agent?.phone_number || '',
        context_override: JSON.stringify({
          call_purpose: 'Outbound call',
          timestamp: new Date().toISOString(),
        }, null, 2),
      });
      setError(null);
    }
  }, [open, agent]);

  const handleInputChange = (field: string) => (event: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const formatPhoneNumber = (phone: string): string => {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Add +1 if it's a 10-digit US number
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    
    // Add + if it doesn't have it
    if (digits.length > 10 && !phone.startsWith('+')) {
      return `+${digits}`;
    }
    
    return phone;
  };

  const handleMakeCall = async () => {
    if (!agent) return;

    try {
      setLoading(true);
      setError(null);

      // Validate phone number
      const toNumber = formatPhoneNumber(formData.to_number);
      if (!toNumber || toNumber.length < 10) {
        throw new Error('Please enter a valid phone number');
      }

      // Parse context override
      let contextOverride;
      try {
        contextOverride = JSON.parse(formData.context_override);
      } catch (e) {
        throw new Error('Context override must be valid JSON');
      }

      await AgentAPI.makeOutboundCall({
        agent_id: agent.id,
        to_number: toNumber,
        from_number: formData.from_number || undefined,
        context_override: contextOverride,
      });

      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to make call');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Make Outbound Call - {agent?.name}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Call To (Phone Number)"
              value={formData.to_number}
              onChange={handleInputChange('to_number')}
              placeholder="+15551234567"
              required
              helperText="Enter full phone number with country code"
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Call From (Optional)"
              value={formData.from_number}
              onChange={handleInputChange('from_number')}
              placeholder={agent?.phone_number || "+18578167225"}
              helperText={`Leave empty to use ${agent?.phone_number ? 'agent phone number' : 'default number'}`}
            />
          </Grid>

          <Grid item xs={12}>
            <Typography variant="subtitle2" gutterBottom>
              Call Context (JSON)
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={6}
              value={formData.context_override}
              onChange={handleInputChange('context_override')}
              variant="outlined"
              sx={{ fontFamily: 'monospace' }}
              placeholder='{"customer_name": "John Doe", "reason": "Follow-up call"}'
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Additional context for this specific call. Will be merged with agent's default context.
            </Typography>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button 
          onClick={handleMakeCall} 
          variant="contained" 
          disabled={loading || !formData.to_number}
          color="success"
        >
          {loading ? 'Calling...' : 'Make Call'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};