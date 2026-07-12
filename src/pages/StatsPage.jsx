import { Activity, BarChart3, CircleGauge, ShieldAlert, Sparkles, Target, TrendingUp } from 'lucide-react'
import { calculateStats } from '../utils/analysisEngine'

export default function StatsPage({ matches }) {
  const stats = calculateStats(matches)
  const total = Math.max(1, stats.total)
  const recommendationSegments = [
    { label: 'พร้อมวิเคราะห์', value: stats.strongCount, className: 'bg-emerald-400' },
    { label: 'ติดตามต่อ', value: stats.watchCount, className: 'bg-amber-400' },
    { label: 'รอข้อมูล', value: stats.skippedCount, className: 'bg-rose-400' },
  ]
  const riskSegments = [
    { label: 'LOW', value: stats.lowRiskCount, className: 'bg-cyan-300' },
    { label: 'MED', value: stats.mediumRiskCount, className: 'bg-amber-400' },
    { label: 'HIGH', value: stats.highRiskCount, className: 'bg-rose-400' },
  ]

  return (
    <main className="app-page theme-stats">
      <section className="premium-hero p-4">
        <div className="relative z-10">
          <p className="eyebrow flex items-center gap-1.5">
            <BarChart3 size={14} />
            สถิติภาพรวม
          </p>
          <div className="mt-3 grid grid-cols-[116px_minmax(0,1fr)] items-center gap-4">
            <ConfidenceRing value={stats.averageConfidence} />
            <div className="min-w-0">
              <h2 className="text-3xl font-black leading-9 text-white">สุขภาพสัญญาณ</h2>
              <p className="mt-1 text-sm font-semibold text-slate-400">สรุปความมั่นใจ ความเสี่ยง และสัญญาณจากคู่แข่งขันปัจจุบัน</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniMetric label="จำนวนคู่ทั้งหมด" value={stats.total} />
                <MiniMetric label="สรุปผลแล้ว" value={stats.settled} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-3 rounded-[20px] border border-white/10 bg-white/[0.035] p-3.5">
        <h3 className="section-title flex items-center gap-2">
          <Target size={18} className="text-[var(--page-accent)]" />
          สัดส่วนสัญญาณ
        </h3>
        <DistributionBar segments={recommendationSegments} total={total} />
        <SegmentLegend segments={recommendationSegments} total={total} />
      </section>

      <section className="mt-3 rounded-[20px] border border-white/10 bg-white/[0.035] p-3.5">
        <h3 className="section-title flex items-center gap-2">
          <ShieldAlert size={18} className="text-[var(--page-accent)]" />
          ภาพรวมความเสี่ยง
        </h3>
        <DistributionBar segments={riskSegments} total={total} />
        <div className="mt-3 grid grid-cols-3 gap-2">
          {riskSegments.map((item) => (
            <div key={item.label} className="metric-display p-2.5">
              <p className="text-[10px] font-black text-slate-500">{item.label}</p>
              <p className="mt-1 text-xl font-black text-white">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-3 grid grid-cols-2 gap-2.5">
        <StatTile icon={Activity} label="รายการที่สรุปผลแล้ว" value={stats.settled} />
        <StatTile icon={Sparkles} label="วิเคราะห์แล้ว" value={stats.updatedCount} highlight />
        <StatTile icon={TrendingUp} label="รอผลการแข่งขัน" value={Math.max(0, stats.total - stats.settled)} />
        <StatTile icon={CircleGauge} label="ความมั่นใจเฉลี่ย" value={`${stats.averageConfidence}%`} highlight />
      </section>
    </main>
  )
}

function ConfidenceRing({ value }) {
  const normalized = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className="relative h-[116px] w-[116px] rounded-full p-[7px]" style={{ background: `conic-gradient(var(--page-accent) ${normalized * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}>
      <div className="flex h-full w-full flex-col items-center justify-center rounded-full border border-white/10 bg-[#071019]">
        <p className="text-[10px] font-black uppercase text-slate-500">เฉลี่ย</p>
        <p className="text-3xl font-black leading-8 text-white">{normalized}%</p>
        <p className="text-[10px] font-bold text-purple-200">ความมั่นใจ</p>
      </div>
    </div>
  )
}

function DistributionBar({ segments, total }) {
  return (
    <div className="distribution-bar mt-3">
      {segments.map((item) => (
        <span key={item.label} className={item.className} style={{ width: `${Math.max(item.value ? 5 : 0, (item.value / total) * 100)}%` }} />
      ))}
    </div>
  )
}

function SegmentLegend({ segments, total }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {segments.map((item) => (
        <div key={item.label} className="rounded-2xl border border-white/10 bg-black/20 p-2.5">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${item.className}`} />
            <p className="text-[10px] font-black text-slate-400">{item.label}</p>
          </div>
          <p className="mt-1 text-xl font-black text-white">{item.value}</p>
          <p className="text-[10px] font-bold text-slate-500">{Math.round((item.value / total) * 100)}%</p>
        </div>
      ))}
    </div>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="metric-display p-2.5">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <p className="text-lg font-black text-white">{value}</p>
    </div>
  )
}

function StatTile({ icon: Icon, label, value, highlight = false }) {
  return (
    <div className={`metric-display ${highlight ? 'is-emphasis' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
        <Icon size={16} className="text-[var(--page-accent)]" />
      </div>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  )
}
