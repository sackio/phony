import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Fab,
  Button,
  Alert,
  Snackbar,
  CircularProgress,
  Paper,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Phone as PhoneIcon,
} from '@mui/icons-material';
import { Agent, PhoneNumber } from '../../types/Agent';
import { AgentAPI } from '../../services/api';
import { AgentCard } from '../../components/AgentCard/AgentCard';
import { AgentDialog } from '../dialogs/AgentDialog';
import { ContextDialog } from '../dialogs/ContextDialog';
import { OutboundCallDialog } from '../dialogs/OutboundCallDialog';
import { PhoneNumberDialog } from '../dialogs/PhoneNumberDialog';

export const AgentsPage: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog states
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [outboundCallDialogOpen, setOutboundCallDialogOpen] = useState(false);
  const [phoneNumberDialogOpen, setPhoneNumberDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [agentsData, phoneNumbersData] = await Promise.all([
        AgentAPI.getAgents(),
        AgentAPI.getAvailablePhoneNumbers(),
      ]);
      setAgents(agentsData);
      setPhoneNumbers(phoneNumbersData);
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

  const handleCreateAgent = () => {
    setSelectedAgent(null);
    setAgentDialogOpen(true);
  };

  const handleEditAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    setAgentDialogOpen(true);
  };

  const handleEditContext = (agent: Agent) => {
    setSelectedAgent(agent);
    setContextDialogOpen(true);
  };

  const handleMakeCall = (agent: Agent) => {
    setSelectedAgent(agent);
    setOutboundCallDialogOpen(true);
  };

  const handleDeleteAgent = async (agent: Agent) => {
    if (window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) {
      try {
        await AgentAPI.deleteAgent(agent.id);
        setSuccess('Agent deleted successfully');
        loadData();
      } catch (err) {
        setError('Failed to delete agent');
        console.error('Error deleting agent:', err);
      }
    }
  };

  const handleAgentSaved = () => {
    setAgentDialogOpen(false);
    setSuccess(selectedAgent ? 'Agent updated successfully' : 'Agent created successfully');
    loadData();
  };

  const handleContextSaved = () => {
    setContextDialogOpen(false);
    setSuccess('Context updated successfully');
  };

  const handleCallMade = () => {
    setOutboundCallDialogOpen(false);
    setSuccess('Call initiated successfully');
  };

  const stats = {
    total: agents.length,
    inbound: agents.filter(a => a.type === 'inbound').length,
    outbound: agents.filter(a => a.type === 'outbound').length,
    available: phoneNumbers.length,
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
          Agent Management
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<PhoneIcon />}
            onClick={() => setPhoneNumberDialogOpen(true)}
          >
            Manage Numbers
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadData}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Paper elevation={2} sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="primary">
              {stats.total}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total Agents
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper elevation={2} sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="success.main">
              {stats.inbound}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Inbound Agents
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper elevation={2} sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="info.main">
              {stats.outbound}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Outbound Agents
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper elevation={2} sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="warning.main">
              {stats.available}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Available Numbers
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Agents Grid */}
      {agents.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="h6" align="center" color="text.secondary">
              No agents created yet
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary" mt={1}>
              Click the + button to create your first agent
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {agents.map((agent) => (
            <Grid item xs={12} sm={6} md={4} key={agent.id}>
              <AgentCard
                agent={agent}
                onEdit={handleEditAgent}
                onEditContext={handleEditContext}
                onDelete={handleDeleteAgent}
                onMakeCall={agent.type === 'outbound' ? handleMakeCall : undefined}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Floating Action Button */}
      <Fab
        color="primary"
        aria-label="add agent"
        sx={{ position: 'fixed', bottom: 16, right: 16 }}
        onClick={handleCreateAgent}
      >
        <AddIcon />
      </Fab>

      {/* Dialogs */}
      <AgentDialog
        open={agentDialogOpen}
        onClose={() => setAgentDialogOpen(false)}
        onSaved={handleAgentSaved}
        agent={selectedAgent}
        phoneNumbers={phoneNumbers}
      />

      <ContextDialog
        open={contextDialogOpen}
        onClose={() => setContextDialogOpen(false)}
        onSaved={handleContextSaved}
        agent={selectedAgent}
      />

      <OutboundCallDialog
        open={outboundCallDialogOpen}
        onClose={() => setOutboundCallDialogOpen(false)}
        onSuccess={handleCallMade}
        agent={selectedAgent}
      />

      <PhoneNumberDialog
        open={phoneNumberDialogOpen}
        onClose={() => setPhoneNumberDialogOpen(false)}
        agents={agents}
        onPhoneNumbersChanged={loadData}
      />

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