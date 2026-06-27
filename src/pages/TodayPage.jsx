import { RefreshCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import MatchCard from '../components/MatchCard'
import { recommendationLabels } from '../utils/analysisEngine'
import { formatThaiDate } from '../utils/formatters'

const allFilter = 'ทั้งหมด'
const filters = [allFilter, recommendationLabels.bet, recommendationLabels.lean, recommendationLabels.noBet]

export default function TodayPage({ matches, totalMatchCount = matches.length, loading, error, notice, onRefresh, onOpenMatch }) {
  const [filter, setFilter] = useState(allFilter)
  const visibleMatches = useMemo(() => {
    if (filter === allFilter) return matches
    return matches.filter((match) => match.recommendation === filter)
  }, [filter, matches])
  const selectionText = matches.length ? `${matches.length} คู่` : 'รอข้อมูล'

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-emerald-300/25 bg-gradient-to-br from-pitch-800 via-pitch-850 to-pitch-900 p-4 shadow-[0_20px_58px_rgba(0,0,0,0.28),0_0_34px_rgba(79,70,229,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-200">{formatThaiDate()}</p>
            <h2 className="mt-1 text-2xl font-black leading-8 text-white">
              {matches.length ? 'Top 10 คู่เด่นวันนี้และพรุ่งนี้' : 'รายการวันนี้และพรุ่งนี้'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-3 text-sm font-black text-emerald-100 shadow-[0_0_18px_rgba(52,211,153,0.12)] transition hover:border-emerald-200/70 hover:bg-emerald-300/20 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
            aria-label="โหลดข้อมูลล่าสุด"
          >
            <RefreshCcw size={17} />
            โหลด
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniStat label="จำนวนคู่เด่น" value={selectionText} />
          <MiniStat label="ข้อมูลทั้งหมด" value={`${totalMatchCount} คู่`} />
          <MiniStat label="สถานะข้อมูล" value={notice || 'กำลังตรวจสอบ'} wide />
        </div>
      </section>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold transition ${
              filter === item
                ? 'border-emerald-300 bg-emerald-400 text-pitch-950 shadow-[0_0_18px_rgba(52,211,153,0.18)]'
                : 'border-white/10 bg-pitch-800 text-slate-300 hover:border-white/20 hover:text-white'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {loading ? <StateBox title="กำลังโหลดข้อมูลจริง" message="กำลังอ่านข้อมูลจาก Supabase" /> : null}
      {error && !loading ? <StateBox title="โหลดข้อมูลไม่สำเร็จ" message={`${error} · ใช้ข้อมูลล่าสุดที่มีอยู่`} tone="error" /> : null}
      {!loading && !error && !visibleMatches.length ? (
        <StateBox title="ยังไม่มีรายการคู่ในช่วงวันนี้ถึงพรุ่งนี้" message="กด sync ในหน้าแอดมิน หรือรอ Cron รอบถัดไป" />
      ) : null}

      <div className="mt-4 space-y-3">
        {visibleMatches.map((match) => (
          <MatchCard key={match.id} match={match} onOpen={onOpenMatch} />
        ))}
      </div>
    </main>
  )
}

function MiniStat({ label, value, wide = false }) {
  return (
    <div className={`rounded-lg border border-white/10 bg-white/[0.055] p-3 ${wide ? 'col-span-2' : ''}`}>
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-black leading-5 text-white">{value}</p>
    </div>
  )
}

function StateBox({ title, message, tone = 'default' }) {
  return (
    <div className={`mt-4 rounded-lg border p-5 text-center ${tone === 'error' ? 'border-red-400/30 bg-red-400/10' : 'border-white/10 bg-pitch-800'}`}>
      <p className="font-bold text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{message}</p>
    </div>
  )
}
