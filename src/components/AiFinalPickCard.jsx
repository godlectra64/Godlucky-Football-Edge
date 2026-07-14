import { Brain, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { generateAiFinalPick } from '../utils/aiFinalPickEngine.js'
import { buildSimpleBettingDecision, getBestPickLabel, getDecisionConfidence } from '../utils/bettingDecision.js'
import { normalizeOddsRows } from '../utils/oddsUtils.js'
import { formatMarketFocus } from '../utils/uiLabels.js'
import MarketDirectionBadge from './MarketDirectionBadge'
import MarketOddsCard from './MarketOddsCard'
import RiskBadge from './RiskBadge'

export default function AiFinalPickCard({ match, compact = false, variant = 'expanded', defaultOpen = false }) {
  const isCompact = compact || variant === 'compact'
  const [open, setOpen] = useState(defaultOpen)
  const pick = match?.aiFinalPick ?? generateAiFinalPick(match)
  const decision = pick.bettingDecision ?? buildSimpleBettingDecision(match)
  const odds = normalizeOddsRows(match)
  const signal = signalFromStatus(decision.status)
  const confidence = getDecisionConfidence(decision)
  const isReady = decision.status === 'READY'
  const displayPick = isReady ? getBestPickLabel(decision) : decision.decision_reason_th

  if (isCompact) {
    return (
      <section className={`rounded-xl border px-2.5 py-2 ${cardTone(signal, true)}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400">
              <Brain size={13} className="text-[var(--page-accent)]" />
              {isReady ? 'Final Pick' : 'สถานะการตัดสิน'}
            </p>
            <p className="mt-1 text-clamp-1 text-sm font-black leading-5 text-white">{displayPick}</p>
          </div>
          <MarketDirectionBadge signal={signal} compact />
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          <MiniChip label="ตลาด" value={formatDecisionMarket(isReady ? decision.final_pick.type : decision.market_focus)} />
          <MiniChip label="มั่นใจ" value={`${confidence}%`} />
          <RiskBadge level={pick.riskLevel} compact />
        </div>

        <p className="text-clamp-1 mt-2 rounded-lg border border-white/10 bg-black/15 px-2 py-1.5 text-[11px] font-semibold leading-4 text-slate-300">
          {decision.final_pick.reason}
        </p>
      </section>
    )
  }

  return (
    <section className={`rounded-2xl border p-3 ${cardTone(signal, isCompact)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
            <Brain size={14} className="text-[var(--page-accent)]" />
            {isReady ? 'Final Pick' : 'สถานะการตัดสิน'}
          </p>
          <p className="mt-1 text-clamp-2 text-lg font-black leading-6 text-white">{displayPick}</p>
          <p className="mt-1 text-clamp-2 text-xs font-semibold leading-5 text-slate-300">{decision.final_pick.reason}</p>
        </div>
        <MarketDirectionBadge signal={signal} />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_84px] items-end gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <MiniChip label="ตลาด" value={formatDecisionMarket(isReady ? decision.final_pick.type : decision.market_focus)} />
            <MiniChip label={isReady ? 'ทิศทาง' : 'สถานะ'} value={isReady ? displayPick : decision.status} wide />
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase text-slate-500">ความมั่นใจ</p>
          <p className="text-[1.7rem] font-black leading-8 text-white">{confidence}%</p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <RiskBadge level={pick.riskLevel} />
        <div className="min-w-0 flex-1">
          <div className="progress-bar">
            <span className={barTone(signal)} style={{ width: `${Math.max(4, Math.min(100, confidence))}%` }} />
          </div>
        </div>
      </div>

      <button type="button" onClick={() => setOpen((value) => !value)} className="premium-focus mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-white">
        รายละเอียด
        <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mt-3 grid gap-3">
          <MarketOddsCard odds={odds} />
          <AnalysisBlock title="AH Analysis" pick={decision.ah_pick.label} confidence={decision.ah_pick.confidence} reason={decision.ah_pick.reason} />
          <AnalysisBlock title="O/U Analysis" pick={decision.ou_pick.label} confidence={decision.ou_pick.confidence} reason={decision.ou_pick.reason} />
          <AnalysisBlock title="Final Decision" pick={isReady ? displayPick : decision.status} confidence={confidence} reason={decision.decision_reason_th || decision.final_pick.reason} badge={decision.status} />
        </div>
      ) : null}
    </section>
  )
}

function AnalysisBlock({ title, pick, confidence, reason, badge = '' }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">{title}</p>
          <p className="mt-1 text-xs font-semibold text-slate-400">{pick}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {badge ? <span className={`semantic-badge ${badgeTone(badge)}`}>{badge}</span> : null}
          <span className="semantic-badge border-white/10 bg-white/[0.05] text-white">{Math.round(confidence ?? 0)}%</span>
        </div>
      </div>
      <p className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs leading-5 text-cyan-50">{reason}</p>
    </div>
  )
}

function MiniChip({ label, value, wide = false }) {
  return (
    <span className={`inline-flex min-h-8 min-w-0 items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2.5 text-[11px] font-black text-white ${wide ? 'max-w-full' : ''}`}>
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="truncate">{value || '-'}</span>
    </span>
  )
}

function signalFromStatus(status) {
  if (status === 'READY') return 'STRONG_SIGNAL'
  if (status === 'WATCH') return 'WATCH'
  return 'SKIP'
}

function formatDecisionMarket(type) {
  if (type === 'NO_DECISION') return 'รอราคา'
  if (type === 'TEAM') return 'มุมมองทีม'
  return formatMarketFocus(type)
}

function cardTone(signal, compact) {
  const inset = compact ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : ''
  if (signal === 'STRONG_SIGNAL') return `border-emerald-300/35 bg-emerald-300/12 ${inset}`
  if (signal === 'WATCH') return `border-amber-300/35 bg-amber-300/12 ${inset}`
  return `border-slate-400/25 bg-slate-400/10 ${inset}`
}

function barTone(signal) {
  if (signal === 'STRONG_SIGNAL') return 'bg-gradient-to-r from-emerald-400 to-cyan-200'
  if (signal === 'WATCH') return 'bg-gradient-to-r from-amber-300 to-blue-300'
  return 'bg-gradient-to-r from-slate-400 to-slate-200'
}

function badgeTone(status) {
  if (status === 'READY') return 'badge-bet'
  if (status === 'WATCH') return 'badge-lean'
  return 'badge-no-bet'
}
