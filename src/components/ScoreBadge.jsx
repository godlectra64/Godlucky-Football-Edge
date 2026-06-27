const styles = {
  BET: 'border-emerald-300/50 bg-emerald-400 text-pitch-950 shadow-[0_0_18px_rgba(52,211,153,0.22)]',
  LEAN: 'border-amber-300/60 bg-amber-300/15 text-amber-100 shadow-[0_0_16px_rgba(246,196,69,0.16)]',
  'NO BET': 'border-slate-500/25 bg-slate-500/10 text-slate-300',
}

export default function ScoreBadge({ recommendation }) {
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[11px] font-black tracking-wide ${styles[recommendation] ?? styles['NO BET']}`}>
      {recommendation}
    </span>
  )
}
