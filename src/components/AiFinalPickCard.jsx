import { Brain, ChevronDown, Gauge } from 'lucide-react'
import { useState } from 'react'
import { generateAiFinalPick } from '../utils/aiFinalPickEngine.js'
import { normalizeOddsRows } from '../utils/oddsUtils.js'
import MarketDirectionBadge from './MarketDirectionBadge'
import MarketOddsCard from './MarketOddsCard'

export default function AiFinalPickCard({ match, compact = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const pick = match?.aiFinalPick ?? generateAiFinalPick(match)
  const odds = normalizeOddsRows(match)
  const reasons = (pick.keyReasons ?? []).slice(0, compact ? 3 : 5)
  const warnings = (pick.warningSigns ?? []).slice(0, compact ? 2 : 5)

  return (
    <section className={`rounded-2xl border p-3 ${cardTone(pick.signal)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
            <Brain size={14} className="text-[var(--page-accent)]" />
            AI Final Pick
          </p>
          <p className="mt-1 text-clamp-2 text-lg font-black leading-6 text-white">{pick.direction}</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-300">{pick.marketSignal}</p>
        </div>
        <MarketDirectionBadge signal={pick.signal} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <MiniMetric label="Market Focus" value={pick.marketFocus} />
        <MiniMetric label="Confidence" value={`${Math.round(pick.confidenceScore ?? 0)}%`} />
        <MiniMetric label="Risk Level" value={pick.riskLevel} muted={pick.riskLevel === 'HIGH'} />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Gauge size={13} />
            Confidence
          </span>
          <span className="text-white">{Math.round(pick.confidenceScore ?? 0)}%</span>
        </div>
        <div className="progress-bar mt-1.5">
          <span className={barTone(pick.signal)} style={{ width: `${Math.max(4, Math.min(100, pick.confidenceScore ?? 0))}%` }} />
        </div>
      </div>

      {reasons.length ? (
        <div className="mt-3">
          <p className="text-xs font-black text-white">Key Reasons</p>
          <div className="mt-2 grid gap-1.5">
            {reasons.map((reason) => (
              <p key={reason} className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs leading-5 text-emerald-50">{reason}</p>
            ))}
          </div>
        </div>
      ) : null}

      {!compact ? (
        <>
          <button type="button" onClick={() => setOpen((value) => !value)} className="mt-3 flex min-h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-white">
            Full Analysis
            <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open ? (
            <div className="mt-3 grid gap-3">
              <MarketOddsCard odds={odds} />
              <AnalysisBlock title="AH Analysis" analysis={pick.ahAnalysis} />
              <AnalysisBlock title="OU Analysis" analysis={pick.ouAnalysis} />
              <ListBlock title="Warning Signs" items={warnings} tone="warning" />
              <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{pick.finalSummary}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

function AnalysisBlock({ title, analysis }) {
  if (!analysis) return null
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">{title}</p>
          <p className="mt-1 text-xs font-semibold text-slate-400">{analysis.direction}</p>
        </div>
        <span className="semantic-badge border-white/10 bg-white/[0.05] text-white">{Math.round(analysis.confidenceScore ?? 0)}%</span>
      </div>
      <ListBlock title="Data Direction" items={(analysis.reasons ?? []).slice(0, 3)} />
    </div>
  )
}

function ListBlock({ title, items = [], tone = 'positive' }) {
  const safeItems = items.length ? items : ['No major signal']
  return (
    <div className="mt-2">
      <p className="text-xs font-black text-white">{title}</p>
      <div className="mt-2 grid gap-1.5">
        {safeItems.map((item) => (
          <p key={item} className={`rounded-xl border px-3 py-2 text-xs leading-5 ${tone === 'warning' ? 'border-amber-300/20 bg-amber-300/10 text-amber-50' : 'border-cyan-300/20 bg-cyan-300/10 text-cyan-50'}`}>{item}</p>
        ))}
      </div>
    </div>
  )
}

function MiniMetric({ label, value, muted = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/18 px-2 py-1.5">
      <p className="text-[9px] font-black uppercase text-slate-500">{label}</p>
      <p className={`truncate text-[11px] font-black leading-4 ${muted ? 'text-slate-400' : 'text-white'}`}>{value || '-'}</p>
    </div>
  )
}

function cardTone(signal) {
  if (signal === 'STRONG_SIGNAL') return 'border-emerald-300/30 bg-emerald-300/10'
  if (signal === 'WATCH') return 'border-amber-300/30 bg-amber-300/10'
  return 'border-slate-400/25 bg-slate-400/10'
}

function barTone(signal) {
  if (signal === 'STRONG_SIGNAL') return 'bg-gradient-to-r from-emerald-400 to-cyan-200'
  if (signal === 'WATCH') return 'bg-gradient-to-r from-amber-300 to-blue-300'
  return 'bg-gradient-to-r from-slate-400 to-slate-200'
}
