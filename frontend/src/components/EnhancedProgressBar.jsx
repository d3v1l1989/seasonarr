import { useState, useEffect } from 'react';
import useWebSocket from '../hooks/useWebSocket';

export default function EnhancedProgressBar({ userId }) {
  const [currentOperation, setCurrentOperation] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const { addMessageHandler } = useWebSocket(userId);

  useEffect(() => {
    if (!userId) return;

    const cleanupHandlers = [];

    // Handle legacy progress updates
    cleanupHandlers.push(
      addMessageHandler('progress_update', (data) => {
        setCurrentOperation({
          type: 'single',
          message: data.message,
          progress: data.progress,
          status: data.status,
          timestamp: data.timestamp
        });
        setIsVisible(true);

        if (data.status === 'success' || data.status === 'error' || data.status === 'warning') {
          setTimeout(() => {
            setIsVisible(false);
            setCurrentOperation(null);
          }, 3000);
        }
      })
    );

    // Handle enhanced progress updates (new detailed progress with poster)
    cleanupHandlers.push(
      addMessageHandler('enhanced_progress_update', (data) => {
        setCurrentOperation({
          type: 'enhanced',
          message: data.message,
          progress: data.progress,
          status: data.status,
          timestamp: data.timestamp,
          show_title: data.show_title,
          operation_type: data.operation_type,
          current_step: data.current_step,
          poster_url: data.details?.poster_url
        });
        setIsVisible(true);

        if (data.status === 'success' || data.status === 'error' || data.status === 'warning') {
          setTimeout(() => {
            setIsVisible(false);
            setCurrentOperation(null);
          }, 4000);
        }
      })
    );

    // Handle bulk operation start
    cleanupHandlers.push(
      addMessageHandler('bulk_operation_start', (data) => {
        setCurrentOperation({
          type: 'bulk',
          operation_id: data.operation_id,
          operation_type: data.operation_type,
          total_items: data.total_items,
          items: data.items,
          message: data.message,
          status: 'starting',
          overall_progress: 0,
          current_item: 0,
          current_item_name: '',
          current_item_progress: 0,
          completed_items: [],
          failed_items: [],
          timestamp: data.timestamp
        });
        setIsVisible(true);
      })
    );

    // Handle bulk operation updates
    cleanupHandlers.push(
      addMessageHandler('bulk_operation_update', (data) => {
        setCurrentOperation(prev => ({
          ...prev,
          overall_progress: data.overall_progress,
          current_item: data.current_item,
          current_item_name: data.current_item_name,
          current_item_progress: data.current_item_progress,
          message: data.message,
          status: data.status,
          completed_items: data.completed_items,
          failed_items: data.failed_items,
          poster_url: data.poster_url,
          timestamp: data.timestamp
        }));
        setIsVisible(true);
      })
    );

    // Handle bulk operation completion
    cleanupHandlers.push(
      addMessageHandler('bulk_operation_complete', (data) => {
        setCurrentOperation(prev => ({
          ...prev,
          overall_progress: 100,
          status: data.status,
          message: data.message,
          completed_items: data.completed_items,
          failed_items: data.failed_items,
          success_count: data.success_count,
          failure_count: data.failure_count,
          timestamp: data.timestamp
        }));
        setIsVisible(true);

        // Auto-hide after completion
        setTimeout(() => {
          setIsVisible(false);
          setCurrentOperation(null);
          setIsExpanded(false);
        }, 5000);
      })
    );

    // Handle clear progress (for cancellations)
    cleanupHandlers.push(
      addMessageHandler('clear_progress', (data) => {
        // Immediately clear the progress bar
        setIsVisible(false);
        setCurrentOperation(null);
        
        // Optional: Show a brief cancellation message
        if (data.message) {
          setCurrentOperation({
            type: 'cancelled',
            message: data.message,
            progress: 0,
            status: 'cancelled',
            timestamp: Date.now()
          });
          setIsVisible(true);
          
          // Clear the cancellation message after 2 seconds
          setTimeout(() => {
            setIsVisible(false);
            setCurrentOperation(null);
          }, 2000);
        }
      })
    );

    return () => {
      cleanupHandlers.forEach(cleanup => cleanup());
    };
  }, [userId, addMessageHandler]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return '#4CAF50';
      case 'error':
      case 'failed':
        return '#f44336';
      case 'warning':
        return '#ff9800';
      case 'cancelled':
        return '#9e9e9e';
      default:
        return '#2196F3';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return '✓';
      case 'error':
      case 'failed':
        return '✗';
      case 'warning':
        return '⚠';
      case 'cancelled':
        return '⏹';
      default:
        return '⟳';
    }
  };

  const handleCancel = async () => {
    if (currentOperation?.type === 'bulk' && currentOperation.operation_id) {
      try {
        const response = await fetch(`/api/operations/${currentOperation.operation_id}/cancel`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          // Update UI to show cancellation
          setCurrentOperation(prev => ({
            ...prev,
            status: 'cancelled',
            message: 'Operation cancelled by user'
          }));
          
          // Auto-dismiss after 2 seconds
          setTimeout(() => {
            setIsVisible(false);
            setCurrentOperation(null);
          }, 2000);
        } else {
          console.error('Failed to cancel operation');
        }
      } catch (error) {
        console.error('Error cancelling operation:', error);
      }
    }
  };

  if (!isVisible || !currentOperation) {
    return null;
  }

  const isBulkOperation = currentOperation.type === 'bulk';
  const isEnhancedOperation = currentOperation.type === 'enhanced';

  return (
    <div className="enhanced-progress-container">
      {/* Background poster for enhanced operations and bulk operations */}
      {(isEnhancedOperation || isBulkOperation) && currentOperation.poster_url && (
        <div className="progress-poster-background">
          <img 
            src={currentOperation.poster_url} 
            alt={currentOperation.show_title || currentOperation.current_item_name}
            className="progress-poster-image"
          />
          <div className="progress-poster-overlay"></div>
        </div>
      )}


      <div className="progress-main">
        <div className="progress-header">
          <span 
            className="progress-icon"
            style={{ color: getStatusColor(currentOperation.status) }}
          >
            {getStatusIcon(currentOperation.status)}
          </span>
          <span className="progress-text">{currentOperation.message}</span>
          
          {isBulkOperation && (
            <div className="progress-controls">
              <button 
                className="progress-expand-btn"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? "Collapse details" : "Expand details"}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
              {currentOperation.status === 'running' && (
                <button 
                  className="progress-cancel-btn"
                  onClick={handleCancel}
                  title="Cancel operation"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
        
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ 
              width: `${isBulkOperation ? currentOperation.overall_progress : currentOperation.progress}%`,
              backgroundColor: getStatusColor(currentOperation.status)
            }}
          />
        </div>
        
        <div className="progress-info">
          <span className="progress-percentage">
            {isBulkOperation ? currentOperation.overall_progress : currentOperation.progress}%
          </span>
          
          {isBulkOperation && (
            <span className="progress-count">
              {currentOperation.current_item}/{currentOperation.total_items}
            </span>
          )}
          
        </div>
      </div>

      {isBulkOperation && isExpanded && (
        <div className="progress-details">
          <div className="progress-current-item">
            <h4>Current Item</h4>
            <div className="current-item-info">
              <span className="current-item-name">{currentOperation.current_item_name}</span>
              {currentOperation.current_item_progress > 0 && (
                <div className="current-item-progress">
                  <div className="progress-bar small">
                    <div 
                      className="progress-fill"
                      style={{ 
                        width: `${currentOperation.current_item_progress}%`,
                        backgroundColor: getStatusColor(currentOperation.status)
                      }}
                    />
                  </div>
                  <span className="progress-percentage small">
                    {currentOperation.current_item_progress}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {currentOperation.completed_items && currentOperation.completed_items.length > 0 && (
            <div className="progress-completed">
              <h4>Completed ({currentOperation.completed_items.length})</h4>
              <div className="item-list">
                {currentOperation.completed_items.map((item, index) => (
                  <div key={index} className="item-entry success">
                    <span className="item-icon">✓</span>
                    <span className="item-name">{item.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentOperation.failed_items && currentOperation.failed_items.length > 0 && (
            <div className="progress-failed">
              <h4>Failed ({currentOperation.failed_items.length})</h4>
              <div className="item-list">
                {currentOperation.failed_items.map((item, index) => (
                  <div key={index} className="item-entry error">
                    <span className="item-icon">✗</span>
                    <span className="item-name">{item.name}</span>
                    {item.error && (
                      <span className="item-error" title={item.error}>
                        {item.error.length > 50 ? `${item.error.substring(0, 50)}...` : item.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentOperation.success_count !== undefined && currentOperation.failure_count !== undefined && (
            <div className="progress-summary">
              <div className="summary-stats">
                <span className="stat success">
                  ✓ {currentOperation.success_count} successful
                </span>
                <span className="stat error">
                  ✗ {currentOperation.failure_count} failed
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}