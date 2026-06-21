import { RefreshCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import MatchCard from '../components/MatchCard'
import { recommendationLabels } from '../utils/analysisEngine'
import { formatThaiDate } from '../utils/formatters'

const allFilter = 'ทั้งหมด'
const filters = [allFilter, recommendationLabels.strong, recommendationLabels.watch, recommendationLabels.skip]

export default function TodayPage({ matches, loading, error, notice, debug, onRefresh, onOpenMatch }) {
  const [filter, setFilter] = useState(allFilter)
  const visibleMatches = useMemo(() => {
    if (filter === allFilter) return matches
    return matches.filter((match) => match.recommendation === filter)
  }, [filter, matches])

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-emerald-400/20 bg-gradient-to-br from-pitch-800 to-pitch-900 p-4">
        <p className="text-sm text-emerald-200">{formatThaiDate()}</p>
        <h2 className="mt-1 text-2xl font-black text-white">รายการคู่จริงวันนี้และพรุ่งนี้</h2>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <MiniStat label="จำนวนคู่" value={`${matches.length} คู่`} />
          <MiniStat label="สถานะข้อมูล" value={notice || 'กำลังตรวจสอบ'} />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/40 bg-emerald-400/10 font-bold text-emerald-100"
        >
          <RefreshCcw size={18} />
          โหลดข้อมูลล่าสุด
        </button>
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

      <DebugPanel debug={debug} />

      {loading ? <StateBox title="กำลังโหลดข้อมูลจริง" message="กำลังอ่านข้อมูลจาก Supabase" /> : null}
      {error && !loading ? <StateBox title="โหลดข้อมูลไม่สำเร็จ" message={`${error} · ข้อมูลล่าสุดที่บันทึกไว้`} tone="error" /> : null}
      {!loading && !error && !visibleMatches.length ? (
        <StateBox title="ยังไม่มีรายการคู่ในช่วงวันนี้ถึงพรุ่งนี้" message="กด sync ในหน้าแอดมิน หรือรอ Cron รอบถัดไป" />
      ) : null}

      <div className="mt-4 space-y-4">
        {visibleMatches.map((match) => (
          <MatchCard key={match.id} match={match} onOpen={onOpenMatch} />
        ))}
      </div>
    </main>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-white/[0.06] p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-white">{value}</p>
    </div>
  )
}

function DebugPanel({ debug }) {
  if (!debug) return null

  const rows = [
    ['Supabase URL', debug.supabaseUrl],
    ['Project ref', debug.projectRef],
    ['Rows fetched', debug.rowsFetched],
    ['First match id', debug.firstMatchId],
    ['First match date', debug.firstMatchDate],
  ]

  return (
    <section className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3">
      <p className="text-sm font-bold text-amber-100">Temporary debug</p>
      <dl className="mt-2 space-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-28 shrink-0 text-slate-400">{label}</dt>
            <dd className="min-w-0 break-all font-semibold text-white">{String(value ?? '-')}</dd>
          </div>
        ))}
      </dl>
    </section>
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
