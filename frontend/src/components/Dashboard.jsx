import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { sonarr, auth, settings } from '../services/api';
import ShowCard from './ShowCard';
import SonarrSelector from './SonarrSelector';
import EnhancedProgressBar from './EnhancedProgressBar';
import AddSonarrModal from './AddSonarrModal';
import Pagination from './Pagination';
import logoTransparent from '../assets/logotransparent.png';

export default function Dashboard() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState([]);
  const [selectedInstance, setSelectedInstance] = useState(() => {
    const savedInstanceId = localStorage.getItem('seasonarr_selected_instance');
    return savedInstanceId ? { id: parseInt(savedInstanceId, 10) } : null;
  });
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(() => {
    const savedPage = localStorage.getItem('seasonarr_current_page');
    return savedPage ? parseInt(savedPage, 10) : 1;
  });
  const [totalPages, setTotalPages] = useState(1);
  const [user, setUser] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filters, setFilters] = useState(() => {
    const savedFilters = localStorage.getItem('seasonarr_filters');
    if (savedFilters) {
      try {
        return JSON.parse(savedFilters);
      } catch (e) {
        console.warn('Failed to parse saved filters:', e);
      }
    }
    return {
      search: '',
      status: '',
      missing_episodes: true, // Default to showing missing episodes
      sort: 'title_asc', // Default to title A-Z
      network: '',
      genres: [],
      year_from: '',
      year_to: '',
      runtime_min: '',
      runtime_max: '',
      certification: ''
    };
  });
  const [userSettings, setUserSettings] = useState({
    shows_per_page: 35,
    default_sort: 'title_asc',
    default_show_missing_only: true
  });
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedShows, setSelectedShows] = useState(new Set());
  const [filterOptions, setFilterOptions] = useState({
    networks: [],
    genres: [],
    certifications: [],
    year_range: { min: null, max: null },
    runtime_range: { min: null, max: null }
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(() => {
    const saved = localStorage.getItem('seasonarr_show_advanced_filters');
    return saved ? JSON.parse(saved) : false;
  });
  const [statistics, setStatistics] = useState({
    totalShows: 0,
    totalMissingEpisodes: 0,
    showsWithMissingEpisodes: 0,
    seasonsWithMissingEpisodes: 0
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    loadInstances();
    loadUser();
    loadSettings();
  }, []);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMobileMenuOpen && !event.target.closest('.dashboard-header')) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (selectedInstance) {
      loadShows();
      loadFilterOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstance, page, filters]);

  const loadUser = async () => {
    try {
      const response = await auth.getMe();
      setUser(response.data);
    } catch (error) {
      console.error('Error loading user:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await settings.getSettings();
      const loadedSettings = response.data;
      setUserSettings(loadedSettings);
      
      // Apply default settings only if no saved filters exist
      const savedFilters = localStorage.getItem('seasonarr_filters');
      if (!savedFilters) {
        const defaultFilters = {
          search: '',
          status: '',
          missing_episodes: loadedSettings.default_show_missing_only,
          sort: loadedSettings.default_sort,
          network: '',
          genres: [],
          year_from: '',
          year_to: '',
          runtime_min: '',
          runtime_max: '',
          certification: ''
        };
        setFilters(defaultFilters);
        localStorage.setItem('seasonarr_filters', JSON.stringify(defaultFilters));
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const loadInstances = async () => {
    try {
      const response = await sonarr.getInstances();
      setInstances(response.data);
      
      // Try to restore saved instance or use first available
      const savedInstanceId = localStorage.getItem('seasonarr_selected_instance');
      if (savedInstanceId) {
        const savedInstance = response.data.find(inst => inst.id === parseInt(savedInstanceId, 10));
        if (savedInstance) {
          setSelectedInstance(savedInstance);
        } else if (response.data.length > 0) {
          setSelectedInstance(response.data[0]);
          localStorage.setItem('seasonarr_selected_instance', response.data[0].id.toString());
        }
      } else if (response.data.length > 0) {
        setSelectedInstance(response.data[0]);
        localStorage.setItem('seasonarr_selected_instance', response.data[0].id.toString());
      }
    } catch (error) {
      console.error('Error loading instances:', error);
    }
  };

  const loadFilterOptions = async () => {
    if (!selectedInstance) return;
    
    try {
      const response = await sonarr.getFilterOptions(selectedInstance.id);
      setFilterOptions(response.data);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  };

  const sortShows = (shows, sortOption) => {
    const sorted = [...shows];
    
    switch (sortOption) {
      case 'title_asc':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'title_desc':
        return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case 'year_desc':
        return sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
      case 'year_asc':
        return sorted.sort((a, b) => (a.year || 0) - (b.year || 0));
      case 'status':
        return sorted.sort((a, b) => a.status.localeCompare(b.status));
      case 'missing_desc':
        return sorted.sort((a, b) => b.missing_episode_count - a.missing_episode_count);
      case 'missing_asc':
        return sorted.sort((a, b) => a.missing_episode_count - b.missing_episode_count);
      default:
        return sorted;
    }
  };

  const loadShows = async () => {
    if (!selectedInstance) return;
    
    setLoading(true);
    try {
      const response = await sonarr.getShows(selectedInstance.id, page, userSettings.shows_per_page, filters);
      const sortedShows = sortShows(response.data.shows, filters.sort);
      setShows(sortedShows);
      setTotalPages(response.data.total_pages);
      
      // Update statistics based on current page data
      // For accurate stats, we need all shows, so let's load them separately
      loadStatistics();
    } catch (error) {
      console.error('Error loading shows:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStatistics = async () => {
    if (!selectedInstance) return;
    
    try {
      // Get all shows for statistics calculation
      const allShowsResponse = await sonarr.getShows(selectedInstance.id, 1, 10000, {});
      const allShows = allShowsResponse.data.shows;
      
      // Calculate seasons with missing episodes
      const seasonsWithMissingEpisodes = allShows.reduce((count, show) => {
        const seasonsWithMissing = show.seasons?.filter(season => 
          season.monitored && season.missing_episode_count > 0
        ).length || 0;
        return count + seasonsWithMissing;
      }, 0);

      // Calculate shows with missing episodes
      const showsWithMissingEpisodes = allShows.filter(show => show.missing_episode_count > 0).length;

      const stats = {
        totalShows: allShows.length,
        totalMissingEpisodes: allShows.reduce((sum, show) => sum + show.missing_episode_count, 0),
        showsWithMissingEpisodes: showsWithMissingEpisodes,
        seasonsWithMissingEpisodes: seasonsWithMissingEpisodes
      };
      
      setStatistics(stats);
    } catch (error) {
      console.error('Error loading statistics:', error);
    }
  };

  const handleInstanceChange = (instance) => {
    setSelectedInstance(instance);
    setPage(1);
    localStorage.setItem('seasonarr_selected_instance', instance.id.toString());
    localStorage.setItem('seasonarr_current_page', '1');
  };

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
    setPage(1);
    localStorage.setItem('seasonarr_filters', JSON.stringify(newFilters));
    localStorage.setItem('seasonarr_current_page', '1');
  }, []);

  const handleAdvancedFilterChange = useCallback((filterType, value) => {
    const newFilters = { ...filters, [filterType]: value };
    setFilters(newFilters);
    setPage(1);
    localStorage.setItem('seasonarr_filters', JSON.stringify(newFilters));
    localStorage.setItem('seasonarr_current_page', '1');
  }, [filters]);

  const resetAllFilters = () => {
    const resetFilters = {
      search: '',
      status: '',
      missing_episodes: userSettings.default_show_missing_only,
      sort: userSettings.default_sort,
      network: '',
      genres: [],
      year_from: '',
      year_to: '',
      runtime_min: '',
      runtime_max: '',
      certification: ''
    };
    setFilters(resetFilters);
    setPage(1);
    localStorage.setItem('seasonarr_filters', JSON.stringify(resetFilters));
    localStorage.setItem('seasonarr_current_page', '1');
  };

  const handleSearchChange = (searchTerm) => {
    const newFilters = { ...filters, search: searchTerm };
    setFilters(newFilters);
    setPage(1);
    localStorage.setItem('seasonarr_filters', JSON.stringify(newFilters));
    localStorage.setItem('seasonarr_current_page', '1');
  };

  const handleAddSuccess = () => {
    loadInstances();
  };

  const handleSelectionChange = (showId) => {
    const newSelected = new Set(selectedShows);
    if (newSelected.has(showId)) {
      newSelected.delete(showId);
    } else {
      newSelected.add(showId);
    }
    setSelectedShows(newSelected);
    
    // Auto-exit bulk mode when no items are selected
    if (newSelected.size === 0 && bulkMode) {
      setBulkMode(false);
    }
  };

  const handleSelectAll = async () => {
    const allCurrentPageShows = new Set(shows.map(show => show.id));
    const hasAllCurrentPageSelected = [...allCurrentPageShows].every(id => selectedShows.has(id));
    
    if (hasAllCurrentPageSelected && selectedShows.size > shows.length) {
      // If all current page shows are selected and there are more selected (from other pages), deselect all
      setSelectedShows(new Set());
      setBulkMode(false);
    } else if (hasAllCurrentPageSelected) {
      // If only current page is selected, select all shows across all pages
      try {
        const response = await sonarr.getShows(selectedInstance.id, 1, 10000, filters);
        const allShows = response.data.shows;
        const allEligibleShows = allShows.filter(show => show.missing_episode_count > 0);
        setSelectedShows(new Set(allEligibleShows.map(show => show.id)));
      } catch (error) {
        console.error('Error loading all shows for selection:', error);
        // Fallback to current page only
        setSelectedShows(new Set(shows.map(show => show.id)));
      }
    } else {
      // Select all shows on current page
      setSelectedShows(new Set(shows.map(show => show.id)));
    }
  };

  const handleBulkSeasonIt = async () => {
    if (selectedShows.size === 0) return;
    
    try {
      // Check user settings for deletion confirmation
      const userSettingsResponse = await settings.getSettings();
      const requireConfirmation = userSettingsResponse.data.require_deletion_confirmation;
      const skipDeletion = userSettingsResponse.data.skip_episode_deletion;
      
      if (requireConfirmation && !skipDeletion) {
        const selectedShowsList = shows.filter(show => selectedShows.has(show.id));
        const showTitles = selectedShowsList.map(show => show.title).join(', ');
        const confirmMessage = `Are you sure you want to delete existing episodes from ${selectedShows.size} show(s) (${showTitles}) and download season packs?`;
        
        if (!window.confirm(confirmMessage)) {
          return;
        }
      }
      
      // Prepare show items for bulk operation
      // For all selected shows across pages, we need to fetch their data
      const selectedShowIds = Array.from(selectedShows);
      const showItems = selectedShowIds.map(showId => ({
        id: showId,
        name: null, // Backend will fetch the name
        season_number: null, // null for all seasons
        poster_url: null, // Backend will fetch the poster URL
        instance_id: selectedInstance.id
      }));
      
      // Call the new bulk Season It API
      const response = await fetch('/api/bulk-season-it', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          show_items: showItems
        })
      });
      
      if (!response.ok) {
        throw new Error(`Bulk Season It failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('Bulk Season It started:', result);
      
      // Clear selection and exit bulk mode
      setSelectedShows(new Set());
      setBulkMode(false);
      
    } catch (error) {
      console.error('Bulk Season It failed:', error);
      alert(`Bulk Season It failed: ${error.message}`);
    }
  };

  const toggleBulkMode = () => {
    setBulkMode(!bulkMode);
    setSelectedShows(new Set());
  };

  const enterBulkMode = () => {
    setBulkMode(true);
  };

  // Memoize expensive calculations
  const eligibleShows = useMemo(() => 
    shows.filter(show => show.missing_episode_count > 0), 
    [shows]
  );
  
  const selectedEligibleShows = useMemo(() => 
    Array.from(selectedShows).filter(showId => 
      eligibleShows.some(show => show.id === showId)
    ), 
    [selectedShows, eligibleShows]
  );

  return (
    <div className="dashboard">
      <div className="dashboard-content">
        <header className="dashboard-header">
          <div className="header-main">
            <div className="logo-container" onClick={() => navigate('/')} style={{cursor: 'pointer'}}>
              <img src={logoTransparent} alt="Seasonarr" className="logo" />
              <h1>Seasonarr</h1>
            </div>
            <button 
              className="mobile-menu-toggle"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle mobile menu"
            >
              <span className={`hamburger ${isMobileMenuOpen ? 'active' : ''}`}>
                <span></span>
                <span></span>
                <span></span>
              </span>
            </button>
          </div>
          <div className={`dashboard-controls ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
            <SonarrSelector
              instances={instances}
              selectedInstance={selectedInstance}
              onInstanceChange={handleInstanceChange}
            />
            <button 
              className="add-instance-btn"
              onClick={() => {
                setShowAddModal(true);
                setIsMobileMenuOpen(false);
              }}
            >
              + Add Instance
            </button>
            <button 
              className="settings-btn"
              onClick={() => {
                navigate('/settings');
                setIsMobileMenuOpen(false);
              }}
            >
              Settings
            </button>
            <button 
              className="activity-btn"
              onClick={() => {
                navigate('/activity');
                setIsMobileMenuOpen(false);
              }}
            >
              Activity
            </button>
            <button className="logout-btn" onClick={() => {
              auth.logout();
              window.location.reload();
            }}>
              Logout
            </button>
          </div>
        </header>

        {selectedInstance && (
          <div className="statistics-dashboard">
            <h2>Library Overview</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-number">{statistics.totalShows}</div>
                <div className="stat-label">Total Shows</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{statistics.totalMissingEpisodes}</div>
                <div className="stat-label">Missing Episodes</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{statistics.showsWithMissingEpisodes}</div>
                <div className="stat-label">Shows with Missing Episodes</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{statistics.seasonsWithMissingEpisodes}</div>
                <div className="stat-label">Seasons with Missing Episodes</div>
              </div>
            </div>
          </div>
        )}

        <div className="search-and-filters">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search shows..."
              value={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="filters">
            <div className="filters-primary">
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange({ ...filters, status: e.target.value })}
                className="filter-select"
              >
                <option value="">Any Status</option>
                <option value="continuing">Continuing</option>
                <option value="ended">Ended</option>
                <option value="upcoming">Upcoming</option>
              </select>
              
              <select
                value={filters.missing_episodes === undefined ? "" : filters.missing_episodes.toString()}
                onChange={(e) => handleFilterChange({ 
                  ...filters, 
                  missing_episodes: e.target.value === "" ? undefined : e.target.value === "true"
                })}
                className="filter-select"
              >
                <option value="">All Shows</option>
                <option value="true">Missing Episodes</option>
                <option value="false">Complete</option>
              </select>
              
              <select
                value={filters.sort}
                onChange={(e) => handleFilterChange({ ...filters, sort: e.target.value })}
                className="filter-select"
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
            
            <div className="filters-secondary">
              <button 
                onClick={resetAllFilters}
                className="reset-filters-btn"
              >
                Reset Filters
              </button>
              
              <button 
                onClick={() => {
                  const newValue = !showAdvancedFilters;
                  setShowAdvancedFilters(newValue);
                  localStorage.setItem('seasonarr_show_advanced_filters', JSON.stringify(newValue));
                }}
                className={`bulk-toggle-btn ${showAdvancedFilters ? 'active' : ''}`}
              >
                {showAdvancedFilters ? 'Hide Advanced' : 'Advanced Filters'}
              </button>
              
              <button 
                onClick={toggleBulkMode}
                className={`bulk-toggle-btn ${bulkMode ? 'active' : ''}`}
              >
                {bulkMode ? 'Exit Bulk Mode' : 'Bulk Select'}
              </button>
            </div>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="advanced-filters">
            <div className="advanced-filters-row">
              <div className="filter-group">
                <label>Network:</label>
                <select
                  value={filters.network}
                  onChange={(e) => handleAdvancedFilterChange('network', e.target.value)}
                  className="filter-select"
                >
                  <option value="">Any Network</option>
                  {filterOptions.networks.map(network => (
                    <option key={network} value={network}>{network}</option>
                  ))}
                </select>
              </div>
              
              <div className="filter-group">
                <label>Certification:</label>
                <select
                  value={filters.certification}
                  onChange={(e) => handleAdvancedFilterChange('certification', e.target.value)}
                  className="filter-select"
                >
                  <option value="">Any Rating</option>
                  {filterOptions.certifications.map(cert => (
                    <option key={cert} value={cert}>{cert}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="advanced-filters-row">
              <div className="filter-group">
                <label>Year Range:</label>
                <div className="range-inputs">
                  <input
                    type="number"
                    placeholder="From"
                    value={filters.year_from}
                    onChange={(e) => handleAdvancedFilterChange('year_from', e.target.value ? parseInt(e.target.value) : '')}
                    min={filterOptions.year_range.min}
                    max={filterOptions.year_range.max}
                    className="range-input"
                  />
                  <span>to</span>
                  <input
                    type="number"
                    placeholder="To"
                    value={filters.year_to}
                    onChange={(e) => handleAdvancedFilterChange('year_to', e.target.value ? parseInt(e.target.value) : '')}
                    min={filterOptions.year_range.min}
                    max={filterOptions.year_range.max}
                    className="range-input"
                  />
                </div>
              </div>
              
              <div className="filter-group">
                <label>Runtime (minutes):</label>
                <div className="range-inputs">
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.runtime_min}
                    onChange={(e) => handleAdvancedFilterChange('runtime_min', e.target.value ? parseInt(e.target.value) : '')}
                    min={filterOptions.runtime_range.min}
                    max={filterOptions.runtime_range.max}
                    className="range-input"
                  />
                  <span>to</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.runtime_max}
                    onChange={(e) => handleAdvancedFilterChange('runtime_max', e.target.value ? parseInt(e.target.value) : '')}
                    min={filterOptions.runtime_range.min}
                    max={filterOptions.runtime_range.max}
                    className="range-input"
                  />
                </div>
              </div>
            </div>
            
            <div className="advanced-filters-row">
              <div className="filter-group genres-filter">
                <label>Genres:</label>
                <div className="genres-selection">
                  {filterOptions.genres.map(genre => (
                    <label key={genre} className="genre-checkbox">
                      <input
                        type="checkbox"
                        checked={filters.genres.includes(genre)}
                        onChange={(e) => {
                          const newGenres = e.target.checked
                            ? [...filters.genres, genre]
                            : filters.genres.filter(g => g !== genre);
                          handleAdvancedFilterChange('genres', newGenres);
                        }}
                      />
                      <span>{genre}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {bulkMode && eligibleShows.length > 0 && (
          <div className="bulk-actions">
            <div className="bulk-actions-left">
              <span className="selected-count">
                {selectedShows.size} selected
                {selectedShows.size > shows.length ? ' (across all pages)' : ` of ${eligibleShows.length} on this page`}
              </span>
              <button 
                onClick={handleSelectAll}
                className="bulk-toggle-btn"
              >
                {(() => {
                  const allCurrentPageShows = new Set(shows.map(show => show.id));
                  const hasAllCurrentPageSelected = [...allCurrentPageShows].every(id => selectedShows.has(id));
                  
                  if (hasAllCurrentPageSelected && selectedShows.size > shows.length) {
                    return 'Deselect All';
                  } else if (hasAllCurrentPageSelected) {
                    return 'Select All Pages';
                  } else {
                    return 'Select Page';
                  }
                })()}
              </button>
            </div>
            <div className="bulk-actions-right">
              <button 
                onClick={handleBulkSeasonIt}
                disabled={selectedShows.size === 0}
                className="bulk-season-it-btn"
              >
                🧂 Season It! ({selectedShows.size})
              </button>
            </div>
          </div>
        )}

        <Pagination 
          currentPage={page}
          totalPages={totalPages}
          onPageChange={(newPage) => {
            setPage(newPage);
            localStorage.setItem('seasonarr_current_page', newPage.toString());
          }}
        />
        
        {loading ? (
          <div className="loading">Loading shows...</div>
        ) : (
          <div className="shows-grid">
            {shows.map((show) => (
              <ShowCard 
                key={show.id} 
                show={show} 
                instanceId={selectedInstance?.id}
                isSelected={selectedShows.has(show.id)}
                onSelectionChange={handleSelectionChange}
                bulkMode={bulkMode}
                onEnterBulkMode={enterBulkMode}
              />
            ))}
          </div>
        )}

        <Pagination 
          currentPage={page}
          totalPages={totalPages}
          onPageChange={(newPage) => {
            setPage(newPage);
            localStorage.setItem('seasonarr_current_page', newPage.toString());
          }}
        />
        
      </div>
      
      <AddSonarrModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleAddSuccess}
      />
      
      {user && <EnhancedProgressBar userId={user.id} />}
    </div>
  );
}