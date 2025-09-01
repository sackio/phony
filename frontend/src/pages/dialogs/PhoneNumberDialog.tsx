import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  Typography,
  Alert,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
} from '@mui/material';
import {
  LinkOff as UnlinkIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { Agent, PhoneNumber } from '../../types/Agent';
import { AgentAPI } from '../../services/api';

interface PhoneNumberDialogProps {
  open: boolean;
  onClose: () => void;
  agents: Agent[];
  onPhoneNumbersChanged: () => void;
}

export const PhoneNumberDialog: React.FC<PhoneNumberDialogProps> = ({
  open,
  onClose,
  agents,
  onPhoneNumbersChanged,
}) => {
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadPhoneNumbers();
    }
  }, [open]);

  const loadPhoneNumbers = async () => {
    try {
      setLoading(true);
      const numbers = await AgentAPI.getAllPhoneNumbers();
      setPhoneNumbers(numbers);
    } catch (err) {
      setError('Failed to load phone numbers');
      console.error('Error loading phone numbers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignNumber = async (phoneNumber: string, agentId: string) => {
    try {
      await AgentAPI.assignPhoneNumber(phoneNumber, agentId);
      setSuccess(`Phone number assigned successfully`);
      loadPhoneNumbers();
      onPhoneNumbersChanged();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to assign phone number');
    }
  };

  const handleUnassignNumber = async (phoneNumber: string) => {
    try {
      await AgentAPI.unassignPhoneNumber(phoneNumber);
      setSuccess(`Phone number unassigned successfully`);
      loadPhoneNumbers();
      onPhoneNumbersChanged();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to unassign phone number');
    }
  };

  const getAvailableInboundAgents = () => {
    return agents.filter(agent => agent.type === 'inbound' && !agent.phone_number);
  };

  const getAgentName = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    return agent ? agent.name : 'Unknown Agent';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Phone Number Management</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Manage phone number assignments to inbound agents. Each phone number can only be assigned to one inbound agent.
        </Typography>

        <List>
          {phoneNumbers.map((phone) => (
            <ListItem 
              key={phone.phone_number}
              sx={{
                border: 1,
                borderColor: phone.assigned_agent_id ? 'success.main' : 'grey.300',
                borderRadius: 1,
                mb: 1,
                backgroundColor: phone.assigned_agent_id ? 'success.light' : 'background.paper',
              }}
            >
              <ListItemText
                primary={
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {phone.phone_number}
                    </Typography>
                    <Chip
                      label={phone.assigned_agent_id ? 'Assigned' : 'Available'}
                      color={phone.assigned_agent_id ? 'success' : 'default'}
                      size="small"
                    />
                  </Box>
                }
                secondary={
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {phone.friendly_name || 'No friendly name'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Capabilities: {phone.capabilities.join(', ')}
                    </Typography>
                    {phone.assigned_agent_id && (
                      <Typography variant="body2" color="success.main" fontWeight={500}>
                        Assigned to: {getAgentName(phone.assigned_agent_id)}
                      </Typography>
                    )}
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                {phone.assigned_agent_id ? (
                  <IconButton
                    edge="end"
                    onClick={() => handleUnassignNumber(phone.phone_number)}
                    color="warning"
                    title="Unassign phone number"
                  >
                    <UnlinkIcon />
                  </IconButton>
                ) : (
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Assign to Agent</InputLabel>
                    <Select
                      label="Assign to Agent"
                      defaultValue=""
                      onChange={(e) => handleAssignNumber(phone.phone_number, e.target.value)}
                    >
                      {getAvailableInboundAgents().map((agent) => (
                        <MenuItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>

        {phoneNumbers.length === 0 && !loading && (
          <Typography variant="body1" color="text.secondary" align="center" sx={{ py: 4 }}>
            No phone numbers found. Make sure your Twilio account has phone numbers configured.
          </Typography>
        )}

        {getAvailableInboundAgents().length === 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            No available inbound agents to assign phone numbers to. Create inbound agents first.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={loadPhoneNumbers} disabled={loading}>
          Refresh
        </Button>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};