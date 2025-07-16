export default function SonarrSelector({ instances, selectedInstance, onInstanceChange }) {
  return (
    <div className="sonarr-selector">
      <select
        value={selectedInstance?.id || ''}
        onChange={(e) => {
          const instance = instances.find(i => i.id === parseInt(e.target.value));
          onInstanceChange(instance);
        }}
      >
        <option value="">Select Sonarr Instance</option>
        {instances.map((instance) => (
          <option key={instance.id} value={instance.id}>
            {instance.name}
          </option>
        ))}
      </select>
    </div>
  );
}