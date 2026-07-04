import { CheckCircle2, Lock, RefreshCcw, Sparkles, Unlock, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import MatchCard from '../components/MatchCard'
import { buildTodayMarketSections, getConfidence, isMarketReadyForDisplay, isWaitingForMarketData, recommendationLabels } from '../utils/analysisEngine'
import { buildAiFinalPick, getOneBestPickOfDay } from '../utils/finalPick'
import { formatThaiDate, formatUpdatedAt } from '../utils/formatters'
import { buildTodayStatusBuckets } from '../utils/todayMatchBuckets'

const allFilter = 'ALL'
const filters = [allFilter, recommendationLabels.bet, recommendationLabels.lean, recommendationLabels.watch, recommendationLabels.noBet]

export default function TodayPage({ matches, oneBestPick: providedOneBestPick = null, totalMatchCount = matches.length, top10Status = null, top10Locked = false, loading, error, onRefresh, onOpenMatch, onGoResults }) {
  const [filter, setFilter] = useState(allFilter)
  const { playableMatches, finishedMatches, notPlayableMatches } = useMemo(() => buildTodayStatusBuckets(matches), [matches])
  const { readyMatches, waitingMatches, hasDisplayMatches, showWaitingNotice } = useMemo(() => buildTodayMarketSections(playableMatches, filter), [filter, playableMatches])
  const avgConfidence = playableMatches.length ? Math.round(playableMatches.reduce((total, match) => total + getConfidence(match), 0) / playableMatches.length) : 0
  const marketReadyCount = playableMatches.filter(isMarketReadyForDisplay).length
  const waitingMarketCount = playableMatches.filter(isWaitingForMarketData).length
  const v4ReadyCount = playableMatches.filter((match) => Number(match.calibratedConfidence ?? match.calibrated_confidence_score ?? match.analysis?.calibrated_confidence_score ?? 0) > 0).length
  const oneBestPick = useMemo(() => {
    const providedMatchId = providedOneBestPick?.match?.id
    if (providedMatchId && playableMatches.some((match) => match.id === providedMatchId)) return providedOneBestPick
    return getOneBestPickOfDay(playableMatches)
  }, [providedOneBestPick, playableMatches])
  const lastUpdated = top10Status?.lastUpdated ?? top10Status?.lockedAt ?? null
  const totalTop10Count = matches.length || 0
  const showFinishedOnlyState = !loading && !error && playableMatches.length === 0 && finishedMatches.length > 0
  const showEmptyState = !loading && !error && playableMatches.length === 0 && finishedMatches.length === 0

  return (
    <main className="app-page theme-today">
      <section className="premium-hero android-top-panel p-3">
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Sparkles size={13} />
                บอร์ด Top10 วันนี้
              </p>
              <h2 className="mt-0.5 text-[1.18rem] font-black leading-6 text-white">คู่เด็ดวันนี้</h2>
              <p className="text-clamp-1 mt-0.5 text-[11px] font-bold leading-4 text-slate-400">{formatThaiDate()}</p>
            </div>
            <button type="button" onClick={onRefresh} className="premium-button premium-focus flex min-h-10 shrink-0 items-center justify-center gap-1.5 px-3 text-xs" aria-label="Refresh matches">
              <RefreshCcw size={14} />
              รีเฟรช
            </button>
          </div>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <Top10LockBadge status={top10Status} locked={top10Locked} />
            <CompactMetric label="ทั้งหมดวันนี้" value={`${totalTop10Count}/${totalMatchCount || 0}`} />
            <CompactMetric label="พร้อมใช้งาน" value={`${playableMatches.length}/${totalTop10Count}`} />
            <CompactMetric label="เฉลี่ย" value={`${avgConfidence}%`} />
            <CompactMetric label="พร้อมวิเคราะห์" value={`${marketReadyCount}/${playableMatches.length || 0}`} />
            <CompactMetric label="รอตลาด" value={`${waitingMarketCount}/${playableMatches.length || 0}`} />
            <CompactMetric label="จบแล้ว" value={`${finishedMatches.length}/${totalTop10Count}`} />
          </div>

          <div className="mt-2 flex min-w-0 items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5">
            <p className="text-clamp-1 text-[11px] font-semibold text-slate-400">
              V4 {v4ReadyCount}/{playableMatches.length || 0} · อัปเดต {lastUpdated ? formatUpdatedAt(lastUpdated) : '-'}
            </p>
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-black text-emerald-100">
              <CheckCircle2 size={12} />
              พร้อม
            </span>
          </div>

          {!loading && showWaitingNotice ? (
            <p className="mt-1.5 text-clamp-1 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2.5 py-1.5 text-[11px] font-bold leading-4 text-amber-100">
              วันนี้ข้อมูลตลาดยังไม่พร้อม ระบบจะอัปเดตอีกครั้งรอบถัดไป
            </p>
          ) : null}
          {!loading && totalTop10Count < 10 ? (
            <p className="mt-1 text-clamp-1 text-[10.5px] font-semibold text-slate-500">
              วันนี้มี AI Picks {totalTop10Count} คู่จากข้อมูลที่พร้อมใช้งาน
            </p>
          ) : null}
          {!loading && notPlayableMatches.length ? (
            <p className="mt-1 text-clamp-1 text-[10.5px] font-semibold text-slate-500">
              ไม่แสดงคู่ที่เลื่อน/ยกเลิก/ไม่ทราบสถานะ {notPlayableMatches.length} คู่ในบอร์ดหลัก
            </p>
          ) : null}
        </div>
      </section>

      {playableMatches.length ? <OneBestPickSummary oneBestPick={oneBestPick} /> : null}

      {playableMatches.length ? (
        <div className="mobile-scroll mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`min-h-8 shrink-0 rounded-full border px-3 text-[11px] font-black transition ${
                filter === item ? filterActiveClass(item) : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? <LoadingSkeleton /> : null}
      {error && !loading && !matches.length ? <StateBox title="โหลดข้อมูลไม่สำเร็จ" message="ระบบกำลังแสดงข้อมูลล่าสุดที่มีอยู่" detail={error} tone="error" onRetry={onRefresh} /> : null}
      {showFinishedOnlyState ? (
        <StateBox
          title="คู่ของวันนี้แข่งจบแล้ว"
          message="คู่ของวันนี้แข่งจบแล้ว ดูผลได้ที่หน้าผลย้อนหลัง"
          actionLabel="ไปหน้าผลย้อนหลัง"
          onAction={onGoResults}
        />
      ) : null}
      {showEmptyState ? (
        <StateBox
          title="ยังไม่มีรายการแข่งขันสำหรับวันนี้"
          message="ลองรีเฟรชข้อมูลหรือกลับมาตรวจอีกครั้ง"
          onRetry={onRefresh}
        />
      ) : null}

      {!loading && !error && playableMatches.length > 0 && hasDisplayMatches ? (
        <div className="mt-2.5 grid gap-4">
          {readyMatches.length ? (
            <MatchSection title="คู่พร้อมวิเคราะห์" count={readyMatches.length} tone="ready">
              <div className="grid gap-2.5">
                {readyMatches.map((match) => (
                  <MatchCard key={match.id} match={match} onOpen={onOpenMatch} isPlayable />
                ))}
              </div>
            </MatchSection>
          ) : null}

          {waitingMatches.length ? (
            <MatchSection title="รอข้อมูลตลาด" count={waitingMatches.length} tone="waiting">
              <div className="grid gap-2.5">
                {waitingMatches.map((match) => (
                  <MatchCard key={match.id} match={match} onOpen={onOpenMatch} isPlayable isWaitingMarketData />
                ))}
              </div>
            </MatchSection>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}

function MatchSection({ title, count, tone = 'ready', children }) {
  const toneClass = tone === 'ready' ? 'text-emerald-100' : 'text-amber-100'
  return (
    <section>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <h3 className={`text-sm font-black ${toneClass}`}>{title}</h3>
        <span className="semantic-badge border-white/10 bg-white/[0.04] text-slate-200">{count}</span>
      </div>
      {children}
    </section>
  )
}

function Top10LockBadge({ status, locked }) {
  const Icon = locked ? Lock : Unlock
  const lockedAt = status?.lockedAt ? formatUpdatedAt(status.lockedAt) : '-'
  const lastUpdated = status?.lastUpdated ? formatUpdatedAt(status.lastUpdated) : '-'
  return (
    <span
      className={`semantic-badge max-w-full ${locked ? 'border-emerald-300/35 bg-emerald-300/12 text-emerald-50' : 'border-amber-300/30 bg-amber-300/12 text-amber-100'}`}
      title={`ล็อก ${lockedAt} · อัปเดตล่าสุด ${lastUpdated}`}
    >
      <Icon size={12} />
      {locked ? 'ล็อก Top10' : 'ยังไม่ล็อก'} {status?.lockedCount ?? 0}/10
    </span>
  )
}

function CompactMetric({ label, value }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 text-[11px] font-black text-white">
      <span className="text-slate-500">{label}</span>
      {value}
    </span>
  )
}

function OneBestPickSummary({ oneBestPick }) {
  const match = oneBestPick?.match ?? null
  const finalPick = match ? buildAiFinalPick(match) : null
  const isClearPick = Boolean(match && oneBestPick?.heroType !== 'NO_CLEAR_PICK')
  const pickText = isClearPick && finalPick.canHighlight
    ? finalPick.pickTeam
    : isClearPick && finalPick.recommendation === recommendationLabels.noBet
      ? 'Skip'
      : isClearPick
        ? 'ข้อมูลยังไม่พอเลือกฝั่ง'
        : 'ยังไม่พบคู่หลักที่ชัดเจน'

  return (
    <section className={`mt-1.5 rounded-[16px] border p-2.5 ${oneBestHeroClass(oneBestPick?.heroType)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5">
            <Sparkles size={12} />
            คู่หลักวันนี้
          </p>
          <p className={`mt-0.5 text-clamp-1 text-base font-black leading-5 ${finalPick?.canHighlight ? 'text-white' : 'text-slate-300'}`}>{pickText}</p>
          {isClearPick ? (
            <p className="text-clamp-1 mt-0.5 text-[11px] font-bold text-slate-400">
              {finalPick.matchLabel} · {finalPick.confidence}% · {finalPick.riskLevel}
            </p>
          ) : (
            <p className="text-clamp-1 mt-0.5 text-[11px] font-bold text-slate-400">{oneBestPick?.note ?? 'กำลังสะสมข้อมูล'}</p>
          )}
        </div>
        <span className={`semantic-badge shrink-0 ${oneBestBadgeClass(oneBestPick?.heroType)}`}>{oneBestPick?.title ?? 'NO CLEAR PICK'}</span>
      </div>
    </section>
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

function filterActiveClass(item) {
  if (item === recommendationLabels.bet) return 'border-emerald-300/45 bg-emerald-300/15 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.16)]'
  if (item === recommendationLabels.lean) return 'border-amber-300/45 bg-amber-300/15 text-amber-50 shadow-[0_0_18px_rgba(245,158,11,0.14)]'
  if (item === recommendationLabels.watch) return 'border-cyan-300/45 bg-cyan-300/15 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.12)]'
  if (item === recommendationLabels.noBet) return 'border-red-300/40 bg-red-400/15 text-red-50 shadow-[0_0_18px_rgba(251,113,133,0.12)]'
  return 'border-emerald-300/45 bg-emerald-300/15 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.16)]'
}

function LoadingSkeleton() {
  return (
    <div className="mt-3 grid gap-2.5" aria-label="กำลังโหลด Top10">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-[18px] border border-white/10 bg-white/[0.04] p-3">
          <div className="h-4 w-32 rounded-full bg-white/10" />
          <div className="mt-3 h-6 w-10/12 rounded-full bg-white/10" />
          <div className="mt-3 h-10 rounded-2xl bg-white/10" />
        </div>
      ))}
    </div>
  )
}

function StateBox({ title, message, detail = '', tone = 'default', onRetry, actionLabel = '', onAction }) {
  return (
    <div className={`mt-3 rounded-2xl border p-4 text-center ${tone === 'error' ? 'border-red-400/30 bg-red-400/10' : 'border-white/10 bg-white/[0.045]'}`}>
      <p className="font-black text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{message}</p>
      {detail ? <p className="text-clamp-2 mt-1 text-xs leading-5 text-slate-400">{detail}</p> : null}
      {onAction ? (
        <button type="button" onClick={onAction} className="premium-button premium-focus mt-3 min-h-11 px-5 text-sm">
          {actionLabel || 'ไปหน้าผลย้อนหลัง'}
        </button>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="premium-button premium-focus mt-3 min-h-11 px-5 text-sm">
          ลองใหม่
        </button>
      ) : null}
      <Zap size={18} className="mx-auto mt-2 text-[var(--page-accent)]" />
    </div>
  )
}
