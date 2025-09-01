import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import { Agent, CallContext } from '../../types/Agent';
import { AgentAPI } from '../../services/api';

interface ContextDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  agent?: Agent | null;
}

export const ContextDialog: React.FC<ContextDialogProps> = ({
  open,
  onClose,
  onSaved,
  agent,
}) => {
  const [context, setContext] = useState<CallContext | null>(null);
  const [formData, setFormData] = useState({
    notes: '',
    context_data: '{}',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && agent) {
      loadContext();
    }
  }, [open, agent]);

  const loadContext = async () => {
    if (!agent) return;

    try {
      setLoading(true);
      const contextData = await AgentAPI.getAgentContext(agent.id);
      setContext(contextData);
      setFormData({
        notes: contextData.notes || '',
        context_data: JSON.stringify(contextData.context_data, null, 2),
      });
    } catch (err) {
      console.error('Error loading context:', err);
      // Create default context if none exists
      setFormData({
        notes: '',
        context_data: JSON.stringify(agent.context_data, null, 2),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string) => (event: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleSave = async () => {
    if (!agent) return;

    try {
      setLoading(true);
      setError(null);

      // Parse context data
      let contextData;
      try {
        contextData = JSON.parse(formData.context_data);
      } catch (e) {
        throw new Error('Context data must be valid JSON');
      }

      await AgentAPI.updateAgentContext(agent.id, {
        notes: formData.notes,
        context_data: contextData,
      });

      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save context');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Edit Agent Context - {agent?.name}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mt: 2 }}>
          <TextField
            fullWidth
            label="Notes"
            multiline
            rows={3}
            value={formData.notes}
            onChange={handleInputChange('notes')}
            placeholder="Special notes or instructions for this agent..."
            sx={{ mb: 2 }}
          />

          <Typography variant="subtitle2" gutterBottom>
            Context Data (JSON)
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={10}
            value={formData.context_data}
            onChange={handleInputChange('context_data')}
            variant="outlined"
            sx={{ fontFamily: 'monospace' }}
            placeholder='{"key": "value", "instructions": "Special instructions"}'
          />
          
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            This data will be available to the AI agent during calls. Use JSON format.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button 
          onClick={handleSave} 
          variant="contained" 
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Context'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};