import { CheckCircle2, RefreshCcw, Sparkles, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import MatchCard from '../components/MatchCard'
import { getConfidence, recommendationLabels } from '../utils/analysisEngine'
import { formatThaiDate } from '../utils/formatters'

const allFilter = 'ALL'
const filters = [allFilter, recommendationLabels.bet, recommendationLabels.lean, recommendationLabels.noBet]

export default function TodayPage({ matches, totalMatchCount = matches.length, loading, error, notice, onRefresh, onOpenMatch }) {
  const [filter, setFilter] = useState(allFilter)
  const visibleMatches = useMemo(() => {
    if (filter === allFilter) return matches
    return matches.filter((match) => match.recommendation === filter)
  }, [filter, matches])
  const avgConfidence = matches.length ? Math.round(matches.reduce((total, match) => total + getConfidence(match), 0) / matches.length) : 0
  const playableCount = matches.filter((match) => match.recommendation === recommendationLabels.bet || match.recommendation === recommendationLabels.lean).length

  return (
    <main className="app-page theme-today">
      <section className="premium-hero p-3.5">
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Sparkles size={14} />
                Today's Edge Board
              </p>
              <h2 className="mt-1 text-[1.7rem] font-black leading-8 text-white">Intelligence Board</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">{formatThaiDate()}</p>
            </div>
            <button type="button" onClick={onRefresh} className="premium-button premium-focus flex shrink-0 items-center justify-center gap-1.5 px-3 text-xs" aria-label="Refresh matches">
              <RefreshCcw size={15} />
              Sync
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
            <HeroMetric label="Selected" value={matches.length || 0} suffix="matches" />
            <HeroMetric label="Total" value={totalMatchCount || 0} suffix="live" />
            <div className="metric-display is-emphasis min-w-[82px] text-right">
              <p className="text-[10px] font-black uppercase text-slate-400">Avg</p>
              <p className="text-2xl font-black leading-7 text-white">{avgConfidence}%</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2.5">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-400">
                <span>Board strength</span>
                <span className="text-emerald-100">{playableCount}/{matches.length || 0} actionable</span>
              </div>
              <div className="progress-bar mt-1.5">
                <span style={{ width: `${matches.length ? Math.max(6, Math.round((playableCount / matches.length) * 100)) : 4}%` }} />
              </div>
            </div>
            <span className="semantic-badge badge-positive">
              <CheckCircle2 size={12} />
              {notice ? 'Synced' : 'Ready'}
            </span>
          </div>
          {notice ? <p className="mt-2 text-clamp-1 text-[11px] font-semibold text-slate-500">{notice}</p> : null}
        </div>
      </section>

      <div className="mobile-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`min-h-9 shrink-0 rounded-full border px-3 text-xs font-black transition ${
              filter === item ? filterActiveClass(item) : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {loading ? <StateBox title="Loading live fixtures" message="Reading current match intelligence." /> : null}
      {error && !loading ? <StateBox title="Data load failed" message={`${error} · showing the latest available data`} tone="error" /> : null}
      {!loading && !error && !visibleMatches.length ? (
        <StateBox title="No matches in this filter" message="Try another recommendation filter or sync from Admin." />
      ) : null}

      <div className="mt-3 grid gap-2.5">
        {visibleMatches.map((match) => (
          <MatchCard key={match.id} match={match} onOpen={onOpenMatch} />
        ))}
      </div>
    </main>
  )
}

function HeroMetric({ label, value, suffix }) {
  return (
    <div className="metric-display">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <div className="mt-0.5 flex items-end gap-1">
        <p className="text-2xl font-black leading-7 text-white">{value}</p>
        <p className="pb-0.5 text-[10px] font-bold text-slate-500">{suffix}</p>
      </div>
    </div>
  )
}

function filterActiveClass(item) {
  if (item === recommendationLabels.bet) return 'border-emerald-300/45 bg-emerald-300/15 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.16)]'
  if (item === recommendationLabels.lean) return 'border-amber-300/45 bg-amber-300/15 text-amber-50 shadow-[0_0_18px_rgba(245,158,11,0.14)]'
  if (item === recommendationLabels.noBet) return 'border-red-300/40 bg-red-400/15 text-red-50 shadow-[0_0_18px_rgba(251,113,133,0.12)]'
  return 'border-emerald-300/45 bg-emerald-300/15 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.16)]'
}

function StateBox({ title, message, tone = 'default' }) {
  return (
    <div className={`mt-3 rounded-2xl border p-4 text-center ${tone === 'error' ? 'border-red-400/30 bg-red-400/10' : 'border-white/10 bg-white/[0.045]'}`}>
      <p className="font-black text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{message}</p>
      <Zap size={18} className="mx-auto mt-2 text-[var(--page-accent)]" />
    </div>
  )
}
