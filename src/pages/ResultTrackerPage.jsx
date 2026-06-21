import { formatShortDate } from '../utils/formatters'
import { getRecommendation } from '../utils/analysisEngine'

const results = ['Win', 'Lose', 'Push', 'Pending']

export default function ResultTrackerPage({ matches, onUpdateMatch }) {
  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h2 className="text-2xl font-black text-white">บันทึกผล</h2>
        <p className="mt-1 text-sm text-slate-400">อัปเดต Win / Lose / Push หลังแข่งได้ทันที</p>
      </section>

      <div className="mt-4 space-y-3">
        {matches.map((match) => (
          <article key={match.id} className="rounded-lg border border-white/10 bg-pitch-800 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-400">{formatShortDate(match.date)} · {match.time} · {match.league}</p>
                <h3 className="mt-1 text-base font-bold text-white">{match.homeTeam}</h3>
                <p className="text-sm text-slate-400">vs {match.awayTeam}</p>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-200">{getRecommendation(match)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] p-3">
              <div>
                <p className="text-xs text-slate-400">ตลาด</p>
                <p className="font-bold text-white">{match.recommendedMarket}</p>
              </div>
              <select
                value={match.result}
                onChange={(event) => onUpdateMatch({ ...match, result: event.target.value })}
                className="min-h-11 rounded-lg border border-white/10 bg-pitch-900 px-3 text-sm font-bold text-white"
              >
                {results.map((result) => (
                  <option key={result} value={result}>{result}</option>
                ))}
              </select>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
