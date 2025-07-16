import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { sonarr, settings } from '../services/api';

const ShowCard = memo(function ShowCard({ show, instanceId, isSelected, onSelectionChange, bulkMode, onEnterBulkMode }) {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'continuing':
        return '#4CAF50';
      case 'ended':
        return '#f44336';
      default:
        return '#ff9800';
    }
  };

  const handleSeasonIt = useCallback(async (seasonNumber = null) => {
    try {
      // Check user settings for deletion confirmation
      const userSettings = await settings.getSettings();
      const requireConfirmation = userSettings.data.require_deletion_confirmation;
      const skipDeletion = userSettings.data.skip_episode_deletion;
      
      if (requireConfirmation && !skipDeletion) {
        const confirmMessage = seasonNumber 
          ? `Are you sure you want to delete existing episodes from Season ${seasonNumber} of "${show.title}" and download the season pack?`
          : `Are you sure you want to delete existing episodes from all seasons of "${show.title}" and download season packs?`;
          
        if (!window.confirm(confirmMessage)) {
          return;
        }
      }
      
      await sonarr.seasonIt(show.id, seasonNumber, instanceId);
    } catch (error) {
      console.error('Season It failed:', error);
    }
  }, [show.id, show.title, instanceId]);

  const handleCardClick = useCallback(() => {
    if (bulkMode) {
      onSelectionChange(show.id);
    } else {
      // Store the instance ID in sessionStorage so ShowDetail can access it
      sessionStorage.setItem('selectedInstanceId', instanceId);
      navigate(`/show/${show.id}`);
    }
  }, [bulkMode, onSelectionChange, show.id, instanceId, navigate]);

  const handleCheckboxChange = useCallback((e) => {
    e.stopPropagation();
    if (!bulkMode) {
      onEnterBulkMode();
    }
    onSelectionChange(show.id);
  }, [bulkMode, onEnterBulkMode, onSelectionChange, show.id]);

  return (
    <div className={`show-card ${bulkMode ? 'bulk-mode' : ''} ${isSelected ? 'selected' : ''}`} onClick={handleCardClick}>
      <div className="selection-checkbox-circle">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="show-poster" ref={imgRef}>
        {show.poster_url && isVisible ? (
          <img 
            src={show.poster_url} 
            alt={show.title}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(true)}
            style={{ 
              opacity: imageLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease'
            }}
          />
        ) : show.poster_url && !isVisible ? (
          <div className="poster-placeholder">Loading...</div>
        ) : (
          <div className="no-poster">No Image</div>
        )}
      </div>
      
      <div className="show-info">
        <div className="show-content">
          <h3 className="show-title">{show.title} {show.year && `(${show.year})`}</h3>
          
          <div className="show-status">
            <span className="status-indicator" style={{ backgroundColor: getStatusColor(show.status) }}>
              {show.status}
            </span>
            {show.missing_episode_count === 0 ? (
              <span className="seasoned">Seasoned</span>
            ) : (
              <span className="unseasoned">Unseasoned</span>
            )}
          </div>

          <div className="episode-stats">
            <span>Episodes: {show.episode_count}</span>
            <span>Missing: {show.missing_episode_count}</span>
          </div>
        </div>

        <div className="show-actions">
          {show.missing_episode_count > 0 && show.seasons && show.seasons.some(season => 
            season.missing_episode_count > 0 && season.monitored && !season.has_future_episodes
          ) && (
            <button 
              className="season-it-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleSeasonIt();
              }}
            >
              🧂 Season It!
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default ShowCard;