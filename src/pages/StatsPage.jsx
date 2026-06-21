import { calculateStats } from '../utils/analysisEngine'

export default function StatsPage({ matches }) {
  const stats = calculateStats(matches)
  const cards = [
    ['จำนวนคู่ทั้งหมด', stats.total],
    ['จบการแข่งขันแล้ว', stats.settled],
    ['น่าสนใจมาก', stats.strongCount],
    ['น่าติดตาม', stats.watchCount],
    ['ข้าม', stats.skippedCount],
    ['เสี่ยงต่ำ', stats.lowRiskCount],
    ['เสี่ยงกลาง', stats.mediumRiskCount],
    ['เสี่ยงสูง', stats.highRiskCount],
    ['ความมั่นใจเฉลี่ย', `${stats.averageConfidence}%`],
    ['มีผลวิเคราะห์', stats.updatedCount],
  ]

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-emerald-400/20 bg-pitch-800 p-4">
        <p className="text-sm font-semibold text-emerald-200">ภาพรวมข้อมูลจริง</p>
        <div className="mt-2 flex items-end justify-between">
          <h2 className="text-4xl font-black text-white">{stats.averageConfidence}%</h2>
          <p className="pb-1 text-sm text-slate-400">confidence เฉลี่ย</p>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/10 bg-pitch-800 p-4">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-black text-white">{value}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
