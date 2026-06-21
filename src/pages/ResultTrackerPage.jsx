import { getRecommendation } from '../utils/analysisEngine'
import { formatKickoffTime, formatScore, formatShortDate } from '../utils/formatters'

export default function ResultTrackerPage({ matches }) {
  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h2 className="text-2xl font-black text-white">ผลการแข่งขัน</h2>
        <p className="mt-1 text-sm text-slate-400">อ่านสถานะและสกอร์จากข้อมูลจริงที่ sync ล่าสุด</p>
      </section>

      <div className="mt-4 space-y-3">
        {!matches.length ? (
          <div className="rounded-lg border border-white/10 bg-pitch-800 p-5 text-center text-slate-300">
            ยังไม่มีข้อมูลผลการแข่งขัน
          </div>
        ) : null}
        {matches.map((match) => (
          <article key={match.id} className="rounded-lg border border-white/10 bg-pitch-800 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-400">{formatShortDate(match.kickoffAt)} · {formatKickoffTime(match.kickoffAt)} · {match.league?.name}</p>
                <h3 className="mt-1 truncate text-base font-bold text-white">{match.homeTeam?.name}</h3>
                <p className="truncate text-sm text-slate-400">vs {match.awayTeam?.name}</p>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-200">{getRecommendation(match)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-white/[0.04] p-3">
              <div>
                <p className="text-xs text-slate-400">สถานะ</p>
                <p className="font-bold text-white">{match.status || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">สกอร์</p>
                <p className="font-bold text-white">{formatScore(match.homeGoals, match.awayGoals)}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
