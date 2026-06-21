import { calculateStats } from '../utils/analysisEngine'

export default function StatsPage({ matches }) {
  const stats = calculateStats(matches)
  const cards = [
    ['จำนวนคู่ทั้งหมด', stats.total],
    ['จำนวน BET', stats.betCount],
    ['จำนวน LEAN', stats.leanCount],
    ['Winrate รวม', `${stats.winrateOverall}%`],
    ['Winrate BET', `${stats.winrateBet}%`],
    ['Winrate LEAN', `${stats.winrateLean}%`],
    ['AH Winrate', `${stats.ahWinrate}%`],
    ['OU Winrate', `${stats.ouWinrate}%`],
    ['Win', stats.win],
    ['Lose', stats.lose],
    ['Push', stats.push],
    ['Pending', stats.pending],
  ]

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-emerald-400/20 bg-pitch-800 p-4">
        <p className="text-sm font-semibold text-emerald-200">ROI แบบง่าย</p>
        <div className="mt-2 flex items-end justify-between">
          <h2 className="text-4xl font-black text-white">{stats.roiPercent}%</h2>
          <p className="pb-1 text-sm text-slate-400">{stats.roiUnits > 0 ? '+' : ''}{stats.roiUnits} units</p>
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
