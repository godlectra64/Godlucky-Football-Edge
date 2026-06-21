import { riskLabels } from '../utils/analysisEngine'

const styles = {
  low: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200',
  medium: 'border-amber-300/35 bg-amber-300/10 text-amber-100',
  high: 'border-red-400/40 bg-red-400/15 text-red-100',
}

export default function RiskBadge({ level }) {
  const normalized = ['low', 'medium', 'high'].includes(level) ? level : 'medium'

  return (
    <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${styles[normalized]}`}>
      เสี่ยง{riskLabels[normalized]}
    </span>
  )
}
