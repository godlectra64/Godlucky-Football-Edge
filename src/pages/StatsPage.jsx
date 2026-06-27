import { Activity, BarChart3, ShieldAlert, Sparkles, Target, TrendingUp } from 'lucide-react'
import { calculateStats } from '../utils/analysisEngine'

export default function StatsPage({ matches }) {
  const stats = calculateStats(matches)
  const recommendationCards = [
    { label: 'BET', value: stats.strongCount, tone: 'text-emerald-100', bg: 'bg-emerald-300/10 border-emerald-300/25' },
    { label: 'LEAN', value: stats.watchCount, tone: 'text-amber-100', bg: 'bg-amber-300/10 border-amber-300/25' },
    { label: 'NO BET', value: stats.skippedCount, tone: 'text-red-100', bg: 'bg-red-400/10 border-red-400/25' },
  ]
  const riskCards = [
    ['เสี่ยงต่ำ', stats.lowRiskCount, 'badge-low'],
    ['เสี่ยงกลาง', stats.mediumRiskCount, 'badge-medium'],
    ['เสี่ยงสูง', stats.highRiskCount, 'badge-high'],
  ]

  return (
    <main className="app-page theme-stats">
      <section className="premium-hero p-4">
        <div className="relative z-10">
          <p className="eyebrow flex items-center gap-1.5">
            <BarChart3 size={15} />
            Analytics Overview
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-300">Confidence เฉลี่ย</p>
              <h2 className="mt-1 text-5xl font-black leading-none text-white">{stats.averageConfidence}%</h2>
            </div>
            <div className="metric-card metric-card-emphasis min-w-[112px] text-right">
              <p className="text-xs font-bold text-slate-300">ทั้งหมด</p>
              <p className="mt-1 text-2xl font-black text-purple-100">{stats.total}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <StatTile icon={Activity} label="จบการแข่งขัน" value={stats.settled} />
        <StatTile icon={Sparkles} label="มีผลวิเคราะห์" value={stats.updatedCount} highlight />
      </section>

      <section className="mt-4 premium-card-subtle p-4">
        <h3 className="section-title flex items-center gap-2">
          <Target size={19} />
          Recommendation Mix
        </h3>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {recommendationCards.map((item) => (
            <div key={item.label} className={`rounded-2xl border p-3 ${item.bg}`}>
              <p className="text-[11px] font-black text-slate-300">{item.label}</p>
              <p className={`mt-2 text-2xl font-black ${item.tone}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 premium-card-subtle p-4">
        <h3 className="section-title flex items-center gap-2">
          <ShieldAlert size={19} />
          Risk Profile
        </h3>
        <div className="mt-3 space-y-2">
          {riskCards.map(([label, value, badge]) => (
            <div key={label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <span className={`badge-premium ${badge}`}>{label}</span>
              <span className="text-xl font-black text-white">{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 premium-card-subtle p-4">
        <h3 className="section-title flex items-center gap-2">
          <TrendingUp size={19} />
          Data Pulse
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniMetric label="คู่ทั้งหมด" value={stats.total} />
          <MiniMetric label="รอผล" value={Math.max(0, stats.total - stats.settled)} />
        </div>
      </section>
    </main>
  )
}

function StatTile({ icon: Icon, label, value, highlight = false }) {
  return (
    <div className={`metric-card ${highlight ? 'metric-card-emphasis' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-400">{label}</p>
        <Icon size={17} className="text-purple-200" />
      </div>
      <p className="mt-2 text-3xl font-black text-white">{value}</p>
    </div>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-xs font-bold text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  )
}
