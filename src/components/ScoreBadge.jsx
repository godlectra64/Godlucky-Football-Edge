const styles = {
  BET: 'badge-bet',
  LEAN: 'badge-lean',
  'NO BET': 'badge-no-bet',
}

export default function ScoreBadge({ recommendation }) {
  return (
    <span className={`badge-premium ${styles[recommendation] ?? styles['NO BET']}`}>
      {recommendation}
    </span>
  )
}
