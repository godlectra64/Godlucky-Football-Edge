const styles = {
  low: 'badge-low',
  medium: 'badge-medium',
  high: 'badge-high',
}

export default function RiskBadge({ level }) {
  const normalized = ['low', 'medium', 'high'].includes(String(level).toLowerCase()) ? String(level).toLowerCase() : 'medium'

  return (
    <span className={`semantic-badge uppercase ${styles[normalized]}`}>
      {normalized.toUpperCase()}
    </span>
  )
}
