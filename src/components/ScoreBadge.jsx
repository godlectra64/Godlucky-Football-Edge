const styles = {
  BET: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200',
  LEAN: 'border-amber-300/40 bg-amber-300/15 text-amber-100',
  'NO BET': 'border-slate-400/30 bg-slate-400/15 text-slate-200',
}

export default function ScoreBadge({ recommendation }) {
  return (
    <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-bold ${styles[recommendation]}`}>
      {recommendation}
    </span>
  )
}
