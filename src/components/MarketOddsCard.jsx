import { LineChart } from 'lucide-react'

export default function MarketOddsCard({ odds = [], compact = false }) {
  const rows = odds.slice(0, compact ? 2 : 4)
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-black text-white">
          <LineChart size={16} className="text-[var(--page-accent)]" />
          AI Market Signal
        </p>
        <span className="semantic-badge border-white/10 bg-white/[0.05] text-slate-200">{rows.length ? `${rows.length} lines` : 'No data'}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {rows.length ? rows.map((row) => (
          <div key={`${row.marketFocus}-${row.selection}-${row.bookmaker}-${row.oddText}`} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-black text-white">{row.marketFocus} · {row.selection ?? row.marketName}</p>
              <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{row.bookmaker ?? 'API-FOOTBALL'} · line {row.line ?? '-'}</p>
            </div>
            <span className="self-center text-sm font-black text-[var(--page-accent)]">{row.oddText ?? row.price ?? '-'}</span>
          </div>
        )) : (
          <p className="rounded-xl border border-slate-400/20 bg-slate-400/10 px-3 py-2 text-sm leading-6 text-slate-300">Market data is not available yet</p>
        )}
      </div>
    </div>
  )
}
