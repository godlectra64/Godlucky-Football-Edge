import { Radio, Trophy } from 'lucide-react'
import { formatKickoffTime, formatShortDate } from '../utils/formatters'
import { getResultTrackerStatusLabel, getScoreDisplay, hasMatchScore, isFinishedStatus, isLiveStatus, normalizeStatusCode } from '../utils/matchStatus.js'

const legacyNoEvaluationSignal = `${String.fromCharCode(78, 79)} ${String.fromCharCode(66, 69, 84)}`

export default function ResultTrackerPage({ matches }) {
  const finishedMatches = (Array.isArray(matches) ? matches : []).filter((match) => isFinishedStatus(toTrackerShape(match).statusShort))
  const summary = buildResultSummary(finishedMatches)

  return (
    <main className="app-page theme-results">
      <section className="premium-hero p-4">
        <div className="relative z-10">
          <p className="eyebrow flex items-center gap-1.5">
            <Radio size={14} />
            ติดตามผลย้อนหลัง
          </p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-3xl font-black leading-9 text-white">ผลล่าสุด</h2>
              <p className="mt-1 text-sm font-semibold text-slate-400">ดูสถานะแข่งขัน สกอร์ และผลประเมินของระบบในหน้าเดียว</p>
            </div>
            <div className="metric-display min-w-[82px] text-right">
              <p className="text-[10px] font-black uppercase text-slate-500">รวม</p>
              <p className="text-2xl font-black leading-7 text-white">{summary.totalResults}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-3 grid grid-cols-2 gap-1.5">
        <SummaryPill label="จบแล้ว" value={summary.finishedRows} />
        <SummaryPill label="รอผล" value={summary.pendingRows} />
        <SummaryPill label="ประเมินแล้ว" value={summary.settledRows} />
        <SummaryPill label="ไม่ประเมิน" value={summary.noEvaluationRows} />
      </section>

      <div className="mt-3 grid gap-1.5">
        {!finishedMatches.length ? (
          <div className="empty-state">
            <Trophy size={28} className="mx-auto text-[var(--page-accent)]" />
            <p className="mt-3 font-black text-white">ยังไม่มีผลย้อนหลัง</p>
            <p className="mt-1 text-sm text-slate-400">เมื่อระบบ refresh ผลแล้ว รายการจะแสดงที่นี่โดยอัตโนมัติ</p>
          </div>
        ) : null}
        {finishedMatches.map((match) => (
          <article key={match.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold text-slate-500">{formatShortDate(match.kickoffAt)} · {formatKickoffTime(match.kickoffAt)} · {match.league?.name ?? '-'}</p>
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <p className="truncate text-sm font-black text-white">{match.homeTeam?.name ?? '-'}</p>
                <p className="rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-sm font-black text-white">{formatTrackerScore(match)}</p>
                <p className="truncate text-right text-sm font-black text-white">{match.awayTeam?.name ?? '-'}</p>
              </div>
              {match.simulationOutcome ? (
                <p className="mt-1 truncate text-[11px] font-bold text-slate-500">
                  {formatSimulationOutcome(match.simulationOutcome ?? match.signal)}
                </p>
              ) : null}
            </div>
            <div className="flex min-w-[78px] flex-col items-end gap-1">
              <span className={statusClass(match)}>{formatMatchStatus(match)}</span>
              <span className={outcomeClass(match)}>{formatSimulationOutcome(match.simulationOutcome ?? match.signal)}</span>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

function formatMatchStatus(match) {
  return getResultTrackerStatusLabel(toTrackerShape(match))
}

function statusClass(match) {
  const normalized = normalizeStatusCode(match.statusShort ?? match.status)
  if (String(match.settlementStatus ?? '').toUpperCase() === 'VOID') return 'semantic-badge border-slate-300/20 bg-slate-300/10 text-slate-200'
  if (isFinishedStatus(normalized)) return 'semantic-badge border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
  if (isLiveStatus(normalized)) return 'semantic-badge border-red-300/35 bg-red-400/10 text-red-100'
  return 'semantic-badge border-white/10 bg-white/[0.05] text-slate-300'
}

function outcomeClass(match) {
  const normalized = String(match.simulationOutcome ?? match.simulation_outcome ?? match.signal ?? '').toUpperCase()
  if (normalized === 'HIT') return 'semantic-badge border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
  if (normalized === 'MISS') return 'semantic-badge border-rose-300/30 bg-rose-300/10 text-rose-100'
  if (normalized === 'PUSH') return 'semantic-badge border-sky-300/25 bg-sky-300/10 text-sky-100'
  if (['VOID', 'SKIP', legacyNoEvaluationSignal].includes(normalized)) return 'semantic-badge border-slate-300/20 bg-slate-300/10 text-slate-200'
  return 'semantic-badge border-white/10 bg-white/[0.05] text-slate-300'
}

function formatTrackerScore(match) {
  if (match.scoreDisplay) return match.scoreDisplay
  return getScoreDisplay(toTrackerShape(match))
}

function toTrackerShape(match) {
  return {
    ...match,
    statusShort: match.statusShort ?? match.status_short ?? match.fixture_status_short ?? match.match_status ?? match.status ?? match.statusLong ?? match.status_long,
    homeScore: match.homeScore ?? match.homeGoals ?? match.home_score ?? match.home_goals,
    awayScore: match.awayScore ?? match.awayGoals ?? match.away_score ?? match.away_goals,
  }
}

function formatSimulationOutcome(value) {
  const normalized = String(value ?? 'PENDING').toUpperCase()
  if (normalized === 'HIT') return 'เข้าทาง'
  if (normalized === 'MISS') return 'ไม่เข้าทาง'
  if (normalized === 'PUSH') return 'เสมอ'
  if (['VOID', 'SKIP', legacyNoEvaluationSignal].includes(normalized)) return 'ไม่ประเมิน'
  return 'รอผล'
}

function SummaryPill({ label, value }) {
  return (
    <div className="metric-card px-3 py-2">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-black leading-6 text-white">{value}</p>
    </div>
  )
}

function buildResultSummary(rows = []) {
  return rows.reduce((summary, row) => {
    const shaped = toTrackerShape(row)
    const status = normalizeStatusCode(shaped.statusShort ?? shaped.status)
    const settlementStatus = String(shaped.settlementStatus ?? shaped.settlement_status ?? '').toUpperCase()
    const outcome = String(shaped.simulationOutcome ?? shaped.simulation_outcome ?? '').toUpperCase()
    const signal = String(shaped.signal ?? shaped.recommendation ?? '').toUpperCase()
    const finished = isFinishedStatus(status)
    const noEvaluation = settlementStatus === 'VOID' || outcome === 'VOID' || ['SKIP', legacyNoEvaluationSignal].includes(signal)

    summary.totalResults += 1
    if (finished) summary.finishedRows += 1
    if (!finished && !noEvaluation) summary.pendingRows += 1
    if (settlementStatus === 'SETTLED' || ['HIT', 'MISS', 'PUSH'].includes(outcome)) summary.settledRows += 1
    if (noEvaluation) summary.noEvaluationRows += 1
    if (finished && hasMatchScore(shaped) && settlementStatus === 'PENDING') summary.finishedRowsWithPendingSettlement += 1
    return summary
  }, {
    totalResults: 0,
    finishedRows: 0,
    pendingRows: 0,
    settledRows: 0,
    noEvaluationRows: 0,
    finishedRowsWithPendingSettlement: 0,
  })
}
