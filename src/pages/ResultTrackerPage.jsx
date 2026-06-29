import { Radio, Trophy } from 'lucide-react'
import ScoreBadge from '../components/ScoreBadge'
import { getRecommendation } from '../utils/analysisEngine'
import { formatKickoffTime, formatScore, formatShortDate } from '../utils/formatters'

export default function ResultTrackerPage({ matches }) {
  const liveLike = matches.filter((match) => match.status && !['NS', 'TBD'].includes(match.status)).length

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
            <p className="mt-1 text-sm text-slate-400">ซิงก์ข้อมูลคู่แข่งขันจากหน้าจัดการก่อน เพื่อเริ่มติดตามผล</p>
          </div>
        ) : null}
        {matches.map((match) => (
          <article key={match.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold text-slate-500">{formatShortDate(match.kickoffAt)} · {formatKickoffTime(match.kickoffAt)} · {match.league?.name ?? '-'}</p>
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <p className="truncate text-sm font-black text-white">{match.homeTeam?.name ?? '-'}</p>
                <p className="rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-sm font-black text-white">{formatScore(match.homeGoals, match.awayGoals)}</p>
                <p className="truncate text-right text-sm font-black text-white">{match.awayTeam?.name ?? '-'}</p>
              </div>
            </div>
            <div className="flex min-w-[72px] flex-col items-end gap-1">
              <span className={statusClass(match.status)}>{formatMatchStatus(match.status)}</span>
              <ScoreBadge recommendation={getRecommendation(match)} />
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

function formatMatchStatus(status) {
  const normalized = String(status || 'PENDING').toUpperCase()
  if (normalized === 'PENDING' || normalized === 'NS' || normalized === 'TBD') return 'PENDING · รอผล'
  if (['FT', 'AET', 'PEN', 'FINISHED'].includes(normalized)) return 'จบการแข่งขัน'
  if (['1H', '2H', 'HT', 'LIVE', 'ET'].includes(normalized)) return `${normalized} · กำลังแข่ง`
  return normalized
}

function statusClass(status) {
  const normalized = String(status ?? '').toUpperCase()
  if (['FT', 'AET', 'PEN', 'FINISHED'].includes(normalized)) return 'semantic-badge border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
  if (['1H', '2H', 'HT', 'LIVE', 'ET'].includes(normalized)) return 'semantic-badge border-red-300/35 bg-red-400/10 text-red-100'
  return 'semantic-badge border-white/10 bg-white/[0.05] text-slate-300'
}
