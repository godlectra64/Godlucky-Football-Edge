const styles = {
  low: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100',
  medium: 'border-amber-300/35 bg-amber-300/10 text-amber-100',
  high: 'border-red-400/35 bg-red-400/10 text-red-100',
}

export default function RiskBadge({ level }) {
  const normalized = ['low', 'medium', 'high'].includes(level) ? level : 'medium'

  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[11px] font-bold uppercase ${styles[normalized]}`}>
      {normalized}
    </span>
  )
}
