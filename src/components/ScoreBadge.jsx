const styles = {
  BET: 'badge-bet',
  LEAN: 'badge-lean',
  WATCH: 'border-cyan-300/32 bg-cyan-300/12 text-cyan-50',
  'NO BET': 'badge-no-bet',
}

export default function ScoreBadge({ recommendation }) {
  const value = recommendation || 'NO BET'
  return (
    <span className={`semantic-badge ${styles[value] ?? styles['NO BET']}`} title={value} aria-label={`สัญญาณ ${value}`}>
      {value}
    </span>
  )
}
