import { Activity, Filter, RefreshCw, Target, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  buildPerformanceGroups,
  buildTrendDatasets,
  calculatePerformanceMetrics,
  filterPerformanceRows,
  getPerformanceFilterOptions,
} from '../utils/performanceIntelligence'
import { formatShortDate, formatUpdatedAt } from '../utils/formatters'

const allValue = ''

export default function AiPerformancePage({ rows = [], loading = false, error = '', onRefresh }) {
  const [filters, setFilters] = useState({
    league: allValue,
    recommendation: allValue,
    version: allValue,
    dateFrom: '',
    dateTo: '',
  })
  const options = useMemo(() => getPerformanceFilterOptions(rows), [rows])
  const filteredRows = useMemo(() => filterPerformanceRows(rows, filters), [rows, filters])
  const metrics = useMemo(() => calculatePerformanceMetrics(filteredRows), [filteredRows])
  const groups = useMemo(() => buildPerformanceGroups(filteredRows), [filteredRows])
  const trends = useMemo(() => buildTrendDatasets(filteredRows), [filteredRows])
  const latestRows = filteredRows.slice(0, 50)

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-emerald-400/20 bg-pitch-800 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-200">AI Performance</p>
            <h2 className="mt-1 text-2xl font-black text-white">Performance Intelligence</h2>
          </div>
          <button type="button" onClick={onRefresh} className="flex min-h-10 items-center gap-2 rounded-lg bg-emerald-400 px-3 text-sm font-bold text-pitch-950">
            <RefreshCw size={16} />
            Sync
          </button>
        </div>
        {error ? <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
        {loading ? <p className="mt-3 text-sm text-slate-300">Loading performance data...</p> : null}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <SummaryCard icon={Trophy} label="Win Rate" value={`${metrics.winRate}%`} />
        <SummaryCard icon={Target} label="Accuracy" value={`${metrics.accuracy}%`} />
        <SummaryCard icon={Activity} label="Total Matches" value={metrics.totalPredictions} />
        <SummaryCard icon={Filter} label="Pending" value={metrics.pending} />
        <SummaryCard label="Avg Confidence" value={`${metrics.averageConfidence}%`} />
        <SummaryCard label="Last Update" value={metrics.lastUpdate ? formatUpdatedAt(metrics.lastUpdate) : '-'} />
      </section>

      <FilterPanel filters={filters} setFilters={setFilters} options={options} />
      <TrendPreview trends={trends} groups={groups} />
      <LatestTable rows={latestRows} />
    </main>
  )
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-800 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">{label}</p>
        {Icon ? <Icon size={16} className="text-emerald-200" /> : null}
      </div>
      <p className="mt-2 break-words text-2xl font-black text-white">{value}</p>
    </div>
  )
}

function FilterPanel({ filters, setFilters, options }) {
  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
      <h3 className="text-lg font-bold text-white">Filters</h3>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <Select label="League" value={filters.league} onChange={(league) => setFilters((current) => ({ ...current, league }))} options={options.leagues} />
        <Select label="Recommendation" value={filters.recommendation} onChange={(recommendation) => setFilters((current) => ({ ...current, recommendation }))} options={options.recommendations} />
        <Select label="Version" value={filters.version} onChange={(version) => setFilters((current) => ({ ...current, version }))} options={options.versions} />
        <div className="grid grid-cols-2 gap-2">
          <DateInput label="From" value={filters.dateFrom} onChange={(dateFrom) => setFilters((current) => ({ ...current, dateFrom }))} />
          <DateInput label="To" value={filters.dateTo} onChange={(dateTo) => setFilters((current) => ({ ...current, dateTo }))} />
        </div>
      </div>
    </section>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-pitch-900 px-3 text-sm font-semibold text-white">
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function DateInput({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-pitch-900 px-3 text-sm font-semibold text-white" />
    </label>
  )
}

function TrendPreview({ trends, groups }) {
  const versionCount = Object.keys(groups.byVersion).length
  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
      <h3 className="text-lg font-bold text-white">Trend Data</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniMetric label="Timeline" value={trends.winRateTimeline.length} />
        <MiniMetric label="Confidence Buckets" value={trends.confidenceDistribution.length} />
        <MiniMetric label="Recommendations" value={trends.recommendationDistribution.length} />
        <MiniMetric label="Versions" value={versionCount} />
      </div>
    </section>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value}</p>
    </div>
  )
}

function LatestTable({ rows }) {
  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
      <h3 className="text-lg font-bold text-white">Latest 50</h3>
      <div className="mt-3 space-y-3">
        {!rows.length ? <p className="rounded-lg bg-white/[0.04] p-4 text-center text-sm text-slate-300">กำลังสะสมข้อมูล</p> : null}
        {rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-white/10 bg-pitch-900 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-400">{formatShortDate(row.kickoff)} · {row.league ?? '-'}</p>
                <p className="mt-1 truncate font-bold text-white">{row.home_team} vs {row.away_team}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold text-slate-100">{row.recommendation}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Cell label="Eval" value={row.evaluation?.evaluation_status ?? 'pending'} />
              <Cell label="Score" value={formatScore(row.result)} />
              <Cell label="Model" value={row.analysis_version ?? 'unknown'} />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function Cell({ label, value }) {
  return (
    <div className="rounded-lg bg-white/[0.04] p-2">
      <p className="text-slate-400">{label}</p>
      <p className="mt-1 truncate font-bold text-white">{value}</p>
    </div>
  )
}

function formatScore(result) {
  if (!result || result.home_goals === null || result.home_goals === undefined) return 'pending'
  return `${result.home_goals}-${result.away_goals}`
}
