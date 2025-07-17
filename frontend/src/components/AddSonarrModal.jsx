import { useState } from 'react';
import { sonarr } from '../services/api';

export default function AddSonarrModal({ isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    api_key: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleTestConnection = async () => {
    if (!formData.url.trim() || !formData.api_key.trim()) {
      setError('URL and API key are required for testing');
      return;
    }

    setTestingConnection(true);
    setError('');
    setTestResult(null);

    try {
      const response = await sonarr.testConnection({
        name: formData.name || 'Test Instance',
        url: formData.url,
        api_key: formData.api_key
      });

      if (response.data.success) {
        setTestResult({ success: true, message: 'Connection successful!' });
      } else {
        setTestResult({ success: false, message: 'Connection failed' });
      }
    } catch (err) {
      console.error('Error testing connection:', err);
      setTestResult({ success: false, message: 'Connection test failed' });
    } finally {
      setTestingConnection(false);
      // Clear test result after 5 seconds
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await sonarr.createInstance(formData);
      onSuccess();
      onClose();
      setFormData({ name: '', url: '', api_key: '' });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add Sonarr instance');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Sonarr Instance</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              placeholder="e.g., Main Sonarr"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          
          <div className="form-group">
            <label>URL</label>
            <input
              type="url"
              placeholder="http://192.168.1.100:8989"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              required
            />
          </div>
          
          <div className="form-group">
            <label>API Key</label>
            <input
              type="text"
              placeholder="Your Sonarr API key"
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              required
            />
          </div>
          
          {error && <div className="error">{error}</div>}
          
          {testResult && (
            <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
              {testResult.message}
            </div>
          )}
          
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={loading || testingConnection}>
              Cancel
            </button>
            <button 
              type="button" 
              onClick={handleTestConnection}
              disabled={loading || testingConnection}
              className="test-btn"
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </button>
            <button type="submit" disabled={loading || testingConnection}>
              {loading ? 'Adding...' : 'Add Instance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}