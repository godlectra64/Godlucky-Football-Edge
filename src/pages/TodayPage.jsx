import { CheckCircle2, Lock, RefreshCcw, Sparkles, Unlock, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import MatchCard from '../components/MatchCard'
import { getConfidence, recommendationLabels } from '../utils/analysisEngine'
import { buildAiFinalPick, getOneBestPickOfDay } from '../utils/finalPick'
import { formatThaiDate, formatUpdatedAt } from '../utils/formatters'

const allFilter = 'ALL'
const filters = [allFilter, recommendationLabels.bet, recommendationLabels.lean, recommendationLabels.watch, recommendationLabels.noBet]

export default function TodayPage({ matches, oneBestPick: providedOneBestPick = null, totalMatchCount = matches.length, top10Status = null, top10Locked = false, loading, error, notice, onRefresh, onOpenMatch }) {
  const [filter, setFilter] = useState(allFilter)
  const visibleMatches = useMemo(() => {
    if (filter === allFilter) return matches
    return matches.filter((match) => match.recommendation === filter)
  }, [filter, matches])
  const avgConfidence = matches.length ? Math.round(matches.reduce((total, match) => total + getConfidence(match), 0) / matches.length) : 0
  const playableCount = matches.filter((match) => [recommendationLabels.bet, recommendationLabels.lean, recommendationLabels.watch].includes(match.recommendation)).length
  const v4ReadyCount = matches.filter((match) => Number(match.calibratedConfidence ?? match.calibrated_confidence_score ?? match.analysis?.calibrated_confidence_score ?? 0) > 0).length
  const oneBestPick = useMemo(() => providedOneBestPick ?? getOneBestPickOfDay(matches), [providedOneBestPick, matches])
  const lastUpdated = top10Status?.lastUpdated ?? top10Status?.lockedAt ?? null

  return (
    <main className="app-page theme-today">
      <section className="premium-hero android-top-panel p-3.5">
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Sparkles size={14} />
                Daily Top10 Board
              </p>
              <h2 className="mt-1 text-[1.45rem] font-black leading-7 text-white">คู่เด็ดวันนี้</h2>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-300">{formatThaiDate()}</p>
              <p className="text-[11px] font-semibold leading-4 text-slate-500">คัดเฉพาะคู่ที่ AI จัดอันดับไว้ดีที่สุดของวัน</p>
            </div>
            <button type="button" onClick={onRefresh} className="premium-button premium-focus flex min-h-11 shrink-0 items-center justify-center gap-1.5 px-3 text-xs" aria-label="Refresh matches">
              <RefreshCcw size={15} />
              รีเฟรช
            </button>
          </div>

          <Top10LockBadge status={top10Status} locked={top10Locked} />

          <div className="mt-3 grid grid-cols-3 gap-2">
            <HeroMetric label="Top10" value={matches.length || 0} suffix="คู่" />
            <HeroMetric label="ทั้งหมด" value={totalMatchCount || 0} suffix="คู่" />
            <div className="metric-display is-emphasis min-w-[76px] text-right">
              <p className="text-[10px] font-black uppercase text-slate-400">Avg</p>
              <p className="text-2xl font-black leading-7 text-white">{avgConfidence}%</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2.5">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-400">
                <span>ความพร้อมของบอร์ด</span>
                <span className="text-emerald-100">{playableCount}/{matches.length || 0} น่าติดตาม</span>
              </div>
              <div className="progress-bar mt-1.5">
                <span style={{ width: `${matches.length ? Math.max(6, Math.round((playableCount / matches.length) * 100)) : 4}%` }} />
              </div>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">V4 {v4ReadyCount}/{matches.length || 0} · อัปเดตล่าสุด {lastUpdated ? formatUpdatedAt(lastUpdated) : '-'}</p>
            </div>
            <span className="semantic-badge badge-positive">
              <CheckCircle2 size={12} />
              Ready
            </span>
          </div>

          {notice ? <p className="mt-2 text-clamp-1 text-[11px] font-semibold text-slate-500">{formatNotice(notice)}</p> : null}
          {!loading && matches.length && !matches.some((match) => match.recommendation === recommendationLabels.bet) ? (
            <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-bold leading-5 text-amber-100">
              วันนี้ยังไม่มีคู่ระดับ BET แต่ AI ยังจัดอันดับคู่ที่น่าติดตามที่สุดให้ครบตามข้อมูลที่มี
            </p>
          ) : null}
          {!loading && matches.length < 10 ? (
            <p className="mt-1 text-clamp-1 text-[11px] font-semibold text-slate-500">
              วันนี้มี AI Picks {matches.length} คู่จากข้อมูลที่พร้อมใช้งาน
            </p>
          ) : null}
        </div>
      </section>

      <OneBestPickHero oneBestPick={oneBestPick} />

      <div className="mobile-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-xs font-black transition ${
              filter === item ? filterActiveClass(item) : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {loading ? <LoadingSkeleton /> : null}
      {error && !loading ? <StateBox title="โหลดข้อมูลไม่สำเร็จ" message="ระบบกำลังแสดงข้อมูลล่าสุดที่มีอยู่" detail={error} tone="error" onRetry={onRefresh} /> : null}
      {!loading && !error && !visibleMatches.length ? (
        <StateBox
          title={matches.length ? 'ไม่มีคู่ในตัวกรองนี้' : 'ยังไม่มีคู่สำหรับวันนี้'}
          message={matches.length ? 'ลองเปลี่ยนตัวกรองคำแนะนำ หรือรีเฟรชข้อมูลอีกครั้ง' : 'ลองรีเฟรชข้อมูลหรือกลับมาตรวจอีกครั้ง'}
          onRetry={onRefresh}
        />
      ) : null}

      <div className="mt-3 grid gap-3.5">
        {visibleMatches.map((match) => (
          <MatchCard key={match.id} match={match} oneBestPick={oneBestPick} onOpen={onOpenMatch} />
        ))}
      </div>
    </main>
  )
}

function Top10LockBadge({ status, locked }) {
  const Icon = locked ? Lock : Unlock
  const lockedAt = status?.lockedAt ? formatUpdatedAt(status.lockedAt) : '-'
  const lastUpdated = status?.lastUpdated ? formatUpdatedAt(status.lastUpdated) : '-'
  return (
    <div className={`mt-3 rounded-2xl border p-2.5 ${locked ? 'border-emerald-300/35 bg-emerald-300/12' : 'border-amber-300/30 bg-amber-300/12'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] font-black text-white">
          <Icon size={14} />
          {locked ? 'Top10 วันนี้ล็อกแล้ว' : 'ยังไม่ได้ล็อก Top10 วันนี้'}
        </p>
        <span className="semantic-badge border-white/10 bg-white/[0.05] text-white">{status?.lockedCount ?? 0}/10</span>
      </div>
      <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-400">ล็อก {lockedAt} · อัปเดตล่าสุด {lastUpdated}</p>
    </div>
  )
}

function formatNotice(notice) {
  return String(notice ?? '').replaceAll('sync', 'อัปเดต').replaceAll('Sync', 'อัปเดต')
}

function OneBestPickHero({ oneBestPick }) {
  const match = oneBestPick?.match ?? null
  const finalPick = match ? buildAiFinalPick(match) : null
  const isClearPick = Boolean(match && oneBestPick?.heroType !== 'NO_CLEAR_PICK')
  const pickText = isClearPick && finalPick.canHighlight
    ? `AI แนะนำให้เล่น: ${finalPick.pickTeam}`
    : isClearPick && finalPick.recommendation === recommendationLabels.noBet
      ? 'Skip'
      : isClearPick
        ? 'ข้อมูลยังไม่พอเลือกฝั่ง'
        : 'วันนี้ AI ยังไม่พบคู่ที่มีคุณภาพพอให้เลือกเป็นตัวหลัก'

  return (
    <section className={`mt-3 rounded-[20px] border p-3 shadow-[0_18px_48px_rgba(0,0,0,0.28)] ${oneBestHeroClass(oneBestPick?.heroType)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5">
            <Sparkles size={14} />
            One Best Pick
          </p>
          <h1 className="mt-1 text-[1.15rem] font-black leading-6 text-white">ถ้าเลือกได้แค่ 1 คู่วันนี้</h1>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-300">{oneBestPick?.subtitle ?? 'กำลังสะสมข้อมูลเพื่อเลือกคู่หลัก'}</p>
        </div>
        <span className={`semantic-badge shrink-0 ${oneBestBadgeClass(oneBestPick?.heroType)}`}>{oneBestPick?.title ?? 'NO CLEAR PICK'}</span>
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
        <p className={`text-clamp-2 text-lg font-black leading-6 ${finalPick?.canHighlight ? 'text-white' : 'text-slate-300'}`}>{pickText}</p>
        {isClearPick ? (
          <>
            <p className="mt-1 text-clamp-1 text-xs font-bold text-slate-400">{finalPick.matchLabel}</p>
            <p className="mt-0.5 text-clamp-1 text-[11px] font-bold text-slate-500">{finalPick.leagueName} · {finalPick.kickoffAt ? formatKickoffShort(finalPick.kickoffAt) : '-'}</p>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <FinalPickInfo label="Rec" value={finalPick.recommendation} muted={finalPick.recommendation === recommendationLabels.noBet} />
              <FinalPickInfo label="Confidence" value={`${finalPick.confidence}%`} />
              <FinalPickInfo label="Risk" value={finalPick.riskLevel} muted={finalPick.riskLevel === 'HIGH'} />
            </div>
            <p className="text-clamp-2 mt-2 text-xs font-bold leading-5 text-slate-200">{finalPick.pickReason}</p>
          </>
        ) : (
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{oneBestPick?.note ?? 'วันนี้ AI ยังไม่พบคู่ที่มีคุณภาพเพียงพอ'}</p>
        )}
      </div>
    </section>
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

function oneBestHeroClass(heroType) {
  if (heroType === 'FINAL_PICK') return 'border-emerald-300/35 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(15,23,42,0.96))]'
  if (heroType === 'BEST_AVAILABLE') return 'border-amber-300/35 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(15,23,42,0.96))]'
  if (heroType === 'WATCHLIST') return 'border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(15,23,42,0.96))]'
  return 'border-slate-500/25 bg-[linear-gradient(135deg,rgba(100,116,139,0.13),rgba(15,23,42,0.96))]'
}

function oneBestBadgeClass(heroType) {
  if (heroType === 'FINAL_PICK') return 'badge-positive'
  if (heroType === 'BEST_AVAILABLE') return 'border-amber-300/30 bg-amber-300/10 text-amber-100'
  if (heroType === 'WATCHLIST') return 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100'
  return 'border-slate-400/25 bg-slate-400/10 text-slate-200'
}

function FinalPickInfo({ label, value, muted = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-2 py-1.5">
      <p className="text-[9px] font-black uppercase text-slate-500">{label}</p>
      <p className={`text-clamp-1 text-[11px] font-black leading-4 ${muted ? 'text-slate-400' : 'text-white'}`}>{value}</p>
    </div>
  )
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
  if (item === recommendationLabels.watch) return 'border-cyan-300/45 bg-cyan-300/15 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.12)]'
  if (item === recommendationLabels.noBet) return 'border-red-300/40 bg-red-400/15 text-red-50 shadow-[0_0_18px_rgba(251,113,133,0.12)]'
  return 'border-emerald-300/45 bg-emerald-300/15 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.16)]'
}

function LoadingSkeleton() {
  return (
    <div className="mt-3 grid gap-3" aria-label="Loading Top10 picks">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-[20px] border border-white/10 bg-white/[0.04] p-3.5">
          <div className="h-4 w-32 rounded-full bg-white/10" />
          <div className="mt-3 h-6 w-10/12 rounded-full bg-white/10" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="h-12 rounded-2xl bg-white/10" />
            <div className="h-12 rounded-2xl bg-white/10" />
            <div className="h-12 rounded-2xl bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  )
}

function StateBox({ title, message, detail = '', tone = 'default', onRetry }) {
  return (
    <div className={`mt-3 rounded-2xl border p-4 text-center ${tone === 'error' ? 'border-red-400/30 bg-red-400/10' : 'border-white/10 bg-white/[0.045]'}`}>
      <p className="font-black text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{message}</p>
      {detail ? <p className="text-clamp-2 mt-1 text-xs leading-5 text-slate-400">{detail}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="premium-button premium-focus mt-3 min-h-11 px-5 text-sm">
          ลองใหม่
        </button>
      ) : null}
      <Zap size={18} className="mx-auto mt-2 text-[var(--page-accent)]" />
    </div>
  )
}
