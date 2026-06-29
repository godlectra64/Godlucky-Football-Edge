import { Radio, Trophy } from 'lucide-react'
import ScoreBadge from '../components/ScoreBadge'
import { getRecommendation } from '../utils/analysisEngine'
import { formatKickoffTime, formatShortDate } from '../utils/formatters'
import { getResultTrackerStatusLabel, getScoreDisplay, isFinishedStatus, isLiveStatus, normalizeStatusCode } from '../utils/matchStatus.js'

export default function ResultTrackerPage({ matches }) {
  const liveLike = matches.filter((match) => isLiveStatus(match.statusShort ?? match.status)).length

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
              <p className="text-[10px] font-black uppercase text-slate-500">กำลังแข่ง</p>
              <p className="text-2xl font-black leading-7 text-white">{liveLike}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-3 grid gap-1.5">
        {!matches.length ? (
          <div className="empty-state">
            <Trophy size={28} className="mx-auto text-[var(--page-accent)]" />
            <p className="mt-3 font-black text-white">ยังไม่มีผลย้อนหลัง</p>
            <p className="mt-1 text-sm text-slate-400">เมื่อระบบ refresh ผลแล้ว รายการจะแสดงที่นี่โดยอัตโนมัติ</p>
          </div>
        ) : null}
        {matches.map((match) => (
          <article key={match.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold text-slate-500">{formatShortDate(match.kickoffAt)} · {formatKickoffTime(match.kickoffAt)} · {match.league?.name ?? '-'}</p>
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <p className="truncate text-sm font-black text-white">{match.homeTeam?.name ?? '-'}</p>
                <p className="rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-sm font-black text-white">{formatTrackerScore(match)}</p>
                <p className="truncate text-right text-sm font-black text-white">{match.awayTeam?.name ?? '-'}</p>
              </div>
              {match.marketFocus || match.simulationOutcome ? (
                <p className="mt-1 truncate text-[11px] font-bold text-slate-500">
                  {formatMarket(match.marketFocus)} {match.direction ? `· ${match.direction}` : ''} · {formatSimulationOutcome(match.simulationOutcome)}
                </p>
              ) : null}
            </div>
            <div className="flex min-w-[72px] flex-col items-end gap-1">
              <span className={statusClass(match)}>{formatMatchStatus(match)}</span>
              <ScoreBadge recommendation={getRecommendation(match)} />
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
  if (isFinishedStatus(normalized)) return 'semantic-badge border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
  if (isLiveStatus(normalized)) return 'semantic-badge border-red-300/35 bg-red-400/10 text-red-100'
  if (String(match.settlementStatus ?? '').toUpperCase() === 'VOID') return 'semantic-badge border-slate-300/20 bg-slate-300/10 text-slate-200'
  return 'semantic-badge border-white/10 bg-white/[0.05] text-slate-300'
}

function formatTrackerScore(match) {
  if (match.scoreDisplay) return match.scoreDisplay
  return getScoreDisplay(toTrackerShape(match))
}

function toTrackerShape(match) {
  return {
    ...match,
    statusShort: match.statusShort ?? match.status,
    homeScore: match.homeScore ?? match.homeGoals,
    awayScore: match.awayScore ?? match.awayGoals,
  }
}

function formatSimulationOutcome(value) {
  const normalized = String(value ?? 'PENDING').toUpperCase()
  if (normalized === 'HIT') return 'เข้าเป้า'
  if (normalized === 'MISS') return 'ไม่เข้าเป้า'
  if (normalized === 'PUSH') return 'เจ๊า'
  if (normalized === 'VOID') return 'ไม่นับผล'
  return 'รอผล'
}

function formatMarket(value) {
  const normalized = String(value ?? '').toUpperCase()
  if (normalized === 'MATCH_WINNER') return 'ผลแพ้ชนะ'
  if (normalized === 'OU') return 'สูงต่ำ'
  if (normalized === 'AH') return 'แฮนดิแคป'
  if (normalized === 'BTTS') return 'ทั้งสองทีมยิง'
  return normalized || 'ผลจำลอง'
}
