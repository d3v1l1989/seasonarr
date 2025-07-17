import { useState, useEffect, useRef, useCallback } from 'react';

const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const RECONNECT_MULTIPLIER = 1.5;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useWebSocket(userId) {
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [lastMessage, setLastMessage] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const messageHandlersRef = useRef(new Map());
  const isManuallyClosedRef = useRef(false);
  
  // Get token from localStorage
  const getAuthToken = useCallback(() => {
    return localStorage.getItem('token');
  }, []);

  // Calculate reconnect delay with exponential backoff
  const getReconnectDelay = useCallback(() => {
    const delay = Math.min(
      reconnectDelayRef.current * Math.pow(RECONNECT_MULTIPLIER, reconnectAttempts),
      MAX_RECONNECT_DELAY
    );
    return delay + Math.random() * 1000; // Add jitter
  }, [reconnectAttempts]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!userId) return;
    
    const token = getAuthToken();
    if (!token) {
      console.warn('No auth token available for WebSocket connection');
      setConnectionStatus('error');
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/${userId}?token=${encodeURIComponent(token)}`;
      
      setConnectionStatus('connecting');
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setConnectionStatus('connected');
        setReconnectAttempts(0);
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
          
          // Handle ping messages
          if (data.type === 'ping') {
            // Send pong response
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ 
                type: 'pong', 
                timestamp: data.timestamp 
              }));
            }
            return;
          }

          // Call registered message handlers
          const handlers = messageHandlersRef.current.get(data.type) || [];
          handlers.forEach(handler => {
            try {
              handler(data);
            } catch (error) {
              console.error('Error in message handler:', error);
            }
          });

        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        setConnectionStatus('disconnected');
        
        // Only attempt reconnection if not manually closed and within attempt limits
        if (!isManuallyClosedRef.current && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay();
          
          setConnectionStatus('reconnecting');
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error('Max reconnection attempts reached');
          setConnectionStatus('error');
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setConnectionStatus('error');
    }
  }, [userId, getAuthToken, reconnectAttempts, getReconnectDelay]);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    isManuallyClosedRef.current = true;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setConnectionStatus('disconnected');
  }, []);

  // Send message
  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    console.warn('WebSocket not connected, cannot send message');
    return false;
  }, []);

  // Register message handler
  const addMessageHandler = useCallback((messageType, handler) => {
    if (!messageHandlersRef.current.has(messageType)) {
      messageHandlersRef.current.set(messageType, []);
    }
    messageHandlersRef.current.get(messageType).push(handler);

    // Return cleanup function
    return () => {
      const handlers = messageHandlersRef.current.get(messageType);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
        if (handlers.length === 0) {
          messageHandlersRef.current.delete(messageType);
        }
      }
    };
  }, []);

  // Manual reconnect
  const reconnect = useCallback(() => {
    setReconnectAttempts(0);
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    isManuallyClosedRef.current = false;
    
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    setTimeout(connect, 100);
  }, [connect]);

  // Initialize connection
  useEffect(() => {
    if (userId) {
      isManuallyClosedRef.current = false;
      connect();
    }

    return () => {
      disconnect();
    };
  }, [userId, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    connectionStatus,
    lastMessage,
    sendMessage,
    addMessageHandler,
    reconnect,
    disconnect,
    reconnectAttempts,
    isConnected: connectionStatus === 'connected'
  };
}

export default useWebSocket;