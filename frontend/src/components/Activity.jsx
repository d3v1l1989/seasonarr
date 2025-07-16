import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { sonarr, auth } from '../services/api';
import ActivityHistory from './ActivityHistory';
import SonarrSelector from './SonarrSelector';
import logoTransparent from '../assets/logotransparent.png';

export default function Activity() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState([]);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadInstances();
  }, []);

  const loadInstances = async () => {
    setLoading(true);
    try {
      const response = await sonarr.getInstances();
      setInstances(response.data);
      if (response.data.length > 0) {
        setSelectedInstance(response.data[0]);
      }
    } catch (error) {
      console.error('Error loading instances:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInstanceChange = (instance) => {
    setSelectedInstance(instance);
  };

  return (
    <div className="dashboard">
      <div className="dashboard-content">
        <header className="dashboard-header">
          <div className="logo-container" onClick={() => navigate('/')} style={{cursor: 'pointer'}}>
            <img src={logoTransparent} alt="Seasonarr" className="logo" />
            <h1>Seasonarr</h1>
          </div>
          <div className="dashboard-controls">
            <SonarrSelector
              instances={instances}
              selectedInstance={selectedInstance}
              onInstanceChange={handleInstanceChange}
            />
            <button 
              className="settings-btn"
              onClick={() => navigate('/settings')}
            >
              Settings
            </button>
            <button 
              className="dashboard-btn"
              onClick={() => navigate('/')}
            >
              Dashboard
            </button>
            <button className="logout-btn" onClick={() => {
              auth.logout();
              window.location.reload();
            }}>
              Logout
            </button>
          </div>
        </header>

        <div className="activity-page">
          <h2>Activity History</h2>
          {loading ? (
            <div className="loading">Loading instances...</div>
          ) : (
            <ActivityHistory selectedInstance={selectedInstance} />
          )}
        </div>
      </div>
    </div>
  );
}