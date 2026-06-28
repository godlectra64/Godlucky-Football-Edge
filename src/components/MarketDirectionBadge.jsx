import { Activity, Eye, ShieldX } from 'lucide-react'

export default function MarketDirectionBadge({ signal = 'SKIP' }) {
  const normalized = String(signal ?? 'SKIP').toUpperCase()
  const config = getConfig(normalized)
  const Icon = config.icon
  return (
    <span className={`semantic-badge shrink-0 ${config.className}`}>
      <Icon size={12} />
      {config.label}
    </span>
  )
}

function getConfig(signal) {
  if (signal === 'STRONG_SIGNAL') {
    return {
      label: 'Strong Signal',
      icon: Activity,
      className: 'border-emerald-300/35 bg-emerald-300/12 text-emerald-50',
    }
  }
  if (signal === 'WATCH') {
    return {
      label: 'Watch',
      icon: Eye,
      className: 'border-amber-300/35 bg-amber-300/12 text-amber-50',
    }
  }
  return {
    label: 'Skip',
    icon: ShieldX,
    className: 'border-slate-400/25 bg-slate-400/10 text-slate-200',
  }
}
