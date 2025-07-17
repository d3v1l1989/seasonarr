import axios from 'axios';

const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const auth = {
  checkFirstRun: () => api.get('/setup/first-run'),
  
  register: async (username, password) => {
    const response = await api.post('/setup/register', { username, password });
    const { access_token } = response.data;
    localStorage.setItem('token', access_token);
    return response.data;
  },
  
  login: async (username, password, rememberMe = false) => {
    const response = await api.post('/login', { username, password, remember_me: rememberMe });
    const { access_token } = response.data;
    localStorage.setItem('token', access_token);
    return response.data;
  },
  
  logout: () => {
    localStorage.removeItem('token');
  },
  
  getMe: () => api.get('/me'),
  
  isAuthenticated: () => !!localStorage.getItem('token'),
};

export const sonarr = {
  getInstances: () => api.get('/sonarr'),
  createInstance: (data) => api.post('/sonarr', data),
  updateInstance: (id, data) => api.put(`/sonarr/${id}`, data),
  deleteInstance: (id) => api.delete(`/sonarr/${id}`),
  testConnection: (data) => api.post('/sonarr/test-connection', data),
  testExistingConnection: (id) => api.post(`/sonarr/${id}/test-connection`),
  getShows: (instanceId, page = 1, pageSize = 36, filters = {}) => {
    const params = new URLSearchParams({
      instance_id: instanceId,
      page,
      page_size: pageSize,
    });
    
    if (filters.search) params.append('search', filters.search);
    if (filters.status) params.append('status', filters.status);
    if (filters.monitored !== undefined) params.append('monitored', filters.monitored);
    if (filters.missing_episodes !== undefined) params.append('missing_episodes', filters.missing_episodes);
    if (filters.network) params.append('network', filters.network);
    if (filters.genres && filters.genres.length > 0) {
      filters.genres.forEach(genre => params.append('genres', genre));
    }
    if (filters.year_from !== undefined && filters.year_from !== '') params.append('year_from', filters.year_from);
    if (filters.year_to !== undefined && filters.year_to !== '') params.append('year_to', filters.year_to);
    if (filters.runtime_min !== undefined && filters.runtime_min !== '') params.append('runtime_min', filters.runtime_min);
    if (filters.runtime_max !== undefined && filters.runtime_max !== '') params.append('runtime_max', filters.runtime_max);
    if (filters.certification) params.append('certification', filters.certification);
    
    return api.get(`/shows?${params}`);
  },
  getFilterOptions: (instanceId) => {
    const params = new URLSearchParams({
      instance_id: instanceId
    });
    return api.get(`/shows/filter-options?${params}`);
  },
  getShowDetail: (showId, instanceId) => {
    const params = new URLSearchParams({
      instance_id: instanceId
    });
    return api.get(`/shows/${showId}?${params}`);
  },
  seasonIt: (showId, seasonNumber = null, instanceId = null) => 
    api.post('/season-it', { show_id: showId, season_number: seasonNumber, instance_id: instanceId }),
  getActivityLogs: (instanceId = null, page = 1, pageSize = 20) => {
    const params = new URLSearchParams({
      page,
      page_size: pageSize
    });
    if (instanceId) params.append('instance_id', instanceId);
    return api.get(`/activity-logs?${params}`);
  },
};

export const settings = {
  getSettings: () => api.get('/settings'),
  updateSettings: (settingsData) => api.put('/settings', settingsData),
};

export default api;