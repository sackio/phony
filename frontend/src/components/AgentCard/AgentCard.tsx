import React from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Chip,
  Button,
  Box,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  MoreVert as MoreIcon,
  Edit as EditIcon,
  Settings as SettingsIcon,
  Delete as DeleteIcon,
  Call as CallIcon,
  CallReceived as CallReceivedIcon,
  CallMade as CallMadeIcon,
} from '@mui/icons-material';
import { Agent } from '../../types/Agent';

interface AgentCardProps {
  agent: Agent;
  onEdit: (agent: Agent) => void;
  onEditContext: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  onMakeCall?: (agent: Agent) => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onEdit,
  onEditContext,
  onDelete,
  onMakeCall,
}) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleEdit = () => {
    onEdit(agent);
    handleMenuClose();
  };

  const handleEditContext = () => {
    onEditContext(agent);
    handleMenuClose();
  };

  const handleDelete = () => {
    onDelete(agent);
    handleMenuClose();
  };

  const handleMakeCall = () => {
    if (onMakeCall) {
      onMakeCall(agent);
    }
    handleMenuClose();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'warning';
      case 'disabled':
        return 'error';
      default:
        return 'default';
    }
  };

  const getTypeColor = (type: string) => {
    return type === 'inbound' ? 'primary' : 'secondary';
  };

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: 4,
        borderLeftColor: theme => 
          agent.type === 'inbound' ? theme.palette.success.main : theme.palette.info.main,
      }}
    >
      <CardContent sx={{ flexGrow: 1 }}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
          <Typography variant="h6" component="div" gutterBottom>
            {agent.name}
          </Typography>
          <IconButton size="small" onClick={handleMenuOpen}>
            <MoreIcon />
          </IconButton>
        </Box>

        <Box display="flex" gap={1} mb={2}>
          <Chip
            icon={agent.type === 'inbound' ? <CallReceivedIcon /> : <CallMadeIcon />}
            label={agent.type.charAt(0).toUpperCase() + agent.type.slice(1)}
            color={getTypeColor(agent.type) as 'primary' | 'secondary'}
            size="small"
          />
          <Chip
            label={agent.status}
            color={getStatusColor(agent.status) as 'success' | 'warning' | 'error' | 'default'}
            size="small"
          />
        </Box>

        <Typography variant="body2" color="text.secondary" gutterBottom>
          <strong>Voice:</strong> {agent.voice}
        </Typography>

        {agent.phone_number && (
          <Typography variant="body2" color="text.secondary" gutterBottom>
            <strong>Phone:</strong> {agent.phone_number}
          </Typography>
        )}

        {agent.personality && (
          <Typography variant="body2" color="text.secondary" gutterBottom>
            <strong>Personality:</strong> {agent.personality}
          </Typography>
        )}

        <Box mt={2}>
          <Typography variant="body2" color="text.secondary">
            <strong>Calls:</strong> {agent.total_calls} ({agent.total_minutes} min)
          </Typography>
          {agent.last_call_at && (
            <Typography variant="body2" color="text.secondary">
              <strong>Last Call:</strong> {new Date(agent.last_call_at).toLocaleDateString()}
            </Typography>
          )}
        </Box>
      </CardContent>

      <CardActions>
        <Button size="small" startIcon={<EditIcon />} onClick={handleEdit}>
          Edit
        </Button>
        <Button size="small" startIcon={<SettingsIcon />} onClick={handleEditContext}>
          Context
        </Button>
        {agent.type === 'outbound' && (
          <Button size="small" startIcon={<CallIcon />} onClick={handleMakeCall}>
            Call
          </Button>
        )}
      </CardActions>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleEdit}>
          <EditIcon sx={{ mr: 1 }} /> Edit Agent
        </MenuItem>
        <MenuItem onClick={handleEditContext}>
          <SettingsIcon sx={{ mr: 1 }} /> Edit Context
        </MenuItem>
        {agent.type === 'outbound' && (
          <MenuItem onClick={handleMakeCall}>
            <CallIcon sx={{ mr: 1 }} /> Make Call
          </MenuItem>
        )}
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1 }} /> Delete Agent
        </MenuItem>
      </Menu>
    </Card>
  );
};