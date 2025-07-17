import { useState, useEffect } from 'react';
import { sonarr } from '../services/api';

export default function SonarrInstanceManager() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingInstance, setEditingInstance] = useState(null);
  const [testingConnection, setTestingConnection] = useState(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    loadInstances();
  }, []);

  const loadInstances = async () => {
    try {
      const response = await sonarr.getInstances();
      setInstances(response.data);
    } catch (error) {
      console.error('Error loading instances:', error);
      setMessage('Error loading Sonarr instances');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (instance) => {
    setEditingInstance({
      id: instance.id,
      name: instance.name,
      url: instance.url,
      api_key: '', // Don't pre-fill API key for security
      originalInstance: instance
    });
    setMessage('');
    setMessageType('info');
  };

  const handleTestConnection = async (instance) => {
    if (!instance.name.trim() || !instance.url.trim() || !instance.api_key.trim()) {
      setMessage('Name, URL, and API key are required for testing');
      return;
    }

    setTestingConnection(instance.id || 'editing');
    setMessage('');

    try {
      const response = await sonarr.testConnection({
        name: instance.name,
        url: instance.url,
        api_key: instance.api_key
      });

      if (response.data.success) {
        setMessage('Connection successful!');
        setMessageType('success');
      } else {
        setMessage('Connection failed');
        setMessageType('error');
      }
    } catch (error) {
      console.error('Error testing connection:', error);
      setMessage('Connection test failed');
      setMessageType('error');
    } finally {
      setTestingConnection(null);
      setTimeout(() => {
        setMessage('');
        setMessageType('info');
      }, 5000);
    }
  };

  const handleTestExistingConnection = async (instance) => {
    setTestingConnection(instance.id);
    setMessage('');

    try {
      const response = await sonarr.testExistingConnection(instance.id);
      
      if (response.data.success) {
        setMessage('Connection successful!');
        setMessageType('success');
      } else {
        setMessage('Connection failed');
        setMessageType('error');
      }
    } catch (error) {
      console.error('Error testing connection:', error);
      setMessage('Connection test failed');
      setMessageType('error');
    } finally {
      setTestingConnection(null);
      setTimeout(() => {
        setMessage('');
        setMessageType('info');
      }, 5000);
    }
  };

  const handleCancelEdit = () => {
    setEditingInstance(null);
    setMessage('');
    setMessageType('info');
  };

  const handleSaveEdit = async () => {
    if (!editingInstance.name.trim() || !editingInstance.url.trim()) {
      setMessage('Name and URL are required');
      setMessageType('error');
      return;
    }

    try {
      const updateData = {
        name: editingInstance.name,
        url: editingInstance.url
      };

      // Only include API key if it was changed
      if (editingInstance.api_key.trim()) {
        updateData.api_key = editingInstance.api_key;
      }

      await sonarr.updateInstance(editingInstance.id, updateData);
      setMessage('Instance updated successfully!');
      setMessageType('success');
      setEditingInstance(null);
      loadInstances();
      setTimeout(() => {
        setMessage('');
        setMessageType('info');
      }, 3000);
    } catch (error) {
      console.error('Error updating instance:', error);
      setMessage(error.response?.data?.detail || 'Error updating instance');
      setMessageType('error');
    }
  };

  const handleDelete = (instance) => {
    setDeleteConfirm(instance);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      await sonarr.deleteInstance(deleteConfirm.id);
      setMessage('Instance deleted successfully!');
      setMessageType('success');
      loadInstances();
      setTimeout(() => {
        setMessage('');
        setMessageType('info');
      }, 3000);
    } catch (error) {
      console.error('Error deleting instance:', error);
      setMessage('Error deleting instance');
      setMessageType('error');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  if (loading) {
    return <div className="loading">Loading Sonarr instances...</div>;
  }

  return (
    <div className="settings-section">
      <h2>Sonarr Instances</h2>
      <p>Manage your Sonarr server connections</p>
      
      {message && (
        <div className={`connection-message ${messageType}`}>
          {message}
        </div>
      )}

      <div className="sonarr-instances-list">
        {instances.length === 0 ? (
          <p className="no-instances">No Sonarr instances configured</p>
        ) : (
          instances.map((instance) => (
            <div key={instance.id} className="sonarr-instance-card">
              {editingInstance?.id === instance.id ? (
                <div className="instance-edit-form">
                  <div className="form-group">
                    <label>Name:</label>
                    <input
                      type="text"
                      value={editingInstance.name}
                      onChange={(e) => setEditingInstance({...editingInstance, name: e.target.value})}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>URL:</label>
                    <input
                      type="url"
                      value={editingInstance.url}
                      onChange={(e) => setEditingInstance({...editingInstance, url: e.target.value})}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>API Key: <span className="optional">(leave blank to keep current)</span></label>
                    <input
                      type="password"
                      value={editingInstance.api_key}
                      onChange={(e) => setEditingInstance({...editingInstance, api_key: e.target.value})}
                      className="form-input"
                      placeholder="Enter new API key or leave blank"
                    />
                  </div>
                  <div className="form-actions">
                    <button 
                      onClick={handleSaveEdit}
                      className="btn btn-primary"
                    >
                      Save
                    </button>
                    <button 
                      onClick={() => handleTestConnection(editingInstance)}
                      disabled={testingConnection === 'editing'}
                      className="btn btn-secondary"
                    >
                      {testingConnection === 'editing' ? 'Testing...' : 'Test Connection'}
                    </button>
                    <button 
                      onClick={handleCancelEdit}
                      className="btn btn-cancel"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="instance-info">
                  <div className="instance-header">
                    <h3>{instance.name}</h3>
                    <div className="instance-actions">
                      <button 
                        onClick={() => handleEdit(instance)}
                        className="btn btn-small btn-primary"
                      >
                        Edit
                      </button>
                      <button 
                        onClick={() => handleTestExistingConnection(instance)}
                        className="btn btn-small btn-secondary"
                      >
                        Test Connection
                      </button>
                      <button 
                        onClick={() => handleDelete(instance)}
                        className="btn btn-small btn-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="instance-details">
                    <p><strong>URL:</strong> {instance.url}</p>
                    <p><strong>Created:</strong> {new Date(instance.created_at).toLocaleDateString()}</p>
                    <p><strong>Status:</strong> <span className={`status ${instance.is_active ? 'active' : 'inactive'}`}>{instance.is_active ? 'Active' : 'Inactive'}</span></p>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="delete-modal">
            <div className="modal-header">
              <h3>Delete Instance</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete the Sonarr instance</p>
              <p className="instance-name">{deleteConfirm.name}</p>
            </div>
            <div className="modal-actions">
              <button 
                onClick={confirmDelete}
                className="btn btn-danger"
              >
                Delete
              </button>
              <button 
                onClick={cancelDelete}
                className="btn btn-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}