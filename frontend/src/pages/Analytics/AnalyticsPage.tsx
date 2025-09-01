import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  TrendingUp,
  Schedule,
  Phone,
  SmartToy,
} from '@mui/icons-material';
import { Agent } from '../../types/Agent';
import { AgentAPI } from '../../services/api';

export const AnalyticsPage: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const agentsData = await AgentAPI.getAgents();
      setAgents(agentsData);
    } catch (error) {
      console.error('Error loading analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Calculate metrics
  const totalCalls = agents.reduce((sum, agent) => sum + agent.total_calls, 0);
  const totalMinutes = agents.reduce((sum, agent) => sum + agent.total_minutes, 0);
  const avgCallLength = totalCalls > 0 ? totalMinutes / totalCalls : 0;
  const activeAgents = agents.filter(a => a.status === 'active').length;

  // Sort agents by activity
  const sortedAgents = [...agents].sort((a, b) => b.total_calls - a.total_calls);
  const topAgents = sortedAgents.slice(0, 5);

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
        Analytics & Reports
      </Typography>

      {/* Key Metrics */}
      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Phone color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h4" color="primary">
                {totalCalls.toLocaleString()}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Calls
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Schedule color="success" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h4" color="success.main">
                {totalMinutes.toLocaleString()}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Minutes
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <TrendingUp color="info" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h4" color="info.main">
                {avgCallLength.toFixed(1)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Avg Call Length (min)
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <SmartToy color="warning" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h4" color="warning.main">
                {activeAgents}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Active Agents
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Top Performing Agents */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Top Performing Agents
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Agent</TableCell>
                      <TableCell align="right">Calls</TableCell>
                      <TableCell align="right">Minutes</TableCell>
                      <TableCell align="right">Avg Length</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {topAgents.map((agent) => (
                      <TableRow key={agent.id}>
                        <TableCell>
                          <Box display="flex" alignItems="center" gap={1}>
                            {agent.name}
                            <Chip
                              label={agent.type}
                              size="small"
                              color={agent.type === 'inbound' ? 'success' : 'info'}
                              variant="outlined"
                            />
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          {agent.total_calls.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          {agent.total_minutes.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          {agent.total_calls > 0 
                            ? (agent.total_minutes / agent.total_calls).toFixed(1)
                            : '0.0'
                          } min
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {topAgents.length === 0 && (
                <Typography color="text.secondary" align="center" py={2}>
                  No call data available yet
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Agent Summary */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Agent Summary
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Agent</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Phone</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {agents.map((agent) => (
                      <TableRow key={agent.id}>
                        <TableCell>{agent.name}</TableCell>
                        <TableCell>
                          <Chip
                            label={agent.type}
                            size="small"
                            color={agent.type === 'inbound' ? 'success' : 'info'}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={agent.status}
                            size="small"
                            color={
                              agent.status === 'active' ? 'success' : 
                              agent.status === 'inactive' ? 'warning' : 'error'
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {agent.phone_number || 'None'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Call Distribution */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Call Distribution
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Box p={2} bgcolor="success.light" borderRadius={1}>
                    <Typography variant="h6" color="success.contrastText">
                      Inbound Calls
                    </Typography>
                    <Typography variant="h4" color="success.contrastText">
                      {agents
                        .filter(a => a.type === 'inbound')
                        .reduce((sum, a) => sum + a.total_calls, 0)
                        .toLocaleString()
                      }
                    </Typography>
                    <Typography variant="body2" color="success.contrastText">
                      {agents
                        .filter(a => a.type === 'inbound')
                        .reduce((sum, a) => sum + a.total_minutes, 0)
                        .toLocaleString()
                      } minutes
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box p={2} bgcolor="info.light" borderRadius={1}>
                    <Typography variant="h6" color="info.contrastText">
                      Outbound Calls
                    </Typography>
                    <Typography variant="h4" color="info.contrastText">
                      {agents
                        .filter(a => a.type === 'outbound')
                        .reduce((sum, a) => sum + a.total_calls, 0)
                        .toLocaleString()
                      }
                    </Typography>
                    <Typography variant="body2" color="info.contrastText">
                      {agents
                        .filter(a => a.type === 'outbound')
                        .reduce((sum, a) => sum + a.total_minutes, 0)
                        .toLocaleString()
                      } minutes
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