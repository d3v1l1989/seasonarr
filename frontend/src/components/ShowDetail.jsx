import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sonarr, settings, auth } from '../services/api';
import EnhancedProgressBar from './EnhancedProgressBar';
import logoTransparent from '../assets/logotransparent.png';

export default function ShowDetail() {
  const { showId } = useParams();
  const navigate = useNavigate();
  const [show, setShow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedSeasons, setExpandedSeasons] = useState(new Set());
  const [instanceId, setInstanceId] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Get instance ID from sessionStorage or URL params
    const storedInstanceId = sessionStorage.getItem('selectedInstanceId');
    if (storedInstanceId) {
      setInstanceId(parseInt(storedInstanceId));
    }
    loadUser();
  }, []);

  useEffect(() => {
    if (instanceId) {
      loadShowDetail();
    }
  }, [showId, instanceId]);

  const loadUser = async () => {
    try {
      const response = await auth.getMe();
      setUser(response.data);
    } catch (error) {
      console.error('Error loading user:', error);
    }
  };

  const loadShowDetail = async () => {
    try {
      setLoading(true);
      const response = await sonarr.getShowDetail(showId, instanceId);
      setShow(response.data);
    } catch (error) {
      console.error('Error loading show detail:', error);
      setError('Failed to load show details');
    } finally {
      setLoading(false);
    }
  };

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

  const toggleSeason = (seasonNumber) => {
    const newExpanded = new Set(expandedSeasons);
    if (newExpanded.has(seasonNumber)) {
      newExpanded.delete(seasonNumber);
    } else {
      newExpanded.add(seasonNumber);
    }
    setExpandedSeasons(newExpanded);
  };

  const handleSeasonIt = async (seasonNumber = null) => {
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
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString();
  };

  const getEpisodeStatus = (episode) => {
    if (!episode.monitored) return 'unmonitored';
    if (episode.hasFile) return 'downloaded';
    return 'missing';
  };

  const getEpisodeStatusColor = (status) => {
    switch (status) {
      case 'downloaded':
        return '#4CAF50';
      case 'missing':
        return '#f44336';
      case 'unmonitored':
        return '#666';
      default:
        return '#ff9800';
    }
  };

  if (loading) {
    return (
      <div className="show-detail">
        <div className="loading">Loading show details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="show-detail">
        <div className="error">{error}</div>
        <button onClick={() => navigate(-1)} className="back-btn">
          ← Back
        </button>
      </div>
    );
  }

  if (!show) {
    return (
      <div className="show-detail">
        <div className="error">Show not found</div>
        <button onClick={() => navigate(-1)} className="back-btn">
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="show-detail">
      <div className="show-detail-header">
        <button onClick={() => navigate(-1)} className="back-btn">
          ← Back
        </button>
        <div className="logo-container" onClick={() => navigate('/')} style={{cursor: 'pointer'}}>
          <img src={logoTransparent} alt="Seasonarr" className="logo" />
          <h1>Show Details</h1>
        </div>
      </div>

      <div className="show-detail-content">
        <div className="show-hero">
          <div className="show-poster-large">
            {show.poster_url ? (
              <img src={show.poster_url} alt={show.title} />
            ) : (
              <div className="no-poster">No Image</div>
            )}
          </div>
          
          <div className="show-info-large">
            <h2 className="show-title-large">
              {show.title} {show.year && `(${show.year})`}
            </h2>
            
            <div className="show-meta">
              <div className="show-status-large">
                <span className="status-indicator" style={{ backgroundColor: getStatusColor(show.status) }}>
                  {show.status}
                </span>
                {show.monitored && <span className="monitored">Monitored</span>}
              </div>
              
              <div className="show-stats">
                <div className="stat-item">
                  <span className="stat-label">Episodes:</span>
                  <span className="stat-value">{show.episode_count}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Missing:</span>
                  <span className="stat-value">{show.missing_episode_count}</span>
                </div>
                {show.network && (
                  <div className="stat-item">
                    <span className="stat-label">Network:</span>
                    <span className="stat-value">{show.network}</span>
                  </div>
                )}
                {show.runtime && (
                  <div className="stat-item">
                    <span className="stat-label">Runtime:</span>
                    <span className="stat-value">{show.runtime} min</span>
                  </div>
                )}
              </div>
              
              {show.genres && show.genres.length > 0 && (
                <div className="show-genres">
                  <span className="genres-label">Genres:</span>
                  <div className="genre-tags">
                    {show.genres.map((genre, index) => (
                      <span key={index} className="genre-tag">{genre}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {show.overview && (
              <div className="show-overview">
                <h3>Overview</h3>
                <p>{show.overview}</p>
              </div>
            )}

            <div className="show-actions-large">
              {show.missing_episode_count > 0 && show.seasons && show.seasons.some(season => 
                season.missing_episode_count > 0 && season.monitored && !season.has_future_episodes
              ) && (
                <button 
                  className="season-it-btn large"
                  onClick={() => handleSeasonIt()}
                >
                  🧂 Season It All!
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="seasons-detail">
          <h3>Seasons</h3>
          {show.seasons
            .filter(season => season.seasonNumber > 0)
            .map((season) => (
              <div key={season.seasonNumber} className="season-detail-item">
                <div 
                  className="season-header"
                  onClick={() => toggleSeason(season.seasonNumber)}
                >
                  <div className="season-title-section">
                    <span className="expand-icon">
                      {expandedSeasons.has(season.seasonNumber) ? '▼' : '▶'}
                    </span>
                    <h4>Season {season.seasonNumber}</h4>
                  </div>
                  
                  <div className="season-stats-section">
                    <div className="season-episode-count">
                      {season.episodeCount} episodes
                    </div>
                    {season.missing_episode_count > 0 ? (
                      <div className="season-missing">
                        {season.missing_episode_count} missing
                      </div>
                    ) : (
                      <div className="season-complete">Complete</div>
                    )}
                    {!season.monitored && (
                      <div className="season-unmonitored">Not Monitored</div>
                    )}
                  </div>

                  <div className="season-actions">
                    {season.missing_episode_count > 0 && season.monitored && !season.has_future_episodes && (
                      <button 
                        className="season-it-btn small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSeasonIt(season.seasonNumber);
                        }}
                      >
                        🧂 Season It!
                      </button>
                    )}
                    {season.has_future_episodes && (
                      <div className="season-incomplete-warning">
                        ⏳ Season incomplete
                      </div>
                    )}
                  </div>
                </div>

                {expandedSeasons.has(season.seasonNumber) && (
                  <div className="episodes-list">
                    {season.episodes
                      .sort((a, b) => a.episodeNumber - b.episodeNumber)
                      .map((episode) => (
                        <div key={episode.id} className="episode-item">
                          <div className="episode-number">
                            {episode.episodeNumber}
                          </div>
                          <div className="episode-details">
                            <div className="episode-title">
                              {episode.title || `Episode ${episode.episodeNumber}`}
                            </div>
                            <div className="episode-meta">
                              {episode.airDate && (
                                <span className="episode-date">
                                  {formatDate(episode.airDate)}
                                </span>
                              )}
                              <span 
                                className="episode-status"
                                style={{ 
                                  color: getEpisodeStatusColor(getEpisodeStatus(episode))
                                }}
                              >
                                {getEpisodeStatus(episode)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>
      
      {user && <EnhancedProgressBar userId={user.id} />}
    </div>
  );
}