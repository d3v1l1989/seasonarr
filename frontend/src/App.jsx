import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './services/api';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import ShowDetail from './components/ShowDetail';
import Settings from './components/Settings';
import Activity from './components/Activity';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkFirstRunAndAuth();
  }, []);

  const checkFirstRunAndAuth = async () => {
    try {
      const firstRunResponse = await auth.checkFirstRun();
      setIsFirstRun(firstRunResponse.data.is_first_run);

      if (!firstRunResponse.data.is_first_run && auth.isAuthenticated()) {
        try {
          await auth.getMe();
          setIsAuthenticated(true);
        } catch {
          auth.logout();
          setIsAuthenticated(false);
        }
      }
    } catch (error) {
      console.error('Error checking first run status:', error);
    }
    setLoading(false);
  };

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  const handleRegister = () => {
    setIsFirstRun(false);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    auth.logout();
    setIsAuthenticated(false);
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (isFirstRun) {
    return <Register onRegister={handleRegister} />;
  }

  return (
    <Router>
      <div className="app">
        {isAuthenticated ? (
          <Routes>
            <Route path="/" element={<Dashboard onLogout={handleLogout} />} />
            <Route path="/show/:showId" element={<ShowDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </div>
    </Router>
  );
}

export default App;
