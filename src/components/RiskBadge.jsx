const styles = {
  low: 'badge-low',
  medium: 'badge-medium',
  high: 'badge-high',
}

export default function RiskBadge({ level }) {
  const normalized = ['low', 'medium', 'high'].includes(level) ? level : 'medium'

  return (
    <span className={`badge-premium uppercase ${styles[normalized]}`}>
      {normalized}
    </span>
  )
}
