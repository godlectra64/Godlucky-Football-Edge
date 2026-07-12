import { Brain, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { getAnalysisStatusLabelTh, getAnalysisStatusTone } from '../utils/analysisStatus.js'
import { buildFootballAnalyticsOutput, EXPECTED_SCORE_DISCLAIMER_TH } from '../utils/footballAnalytics.js'

export default function AiFinalPickCard({ match, compact = false, variant = 'expanded', defaultOpen = false }) {
  const isCompact = compact || variant === 'compact'
  const [open, setOpen] = useState(defaultOpen)
  const analytics = buildFootballAnalyticsOutput(match)
  const tone = getAnalysisStatusTone(analytics.analysisStatus)
  const statusLabel = getAnalysisStatusLabelTh(analytics.analysisStatus)

  if (isCompact) {
    return (
      <section className={`rounded-xl border px-2.5 py-2 ${cardTone(tone, true)}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400">
              <Brain size={13} className="text-[var(--page-accent)]" />
              มุมมองจากโมเดล
            </p>
            <p className="mt-1 text-clamp-1 text-sm font-black leading-5 text-white">{analytics.modelOutlook.labelTh}</p>
          </div>
          <StatusBadge tone={tone} label={statusLabel} />
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          <MiniChip label="เจ้าบ้าน" value={percent(analytics.matchOutlook.homeWin)} />
          <MiniChip label="เสมอ" value={percent(analytics.matchOutlook.draw)} />
          <MiniChip label="ทีมเยือน" value={percent(analytics.matchOutlook.awayWin)} />
          <MiniChip label="มั่นใจ" value={`${analytics.confidence}%`} />
        </div>
      </section>
    )
  }

  return (
    <section className={`rounded-2xl border p-3 ${cardTone(tone, false)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
            <Brain size={14} className="text-[var(--page-accent)]" />
            มุมมองจากโมเดล
          </p>
          <p className="mt-1 text-clamp-2 text-lg font-black leading-6 text-white">{analytics.modelOutlook.labelTh}</p>
          <p className="mt-1 text-clamp-2 text-xs font-semibold leading-5 text-slate-300">{analytics.thaiReasons[0]}</p>
        </div>
        <StatusBadge tone={tone} label={statusLabel} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <ProbabilityCell label="เจ้าบ้าน" value={analytics.matchOutlook.homeWin} />
        <ProbabilityCell label="เสมอ" value={analytics.matchOutlook.draw} />
        <ProbabilityCell label="ทีมเยือน" value={analytics.matchOutlook.awayWin} />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_88px] items-end gap-2">
        <div className="min-w-0">
          <div className="progress-bar">
            <span className={barTone(tone)} style={{ width: `${Math.max(4, Math.min(100, analytics.confidence))}%` }} />
          </div>
          <p className="mt-1 text-[11px] font-semibold text-slate-400">คุณภาพข้อมูล {analytics.dataQuality.level}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase text-slate-500">ความมั่นใจ</p>
          <p className="text-[1.7rem] font-black leading-8 text-white">{analytics.confidence}%</p>
        </div>
      </div>

      <button type="button" onClick={() => setOpen((value) => !value)} className="premium-focus mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-white">
        รายละเอียด
        <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mt-3 grid gap-3">
          <AnalysisBlock title="ประตูคาดการณ์" items={[
            ['เจ้าบ้าน', analytics.expectedGoals.home],
            ['ทีมเยือน', analytics.expectedGoals.away],
            ['รวม', analytics.expectedGoals.total],
          ]} />
          <ScoreBlock predictions={analytics.expectedScorePredictions} />
          <AnalysisBlock title="องค์ประกอบความมั่นใจ" items={Object.entries(analytics.confidenceBreakdown).map(([key, value]) => [formatKey(key), `${Math.round(value)}/100`])} />
          <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs leading-5 text-cyan-50">{EXPECTED_SCORE_DISCLAIMER_TH}</p>
        </div>
      ) : null}
    </section>
  )
}

function AnalysisBlock({ title, items }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-sm font-black text-white">{title}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {items.map(([label, value]) => (
          <MiniMetric key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  )
}

function ScoreBlock({ predictions }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-sm font-black text-white">สกอร์ที่โมเดลมองเห็น</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {predictions.map((row) => (
          <MiniMetric key={row.score} label={row.score} value={percent(row.probability)} />
        ))}
      </div>
    </div>
  )
}

function ProbabilityCell({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/15 p-2">
      <p className="text-[10px] font-black text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-black text-white">{percent(value)}</p>
    </div>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/15 p-2">
      <p className="truncate text-[10px] font-black text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xs font-black text-white">{value}</p>
    </div>
  )
}

function MiniChip({ label, value }) {
  return (
    <span className="inline-flex min-h-8 min-w-0 items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2.5 text-[11px] font-black text-white">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="truncate">{value || '-'}</span>
    </span>
  )
}

function StatusBadge({ tone, label }) {
  return <span className={`semantic-badge shrink-0 ${badgeTone(tone)}`}>{label}</span>
}

function percent(value) {
  return `${Math.round(Number(value ?? 0) * 100)}%`
}

function formatKey(value) {
  return String(value).replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}

function cardTone(tone, compact) {
  const inset = compact ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : ''
  if (tone === 'good') return `border-emerald-300/35 bg-emerald-300/12 ${inset}`
  if (tone === 'watch') return `border-amber-300/35 bg-amber-300/12 ${inset}`
  if (tone === 'risk') return `border-red-300/30 bg-red-400/10 ${inset}`
  return `border-slate-400/25 bg-slate-400/10 ${inset}`
}

function badgeTone(tone) {
  if (tone === 'good') return 'badge-positive'
  if (tone === 'watch') return 'badge-medium'
  if (tone === 'risk') return 'badge-high'
  return 'border-slate-300/25 bg-slate-300/10 text-slate-100'
}

function barTone(tone) {
  if (tone === 'good') return 'bg-gradient-to-r from-emerald-400 to-cyan-200'
  if (tone === 'watch') return 'bg-gradient-to-r from-amber-300 to-blue-300'
  if (tone === 'risk') return 'bg-gradient-to-r from-red-400 to-rose-200'
  return 'bg-gradient-to-r from-slate-400 to-slate-200'
}
