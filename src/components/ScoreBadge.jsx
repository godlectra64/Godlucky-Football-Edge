import { formatRecommendationLabel } from '../utils/uiLabels'

const styles = {
  BET: 'badge-bet',
  LEAN: 'badge-lean',
  WATCH: 'border-cyan-300/32 bg-cyan-300/12 text-cyan-50',
  'NO BET': 'badge-no-bet',
}

const modeLabels = {
  strong: 'พร้อมตัดสิน',
  watch: 'เฝ้าดู',
  waiting: 'รอข้อมูลจาก API-Football',
}

export default function ScoreBadge({ recommendation, mode = '' }) {
  const value = String(recommendation || 'NO BET').toUpperCase().replace('_', ' ')
  const label = modeLabels[mode] ?? formatRecommendationLabel(value)
  return (
    <span className={`semantic-badge ${styles[value] ?? styles['NO BET']}`} title={label} aria-label={label}>
      {label}
    </span>
  )
}
