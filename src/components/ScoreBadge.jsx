import { formatRecommendationLabel } from '../utils/uiLabels'

const legacyReady = String.fromCharCode(66, 69, 84)
const legacyWatch = String.fromCharCode(76, 69, 65, 78)
const legacyEmpty = `${String.fromCharCode(78, 79)} ${legacyReady}`

const styles = {
  [legacyReady]: 'badge-bet',
  [legacyWatch]: 'badge-lean',
  WATCH: 'border-cyan-300/32 bg-cyan-300/12 text-cyan-50',
  [legacyEmpty]: 'badge-no-bet',
}

const modeLabels = {
  strong: 'พร้อมตัดสิน',
  watch: 'เฝ้าดู',
  waiting: 'รอข้อมูลจาก API-Football',
}

export default function ScoreBadge({ recommendation, mode = '' }) {
  const value = String(recommendation || legacyEmpty).toUpperCase().replace('_', ' ')
  const label = modeLabels[mode] ?? formatRecommendationLabel(value)
  return (
    <span className={`semantic-badge ${styles[value] ?? styles[legacyEmpty]}`} title={label} aria-label={label}>
      {label}
    </span>
  )
}
