import { Activity, Filter, Microscope, RefreshCw, Target, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import ScoreBadge from '../components/ScoreBadge'
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
      <section className="premium-hero ai-hero p-4">
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5">
              <Microscope size={14} />
              ผลงาน AI
            </p>
            <h2 className="mt-1 text-3xl font-black leading-9 text-white">ผลงานย้อนหลังของ AI</h2>
            <p className="mt-1 text-sm font-semibold text-slate-400">ตรวจคุณภาพการประเมิน ความแม่นยำ และผลล่าสุดของระบบ</p>
            <button type="button" onClick={onRefresh} className="mt-4 flex min-h-11 items-center gap-2 rounded-2xl border border-amber-300/45 bg-amber-300/18 px-4 text-sm font-black text-amber-50 shadow-[0_0_30px_rgba(246,196,69,0.18)]">
              <RefreshCw size={16} />
              อัปเดตข้อมูล
            </button>
          </div>
          <div className="ai-orb" aria-hidden="true" />
        </div>
        {error ? <p className="relative z-10 mt-3 rounded-2xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
        {loading ? <p className="relative z-10 mt-3 text-sm font-semibold text-slate-300">กำลังโหลดข้อมูลผลงาน AI...</p> : null}
      </section>

      <section className="mt-3 grid gap-2.5 md:grid-cols-[1.35fr_1fr]">
        <div className="rounded-[22px] border border-amber-300/25 bg-amber-300/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase text-amber-200/80">ความแม่นยำรวม</p>
              <p className="mt-1 text-5xl font-black leading-none text-white">{readiness.hasEnoughData ? `${metrics.accuracy}%` : '--'}</p>
            </div>
            <Trophy size={28} className="text-amber-200" />
          </div>
          <p className="mt-3 text-sm leading-6 text-amber-50/85">{readiness.hasEnoughData ? 'คำนวณจากรายการที่สรุปผลแล้วภายใต้ตัวกรองปัจจุบัน' : readiness.message}</p>
          <div className="progress-bar mt-3">
            <span style={{ width: `${readiness.hasEnoughData ? Math.max(5, metrics.accuracy) : 8}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <SummaryCard icon={Target} label="อัตราเข้าเป้า" value={readiness.hasEnoughData ? `${metrics.winRate}%` : '--'} />
          <SummaryCard icon={Activity} label="จำนวนคู่ทั้งหมด" value={metrics.totalPredictions} />
          <SummaryCard icon={Filter} label="รอผลการแข่งขัน" value={metrics.pending} />
          <SummaryCard label="ความมั่นใจเฉลี่ย" value={filteredRows.length ? `${metrics.averageConfidence}%` : '--'} />
        </div>
      </section>

      {!loading && !error && !readiness.hasEnoughData ? <PerformanceState readiness={readiness} /> : null}
      {readiness.hasEnoughData ? <ModelIntelligenceSection analysis={modelAnalysis} exportPreview={exportPreview} dataCoverage={dataCoverage} /> : null}
      {readiness.hasEnoughData ? <TrendPreview trends={trends} groups={groups} /> : null}
      <LatestTable rows={latestRows} onOpenMatch={onOpenMatch} lastUpdate={metrics.lastUpdate} />
      <FilterPanel filters={filters} setFilters={setFilters} options={options} />
    </main>
  )
}

function PerformanceState({ readiness }) {
  return (
    <section className="empty-state mt-3">
      <Microscope size={28} className="mx-auto text-[var(--page-accent)]" />
      <p className="mt-3 text-lg font-black text-white">{readiness.title}</p>
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
    <section className="mt-3 rounded-[22px] border border-white/10 bg-white/[0.035] p-3.5">
      <h3 className="section-title">แผงวิเคราะห์ผลงาน</h3>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniMetric label="ความแม่นยำรวม" value={`${analysis.overall.accuracy}%`} />
        <MiniMetric label="ข้อมูลครบ" value={`${dataCoverage.score}%`} />
        <MiniMetric label="ระดับข้อมูล" value={formatCoverageLevel(dataCoverage.level)} />
      </div>
      <ModelExplainabilityPanel explainability={explainability} />
      <CompactList title="เทียบความมั่นใจ" items={confidenceRows.map((item) => `${item.range}: ${item.accuracy}% (${item.predictions})`)} />
      <CompactList title="เทียบตามลีก" items={leagueRows.map((item) => `${item.league}: ${item.accuracy}% (${item.predictions})`)} />
      <CompactList title="แยกตามสัญญาณ" items={analysis.recommendationPerformance.map((item) => `${item.recommendation}: ${item.accuracy}% (${item.predictions})`)} />
      <CompactList title="แยกตามความเสี่ยง" items={analysis.riskPerformance.map((item) => `${item.riskLevel}: ${item.accuracy}% (${item.predictions})`)} />
      <CompactList title="ประสิทธิภาพโมดูล" items={topModules.map((item) => `${item.label}: ${item.effectivenessScore}/100`)} />
      <CompactList title="ข้อเสนอแนะการปรับเทียบ" items={analysis.calibrationSuggestions.slice(0, 4).map((item) => item.message)} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniMetric label="ไฟล์ JSON" value={`${exportPreview.jsonBytes}b`} />
        <MiniMetric label="แถว CSV" value={exportPreview.csvRows} />
      </div>
    </section>
  )
}

function ModelExplainabilityPanel({ explainability }) {
  return (
    <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3">
      <p className="text-sm font-black text-white">คำอธิบายโมเดล</p>
      <p className="mt-2 text-xs leading-5 text-slate-300">{explainability.message || 'กำลังเก็บข้อมูลผลงาน'}</p>
      <CompactList title="โมดูลที่ช่วยผลลัพธ์บ่อย" items={(explainability.positiveModules ?? []).map((item) => item.reason)} />
      <CompactList title="โมดูลที่ฉุดผลลัพธ์บ่อย" items={(explainability.negativeModules ?? []).map((item) => item.reason)} />
      <CompactList title="ช่วงความมั่นใจสูงเกินจริง" items={(explainability.overconfidentBins ?? []).map((item) => `${item.range}: ความแม่นยำ ${item.accuracy}% ช่องว่าง ${item.gap}% (${item.predictions})`)} />
      <CompactList title="กลุ่มความเสี่ยงที่ต้องระวัง" items={(explainability.riskyRiskGroups ?? []).map((item) => `${item.riskLevel}: ความแม่นยำ ${item.accuracy}% ช่องว่าง ${item.gap}% (${item.predictions})`)} />
    </div>
  )
}

function CompactList({ title, items }) {
  const safeItems = items.length ? items : ['กำลังเก็บข้อมูล']
  return (
    <div className="mt-3">
      <p className="text-sm font-black text-white">{title}</p>
      <div className="mt-2 grid gap-1.5">
        {safeItems.map((item) => (
          <p key={item} className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-xs leading-5 text-slate-300">{item}</p>
        ))}
      </div>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="metric-display">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
        {Icon ? <Icon size={15} className="text-amber-200" /> : null}
      </div>
      <p className="mt-2 break-words text-xl font-black leading-6 text-white">{value}</p>
    </div>
  )
}

function FilterPanel({ filters, setFilters, options }) {
  return (
    <section className="mt-3 rounded-[22px] border border-white/10 bg-white/[0.025] p-3.5">
      <h3 className="flex items-center gap-2 text-sm font-black text-slate-300">
        <Filter size={16} />
        ตัวกรองผลงาน
      </h3>
      <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <Select label="ลีก" value={filters.league} onChange={(league) => setFilters((current) => ({ ...current, league }))} options={options.leagues} />
        <Select label="สัญญาณ" value={filters.recommendation} onChange={(recommendation) => setFilters((current) => ({ ...current, recommendation }))} options={options.recommendations} />
        <Select label="เวอร์ชัน" value={filters.version} onChange={(version) => setFilters((current) => ({ ...current, version }))} options={options.versions} />
        <DateInput label="ตั้งแต่วันที่" value={filters.dateFrom} onChange={(dateFrom) => setFilters((current) => ({ ...current, dateFrom }))} />
        <DateInput label="ถึงวันที่" value={filters.dateTo} onChange={(dateTo) => setFilters((current) => ({ ...current, dateTo }))} />
      </div>
    </section>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-white/10 bg-[#071019] px-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-amber-300/40">
        <option value="">ทั้งหมด</option>
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
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-white/10 bg-[#071019] px-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-amber-300/40" />
    </label>
  )
}

function TrendPreview({ trends, groups }) {
  const versionCount = Object.keys(groups.byVersion).length
  const totalTrend = Math.max(1, trends.recommendationDistribution.reduce((total, item) => total + item.value, 0))
  return (
    <section className="mt-3 rounded-[22px] border border-white/10 bg-white/[0.035] p-3.5">
      <h3 className="section-title">แนวโน้มผลงาน</h3>
      <div className="distribution-bar mt-3">
        {trends.recommendationDistribution.map((item) => (
          <span key={item.label} className={distributionClass(item.label)} style={{ width: `${Math.max(item.value ? 5 : 0, (item.value / totalTrend) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <MiniMetric label="ไทม์ไลน์" value={trends.winRateTimeline.length} />
        <MiniMetric label="ช่วงคะแนน" value={trends.confidenceDistribution.length} />
        <MiniMetric label="สัญญาณ" value={trends.recommendationDistribution.length} />
        <MiniMetric label="เวอร์ชัน" value={versionCount} />
      </div>
    </section>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="metric-display p-2.5">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
    </div>
  )
}

function LatestTable({ rows, onOpenMatch, lastUpdate }) {
  return (
    <section className="mt-3 rounded-[22px] border border-white/10 bg-white/[0.035] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="section-title">ผลล่าสุด</h3>
        <p className="text-[11px] font-semibold text-slate-500">{lastUpdate ? formatUpdatedAt(lastUpdate) : 'ยังไม่มีอัปเดต'}</p>
      </div>
      <div className="mt-3 grid gap-2">
        {!rows.length ? <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center text-sm text-slate-300">ยังไม่มีผลย้อนหลัง</p> : null}
        {rows.map((row) => {
          const matchId = row.match_id ?? row.matchId
          const clickable = Boolean(matchId && onOpenMatch)
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-500">{formatShortDate(row.kickoff)} · {row.league ?? '-'}</p>
                  <p className="mt-1 truncate font-black text-white">{row.home_team} vs {row.away_team}</p>
                </div>
                <ScoreBadge recommendation={row.recommendation} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Cell label="สถานะการสรุปผล" value={formatEvaluation(row.evaluation?.evaluation_status)} badge={isPending(row.evaluation?.evaluation_status)} />
                <Cell label="ผลจำลอง" value={formatScore(row.result)} badge={formatScore(row.result) === 'PENDING · รอผล'} />
                <Cell label="โมเดล" value={formatModel(row.analysis_version)} />
              </div>
            </>
          )

          if (clickable) {
            return (
              <button key={row.id} type="button" onClick={() => onOpenMatch(matchId)} className="block min-h-11 w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-amber-300/35 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-amber-300/40">
                {content}
              </button>
            )
          }

          return <article key={row.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">{content}</article>
        })}
      </div>
    </section>
  )
}

function Cell({ label, value, badge = false }) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-2">
      <p className="text-slate-500">{label}</p>
      {badge ? <span className="mt-1 inline-flex rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 font-bold text-amber-100">{value}</span> : <p className="mt-1 truncate font-bold text-white">{value}</p>}
    </div>
  )
}

function formatEvaluation(status) {
  const normalized = String(status ?? 'pending')
  if (normalized === 'pending') return 'PENDING · รอผล'
  if (normalized === 'correct') return 'HIT · เข้าเป้า'
  if (normalized === 'incorrect') return 'MISS · ไม่เข้าเป้า'
  if (normalized === 'no_evaluation') return 'VOID · ไม่นับผล'
  return normalized
}

function isPending(status) {
  return !status || status === 'pending'
}

function formatModel(version) {
  if (!version || version === 'unknown') return 'Football Intel'
  if (String(version).startsWith('football-intelligence')) return 'Football Intel'
  return version
}

function distributionClass(label) {
  if (label === 'BET') return 'bg-emerald-400'
  if (label === 'LEAN') return 'bg-amber-400'
  return 'bg-rose-400'
}

function formatCoverageLevel(level) {
  if (level === 'high') return 'สูง'
  if (level === 'medium') return 'กลาง'
  return 'ต่ำ'
}

function summarizeDataCoverage(rows = []) {
  if (!rows.length) return { score: 0, level: 'low', reason: 'ความครบถ้วนข้อมูล 0% (0/0)' }
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
    reason: `ข้อมูลครบถ้วนเฉลี่ย ${score}% จาก ${rows.length} รายการ`,
  }
}

function formatScore(result) {
  if (!result || result.home_goals === null || result.home_goals === undefined) return 'PENDING · รอผล'
  return `${result.home_goals}-${result.away_goals}`
}
