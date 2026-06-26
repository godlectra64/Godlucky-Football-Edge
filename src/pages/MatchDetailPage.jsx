import { ArrowLeft, CalendarClock, ChevronLeft, Gauge, ListChecks, ShieldAlert, Sparkles, Star, TrendingUp } from 'lucide-react'
import RiskBadge from '../components/RiskBadge'
import ScoreBadge from '../components/ScoreBadge'
import {
  buildAiVerdict,
  buildRiskFactors,
  getRiskLabel,
  normalizeDetailPayload,
  splitSummary,
} from '../utils/matchDetail'
import { formatKickoffTime, formatScore, formatUpdatedAt } from '../utils/formatters'
import { calculateDataCoverage, normalizeDataPlatform } from '../utils/dataPlatform'
import { buildExplainableAi } from '../utils/explainableAi'
import { normalizeMarketIntelligence } from '../utils/marketIntelligence'

const recommendationTone = {
  BET: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100',
  LEAN: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  'NO BET': 'border-slate-300/20 bg-slate-300/10 text-slate-100',
}

export default function MatchDetailPage({ match, loading = false, error = '', performanceContext = 'กำลังสะสมข้อมูล', onBack, onGoToday }) {
  if (loading) {
    return (
      <main className="mx-auto max-w-[430px] px-4 py-4">
        <BackButton onBack={onBack} />
        <StatePanel title="กำลังโหลดรายละเอียด" message="กำลังอ่านข้อมูลการแข่งขันและผลวิเคราะห์ล่าสุด" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="mx-auto max-w-[430px] px-4 py-4">
        <BackButton onBack={onBack} />
        <StatePanel title="โหลดรายละเอียดไม่สำเร็จ" message={error} tone="error" />
      </main>
    )
  }

  if (!match) {
    return (
      <main className="mx-auto max-w-[430px] px-4 py-6">
        <StatePanel title="ยังไม่ได้เลือกคู่สำหรับวิเคราะห์" message="กลับไปหน้า Today แล้วเลือกคู่ที่ต้องการดูรายละเอียด">
          <button type="button" onClick={onGoToday} className="mt-4 min-h-12 rounded-lg bg-emerald-400 px-5 font-bold text-pitch-950">
            ไปหน้า Today
          </button>
        </StatePanel>
      </main>
    )
  }

  const detail = normalizeDetailPayload(match)
  const verdict = buildAiVerdict(detail)
  const riskFactors = buildRiskFactors(detail)
  const riskLabel = getRiskLabel(detail.riskLevel)
  const predictionReliability = arguments[0]?.predictionReliability ?? null
  const platform = normalizeDataPlatform({ match: detail, analysis: detail.analysis })
  const explainability = buildExplainableAi(platform)
  const dataCoverage = calculateDataCoverage(platform)
  const marketIntelligence = normalizeMarketIntelligence(detail)

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <BackButton onBack={onBack} />
      <HeroHeader detail={detail} />
      <AiVerdictSection detail={detail} verdict={verdict} />
      <ScoreBreakdownSection items={detail.moduleItems} />
      <ExplainableAiSection explanation={explainability} />
      <FootballIntelligenceSection intelligence={detail.footballIntelligence} />
      <FootballDataIntelligenceSection items={detail.dataIntelligenceItems} />
      <AiPerformanceContextSection performanceContext={performanceContext} />
      <PredictionReliabilitySection reliability={predictionReliability} />
      <RiskAnalysisSection detail={detail} riskLabel={riskLabel} riskFactors={riskFactors} />
      <RankingSection detail={detail} />
      <DataQualitySection dataQuality={detail.dataQuality} />
      <DataPlatformCoverageSection coverage={dataCoverage} />
      <MarketIntelligenceSection market={marketIntelligence} />
      <SummarySection detail={detail} />
    </main>
  )
}

function BackButton({ onBack }) {
  return (
    <button type="button" onClick={onBack} className="sticky top-2 z-10 mb-3 flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-pitch-900/95 px-3 font-semibold text-slate-200 backdrop-blur">
      <ArrowLeft size={20} />
      กลับ
    </button>
  )
}

function HeroHeader({ detail }) {
  return (
    <section className={`rounded-lg border p-4 shadow-glow ${recommendationTone[detail.recommendation] ?? recommendationTone['NO BET']}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <CalendarClock size={16} />
            {detail.league?.name ?? 'ไม่ระบุลีก'} · {formatKickoffTime(detail.kickoffAt)}
          </p>
          <TeamName team={detail.homeTeam} />
          <p className="my-2 text-sm font-semibold text-slate-400">พบกับ</p>
          <TeamName team={detail.awayTeam} />
        </div>
        <ScoreBadge recommendation={detail.recommendation} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Confidence" value={`${detail.confidence}%`} />
        <Metric label="Risk" value={<RiskBadge level={detail.riskLevel} />} />
        <Metric label="Ranking Score" value={`${detail.rankingScore}/100`} />
        <Metric label="Status" value={detail.status ?? '-'} />
        <Metric label="ผลล่าสุด" value={formatScore(detail.homeGoals, detail.awayGoals)} />
        <Metric label="อัปเดต" value={formatUpdatedAt(detail.updatedAt)} />
      </div>
    </section>
  )
}

function AiVerdictSection({ detail, verdict }) {
  return (
    <Section title="คำตัดสินของ AI" icon={Sparkles}>
      <div className="flex items-center justify-between gap-3">
        <ScoreBadge recommendation={verdict.verdict} />
        <p className="text-sm font-semibold text-slate-300">{detail.confidence}% confidence</p>
      </div>
      <BulletList title="เหตุผลหลัก" items={verdict.reasons} />
      <BulletList title="ข้อควรระวัง" items={verdict.cautions} tone="warning" />
      <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{verdict.playable}</p>
    </Section>
  )
}

function ScoreBreakdownSection({ items }) {
  return (
    <Section title="Score Breakdown" icon={Gauge}>
      <div className="space-y-3">
        {items.map((item) => (
          <ScoreRow key={item.key} item={item} />
        ))}
      </div>
    </Section>
  )
}

function ExplainableAiSection({ explanation }) {
  return (
    <Section title="AI คิดคะแนนอย่างไร" icon={Sparkles}>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Base Confidence" value={`${explanation.baseConfidence}%`} />
        <Metric label="Final Confidence" value={`${explanation.finalConfidence}%`} />
        <Metric label="Risk Impact" value={formatContribution(explanation.riskImpact?.value)} />
        <Metric label="Data Confidence" value={formatContribution(explanation.dataConfidenceImpact?.value)} />
      </div>
      <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{explanation.summary}</p>
      <ContributionList title="Positive Factors" items={explanation.positive} tone="positive" />
      <ContributionList title="Negative Factors" items={explanation.negative} tone="negative" />
      <ContributionList title="Neutral Factors" items={explanation.neutral} />
    </Section>
  )
}

function FootballIntelligenceSection({ intelligence }) {
  const cards = [
    { title: 'H2H', score: intelligence.h2h?.score, meta: `confidence: ${intelligence.h2h?.confidence ?? 'low'}`, reason: intelligence.h2h?.reason, signals: intelligence.h2h?.signals },
    { title: 'League Context', score: intelligence.league_context?.score, meta: `${intelligence.league_context?.type ?? 'unknown'} · risk ${formatSigned(intelligence.league_context?.risk_modifier)}`, reason: intelligence.league_context?.reason },
    { title: 'Rest Days', score: intelligence.rest_days?.score, meta: `${formatDays(intelligence.rest_days?.home_rest_days)} vs ${formatDays(intelligence.rest_days?.away_rest_days)} · ${intelligence.rest_days?.advantage ?? 'none'}`, reason: intelligence.rest_days?.reason },
    { title: 'Schedule Difficulty', score: intelligence.schedule_difficulty?.score, meta: `${intelligence.schedule_difficulty?.difficulty ?? 'unknown'} · ${intelligence.schedule_difficulty?.confidence ?? 'low'}`, reason: intelligence.schedule_difficulty?.reason },
    { title: 'Squad Context', score: intelligence.squad_context?.score, meta: `confidence: ${intelligence.squad_context?.confidence ?? 'low'}`, reason: intelligence.squad_context?.reason, signals: intelligence.squad_context?.signals },
    { title: 'Momentum', score: intelligence.momentum?.score, meta: intelligence.momentum?.momentum ?? 'unknown', reason: intelligence.momentum?.reason, signals: intelligence.momentum?.signals },
    { title: 'Match Importance', score: intelligence.match_importance?.score, meta: `${intelligence.match_importance?.importance ?? 'unknown'} · risk ${formatSigned(intelligence.match_importance?.risk_modifier)}`, reason: intelligence.match_importance?.reason },
  ]

  return (
    <Section title="Football Intelligence v3" icon={TrendingUp}>
      <div className="space-y-3">
        {cards.map((card) => (
          <IntelligenceCard key={card.title} card={card} />
        ))}
      </div>
    </Section>
  )
}

function FootballDataIntelligenceSection({ items }) {
  return (
    <Section title="Football Data Intelligence" icon={ListChecks}>
      <div className="space-y-3">
        {(items ?? []).map((item) => (
          <DataIntelligenceCard key={item.key} item={item} />
        ))}
      </div>
    </Section>
  )
}

function AiPerformanceContextSection({ performanceContext }) {
  return (
    <Section title="AI Performance Context" icon={Star}>
      <p className="rounded-lg border border-white/10 bg-pitch-900 p-3 text-sm leading-6 text-slate-200">
        {performanceContext || 'กำลังสะสมข้อมูล'}
      </p>
    </Section>
  )
}

function PredictionReliabilitySection({ reliability }) {
  const data = reliability ?? {}
  return (
    <Section title="Prediction Reliability" icon={Gauge}>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Confidence Calibration" value={`${Math.round(data.confidenceCalibration ?? 0)}%`} />
        <Metric label="Historical Accuracy" value={`${Math.round(data.historicalAccuracy ?? 0)}%`} />
        <Metric label="League Accuracy" value={`${Math.round(data.leagueAccuracy ?? 0)}%`} />
        <Metric label="Data Confidence" value={`${Math.round(data.dataConfidence ?? 0)}%`} />
      </div>
      <p className="mt-3 rounded-lg border border-white/10 bg-pitch-900 p-3 text-sm leading-6 text-slate-200">
        {data.label || 'กำลังสะสมข้อมูล'}
      </p>
    </Section>
  )
}

function RiskAnalysisSection({ detail, riskLabel, riskFactors }) {
  return (
    <Section title="Risk Analysis" icon={ShieldAlert}>
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-pitch-900 p-3">
        <p className="text-sm text-slate-400">Risk Level</p>
        <div className="flex items-center gap-2">
          <RiskBadge level={detail.riskLevel} />
          <span className="text-sm font-bold text-white">{riskLabel.label}</span>
        </div>
      </div>
      <BulletList title="ปัจจัยเสี่ยง" items={riskFactors} tone={detail.riskLevel === 'high' ? 'danger' : 'warning'} />
      {detail.riskLevel === 'high' ? (
        <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm leading-6 text-red-100">
          ระบบจัดเป็นความเสี่ยงสูง จึงควรรอข้อมูลตลาด, lineup และความพร้อมทีมก่อนตัดสินใจ
        </p>
      ) : null}
    </Section>
  )
}

function RankingSection({ detail }) {
  return (
    <Section title="Ranking Explanation" icon={Star}>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Rank" value={detail.rank ? `#${detail.rank}` : '-'} />
        <Metric label="Ranking Score" value={`${detail.rankingScore}/100`} />
        <Metric label="Data Quality" value={`${detail.dataQuality.score}%`} />
        <Metric label="Badges" value={`${detail.rankBadges.length} รายการ`} />
      </div>
      <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{detail.rankReason}</p>
      {detail.rankBadges.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {detail.rankBadges.map((badge) => (
            <span key={badge} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-slate-200">{badge}</span>
          ))}
        </div>
      ) : null}
    </Section>
  )
}

function DataQualitySection({ dataQuality }) {
  return (
    <Section title="คุณภาพข้อมูล" icon={ListChecks}>
      <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">ความครบถ้วน</span>
          <span className="font-bold text-white">{dataQuality.score}%</span>
        </div>
        <ProgressBar value={dataQuality.score} tone={dataQuality.score >= 70 ? 'good' : dataQuality.score >= 45 ? 'medium' : 'risk'} />
      </div>
      <QualityList title="ข้อมูลที่มี" items={dataQuality.available} />
      <QualityList title="ข้อมูลที่ยังไม่มี" items={dataQuality.missing} muted />
    </Section>
  )
}

function DataPlatformCoverageSection({ coverage }) {
  return (
    <Section title="Data Coverage" icon={ListChecks}>
      <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Coverage Level</span>
          <span className="font-bold text-white">{coverage.level} · {coverage.score}%</span>
        </div>
        <ProgressBar value={coverage.score} tone={coverage.score >= 75 ? 'good' : coverage.score >= 45 ? 'medium' : 'risk'} />
      </div>
      <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{coverage.reason}</p>
      <QualityList title="Available" items={coverage.available} />
      <QualityList title="Missing" items={coverage.missing} muted />
    </Section>
  )
}

function MarketIntelligenceSection({ market }) {
  return (
    <Section title="Market Intelligence" icon={TrendingUp}>
      <p className="rounded-lg border border-white/10 bg-pitch-900 p-3 text-sm leading-6 text-slate-200">{market.reason}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Asian Handicap" value={formatMarketValue(market.asian_handicap)} />
        <Metric label="Over/Under" value={formatMarketValue(market.over_under)} />
        <Metric label="1X2" value={formatMarketValue(market.one_x_two)} />
        <Metric label="Value Rating" value={formatMarketValue(market.value_rating)} />
      </div>
    </Section>
  )
}

function SummarySection({ detail }) {
  const paragraphs = [
    ...splitSummary(detail.analysisSummary),
    detail.footballIntelligence?.ai_explanation?.summary,
  ].filter(Boolean)

  return (
    <Section title="AI Summary Full" icon={ChevronLeft}>
      <div className="space-y-3">
        {paragraphs.map((paragraph, index) => (
          <p key={`${paragraph}-${index}`} className="text-sm leading-6 text-slate-300">{paragraph}</p>
        ))}
      </div>
    </Section>
  )
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
      <h3 className="flex items-center gap-2 text-lg font-bold text-white">
        <Icon size={20} />
        {title}
      </h3>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function ScoreRow({ item }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-white">{item.label}</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">{item.reason || 'ข้อมูลจำกัด'}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${toneClass(item.tone)}`}>{item.score}/100</span>
      </div>
      <ProgressBar value={item.score} tone={item.tone} />
      <p className="mt-2 text-xs font-semibold text-slate-400">ระดับ: {item.scoreLabel}</p>
    </div>
  )
}

function IntelligenceCard({ card }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-white">{card.title}</p>
          <p className="mt-1 text-xs font-semibold text-slate-400">{card.meta || 'ข้อมูลจำกัด'}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-bold text-white">{Math.round(card.score ?? 0)}/100</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{card.reason || 'ข้อมูลจำกัด'}</p>
      {card.signals?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.signals.slice(0, 4).map((signal) => (
            <span key={signal} className="rounded-full bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-slate-300">{signal}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DataIntelligenceCard({ item }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-white">{item.label}</p>
          <p className="mt-1 text-xs font-semibold text-slate-400">confidence: {item.confidence ?? 'low'}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${toneClass(item.tone)}`}>{Math.round(item.score ?? 0)}/100</span>
      </div>
      <ProgressBar value={item.score} tone={item.tone} />
      <p className="mt-2 text-sm leading-6 text-slate-300">{item.reason || 'ข้อมูลจำกัด'}</p>
      {item.key === 'data_confidence' ? (
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <QualityInline title="Available" items={item.available} />
          <QualityInline title="Missing" items={item.missing} muted />
        </div>
      ) : null}
    </div>
  )
}

function BulletList({ title, items, tone = 'default' }) {
  const safeItems = items?.length ? items : ['ข้อมูลจำกัด']
  return (
    <div className="mt-3">
      <p className="text-sm font-bold text-white">{title}</p>
      <ul className="mt-2 space-y-2">
        {safeItems.map((item) => (
          <li key={item} className={`rounded-lg border px-3 py-2 text-sm leading-6 ${bulletTone(tone)}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function ContributionList({ title, items, tone = 'neutral' }) {
  const safeItems = items?.length ? items : [{ key: `${title}-empty`, label: 'ข้อมูลจำกัด', value: 0, reason: 'กำลังสะสมข้อมูล' }]
  return (
    <div className="mt-3">
      <p className="text-sm font-bold text-white">{title}</p>
      <div className="mt-2 space-y-2">
        {safeItems.map((item) => (
          <div key={item.key} className={`rounded-lg border px-3 py-2 text-sm leading-6 ${contributionTone(tone === 'neutral' ? item.type : tone)}`}>
            <div className="flex items-start justify-between gap-3">
              <span className="font-bold">{item.label}</span>
              <span className="shrink-0 font-black">{formatContribution(item.value)}</span>
            </div>
            <p className="mt-1 text-xs leading-5 opacity-90">{item.reason}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function QualityList({ title, items, muted = false }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-bold text-white">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(items.length ? items : ['ไม่มี']).map((item) => (
          <span key={item} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${muted ? 'border-slate-500/20 bg-slate-500/10 text-slate-300' : 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'}`}>{item}</span>
        ))}
      </div>
    </div>
  )
}

function QualityInline({ title, items = [], muted = false }) {
  const safeItems = items.length ? items : ['ข้อมูลจำกัด']
  return (
    <div className={`rounded-lg border p-2 ${muted ? 'border-slate-500/20 bg-slate-500/10' : 'border-emerald-300/20 bg-emerald-300/10'}`}>
      <p className="font-bold text-white">{title}</p>
      <p className="mt-1 leading-5 text-slate-300">{safeItems.slice(0, 4).join(', ')}</p>
    </div>
  )
}

function ProgressBar({ value, tone }) {
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${barTone(tone)}`} style={{ width: `${Math.max(4, Math.min(100, value ?? 0))}%` }} />
    </div>
  )
}

function TeamName({ team }) {
  return (
    <div className="mt-2 flex min-w-0 items-center gap-3">
      {team?.logo ? <img src={team.logo} alt="" className="h-10 w-10 rounded-full bg-white/10 object-contain p-1" /> : <div className="h-10 w-10 rounded-full bg-white/10" />}
      <h2 className="truncate text-xl font-black text-white">{team?.name ?? 'ไม่ระบุทีม'}</h2>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <div className="mt-1 text-sm font-bold text-white">{value || '-'}</div>
    </div>
  )
}

function StatePanel({ title, message, tone = 'default', children }) {
  return (
    <div className={`rounded-lg border p-6 text-center ${tone === 'error' ? 'border-red-400/30 bg-red-400/10' : 'border-white/10 bg-pitch-800'}`}>
      <p className="text-lg font-bold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{message}</p>
      {children}
    </div>
  )
}

function toneClass(tone) {
  if (tone === 'good') return 'bg-emerald-300/15 text-emerald-100'
  if (tone === 'risk') return 'bg-red-300/15 text-red-100'
  return 'bg-amber-300/15 text-amber-100'
}

function barTone(tone) {
  if (tone === 'good') return 'bg-emerald-400'
  if (tone === 'risk') return 'bg-red-400'
  return 'bg-amber-300'
}

function bulletTone(tone) {
  if (tone === 'danger') return 'border-red-400/25 bg-red-400/10 text-red-100'
  if (tone === 'warning') return 'border-amber-300/25 bg-amber-300/10 text-amber-100'
  return 'border-white/10 bg-white/[0.04] text-slate-200'
}

function contributionTone(tone) {
  if (tone === 'positive') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
  if (tone === 'negative') return 'border-red-400/25 bg-red-400/10 text-red-100'
  return 'border-white/10 bg-white/[0.04] text-slate-200'
}

function formatDays(value) {
  return value === null || value === undefined ? 'ไม่ทราบ' : `${value} วัน`
}

function formatSigned(value) {
  const numeric = Number(value ?? 0)
  return `${numeric >= 0 ? '+' : ''}${numeric}`
}

function formatContribution(value) {
  const numeric = Number(value ?? 0)
  return `${numeric >= 0 ? '+' : ''}${Math.round(numeric * 10) / 10}`
}

function formatMarketValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
