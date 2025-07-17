import { useState, useEffect, useRef } from 'react';
import { sonarr } from '../services/api';

export default function SearchResultsModal({ show, seasonNumber, instanceId, onClose }) {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const abortControllerRef = useRef(null);

  // Auto-start search when modal opens
  useEffect(() => {
    handleSearch();
    
    // Cleanup function to cancel search when component unmounts
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleSearch = async () => {
    // Cancel any ongoing search
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new AbortController for this search
    abortControllerRef.current = new AbortController();
    
    setLoading(true);
    setError(null);
    try {
      const response = await sonarr.searchSeasonPacks(show.id, seasonNumber, instanceId, abortControllerRef.current.signal);
      setReleases(response.data.releases);
    } catch (err) {
      // Don't show error if the request was cancelled
      if (err.name === 'AbortError' || err.name === 'CanceledError') {
        console.log('Search cancelled by user');
        return;
      }
      console.error('Search failed:', err);
      setError('Failed to search for releases. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (release) => {
    setDownloading(release.guid);
    try {
      await sonarr.downloadRelease(release.guid, show.id, seasonNumber, instanceId, release.indexer_id);
      onClose();
    } catch (err) {
      console.error('Download failed:', err);
      setError('Failed to download release. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  const getQualityColor = (quality) => {
    // Color based on resolution
    if (quality.includes('2160p') || quality.includes('4K')) return '#9C27B0';
    if (quality.includes('1080p')) return '#4CAF50';
    if (quality.includes('720p')) return '#FF9800';
    if (quality.includes('480p')) return '#F44336';
    return '#757575';
  };

  const getQualityScoreColor = (score) => {
    // Color based on quality score (higher = better)
    if (score >= 80) return '#4CAF50';  // Green for high quality
    if (score >= 60) return '#FF9800';  // Orange for medium quality
    if (score >= 40) return '#F44336';  // Red for lower quality
    return '#757575'; // Gray for unknown/very low
  };

  const getSeedersColor = (seeders) => {
    if (seeders >= 10) return '#4CAF50';
    if (seeders >= 5) return '#FF9800';
    return '#F44336';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content search-results-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn modal-corner-close" onClick={onClose}>×</button>

        {/* Show banner */}
        <div 
          className="show-banner"
          style={{
            backgroundImage: show.banner_url ? `url(${show.banner_url})` : 'none'
          }}
        >
          <div className="show-banner-overlay">
            <div className="show-banner-content">
              <img 
                src={show.poster_url}
                alt={show.title}
                className="show-banner-poster"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
              <div className="show-banner-info">
                <h4>{show.title}</h4>
                <p>Season {seasonNumber}</p>
                {show.network && <span className="show-network">{show.network}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-body">
          {loading && (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <p>Searching for season packs...</p>
            </div>
          )}

          {error && (
            <div className="error-message">
              <p>{error}</p>
              <button className="search-btn primary" onClick={handleSearch}>
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && releases.length === 0 && (
            <div className="no-results">
              <p>No season packs found for this season.</p>
              <button className="search-btn primary" onClick={handleSearch}>
                🔄 Search Again
              </button>
            </div>
          )}

          {releases.length > 0 && (
            <div className="releases-container">
              <div className="releases-header">
                <h4>Found {releases.length} Season Pack{releases.length !== 1 ? 's' : ''}</h4>
              </div>

              <div className="releases-list">
                {releases.map((release) => (
                  <div key={release.guid} className="release-item">
                    <div className="release-info">
                      <div className="release-title">
                        <span className="title-text">{release.title}</span>
                        <div className="release-badges">
                          <span 
                            className="quality-badge"
                            style={{ backgroundColor: getQualityColor(release.quality) }}
                          >
                            {release.quality}
                          </span>
                          <span 
                            className="quality-score-badge"
                            style={{ backgroundColor: getQualityScoreColor(release.quality_score) }}
                          >
                            Score: {release.quality_score}
                          </span>
                          <span className="indexer-badge">{release.indexer}</span>
                        </div>
                      </div>
                      
                      <div className="release-stats">
                        <div className="stat-item">
                          <span className="stat-label">Size:</span>
                          <span className="stat-value">{release.size_formatted}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Seeds:</span>
                          <span 
                            className="stat-value"
                            style={{ color: getSeedersColor(release.seeders) }}
                          >
                            {release.seeders}
                          </span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Peers:</span>
                          <span className="stat-value">{release.leechers}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Age:</span>
                          <span className="stat-value">{release.age_formatted}</span>
                        </div>
                      </div>
                    </div>

                    <div className="release-actions">
                      <button
                        className={`season-it-btn ${downloading === release.guid ? 'downloading' : ''}`}
                        onClick={() => handleDownload(release)}
                        disabled={downloading === release.guid}
                      >
                        {downloading === release.guid ? '⏳ Seasoning...' : '🧂 Season It!'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}