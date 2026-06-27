const styles = {
  BET: 'badge-bet',
  LEAN: 'badge-lean',
  WATCH: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100',
  'NO BET': 'badge-no-bet',
}

export default function ScoreBadge({ recommendation }) {
  const value = recommendation || 'NO BET'
  return (
    <span className={`semantic-badge ${styles[value] ?? styles['NO BET']}`}>
      {value}
    </span>
  )
}
