import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contextsApi, type Context } from '../services/api';
import './ContextsPage.css';

export function ContextsPage() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingContext, setEditingContext] = useState<Context | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'incoming' | 'outgoing' | 'both'>('all');

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemInstructions, setSystemInstructions] = useState('');
  const [exampleCallInstructions, setExampleCallInstructions] = useState('');
  const [contextType, setContextType] = useState<'incoming' | 'outgoing' | 'both'>('both');

  // Fetch contexts
  const { data: contextsResponse, isLoading } = useQuery({
    queryKey: ['contexts', filterType === 'all' ? undefined : filterType],
    queryFn: () => contextsApi.list(filterType === 'all' ? undefined : filterType as any),
  });

  const contexts = contextsResponse?.data || [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: contextsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contexts'] });
      resetForm();
      setShowCreateForm(false);
    },
    onError: (error: any) => {
      alert(`Error creating context: ${error.response?.data?.error || error.message}`);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      contextsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contexts'] });
      setEditingContext(null);
      resetForm();
    },
    onError: (error: any) => {
      alert(`Error updating context: ${error.response?.data?.error || error.message}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: contextsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contexts'] });
    },
    onError: (error: any) => {
      alert(`Error deleting context: ${error.response?.data?.error || error.message}`);
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setSystemInstructions('');
    setExampleCallInstructions('');
    setContextType('both');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !systemInstructions) {
      alert('Please fill in all required fields');
      return;
    }
    createMutation.mutate({ name, description, systemInstructions, exampleCallInstructions: exampleCallInstructions || '', contextType });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContext) return;
    updateMutation.mutate({
      id: editingContext._id,
      data: { name, description, systemInstructions, exampleCallInstructions, contextType },
    });
  };

  const handleEdit = (context: Context) => {
    setEditingContext(context);
    setName(context.name);
    setDescription(context.description || '');
    setSystemInstructions(context.systemInstructions);
    setExampleCallInstructions(context.exampleCallInstructions || '');
    setContextType(context.contextType);
    setShowCreateForm(true);
  };

  const handleCancelEdit = () => {
    setEditingContext(null);
    setShowCreateForm(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this context?')) {
      deleteMutation.mutate(id);
    }
  };

  const getContextTypeLabel = (type: string) => {
    switch (type) {
      case 'incoming': return '📥 Incoming';
      case 'outgoing': return '📤 Outgoing';
      case 'both': return '🔄 Both';
      default: return type;
    }
  };

  return (
    <div className="contexts-page">
      <div className="page-header">
        <h2>📝 Context Templates</h2>
        <div className="header-actions">
          <select
            className="filter-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
          >
            <option value="all">All Types</option>
            <option value="incoming">Incoming Only</option>
            <option value="outgoing">Outgoing Only</option>
            <option value="both">Both</option>
          </select>
          {!showCreateForm && (
            <button
              className="btn-primary"
              onClick={() => {
                resetForm();
                setShowCreateForm(true);
              }}
            >
              + New Context
            </button>
          )}
        </div>
      </div>

      {showCreateForm && (
        <div className="context-form-section">
          <h3>{editingContext ? 'Edit Context Template' : 'New Context Template'}</h3>
          <form onSubmit={editingContext ? handleUpdate : handleCreate} className="context-form">
            <div className="form-row">
              <div className="form-group">
                <label>Template Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Friendly Customer Support"
                  required
                />
              </div>

              <div className="form-group">
                <label>Context Type *</label>
                <select
                  value={contextType}
                  onChange={(e) => setContextType(e.target.value as any)}
                  required
                >
                  <option value="both">Both (Incoming & Outgoing)</option>
                  <option value="incoming">Incoming Only</option>
                  <option value="outgoing">Outgoing Only</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this context template"
              />
            </div>

            <div className="form-group">
              <label>System Instructions *</label>
              <textarea
                value={systemInstructions}
                onChange={(e) => setSystemInstructions(e.target.value)}
                placeholder="Enter the system instructions that define the AI's role and behavior..."
                rows={8}
                required
              />
              <small>The AI's core system prompt that defines its personality and role</small>
            </div>

            <div className="form-group">
              <label>Example Call Instructions</label>
              <textarea
                value={exampleCallInstructions}
                onChange={(e) => setExampleCallInstructions(e.target.value)}
                placeholder="Example: 'This is a follow-up call about customer orders' or leave empty..."
                rows={3}
              />
              <small>Optional example of call-specific instructions that can be used with this template</small>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editingContext ? 'Update Template' : 'Create Template'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="contexts-list">
        <h3>Saved Context Templates</h3>
        {isLoading ? (
          <p>Loading contexts...</p>
        ) : contexts.length === 0 ? (
          <div className="empty-state">
            <p>No context templates yet. Create one to reuse across calls.</p>
          </div>
        ) : (
          <div className="contexts-grid">
            {contexts.map((context: Context) => (
              <div key={context._id} className="context-card">
                <div className="context-header">
                  <h4>{context.name}</h4>
                  <span className={`type-badge type-${context.contextType}`}>
                    {getContextTypeLabel(context.contextType)}
                  </span>
                </div>
                {context.description && (
                  <p className="context-description">{context.description}</p>
                )}
                <div className="context-details">
                  <div className="detail-section">
                    <strong>System Instructions:</strong>
                    <p className="preview-text">{context.systemInstructions.substring(0, 120)}...</p>
                  </div>
                  <div className="detail-section">
                    <strong>Example Instructions:</strong>
                    <p className="preview-text">
                      {context.exampleCallInstructions ? context.exampleCallInstructions.substring(0, 80) : '(no example provided)'}
                    </p>
                  </div>
                  <p className="timestamps">
                    Created: {new Date(context.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="context-actions">
                  <button
                    className="btn-edit"
                    onClick={() => handleEdit(context)}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    className="btn-delete"
                    onClick={() => handleDelete(context._id)}
                    disabled={deleteMutation.isPending}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
