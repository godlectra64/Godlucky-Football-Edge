import { CheckCircle2, Eye, Flame, Hourglass, RefreshCcw, Sparkles, Trophy, Zap } from 'lucide-react'
import { useMemo } from 'react'
import MatchCard from '../components/MatchCard'
import { formatThaiDate, formatUpdatedAt } from '../utils/formatters'
import { buildTodayMatchBuckets } from '../utils/todayMatchBuckets'

export default function TodayPage({
  matches = [],
  totalMatchCount = matches.length,
  top10Status = null,
  top10Locked = false,
  loading,
  error,
  onRefresh,
  onOpenMatch,
  onGoResults,
}) {
  const finishedExcludedCount = Number(top10Status?.finishedExcludedCount ?? 0)
  const selectedCount = Number(top10Status?.selectedCount ?? matches.length)
  const windowHoursUsed = Number(top10Status?.windowHoursUsed ?? 36)
  const lockedCount = Number(top10Status?.lockedCount ?? 0)
  const buckets = useMemo(() => buildTodayMatchBuckets(matches, {
    selectedCount,
    finishedCount: Math.max(finishedExcludedCount, top10Status?.finishedCount ?? 0),
    windowHours: windowHoursUsed,
    locked: top10Locked,
    lockedCount,
  }), [finishedExcludedCount, lockedCount, matches, selectedCount, top10Locked, top10Status?.finishedCount, windowHoursUsed])

  const {
    strongMatches,
    watchMatches,
    waitingMatches,
    predictionOnlyMatches,
    finishedMatches,
    hiddenMatches,
    playableMatches,
    summary,
  } = buckets

  const finishedCount = Math.max(summary.finishedCount, finishedMatches.length)
  const lastUpdated = top10Status?.lastUpdated ?? top10Status?.lockedAt ?? null
  const showFinishedOnlyState = !loading && !error && playableMatches.length === 0 && finishedCount > 0
  const showEmptyState = !loading && !error && playableMatches.length === 0 && finishedCount === 0
  const hasMainSections = !loading && !error && (strongMatches.length || watchMatches.length || waitingMatches.length || predictionOnlyMatches.length)
  const noReadyDecision = !loading && !error && playableMatches.length > 0 && strongMatches.length === 0

  return (
    <main className="app-page theme-today">
      <section className="premium-hero android-top-panel p-3">
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Sparkles size={13} />
                AI คัดคู่ประจำวัน
              </p>
              <h2 className="mt-0.5 text-[1.28rem] font-black leading-7 text-white">วิเคราะห์วันนี้</h2>
              <p className="text-clamp-1 mt-0.5 text-[11px] font-bold leading-4 text-slate-400">{formatThaiDate()}</p>
            </div>
            <button type="button" onClick={onRefresh} className="premium-button premium-focus flex min-h-10 shrink-0 items-center justify-center gap-1.5 px-3 text-xs" aria-label="รีเฟรชคู่วันนี้">
              <RefreshCcw size={14} />
              รีเฟรช
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <HeroMetric icon={Flame} label="พร้อมตัดสิน" value={strongMatches.length} tone="strong" />
            <HeroMetric icon={Eye} label="เฝ้าดู" value={watchMatches.length} tone="watch" />
            <HeroMetric icon={Hourglass} label="รอข้อมูล" value={waitingMatches.length} tone="waiting" />
            <HeroMetric icon={Trophy} label="จบแล้ว" value={finishedCount} tone="finished" />
          </div>

          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="text-clamp-1 text-[12px] font-black text-white">{buildHeroMessagePolished(summary, noReadyDecision)}</p>
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-black text-emerald-100">
                <CheckCircle2 size={12} />
                พร้อมใช้งาน
              </span>
            </div>
            <p className="text-clamp-2 mt-1 text-[11px] font-semibold leading-4 text-slate-400">
              {buildHeroSubtextPolished({ noReadyDecision, waitingCount: waitingMatches.length, lastUpdated })}
            </p>
          </div>

          {!loading && hiddenMatches.length ? (
            <p className="mt-2 text-clamp-1 text-[10.5px] font-semibold text-slate-500">
              ซ่อนคู่ที่เลื่อนแข่ง ยกเลิก หรือสถานะยังไม่พร้อม {hiddenMatches.length} คู่
            </p>
          ) : null}
        </div>
      </section>

      {!loading && !error && totalMatchCount > selectedCount ? (
        <section className="mt-3 rounded-[18px] border border-cyan-300/20 bg-cyan-300/10 p-3">
          <p className="text-sm font-black text-cyan-50">{buildSelectionSummaryTitle({ noReadyDecision, waitingCount: waitingMatches.length, selectedCount, totalMatchCount })}</p>
          {noReadyDecision && waitingMatches.length ? (
            <p className="mt-1 text-xs font-semibold leading-5 text-cyan-100">ยังไม่มีคู่ที่ข้อมูลครบพอสำหรับสรุปเต็ม ระบบจะแสดงมุมมองพื้นฐานไปก่อน</p>
          ) : null}
        </section>
      ) : null}

      {loading ? <LoadingSkeleton /> : null}

      {error && !loading && !matches.length ? (
        <StateBox title="โหลดข้อมูลไม่สำเร็จ" message="ระบบกำลังแสดงข้อมูลล่าสุดที่มีอยู่ ลองรีเฟรชอีกครั้งได้เลย" detail={error} tone="error" onRetry={onRefresh} />
      ) : null}

      {showFinishedOnlyState ? (
        <StateBox
          title="คู่ของวันนี้แข่งจบแล้ว"
          message="ย้ายไปดูผลย้อนหลังและประเมินความแม่นของ AI ได้ที่หน้าผลการแข่งขัน"
          actionLabel="ดูผลย้อนหลัง"
          onAction={onGoResults}
        />
      ) : null}

      {showEmptyState ? (
        <StateBox
          title="ยังไม่มีคู่ที่พร้อมคัดวันนี้"
            message="ระบบจะอัปเดตอีกครั้งเมื่อข้อมูลการแข่งขันและสถิติพร้อมพอ"
          onRetry={onRefresh}
        />
      ) : null}

      {hasMainSections ? (
        <div className="mt-3 grid gap-4">
          {noReadyDecision ? (
            <NoReadyDecisionNotice />
          ) : null}

          {strongMatches.length ? (
            <MatchSection title="พร้อมตัดสิน" count={strongMatches.length} tone="strong">
              {strongMatches.map((match) => (
                <MatchCard key={match.id} match={match} onOpen={onOpenMatch} isPlayable displayMode="strong" />
              ))}
            </MatchSection>
          ) : null}

          {watchMatches.length ? (
            <MatchSection title="คู่เฝ้าดู" count={watchMatches.length} tone="watch">
              {watchMatches.map((match) => (
                <MatchCard key={match.id} match={match} onOpen={onOpenMatch} isPlayable displayMode="watch" />
              ))}
            </MatchSection>
          ) : null}

          {waitingMatches.length ? (
            <MatchSection title="รอข้อมูล" count={waitingMatches.length} tone="waiting">
              {waitingMatches.map((match) => (
                <MatchCard key={match.id} match={match} onOpen={onOpenMatch} isPlayable isWaitingMarketData displayMode="waiting" />
              ))}
            </MatchSection>
          ) : null}

          {predictionOnlyMatches.length ? (
            <MatchSection title="Prediction Only" count={predictionOnlyMatches.length} tone="prediction">
              {predictionOnlyMatches.map((match) => (
                <MatchCard key={match.id} match={match} onOpen={onOpenMatch} isPlayable displayMode="prediction" />
              ))}
            </MatchSection>
          ) : null}

          {finishedCount ? <ResultsCta count={finishedCount} onGoResults={onGoResults} /> : null}
        </div>
      ) : null}
    </main>
  )
}

function HeroMetric({ icon: Icon, label, value, tone }) {
  const toneClass = {
    strong: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50',
    watch: 'border-cyan-300/28 bg-cyan-300/10 text-cyan-50',
    waiting: 'border-amber-300/28 bg-amber-300/10 text-amber-50',
    finished: 'border-slate-300/20 bg-slate-300/10 text-slate-100',
  }[tone]
  return (
    <div className={`rounded-xl border px-2.5 py-2 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-300">{label}</span>
        <Icon size={14} />
      </div>
      <p className="mt-1 text-xl font-black leading-6 text-white">{value}</p>
    </div>
  )
}

function MatchSection({ title, count, tone = 'strong', emptyMessage = '', children }) {
  const toneClass = {
    strong: 'text-emerald-100',
    watch: 'text-cyan-100',
    waiting: 'text-amber-100',
    prediction: 'text-slate-100',
  }[tone] ?? 'text-white'
  const childRows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : []

  return (
    <section>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <h3 className={`text-sm font-black ${toneClass}`}>{title}</h3>
        <span className="semantic-badge border-white/10 bg-white/[0.04] text-slate-200">{count}</span>
      </div>
      {childRows.length ? <div className="grid gap-2.5">{childRows}</div> : <EmptySection message={emptyMessage} />}
    </section>
  )
}

function NoReadyDecisionNotice() {
  return (
    <section className="rounded-[18px] border border-amber-300/24 bg-amber-300/10 p-3">
      <p className="text-sm font-black text-amber-50">วันนี้ยังไม่มีคู่ที่ข้อมูลครบพอสำหรับสรุปเต็ม</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-amber-100">ระบบพบ fixture จริง และจะแสดงมุมมองผู้ชนะเบื้องต้นจนกว่าข้อมูลประกอบจะครบขึ้น</p>
    </section>
  )
}

function ResultsCta({ count, onGoResults }) {
  return (
    <section className="rounded-[18px] border border-emerald-300/24 bg-emerald-300/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-white">มีผลย้อนหลังให้ตรวจแล้ว</p>
          <p className="text-clamp-1 mt-0.5 text-xs font-semibold text-emerald-100">{count} คู่ย้ายไปหน้าผลการแข่งขัน</p>
        </div>
        <button type="button" onClick={onGoResults} className="premium-button premium-focus min-h-10 shrink-0 px-4 text-xs">
          ดูผล
        </button>
      </div>
    </section>
  )
}

function EmptySection({ message }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-3 text-sm font-semibold leading-6 text-slate-300">
      {message}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="mt-3 grid gap-2.5" aria-label="กำลังโหลดคู่วันนี้">
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
          {actionLabel || 'ดูผลย้อนหลัง'}
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

function buildHeroMessagePolished(summary, noReadyDecision = false) {
  if (!summary) return buildHeroMessage(summary, noReadyDecision)
  if (noReadyDecision) return 'วันนี้ยังไม่มีคู่ที่ข้อมูลครบพอสำหรับสรุปเต็ม'
  if (summary.hasStrongPick) return 'วันนี้มีคู่พร้อมตัดสิน'
  if (summary.watchCount) return 'มีคู่ที่น่าเฝ้าดู'
  if (summary.waitingCount) return 'รอข้อมูล'
  if (summary.hasFinishedOnly) return 'คู่วันนี้แข่งจบแล้ว'
  return 'กำลังรอข้อมูลที่พร้อมพอสำหรับการคัดคู่'
}

function buildHeroSubtextPolished({ noReadyDecision = false, waitingCount = 0, lastUpdated = null } = {}) {
  const updateText = lastUpdated ? ` · อัปเดต ${formatUpdatedAt(lastUpdated)}` : ''
  if (noReadyDecision || waitingCount) {
    return `ระบบยังแสดงมุมมองผู้ชนะจากข้อมูล fixture และจะอัปเดตเมื่อมีข้อมูลประกอบครบขึ้น${updateText}`
  }
  return `จัดอันดับจากมุมมองผู้ชนะ คุณภาพข้อมูล ความเสี่ยง และความมั่นใจ${updateText}`
}

function buildSelectionSummaryTitle({ noReadyDecision = false, waitingCount = 0, selectedCount = 0, totalMatchCount = 0 } = {}) {
  if (noReadyDecision && waitingCount > 0) {
    return `วันนี้ระบบคัดคู่ที่น่าติดตามได้ ${waitingCount} คู่ จากทั้งหมด ${totalMatchCount} คู่`
  }
  return `วันนี้ระบบคัดคู่ไว้ ${selectedCount} คู่ จากทั้งหมด ${totalMatchCount} คู่`
}

function buildHeroMessage(summary, noReadyDecision = false) {
  if (noReadyDecision) return 'วันนี้ยังไม่มีคู่ที่ข้อมูลครบพอสำหรับสรุปเต็ม'
  if (summary.hasStrongPick) return 'วันนี้มีคู่ที่พร้อมตัดสิน'
  if (summary.watchCount) return 'วันนี้ยังไม่สุด แต่มีคู่ที่ควรเฝ้าดู'
  if (summary.waitingCount) return 'รอข้อมูลประกอบเพิ่มเติม'
  if (summary.hasFinishedOnly) return 'คู่วันนี้แข่งจบแล้ว'
  return 'กำลังรอข้อมูลที่พร้อมพอสำหรับการคัดคู่'
}
