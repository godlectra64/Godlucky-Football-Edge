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

export default function RiskBadge({ level, compact = false }) {
  const normalized = ['low', 'medium', 'high'].includes(String(level).toLowerCase()) ? String(level).toLowerCase() : 'medium'

  return (
    <span className={`semantic-badge ${compact ? 'min-h-7 px-2 text-[10px]' : ''} ${styles[normalized]}`} title={labels[normalized]} aria-label={`ระดับความเสี่ยง ${labels[normalized]}`}>
      {labels[normalized]}
    </span>
  )
}
