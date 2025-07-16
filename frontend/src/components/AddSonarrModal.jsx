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
          
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={loading}>
              {loading ? 'Adding...' : 'Add Instance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}