import { useState, useEffect, useRef } from 'react';

export default function AnimatedCounter({ 
  value, 
  duration = 1000, 
  isLoading = false,
  formatNumber = true 
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const countRef = useRef(null);
  const startTimeRef = useRef(null);

  useEffect(() => {
    if (isLoading || value === 0) {
      setDisplayValue(0);
      return;
    }

    // Start animation from 0
    setDisplayValue(0);
    startTimeRef.current = null;
    
    const animateCount = (timestamp) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentValue = Math.floor(easeOutQuart * value);

      setDisplayValue(currentValue);

      if (progress < 1) {
        countRef.current = requestAnimationFrame(animateCount);
      } else {
        setDisplayValue(value); // Ensure we end on the exact value
      }
    };

    countRef.current = requestAnimationFrame(animateCount);

    return () => {
      if (countRef.current) {
        cancelAnimationFrame(countRef.current);
      }
    };
  }, [value, duration, isLoading]);

  const formatDisplayValue = (num) => {
    if (!formatNumber) return num;
    return num.toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="animated-counter loading">
        <span className="loading-text">Loading...</span>
      </div>
    );
  }

  return (
    <div className="animated-counter">
      <span className="counter-value">
        {formatDisplayValue(displayValue)}
      </span>
    </div>
  );
}