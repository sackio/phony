import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  SmartToy,
  Phone,
  CallReceived,
  CallMade,
  TrendingUp,
} from '@mui/icons-material';
import { Agent, ActiveCall } from '../../types/Agent';
import { AgentAPI } from '../../services/api';

export const DashboardPage: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeCalls, setActiveCalls] = useState<Record<string, ActiveCall>>({});
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [agentsData, activeCallsData] = await Promise.all([
        AgentAPI.getAgents(),
        AgentAPI.getActiveCalls(),
      ]);
      setAgents(agentsData);
      setActiveCalls(activeCallsData);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Set up polling for active calls
    const interval = setInterval(() => {
      AgentAPI.getActiveCalls().then(setActiveCalls).catch(console.error);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const stats = {
    totalAgents: agents.length,
    activeAgents: agents.filter(a => a.status === 'active').length,
    inboundAgents: agents.filter(a => a.type === 'inbound').length,
    outboundAgents: agents.filter(a => a.type === 'outbound').length,
    activeCalls: Object.keys(activeCalls).length,
    totalCalls: agents.reduce((sum, agent) => sum + agent.total_calls, 0),
    totalMinutes: agents.reduce((sum, agent) => sum + agent.total_minutes, 0),
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
      <Typography variant="h4" component="h1" gutterBottom>
        Dashboard
      </Typography>

      {/* Stats Grid */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
            <SmartToy color="primary" sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h4" color="primary">
              {stats.totalAgents}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total Agents
            </Typography>
            <Typography variant="caption" color="success.main">
              {stats.activeAgents} active
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
            <Phone color="secondary" sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h4" color="secondary">
              {stats.activeCalls}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Active Calls
            </Typography>
            <Typography variant="caption" color="info.main">
              Live now
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
            <CallReceived color="success" sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h4" color="success.main">
              {stats.inboundAgents}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Inbound Agents
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Paper elevation={2} sx={{ p: 3, textAlign: 'center' }}>
            <CallMade color="info" sx={{ fontSize: 40, mb: 1 }} />
            <Typography variant="h4" color="info.main">
              {stats.outboundAgents}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Outbound Agents
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Content Grid */}
      <Grid container spacing={3}>
        {/* Active Calls */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Active Calls ({Object.keys(activeCalls).length})
              </Typography>
              {Object.keys(activeCalls).length === 0 ? (
                <Typography color="text.secondary" align="center" py={2}>
                  No active calls
                </Typography>
              ) : (
                <List dense>
                  {Object.entries(activeCalls).map(([callSid, call]) => (
                    <ListItem key={callSid}>
                      <ListItemIcon>
                        {call.session.direction === 'inbound' ? 
                          <CallReceived color="success" /> : 
                          <CallMade color="info" />
                        }
                      </ListItemIcon>
                      <ListItemText
                        primary={`${call.session.from_number} → ${call.session.to_number}`}
                        secondary={
                          <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                            <Chip 
                              label={call.agent?.name || 'Unknown'} 
                              size="small" 
                              color="primary" 
                            />
                            <Chip 
                              label={`${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}`} 
                              size="small" 
                              variant="outlined" 
                            />
                          </Box>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Agent Activity */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Agent Activity
              </Typography>
              <List dense>
                {agents
                  .filter(agent => agent.total_calls > 0)
                  .sort((a, b) => new Date(b.last_call_at || 0).getTime() - new Date(a.last_call_at || 0).getTime())
                  .slice(0, 5)
                  .map((agent) => (
                    <ListItem key={agent.id}>
                      <ListItemIcon>
                        <SmartToy color={agent.status === 'active' ? 'primary' : 'disabled'} />
                      </ListItemIcon>
                      <ListItemText
                        primary={agent.name}
                        secondary={
                          <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                            <Chip 
                              label={`${agent.total_calls} calls`} 
                              size="small" 
                              color="primary" 
                            />
                            <Chip 
                              label={`${agent.total_minutes} min`} 
                              size="small" 
                              variant="outlined" 
                            />
                            {agent.last_call_at && (
                              <Typography variant="caption" color="text.secondary">
                                Last: {new Date(agent.last_call_at).toLocaleDateString()}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                  ))}
              </List>
              {agents.filter(agent => agent.total_calls > 0).length === 0 && (
                <Typography color="text.secondary" align="center" py={2}>
                  No call activity yet
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* System Statistics */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom display="flex" alignItems="center" gap={1}>
                <TrendingUp /> System Statistics
              </Typography>
              <Grid container spacing={3} mt={1}>
                <Grid item xs={12} sm={4}>
                  <Box textAlign="center">
                    <Typography variant="h5" color="primary">
                      {stats.totalCalls.toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total Calls Made
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Box textAlign="center">
                    <Typography variant="h5" color="success.main">
                      {stats.totalMinutes.toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total Minutes
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Box textAlign="center">
                    <Typography variant="h5" color="info.main">
                      {stats.totalMinutes > 0 ? (stats.totalMinutes / stats.totalCalls).toFixed(1) : '0'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Avg Call Length (min)
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};