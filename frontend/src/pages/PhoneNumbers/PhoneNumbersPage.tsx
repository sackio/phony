import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Snackbar,
  CircularProgress,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Phone as PhoneIcon,
  Link as LinkIcon,
  LinkOff as UnlinkIcon,
} from '@mui/icons-material';
import { PhoneNumber, Agent } from '../../types/Agent';
import { AgentAPI } from '../../services/api';

export const PhoneNumbersPage: React.FC = () => {
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [phoneData, agentData] = await Promise.all([
        AgentAPI.getAllPhoneNumbers(),
        AgentAPI.getAgents(),
      ]);
      setPhoneNumbers(phoneData);
      setAgents(agentData);
    } catch (err) {
      setError('Failed to load data');
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getAvailableInboundAgents = () => {
    return agents.filter(agent => agent.type === 'inbound' && !agent.phone_number);
  };

  const getAgentName = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    return agent ? agent.name : 'Unknown Agent';
  };

  const handleAssignNumber = async (phoneNumber: string, agentId: string) => {
    try {
      await AgentAPI.assignPhoneNumber(phoneNumber, agentId);
      setSuccess('Phone number assigned successfully');
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to assign phone number');
    }
  };

  const handleUnassignNumber = async (phoneNumber: string) => {
    if (!window.confirm(`Unassign ${phoneNumber}?`)) return;

    try {
      await AgentAPI.unassignPhoneNumber(phoneNumber);
      setSuccess('Phone number unassigned successfully');
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to unassign phone number');
    }
  };

  const stats = {
    total: phoneNumbers.length,
    assigned: phoneNumbers.filter(p => p.assigned_agent_id).length,
    available: phoneNumbers.filter(p => !p.assigned_agent_id).length,
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Phone Number Management
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadData}
        >
          Refresh
        </Button>
      </Box>

      {/* Stats */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <PhoneIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h4" color="primary">
                {stats.total}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Numbers
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <LinkIcon color="success" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h4" color="success.main">
                {stats.assigned}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Assigned
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <UnlinkIcon color="warning" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h4" color="warning.main">
                {stats.available}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Available
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Phone Numbers List */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Phone Numbers
          </Typography>
          
          {phoneNumbers.length === 0 ? (
            <Typography color="text.secondary" align="center" py={4}>
              No phone numbers found. Make sure your Twilio account has phone numbers configured.
            </Typography>
          ) : (
            <List>
              {phoneNumbers.map((phone, index) => (
                <ListItem
                  key={phone.phone_number}
                  divider={index < phoneNumbers.length - 1}
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
                        <Typography variant="h6">
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
                      <Box mt={1}>
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
                      <Button
                        startIcon={<UnlinkIcon />}
                        onClick={() => handleUnassignNumber(phone.phone_number)}
                        color="warning"
                        variant="outlined"
                        size="small"
                      >
                        Unassign
                      </Button>
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
          )}

          {getAvailableInboundAgents().length === 0 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              No available inbound agents to assign phone numbers to. Create inbound agents first.
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Snackbars */}
      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!success}
        autoHideDuration={4000}
        onClose={() => setSuccess(null)}
      >
        <Alert severity="success" onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      </Snackbar>
    </Box>
  );
};