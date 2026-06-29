import { Activity, Eye, ShieldX } from 'lucide-react'
import { formatSignal } from '../utils/uiLabels'

export default function MarketDirectionBadge({ signal = 'SKIP' }) {
  const normalized = String(signal ?? 'SKIP').toUpperCase()
  const config = getConfig(normalized)
  const Icon = config.icon
  const label = formatSignal(normalized)

  return (
    <span className={`semantic-badge shrink-0 ${config.className}`} title={label} aria-label={label}>
      <Icon size={12} />
      {label}
    </span>
  )
}

function getConfig(signal) {
  if (signal === 'STRONG_SIGNAL') {
    return {
      icon: Activity,
      className: 'border-emerald-300/40 bg-emerald-300/14 text-emerald-50',
    }
  }
  if (signal === 'WATCH') {
    return {
      icon: Eye,
      className: 'border-amber-300/40 bg-amber-300/14 text-amber-50',
    }
  }
  return {
    icon: ShieldX,
    className: 'border-slate-400/28 bg-slate-400/12 text-slate-100',
  }
}
