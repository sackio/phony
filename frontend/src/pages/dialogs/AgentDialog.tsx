import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Alert,
} from '@mui/material';
import { Agent, PhoneNumber } from '../../types/Agent';
import { AgentAPI } from '../../services/api';

interface AgentDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  agent?: Agent | null;
  phoneNumbers: PhoneNumber[];
}

const voiceOptions = [
  { value: 'alloy', label: 'Alloy (Default)' },
  { value: 'echo', label: 'Echo (Male)' },
  { value: 'fable', label: 'Fable (British)' },
  { value: 'onyx', label: 'Onyx (Deep Male)' },
  { value: 'nova', label: 'Nova (Female)' },
  { value: 'shimmer', label: 'Shimmer (Female)' },
];

const defaultContextData = {
  instructions: 'Additional instructions for this agent',
  business_hours: '9 AM - 6 PM EST',
};

export const AgentDialog: React.FC<AgentDialogProps> = ({
  open,
  onClose,
  onSaved,
  agent,
  phoneNumbers,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    type: 'inbound' as 'inbound' | 'outbound',
    phone_number: '',
    system_prompt: 'You are a helpful AI assistant.',
    voice: 'alloy' as Agent['voice'],
    personality: '',
    greeting_message: '',
    context_data: JSON.stringify(defaultContextData, null, 2),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (agent) {
      setFormData({
        name: agent.name,
        type: agent.type,
        phone_number: agent.phone_number || '',
        system_prompt: agent.system_prompt,
        voice: agent.voice,
        personality: agent.personality || '',
        greeting_message: agent.greeting_message || '',
        context_data: JSON.stringify(agent.context_data, null, 2),
      });
    } else {
      setFormData({
        name: '',
        type: 'inbound',
        phone_number: '',
        system_prompt: 'You are a helpful AI assistant.',
        voice: 'alloy',
        personality: '',
        greeting_message: '',
        context_data: JSON.stringify(defaultContextData, null, 2),
      });
    }
    setError(null);
  }, [agent, open]);

  const handleInputChange = (field: string) => (event: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validate form
      if (!formData.name.trim()) {
        throw new Error('Agent name is required');
      }

      if (formData.type === 'inbound' && !formData.phone_number) {
        throw new Error('Phone number is required for inbound agents');
      }

      // Parse context data
      let contextData;
      try {
        contextData = JSON.parse(formData.context_data);
      } catch (e) {
        throw new Error('Context data must be valid JSON');
      }

      const agentData = {
        name: formData.name.trim(),
        type: formData.type,
        phone_number: formData.phone_number || undefined,
        system_prompt: formData.system_prompt,
        voice: formData.voice,
        personality: formData.personality || undefined,
        greeting_message: formData.greeting_message || undefined,
        context_data: contextData,
      };

      if (agent) {
        await AgentAPI.updateAgent(agent.id, agentData);
      } else {
        await AgentAPI.createAgent(agentData);
      }

      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save agent');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {agent ? 'Edit Agent' : 'Create New Agent'}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Agent Name"
              value={formData.name}
              onChange={handleInputChange('name')}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth required>
              <InputLabel>Agent Type</InputLabel>
              <Select
                value={formData.type}
                label="Agent Type"
                onChange={handleInputChange('type')}
              >
                <MenuItem value="inbound">Inbound (Receives Calls)</MenuItem>
                <MenuItem value="outbound">Outbound (Makes Calls)</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {formData.type === 'inbound' && (
            <Grid item xs={12}>
              <FormControl fullWidth required>
                <InputLabel>Phone Number</InputLabel>
                <Select
                  value={formData.phone_number}
                  label="Phone Number"
                  onChange={handleInputChange('phone_number')}
                >
                  {agent?.phone_number && (
                    <MenuItem value={agent.phone_number}>
                      {agent.phone_number} (Current)
                    </MenuItem>
                  )}
                  {phoneNumbers.map((phone) => (
                    <MenuItem key={phone.phone_number} value={phone.phone_number}>
                      {phone.phone_number} {phone.friendly_name && `(${phone.friendly_name})`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Voice</InputLabel>
              <Select
                value={formData.voice}
                label="Voice"
                onChange={handleInputChange('voice')}
              >
                {voiceOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Personality"
              value={formData.personality}
              onChange={handleInputChange('personality')}
              placeholder="e.g., Friendly, Professional, Witty"
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="System Prompt"
              multiline
              rows={3}
              value={formData.system_prompt}
              onChange={handleInputChange('system_prompt')}
              required
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Greeting Message"
              multiline
              rows={2}
              value={formData.greeting_message}
              onChange={handleInputChange('greeting_message')}
              placeholder="Hello! How can I help you today?"
            />
          </Grid>

          <Grid item xs={12}>
            <Typography variant="subtitle2" gutterBottom>
              Context Data (JSON)
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={6}
              value={formData.context_data}
              onChange={handleInputChange('context_data')}
              variant="outlined"
              sx={{ fontFamily: 'monospace' }}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button 
          onClick={handleSave} 
          variant="contained" 
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Agent'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};