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
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  DialogActions,
  Alert,
  Snackbar,
} from '@mui/material';
import {
  CallEnd,
  Edit as EditIcon,
  Refresh as RefreshIcon,
  CallReceived,
  CallMade,
} from '@mui/icons-material';
import { ActiveCall, ContextUpdateRequest } from '../../types/Agent';
import { AgentAPI } from '../../services/api';

export const ActiveCallsPage: React.FC = () => {
  const [activeCalls, setActiveCalls] = useState<Record<string, ActiveCall>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Context editing
  const [editingCall, setEditingCall] = useState<string | null>(null);
  const [contextForm, setContextForm] = useState({
    notes: '',
    context_data: '{}',
  });

  const loadActiveCalls = async () => {
    try {
      setLoading(true);
      const calls = await AgentAPI.getActiveCalls();
      setActiveCalls(calls);
    } catch (err) {
      setError('Failed to load active calls');
      console.error('Error loading active calls:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActiveCalls();
    
    // Poll for updates every 3 seconds
    const interval = setInterval(loadActiveCalls, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleEndCall = async (callSid: string) => {
    if (!window.confirm('End this call?')) return;

    try {
      await AgentAPI.endCall(callSid);
      setSuccess('Call ended successfully');
      loadActiveCalls();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to end call');
    }
  };

  const handleEditContext = (callSid: string) => {
    const call = activeCalls[callSid];
    if (call?.context) {
      setContextForm({
        notes: call.context.notes || '',
        context_data: JSON.stringify(call.context.context_data, null, 2),
      });
      setEditingCall(callSid);
    }
  };

  const handleSaveContext = async () => {
    if (!editingCall) return;

    try {
      let contextData;
      try {
        contextData = JSON.parse(contextForm.context_data);
      } catch (e) {
        setError('Context data must be valid JSON');
        return;
      }

      const updateData: ContextUpdateRequest = {
        notes: contextForm.notes,
        context_data: contextData,
      };

      await AgentAPI.updateActiveCallContext(editingCall, updateData);
      setSuccess('Context updated successfully');
      setEditingCall(null);
      loadActiveCalls();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update context');
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const callList = Object.entries(activeCalls);

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Active Calls ({callList.length})
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadActiveCalls}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {callList.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="h6" align="center" color="text.secondary">
              No active calls
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary" mt={1}>
              Active calls will appear here when agents are on calls
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {callList.map(([callSid, call]) => (
            <Grid item xs={12} md={6} key={callSid}>
              <Card>
                <CardContent>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                    <Box display="flex" alignItems="center" gap={1}>
                      {call.session.direction === 'inbound' ? (
                        <CallReceived color="success" />
                      ) : (
                        <CallMade color="info" />
                      )}
                      <Typography variant="h6">
                        {call.session.direction === 'inbound' ? 'Inbound Call' : 'Outbound Call'}
                      </Typography>
                    </Box>
                    <Chip
                      label={call.session.status}
                      color={call.session.status === 'active' ? 'success' : 'warning'}
                      size="small"
                    />
                  </Box>

                  <Typography variant="body1" gutterBottom>
                    <strong>From:</strong> {call.session.from_number}
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    <strong>To:</strong> {call.session.to_number}
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    <strong>Agent:</strong> {call.agent?.name || 'Unknown'}
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    <strong>Duration:</strong> {formatDuration(call.duration)}
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    <strong>Started:</strong> {new Date(call.session.started_at).toLocaleTimeString()}
                  </Typography>

                  {call.context?.notes && (
                    <Box mt={2} p={1} bgcolor="grey.100" borderRadius={1}>
                      <Typography variant="caption" color="text.secondary">
                        Notes:
                      </Typography>
                      <Typography variant="body2">
                        {call.context.notes}
                      </Typography>
                    </Box>
                  )}

                  <Box display="flex" gap={1} mt={2}>
                    <Button
                      size="small"
                      startIcon={<EditIcon />}
                      onClick={() => handleEditContext(callSid)}
                      variant="outlined"
                    >
                      Edit Context
                    </Button>
                    <Button
                      size="small"
                      startIcon={<CallEnd />}
                      onClick={() => handleEndCall(callSid)}
                      variant="contained"
                      color="error"
                    >
                      End Call
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Context Edit Dialog */}
      <Dialog
        open={!!editingCall}
        onClose={() => setEditingCall(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit Call Context</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Notes"
            multiline
            rows={3}
            value={contextForm.notes}
            onChange={(e) => setContextForm(prev => ({ ...prev, notes: e.target.value }))}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Context Data (JSON)"
            multiline
            rows={8}
            value={contextForm.context_data}
            onChange={(e) => setContextForm(prev => ({ ...prev, context_data: e.target.value }))}
            margin="normal"
            sx={{ fontFamily: 'monospace' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingCall(null)}>Cancel</Button>
          <Button onClick={handleSaveContext} variant="contained">
            Save Context
          </Button>
        </DialogActions>
      </Dialog>

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