import { useMemo, useState } from 'react'
import MatchCard from '../components/MatchCard'
import { getTopMatches } from '../utils/analysisEngine'
import { formatThaiDate, nowTime } from '../utils/formatters'

const filters = ['ทั้งหมด', 'BET', 'LEAN', 'NO BET']

export default function TodayPage({ matches, onOpenMatch }) {
  const [filter, setFilter] = useState('ทั้งหมด')
  const topMatches = useMemo(() => getTopMatches(matches, 10), [matches])
  const visibleMatches = filter === 'ทั้งหมด' ? topMatches : topMatches.filter((match) => match.recommendation === filter)

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-emerald-400/20 bg-gradient-to-br from-pitch-800 to-pitch-900 p-4">
        <p className="text-sm text-emerald-200">{formatThaiDate()}</p>
        <h2 className="mt-1 text-2xl font-black text-white">คู่เด็ดวันนี้</h2>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <MiniStat label="ผ่านคัดเลือก" value={`${topMatches.length} คู่`} />
          <MiniStat label="อัปเดตล่าสุด" value={nowTime()} />
        </div>
      </section>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold ${
              filter === item
                ? 'border-emerald-300 bg-emerald-400 text-pitch-950'
                : 'border-white/10 bg-pitch-800 text-slate-300'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {visibleMatches.map((match) => (
          <MatchCard key={match.id} match={match} onOpen={onOpenMatch} />
        ))}
        {!visibleMatches.length ? (
          <div className="rounded-lg border border-white/10 bg-pitch-800 p-6 text-center text-slate-300">
            ไม่มีคู่ที่ตรงกับตัวกรองนี้
          </div>
        ) : null}
      </div>
    </main>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-white/[0.06] p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  )
}
