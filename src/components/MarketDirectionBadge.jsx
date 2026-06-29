import { Activity, Eye, ShieldX } from 'lucide-react'

export default function MarketDirectionBadge({ signal = 'SKIP' }) {
  const normalized = String(signal ?? 'SKIP').toUpperCase()
  const config = getConfig(normalized)
  const Icon = config.icon
  return (
    <span className={`semantic-badge shrink-0 ${config.className}`} title={config.title} aria-label={config.title}>
      <Icon size={12} />
      {config.label}
    </span>
  )
}

function getConfig(signal) {
  if (signal === 'STRONG_SIGNAL') {
    return {
      label: 'สัญญาณแข็งแรง',
      title: 'STRONG_SIGNAL',
      icon: Activity,
      className: 'border-emerald-300/40 bg-emerald-300/14 text-emerald-50',
    }
  }
  if (signal === 'WATCH') {
    return {
      label: 'รอติดตาม',
      title: 'WATCH',
      icon: Eye,
      className: 'border-amber-300/40 bg-amber-300/14 text-amber-50',
    }
  }
  return {
    label: 'ข้ามคู่นี้',
    title: 'SKIP',
    icon: ShieldX,
    className: 'border-slate-400/28 bg-slate-400/12 text-slate-100',
  }
}
