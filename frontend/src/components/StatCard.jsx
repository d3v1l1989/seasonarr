import AnimatedCounter from './AnimatedCounter';

export default function StatCard({ 
  number, 
  label, 
  isLoading = false, 
  delay = 0,
  className = "" 
}) {
  return (
    <div className={`stat-card ${isLoading ? 'loading' : ''} ${className}`}>
      <div className="stat-number">
        <AnimatedCounter 
          value={isLoading ? 0 : number} 
          isLoading={isLoading}
          duration={1200 + delay * 200}
        />
      </div>
      <div className="stat-label">
        {isLoading ? (
          <span className="loading-text">Loading...</span>
        ) : (
          label
        )}
      </div>
      {isLoading && <div className="stat-card-shimmer"></div>}
    </div>
  );
}