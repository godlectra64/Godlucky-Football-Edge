import { Brain, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { generateAiFinalPick } from '../utils/aiFinalPickEngine.js'
import { normalizeOddsRows } from '../utils/oddsUtils.js'
import { formatMarketFocus } from '../utils/uiLabels.js'
import MarketDirectionBadge from './MarketDirectionBadge'
import MarketOddsCard from './MarketOddsCard'
import RiskBadge from './RiskBadge'

export default function AiFinalPickCard({ match, compact = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const pick = match?.aiFinalPick ?? generateAiFinalPick(match)
  const odds = normalizeOddsRows(match)
  const reasons = (pick.keyReasons ?? []).slice(0, compact ? 2 : 5)
  const warnings = (pick.warningSigns ?? []).slice(0, compact ? 1 : 5)
  const confidence = Math.round(pick.confidenceScore ?? 0)

  return (
    <section className={`rounded-2xl border p-3 ${cardTone(pick.signal, compact)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
            <Brain size={14} className="text-[var(--page-accent)]" />
            บทสรุป AI
          </p>
          <p className={`${compact ? 'text-[1.05rem] leading-6' : 'text-lg leading-6'} mt-1 text-clamp-2 font-black text-white`}>{pick.direction}</p>
          <p className="mt-1 text-clamp-2 text-xs font-semibold leading-5 text-slate-300">{pick.marketSignal}</p>
        </div>
        <MarketDirectionBadge signal={pick.signal} />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_84px] items-end gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <MiniChip label="ตลาด" value={formatMarketFocus(pick.marketFocus)} />
            <MiniChip label="ทิศทาง" value={pick.direction} wide />
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
            <span className={barTone(pick.signal)} style={{ width: `${Math.max(4, Math.min(100, confidence))}%` }} />
          </div>
        </div>
      </div>

      {reasons.length ? (
        <div className="mt-3 grid gap-1.5">
          {reasons.map((reason) => (
            <p key={reason} className="text-clamp-2 rounded-xl border border-emerald-300/18 bg-emerald-300/10 px-3 py-2 text-xs leading-5 text-emerald-50">{reason}</p>
          ))}
        </div>
      ) : null}

      {!compact ? (
        <>
          <button type="button" onClick={() => setOpen((value) => !value)} className="premium-focus mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-white">
            ดูบทวิเคราะห์เต็ม
            <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open ? (
            <div className="mt-3 grid gap-3">
              <MarketOddsCard odds={odds} />
              <AnalysisBlock title="วิเคราะห์ AH · ราคาต่อรอง" analysis={pick.ahAnalysis} />
              <AnalysisBlock title="วิเคราะห์ OU · สูง/ต่ำ" analysis={pick.ouAnalysis} />
              <ListBlock title="สัญญาณเตือน" items={warnings} tone="warning" />
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
      <ListBlock title="ทิศทางจากข้อมูล" items={(analysis.reasons ?? []).slice(0, 3)} />
    </div>
  )
}

function ListBlock({ title, items = [], tone = 'positive' }) {
  const displayItems = items.length ? items : ['ยังไม่มีสัญญาณสำคัญเพิ่มเติม']
  return (
    <div className="mt-2">
      <p className="text-xs font-black text-white">{title}</p>
      <div className="mt-2 grid gap-1.5">
        {displayItems.map((item) => (
          <p key={item} className={`rounded-xl border px-3 py-2 text-xs leading-5 ${tone === 'warning' ? 'border-amber-300/20 bg-amber-300/10 text-amber-50' : 'border-cyan-300/20 bg-cyan-300/10 text-cyan-50'}`}>{item}</p>
        ))}
      </div>
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
