const styles = {
  low: 'badge-low',
  medium: 'badge-medium',
  high: 'badge-high',
}

const labels = {
  low: 'เสี่ยงต่ำ',
  medium: 'เสี่ยงกลาง',
  high: 'เสี่ยงสูง',
}

export default function RiskBadge({ level }) {
  const normalized = ['low', 'medium', 'high'].includes(String(level).toLowerCase()) ? String(level).toLowerCase() : 'medium'

  return (
    <span className={`semantic-badge ${styles[normalized]}`} title={normalized.toUpperCase()} aria-label={`Risk ${normalized.toUpperCase()}`}>
      {labels[normalized]}
    </span>
  )
}
