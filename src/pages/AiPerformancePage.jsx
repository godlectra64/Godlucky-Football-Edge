import { Activity, Filter, RefreshCw, Target, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  buildPerformanceGroups,
  buildTrendDatasets,
  calculatePerformanceMetrics,
  filterPerformanceRows,
  getPerformanceReadiness,
  getPerformanceFilterOptions,
} from '../utils/performanceIntelligence'
import { analyzeModelPerformance, exportPerformanceCsv, exportPerformanceJson } from '../utils/modelPerformanceAnalyzer'
import { formatShortDate, formatUpdatedAt } from '../utils/formatters'
import { calculateDataCoverage } from '../utils/dataPlatform'

const allValue = ''

export default function AiPerformancePage({ rows = [], loading = false, error = '', onRefresh, onOpenMatch }) {
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
  const readiness = useMemo(() => getPerformanceReadiness(filteredRows), [filteredRows])
  const groups = useMemo(() => buildPerformanceGroups(filteredRows), [filteredRows])
  const trends = useMemo(() => buildTrendDatasets(filteredRows), [filteredRows])
  const modelAnalysis = useMemo(() => analyzeModelPerformance(filteredRows), [filteredRows])
  const dataCoverage = useMemo(() => summarizeDataCoverage(filteredRows), [filteredRows])
  const exportPreview = useMemo(() => ({
    jsonBytes: exportPerformanceJson(filteredRows).length,
    csvRows: exportPerformanceCsv(filteredRows).split('\n').length - 1,
  }), [filteredRows])
  const latestRows = filteredRows.slice(0, 50)

  return (
    <main className="app-page-wide theme-performance">
      <section className="premium-hero p-4">
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">AI Performance</p>
            <h2 className="mt-1 text-2xl font-black leading-8 text-white">Performance Intelligence</h2>
            <p className="mt-1 text-sm font-semibold text-slate-300">ติดตามคุณภาพโมเดลจากผลจริง</p>
          </div>
          <button type="button" onClick={onRefresh} className="premium-button premium-focus flex items-center gap-2 px-3 text-sm">
            <RefreshCw size={16} />
            Sync
          </button>
        </div>
        {error ? <p className="relative z-10 mt-3 rounded-2xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
        {loading ? <p className="relative z-10 mt-3 text-sm text-slate-300">Loading performance data...</p> : null}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SummaryCard icon={Trophy} label="Win Rate" value={readiness.hasEnoughData ? `${metrics.winRate}%` : 'ยังไม่มีข้อมูลเพียงพอ'} />
        <SummaryCard icon={Target} label="Accuracy" value={readiness.hasEnoughData ? `${metrics.accuracy}%` : 'กำลังสะสมข้อมูล'} />
        <SummaryCard icon={Activity} label="Total Matches" value={metrics.totalPredictions} />
        <SummaryCard icon={Filter} label="Pending" value={metrics.pending} />
        <SummaryCard label="Avg Confidence" value={filteredRows.length ? `${metrics.averageConfidence}%` : 'กำลังสะสมข้อมูล'} />
        <SummaryCard label="Last Update" value={metrics.lastUpdate ? formatUpdatedAt(metrics.lastUpdate) : '-'} />
      </section>

      <FilterPanel filters={filters} setFilters={setFilters} options={options} />
      {!loading && !error && !readiness.hasEnoughData ? <PerformanceState readiness={readiness} /> : null}
      {readiness.hasEnoughData ? <ModelIntelligenceSection analysis={modelAnalysis} exportPreview={exportPreview} dataCoverage={dataCoverage} /> : null}
      {readiness.hasEnoughData ? <TrendPreview trends={trends} groups={groups} /> : null}
      <LatestTable rows={latestRows} onOpenMatch={onOpenMatch} />
    </main>
  )
}

function PerformanceState({ readiness }) {
  return (
    <section className="premium-card-subtle mt-4 p-5 text-center">
      <p className="text-lg font-bold text-white">{readiness.title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{readiness.message}</p>
    </section>
  )
}

function ModelIntelligenceSection({ analysis, exportPreview, dataCoverage }) {
  const topModules = analysis.moduleEffectiveness.slice(0, 4)
  const confidenceRows = analysis.confidenceCalibration.filter((item) => item.predictions > 0).slice(-3)
  const leagueRows = analysis.leaguePerformance.slice(0, 3)
  const explainability = analysis.modelExplainability ?? {}

  return (
    <section className="premium-card-subtle mt-4 p-4">
      <h3 className="text-lg font-bold text-white">Model Intelligence</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniMetric label="Overall Accuracy" value={`${analysis.overall.accuracy}%`} />
        <MiniMetric label="No Evaluation" value={analysis.overall.noEvaluation} />
        <MiniMetric label="Export JSON" value={`${exportPreview.jsonBytes}b`} />
        <MiniMetric label="Export CSV Rows" value={exportPreview.csvRows} />
        <MiniMetric label="Data Coverage" value={`${dataCoverage.score}%`} />
        <MiniMetric label="Coverage Level" value={dataCoverage.level} />
      </div>
      <ModelExplainabilityPanel explainability={explainability} />
      <CompactList title="Confidence Calibration" items={confidenceRows.map((item) => `${item.range}: ${item.accuracy}% (${item.predictions})`)} />
      <CompactList title="League Comparison" items={leagueRows.map((item) => `${item.league}: ${item.accuracy}% (${item.predictions})`)} />
      <CompactList title="Recommendation Analysis" items={analysis.recommendationPerformance.map((item) => `${item.recommendation}: ${item.accuracy}% (${item.predictions})`)} />
      <CompactList title="Risk Analysis" items={analysis.riskPerformance.map((item) => `${item.riskLevel}: ${item.accuracy}% (${item.predictions})`)} />
      <CompactList title="Module Effectiveness" items={topModules.map((item) => `${item.label}: ${item.effectivenessScore}/100`)} />
      <CompactList title="Calibration Suggestions" items={analysis.calibrationSuggestions.slice(0, 4).map((item) => item.message)} />
    </section>
  )
}

function ModelExplainabilityPanel({ explainability }) {
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-sm font-bold text-white">Model Explainability</p>
      <p className="mt-2 text-xs leading-5 text-slate-300">{explainability.message || 'กำลังสะสมข้อมูล'}</p>
      <CompactList title="Frequent Positive Modules" items={(explainability.positiveModules ?? []).map((item) => item.reason)} />
      <CompactList title="Frequent Negative Modules" items={(explainability.negativeModules ?? []).map((item) => item.reason)} />
      <CompactList title="Overconfident Bins" items={(explainability.overconfidentBins ?? []).map((item) => `${item.range}: accuracy ${item.accuracy}% gap ${item.gap}% (${item.predictions})`)} />
      <CompactList title="Risky Risk Groups" items={(explainability.riskyRiskGroups ?? []).map((item) => `${item.riskLevel}: accuracy ${item.accuracy}% gap ${item.gap}% (${item.predictions})`)} />
    </div>
  )
}

function CompactList({ title, items }) {
  const safeItems = items.length ? items : ['กำลังสะสมข้อมูล']
  return (
    <div className="mt-4">
      <p className="text-sm font-bold text-white">{title}</p>
      <div className="mt-2 space-y-2">
        {safeItems.map((item) => (
          <p key={item} className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-xs leading-5 text-slate-300">{item}</p>
        ))}
      </div>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-400">{label}</p>
        {Icon ? <Icon size={16} className="text-amber-200" /> : null}
      </div>
      <p className="mt-2 break-words text-xl font-black leading-7 text-white lg:text-2xl">{value}</p>
    </div>
  )
}

function FilterPanel({ filters, setFilters, options }) {
  return (
    <section className="premium-card-subtle mt-4 p-4">
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
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#071018] px-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-amber-300/40">
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
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#071018] px-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-amber-300/40" />
    </label>
  )
}

function TrendPreview({ trends, groups }) {
  const versionCount = Object.keys(groups.byVersion).length
  return (
    <section className="premium-card-subtle mt-4 p-4">
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
    <div className="metric-card">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value}</p>
    </div>
  )
}

function LatestTable({ rows, onOpenMatch }) {
  return (
    <section className="premium-card-subtle mt-4 p-4">
      <h3 className="text-lg font-bold text-white">Latest 50</h3>
      <div className="mt-3 space-y-3">
        {!rows.length ? <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center text-sm text-slate-300">กำลังสะสมข้อมูลเพื่อประเมินผลงาน AI</p> : null}
        {rows.map((row) => {
          const matchId = row.match_id ?? row.matchId
          const clickable = Boolean(matchId && onOpenMatch)
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-400">{formatShortDate(row.kickoff)} · {row.league ?? '-'}</p>
                  <p className="mt-1 truncate font-bold text-white">{row.home_team} vs {row.away_team}</p>
                </div>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-bold text-slate-100">{row.recommendation}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Cell label="สถานะ" value={formatEvaluation(row.evaluation?.evaluation_status)} badge={isPending(row.evaluation?.evaluation_status)} />
                <Cell label="ผลแข่ง" value={formatScore(row.result)} badge={formatScore(row.result) === 'รอผล'} />
                <Cell label="โมเดล" value={formatModel(row.analysis_version)} />
              </div>
            </>
          )

          if (clickable) {
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenMatch(matchId)}
                className="block min-h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:border-amber-300/35 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                aria-label={`เปิดรายละเอียด ${row.home_team} vs ${row.away_team}`}
              >
                {content}
              </button>
            )
          }

          return (
            <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              {content}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function Cell({ label, value, badge = false }) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-2">
      <p className="text-slate-400">{label}</p>
      {badge ? (
        <span className="mt-1 inline-flex rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 font-bold text-amber-100">{value}</span>
      ) : (
        <p className="mt-1 truncate font-bold text-white">{value}</p>
      )}
    </div>
  )
}

function formatEvaluation(status) {
  const normalized = String(status ?? 'pending')
  if (normalized === 'pending') return 'รอผล'
  if (normalized === 'correct') return 'ถูกต้อง'
  if (normalized === 'incorrect') return 'ไม่ถูกต้อง'
  if (normalized === 'no_evaluation') return 'ไม่ประเมิน'
  return normalized
}

function isPending(status) {
  return !status || status === 'pending'
}

function formatModel(version) {
  if (!version || version === 'unknown') return 'Football Intelligence'
  if (String(version).startsWith('football-intelligence')) return 'Football Intelligence'
  return version
}

function summarizeDataCoverage(rows = []) {
  if (!rows.length) return { score: 0, level: 'low', reason: 'Data coverage 0% (0/0)' }
  const coverages = rows.map((row) => calculateDataCoverage({
    match: {
      id: row.match_id,
      api_fixture_id: row.fixture_id,
      raw: row.raw ?? row.raw_snapshot ?? {},
    },
    prediction: row,
    result: row.result ?? { status: row.result_status ?? 'pending' },
    evaluation: row.evaluation ?? { evaluation_status: row.evaluation_status ?? 'pending' },
  }))
  const score = Math.round(coverages.reduce((total, item) => total + item.score, 0) / coverages.length)
  return {
    score,
    level: score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low',
    reason: `Average coverage ${score}% from ${rows.length} rows`,
  }
}

function formatScore(result) {
  if (!result || result.home_goals === null || result.home_goals === undefined) return 'รอผล'
  return `${result.home_goals}-${result.away_goals}`
}
