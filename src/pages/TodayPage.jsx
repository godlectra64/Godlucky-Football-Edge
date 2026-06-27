import { CheckCircle2, RefreshCcw, Sparkles, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import MatchCard from '../components/MatchCard'
import { getConfidence, recommendationLabels } from '../utils/analysisEngine'
import { buildAiFinalPick } from '../utils/finalPick'
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
  const finalPickMatch = matches[0] ?? null
  const finalPick = finalPickMatch ? buildAiFinalPick(finalPickMatch) : null

  return (
    <main className="app-page theme-today !pb-[calc(var(--safe-bottom)+132px)]">
      <section className="premium-hero p-3.5">
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Sparkles size={14} />
                AI FINAL PICK
              </p>
              <h2 className="mt-1 text-[1.65rem] font-black leading-8 text-white">AI FINAL PICK วันนี้</h2>
              <p className="mt-1 max-w-[280px] text-xs font-bold leading-5 text-slate-300">คัดเฉพาะคู่ที่ AI ประเมินว่าคุ้มค่าที่สุดของวัน</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">{formatThaiDate()} · ทั้งหมด {totalMatchCount || 0} คู่</p>
            </div>
            <button type="button" onClick={onRefresh} className="premium-button premium-focus flex shrink-0 items-center justify-center gap-1.5 px-3 text-xs" aria-label="Refresh matches">
              <RefreshCcw size={15} />
              Sync
            </button>
          </div>

          {finalPick ? (
            <div className={`mt-3 rounded-2xl border p-3 ${finalPickHeroClass(finalPick)}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase text-amber-100">{finalPickMatch.aiPickLabel ?? 'AI PICK #1'}</p>
                  <p className={`mt-1 text-clamp-2 text-2xl font-black leading-7 ${finalPick.canHighlight ? 'text-white' : 'text-slate-300'}`}>
                    {finalPick.canHighlight ? finalPick.pickTeam : finalPick.pickLabel}
                  </p>
                  <p className="mt-1 text-clamp-1 text-xs font-bold text-slate-400">{finalPick.matchLabel}</p>
                  <p className="mt-0.5 text-clamp-1 text-[11px] font-bold text-slate-500">{finalPick.leagueName} · {finalPick.kickoffAt ? formatKickoffShort(finalPick.kickoffAt) : '-'}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={`semantic-badge ${recommendationHeroBadge(finalPick.recommendation, finalPick.riskLevel)}`}>{finalPick.recommendation}</span>
                  <p className="mt-2 text-[10px] font-black uppercase text-slate-500">Confidence</p>
                  <p className="text-3xl font-black leading-8 text-white">{finalPick.confidence}%</p>
                  <p className="mt-1 text-[10px] font-black uppercase text-slate-400">Risk {finalPick.riskLevel}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <FinalPickInfo label="Market" value={finalPick.marketTypeLabel} muted={!finalPick.marketType} />
                <FinalPickInfo label="Line" value={finalPick.marketLineLabel} muted={!finalPick.marketLine} />
                <FinalPickInfo label={finalPick.probabilitySource === 'confidence_estimate' ? 'Model' : 'Probability'} value={finalPick.probabilityLabel} />
                <FinalPickInfo label="Fair / Value" value={`${finalPick.fairLineLabel} · ${finalPick.valueStatusLabel}`} muted={finalPick.valueStatus !== 'YES'} />
              </div>
              <p className="text-clamp-2 mt-2 text-xs font-bold leading-5 text-slate-200">{finalPick.pickReason}</p>
              <p className="text-clamp-1 mt-1 text-[11px] font-semibold leading-5 text-slate-500">{finalPick.valueReason}</p>
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
              <p className="font-black text-white">ยังไม่มี AI FINAL PICK วันนี้</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">อาจยังไม่ได้ซิงก์คู่แข่งขัน กด Sync เพื่ออัปเดตข้อมูล</p>
            </div>
          )}

          <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
            <HeroMetric label="AI Picks" value={matches.length || 0} suffix="/ 10" />
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
          {!loading && matches.length < 10 ? (
              <p className="mt-1 text-clamp-1 text-[11px] font-semibold text-slate-500">
                วันนี้มี AI Picks {matches.length} คู่จากข้อมูลที่พร้อมใช้งาน
              </p>
          ) : null}
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

      {loading ? <StateBox title="กำลังโหลด Top 10 AI Picks" message="ระบบกำลังอ่านข้อมูลการแข่งขันและผลวิเคราะห์ล่าสุด" /> : null}
      {error && !loading ? <StateBox title="โหลดข้อมูลไม่สำเร็จ" message={`${error} · กำลังแสดงข้อมูลล่าสุดที่มีอยู่`} tone="error" /> : null}
      {!loading && !error && !visibleMatches.length ? (
        <StateBox
          title={matches.length ? 'ไม่มีคู่ในตัวกรองนี้' : 'ยังไม่มี Top 10 AI Picks วันนี้'}
          message={matches.length ? 'ลองเปลี่ยนตัวกรองคำแนะนำ หรือกด Sync เพื่อโหลดข้อมูลใหม่' : 'อาจยังไม่ได้ซิงก์คู่แข่งขันของวันนี้ กด Sync หรือไปที่ Admin เพื่ออัปเดตข้อมูล'}
        />
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

function FinalPickInfo({ label, value, muted = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-2 py-1.5">
      <p className="text-[9px] font-black uppercase text-slate-500">{label}</p>
      <p className={`text-clamp-1 text-[11px] font-black leading-4 ${muted ? 'text-slate-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function finalPickHeroClass(finalPick) {
  if (finalPick.riskLevel === 'HIGH' || finalPick.recommendation === recommendationLabels.noBet) {
    return 'border-red-300/25 bg-red-400/10'
  }
  if (finalPick.recommendation === recommendationLabels.bet) {
    return 'border-emerald-300/35 bg-emerald-300/10 shadow-[0_0_34px_rgba(52,211,153,0.12)]'
  }
  return 'border-amber-300/30 bg-amber-300/10'
}

function recommendationHeroBadge(recommendation, riskLevel) {
  if (riskLevel === 'HIGH' || recommendation === recommendationLabels.noBet) return 'border-red-300/30 bg-red-400/10 text-red-100'
  if (recommendation === recommendationLabels.bet) return 'badge-positive'
  return 'border-amber-300/30 bg-amber-300/10 text-amber-100'
}

function formatKickoffShort(value) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
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
