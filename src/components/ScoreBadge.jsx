const styles = {
  BET: 'badge-bet',
  LEAN: 'badge-lean',
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
