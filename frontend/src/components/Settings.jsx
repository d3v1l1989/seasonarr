import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { settings } from '../services/api';
import logoTransparent from '../assets/logotransparent.png';
import SonarrInstanceManager from './SonarrInstanceManager';

export default function Settings() {
  const navigate = useNavigate();
  const [userSettings, setUserSettings] = useState({
    disable_season_pack_check: false,
    require_deletion_confirmation: false,
    skip_episode_deletion: false,
    shows_per_page: 36,
    default_sort: 'title_asc',
    default_show_missing_only: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await settings.getSettings();
      setUserSettings(response.data);
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setMessage('');

    try {
      await settings.updateSettings(userSettings);
      setMessage('Settings saved successfully!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSettingChange = (key, value) => {
    setUserSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handlePurgeDatabase = async () => {
    setPurging(true);
    setMessage('');

    try {
      await settings.purgeDatabase();
      setMessage('Database purged successfully! All your data has been reset.');
      setShowPurgeConfirm(false);
      
      // Reload settings to show defaults
      await loadSettings();
      
      // Redirect to home after a short delay
      setTimeout(() => {
        navigate('/');
      }, 2000);
    } catch (error) {
      console.error('Error purging database:', error);
      setMessage('Error purging database. Please try again.');
    } finally {
      setPurging(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }

  return (
    <div className="settings-page">
      <div className="settings-content">
        <header className="settings-header">
          <div className="logo-container" onClick={() => navigate('/')} style={{cursor: 'pointer'}}>
            <img src={logoTransparent} alt="Seasonarr" className="logo" />
            <h1>Settings</h1>
          </div>
          <button 
            className="back-btn"
            onClick={() => navigate('/')}
          >
            ← Back to Dashboard
          </button>
        </header>

        <div className="settings-sections">
          {/* Sonarr Instance Management */}
          <SonarrInstanceManager />
          
          {/* Season Pack Processing */}
          <div className="settings-section">
            <h2>Season Pack Processing</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>Disable Season Pack Eligibility Check</label>
                <p>Skip checking for available season packs during "Season It!" process</p>
              </div>
              <div className="setting-control">
                <input
                  type="checkbox"
                  checked={userSettings.disable_season_pack_check}
                  onChange={(e) => handleSettingChange('disable_season_pack_check', e.target.checked)}
                  className="toggle-switch"
                />
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>Require Deletion Confirmation</label>
                <p>Show confirmation dialog before deleting existing episodes</p>
              </div>
              <div className="setting-control">
                <input
                  type="checkbox"
                  checked={userSettings.require_deletion_confirmation}
                  onChange={(e) => handleSettingChange('require_deletion_confirmation', e.target.checked)}
                  className="toggle-switch"
                />
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>Skip Episode Deletion</label>
                <p>Download season packs without deleting individual episodes first</p>
              </div>
              <div className="setting-control">
                <input
                  type="checkbox"
                  checked={userSettings.skip_episode_deletion}
                  onChange={(e) => handleSettingChange('skip_episode_deletion', e.target.checked)}
                  className="toggle-switch"
                />
              </div>
            </div>
          </div>

          {/* Display Preferences */}
          <div className="settings-section">
            <h2>Display Preferences</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>Shows Per Page</label>
                <p>Number of shows to display per page</p>
              </div>
              <div className="setting-control">
                <select
                  value={userSettings.shows_per_page}
                  onChange={(e) => handleSettingChange('shows_per_page', parseInt(e.target.value))}
                  className="setting-select"
                >
                  <option value={18}>18</option>
                  <option value={24}>24</option>
                  <option value={30}>30</option>
                  <option value={36}>36</option>
                  <option value={42}>42</option>
                  <option value={48}>48</option>
                  <option value={60}>60</option>
                </select>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>Default Sort Order</label>
                <p>Default sorting when loading shows</p>
              </div>
              <div className="setting-control">
                <select
                  value={userSettings.default_sort}
                  onChange={(e) => handleSettingChange('default_sort', e.target.value)}
                  className="setting-select"
                >
                  <option value="title_asc">Title (A-Z)</option>
                  <option value="title_desc">Title (Z-A)</option>
                  <option value="year_desc">Year (Newest)</option>
                  <option value="year_asc">Year (Oldest)</option>
                  <option value="status">Status</option>
                  <option value="missing_desc">Missing Episodes (Most)</option>
                  <option value="missing_asc">Missing Episodes (Least)</option>
                </select>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>Default to Missing Episodes Only</label>
                <p>Show only shows with missing episodes by default</p>
              </div>
              <div className="setting-control">
                <input
                  type="checkbox"
                  checked={userSettings.default_show_missing_only}
                  onChange={(e) => handleSettingChange('default_show_missing_only', e.target.checked)}
                  className="toggle-switch"
                />
              </div>
            </div>

          </div>

          {/* Hard Reset Section */}
          <div className="settings-section danger-section">
            <h2>Danger Zone</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>Hard Reset (Purge Database)</label>
                <p>Permanently delete all your data including Sonarr instances, settings, notifications, and activity logs. This action cannot be undone.</p>
              </div>
              <div className="setting-control">
                <button
                  onClick={() => setShowPurgeConfirm(true)}
                  disabled={purging}
                  className="danger-btn"
                >
                  {purging ? 'Purging...' : 'Purge Database'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="save-settings-btn"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {message && (
            <div className={`settings-message ${message.includes('success') ? 'success' : 'error'}`}>
              {message}
            </div>
          )}
        </div>
      </div>

      {/* Purge Confirmation Modal */}
      {showPurgeConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Confirm Hard Reset</h3>
            <p>Are you sure you want to purge all your data?</p>
            <p><strong>This will permanently delete:</strong></p>
            <ul>
              <li>All Sonarr instances</li>
              <li>All settings and preferences</li>
              <li>All notifications</li>
              <li>All activity logs</li>
            </ul>
            <p className="warning-text">This action cannot be undone!</p>
            <div className="modal-actions">
              <button
                onClick={() => setShowPurgeConfirm(false)}
                className="cancel-btn"
                disabled={purging}
              >
                Cancel
              </button>
              <button
                onClick={handlePurgeDatabase}
                className="danger-btn"
                disabled={purging}
              >
                {purging ? 'Purging...' : 'Yes, Purge Database'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}