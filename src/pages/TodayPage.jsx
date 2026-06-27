import { RefreshCcw, Sparkles } from 'lucide-react'
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
    <main className="app-page theme-today">
      <section className="premium-hero p-4">
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5">
                <Sparkles size={15} />
                Today Edge Dashboard
              </p>
              <h2 className="mt-1 text-2xl font-black leading-8 text-white">
                {matches.length ? 'Top 10 คู่เด่นวันนี้และพรุ่งนี้' : 'รายการวันนี้และพรุ่งนี้'}
              </h2>
              <p className="mt-1 text-sm font-semibold text-slate-300">{formatThaiDate()}</p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="premium-button premium-focus flex shrink-0 items-center justify-center gap-2 px-3 text-sm"
              aria-label="โหลดข้อมูลล่าสุด"
            >
              <RefreshCcw size={17} />
              โหลด
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <MiniStat label="คู่เด่น" value={selectionText} emphasis />
            <MiniStat label="ทั้งหมด" value={`${totalMatchCount} คู่`} />
            <MiniStat label="สถานะข้อมูล" value={notice || 'กำลังตรวจสอบ'} wide />
          </div>
        </div>
      </section>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-black transition ${
              filter === item ? filterActiveClass(item) : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:text-white'
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

      <div className="mt-4 premium-list-gap">
        {visibleMatches.map((match) => (
          <MatchCard key={match.id} match={match} onOpen={onOpenMatch} />
        ))}
      </div>
    </main>
  )
}

function filterActiveClass(item) {
  if (item === recommendationLabels.bet) return 'border-emerald-300/45 bg-emerald-300/15 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.16)]'
  if (item === recommendationLabels.lean) return 'border-amber-300/45 bg-amber-300/15 text-amber-50 shadow-[0_0_18px_rgba(251,191,36,0.14)]'
  if (item === recommendationLabels.noBet) return 'border-red-300/40 bg-red-400/15 text-red-50 shadow-[0_0_18px_rgba(248,113,113,0.12)]'
  return 'border-emerald-300/45 bg-emerald-300/15 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.16)]'
}

function MiniStat({ label, value, wide = false, emphasis = false }) {
  return (
    <div className={`metric-card ${emphasis ? 'metric-card-emphasis' : ''} ${wide ? 'col-span-2' : ''}`}>
      <p className="text-xs font-bold text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-black leading-5 text-white">{value}</p>
    </div>
  )
}

function StateBox({ title, message, tone = 'default' }) {
  return (
    <div className={`mt-4 rounded-2xl border p-5 text-center ${tone === 'error' ? 'border-red-400/30 bg-red-400/10' : 'border-white/10 bg-white/[0.045]'}`}>
      <p className="font-black text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{message}</p>
    </div>
  )
}
