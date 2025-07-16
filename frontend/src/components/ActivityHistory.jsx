import { useState, useEffect } from 'react';
import { sonarr } from '../services/api';

export default function ActivityHistory({ selectedInstance }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (selectedInstance) {
      loadActivities();
    }
  }, [selectedInstance]);

  const loadActivities = async (pageNum = 1) => {
    if (!selectedInstance) return;
    
    setLoading(true);
    try {
      const response = await sonarr.getActivityLogs(selectedInstance.id, pageNum, 10);
      const newActivities = response.data;
      
      if (pageNum === 1) {
        setActivities(newActivities);
      } else {
        setActivities(prev => [...prev, ...newActivities]);
      }
      
      setHasMore(newActivities.length === 10);
      setPage(pageNum);
    } catch (error) {
      console.error('Error loading activities:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      loadActivities(page + 1);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'in_progress':
        return '⏳';
      default:
        return '📝';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return '#4CAF50';
      case 'error':
        return '#f44336';
      case 'in_progress':
        return '#ff9800';
      default:
        return '#999';
    }
  };

  if (!selectedInstance) {
    return (
      <div className="activity-history">
        <h3>Activity History</h3>
        <p>Select a Sonarr instance to view activity history.</p>
      </div>
    );
  }

  return (
    <div className="activity-history-container">
      {loading && activities.length === 0 ? (
        <div className="activity-loading">
          <div className="loading-spinner"></div>
          <p>Loading activities...</p>
        </div>
      ) : activities.length === 0 ? (
        <div className="no-activities-modern">
          <div className="no-activities-icon">📋</div>
          <h3>No Recent Activity</h3>
          <p>Activities will appear here when you use the "Season It!" feature.</p>
          <p>Start by selecting shows with missing episodes and click "Season It!" to see your activity history.</p>
        </div>
      ) : (
        <div className="activities-modern-list">
          {activities.map((activity) => (
            <div key={activity.id} className={`activity-modern-item ${activity.status}`}>
              <div className="activity-status-indicator">
                <span className="activity-modern-icon">{getStatusIcon(activity.status)}</span>
              </div>
              
              <div className="activity-content">
                <div className="activity-main-info">
                  <div className="activity-title-section">
                    <h4 className="activity-show-title">{activity.show_title}</h4>
                    {activity.season_number && (
                      <span className="activity-season-badge">Season {activity.season_number}</span>
                    )}
                  </div>
                  <div className="activity-timestamp">
                    {formatDate(activity.created_at)}
                  </div>
                </div>
                
                <div className="activity-message-section">
                  <p className="activity-message-text">{activity.message}</p>
                </div>
                
                <div className="activity-footer">
                  <div className="activity-status-info">
                    <span 
                      className={`activity-status-badge ${activity.status}`}
                      style={{ backgroundColor: getStatusColor(activity.status) }}
                    >
                      {activity.status.toUpperCase()}
                    </span>
                    {activity.completed_at && (
                      <span className="activity-completion-time">
                        Completed: {formatDate(activity.completed_at)}
                      </span>
                    )}
                  </div>
                </div>
                
                {activity.error_details && (
                  <div className="activity-error-section">
                    <div className="error-icon">⚠️</div>
                    <div className="error-content">
                      <strong>Error Details:</strong>
                      <p>{activity.error_details}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {hasMore && (
            <div className="load-more-container">
              <button 
                onClick={loadMore} 
                disabled={loading}
                className="load-more-modern-btn"
              >
                {loading ? (
                  <>
                    <div className="loading-spinner-small"></div>
                    Loading...
                  </>
                ) : (
                  <>
                    <span>Load More Activities</span>
                    <span className="load-more-arrow">↓</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}