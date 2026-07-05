import { ArrowRight, Clock, Medal } from 'lucide-react'
import { getAnalysisSummary, getConfidence, getRecommendation, getRiskLevel, isWaitingForMarketData } from '../utils/analysisEngine'
import { generateAiFinalPick } from '../utils/aiFinalPickEngine'
import { buildAiFinalPick } from '../utils/finalPick'
import { formatKickoffTime } from '../utils/formatters'
import { derivePickTeamFromApiFootballOdds, getApiFootballMarketDisplay } from '../utils/marketDisplay'
import { getMatchStatusInfo, getScoreDisplay } from '../utils/matchStatus'
import { normalizeProfessionalResultFromAnalysis } from '../utils/professionalSelectionPipeline'
import MarketDirectionBadge from './MarketDirectionBadge'
import RiskBadge from './RiskBadge'
import ScoreBadge from './ScoreBadge'

export default function MatchCard({
  match,
  onOpen,
  isFinished: providedIsFinished = null,
  isPlayable: providedIsPlayable = null,
  isWaitingMarketData: providedIsWaitingMarketData = null,
  displayMode = '',
}) {
  const matchStatus = getMatchStatusInfo(match)
  const isFinished = providedIsFinished ?? matchStatus.isFinished
  const isPlayable = providedIsPlayable ?? matchStatus.isPlayable
  const recommendation = match.recommendation ?? getRecommendation(match)
  const confidence = Math.round(match.confidence ?? getConfidence(match))
  const riskLevel = match.riskLevel ?? getRiskLevel(match)
  const finalRank = match.finalRank ?? match.final_rank ?? match.analysis?.final_rank ?? match.rank
  const finalPick = buildAiFinalPick(match)
  const aiPick = match.aiFinalPick ?? generateAiFinalPick(match)
  const marketDisplay = getApiFootballMarketDisplay(match, aiPick)
  const apiPick = derivePickTeamFromApiFootballOdds(match)
  const pickSummary = apiPick.pickSummary
  const waitingMarket = providedIsWaitingMarketData ?? (!isFinished && isWaitingForMarketData(match))
  const mode = displayMode || (waitingMarket ? 'waiting' : recommendation === 'BET' ? 'strong' : 'watch')
  const professional = normalizeProfessionalResultFromAnalysis({ ...match, recommendation })
  const analysisSummary = buildCardSummary(match, recommendation, confidence, waitingMarket)
  const reasons = buildReasonList(match, finalPick, analysisSummary, waitingMarket || !marketDisplay.hasApiFootballMarket, marketDisplay, professional)
  const cardClass = buildCardClass(finalRank ?? match.rank, mode, riskLevel)
  const open = () => onOpen?.(match.id)
  const scoreDisplay = getFinishedScoreDisplay(match)

  return (
    <article
      onClick={open}
      className={`premium-focus cursor-pointer p-3 transition duration-200 active:translate-y-[1px] ${cardClass}`}
      aria-label={`${match.homeTeam?.name ?? 'home team'} vs ${match.awayTeam?.name ?? 'away team'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-slate-400">
            <Clock size={12} className="shrink-0 text-[var(--page-accent)]" />
            <span className="shrink-0">{formatKickoffTime(match.kickoffAt)}</span>
            <span className="text-slate-600">·</span>
            <span className="truncate">{match.league?.name ?? 'ไม่ทราบลีก'}</span>
          </p>
        </div>
        {isFinished ? (
          <span className="semantic-badge shrink-0 border-emerald-300/30 bg-emerald-300/10 text-emerald-100">แข่งจบแล้ว</span>
        ) : !isPlayable ? (
          <span className="semantic-badge shrink-0 border-slate-300/20 bg-slate-300/10 text-slate-200">{matchStatus.label}</span>
        ) : null}
        <span className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-xl border bg-black/25 px-2 text-sm font-black text-[var(--page-accent)] ${finalRank === 1 ? 'border-amber-300/45 shadow-[0_0_20px_rgba(246,196,69,0.18)]' : 'border-white/10'}`}>
          {finalRank ? `#${finalRank}` : <Medal size={17} />}
        </span>
      </div>

      <div className="mt-2.5 rounded-xl border border-white/10 bg-black/18 p-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_42px_minmax(0,1fr)] items-center gap-2">
          <TeamName name={match.homeTeam?.name ?? 'ไม่ทราบทีม'} active={finalPick.pickSide === 'HOME'} />
          <span className="text-center text-xs font-black uppercase text-slate-500">{isFinished && scoreDisplay ? scoreDisplay : 'vs'}</span>
          <TeamName name={match.awayTeam?.name ?? 'ไม่ทราบทีม'} active={finalPick.pickSide === 'AWAY'} align="right" />
        </div>
      </div>

      <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5">
        <ScoreBadge recommendation={recommendation} mode={mode} />
        <RiskBadge level={riskLevel} />
        {marketDisplay.hasApiFootballMarket ? <MarketDirectionBadge signal={waitingMarket ? 'SKIP' : aiPick.signal} compact /> : null}
        <span className="semantic-badge border-white/10 bg-white/[0.04] text-white">AI Score {confidence}%</span>
        {buildProfessionalBadges(professional).map((badge) => (
          <span key={badge} className="semantic-badge border-emerald-300/25 bg-emerald-300/10 text-emerald-50">{badge}</span>
        ))}
      </div>

      <ProfessionalMetrics professional={professional} confidence={confidence} riskLevel={riskLevel} />
      <SystemPickSummaryBox summary={pickSummary} confidence={confidence} hasMarket={marketDisplay.hasApiFootballMarket} />

      {reasons.length ? (
        <div className="mt-2 grid gap-1.5">
          {reasons.slice(0, 3).map((reason) => (
            <p key={reason} className="text-clamp-2 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-1.5 text-xs font-semibold leading-5 text-slate-300">
              {reason}
            </p>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          open()
        }}
        className="premium-button premium-focus mt-2.5 flex min-h-11 w-full items-center justify-center gap-2 px-4 text-sm"
      >
        ดูวิเคราะห์เต็ม
        <ArrowRight size={16} />
      </button>
    </article>
  )
}

function ProfessionalMetrics({ professional, confidence, riskLevel }) {
  const scores = professional?.scores ?? {}
  const riskLabel = String(riskLevel ?? '').toUpperCase() || '-'
  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5">
      <SummaryMetric label="Professional Score" value={`${Math.round(professional?.totalScore ?? 0)}%`} />
      <SummaryMetric label="Confidence" value={`${Math.round(confidence ?? professional?.confidenceScore ?? 0)}%`} />
      <SummaryMetric label="Risk Level" value={riskLabel} muted={riskLabel === 'HIGH'} />
      <SummaryMetric label="Value Edge" value={`${Math.round(scores.valueEdge ?? 0)}%`} muted={(scores.valueEdge ?? 0) < 55} />
      <SummaryMetric label="Market Quality" value={`${Math.round(scores.marketQuality ?? 0)}%`} muted={(scores.marketQuality ?? 0) < 45} />
      <SummaryMetric label="Data Quality" value={`${Math.round(scores.dataQuality ?? 0)}%`} muted={(scores.dataQuality ?? 0) < 50} />
    </div>
  )
}

function TeamName({ name, active = false, align = 'left' }) {
  return (
    <p className={`text-clamp-1 text-[0.98rem] font-black leading-6 ${align === 'right' ? 'text-right' : ''} ${active ? 'text-emerald-100 underline decoration-emerald-300/60 underline-offset-4' : 'text-white'}`}>
      {name}
    </p>
  )
}

function SystemPickSummaryBox({ summary, confidence, hasMarket }) {
  const safeSummary = summary ?? {
    title: 'สรุปมุมมองระบบ',
    sideLabel: 'ยังไม่เลือกฝั่ง',
    market: 'ยังไม่มีข้อมูลราคา',
    predictedOutcomeLabel: 'ยังไม่มีข้อมูลราคา',
    reason: 'ระบบยังไม่พบข้อมูลราคาจาก API-Football สำหรับคู่นี้',
  }
  return (
    <div className={`mt-2 rounded-xl border p-2.5 ${hasMarket ? 'border-emerald-300/20 bg-emerald-300/[0.06]' : 'border-amber-300/20 bg-amber-300/[0.06]'}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="text-[11px] font-black text-white">{safeSummary.title}</p>
        <span className="semantic-badge shrink-0 border-white/10 bg-white/[0.05] text-white">{confidence}%</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <SummaryMetric label="ฝั่งที่ระบบประเมิน" value={safeSummary.sideLabel} />
        <SummaryMetric label="ตลาดที่ใช้" value={safeSummary.market} muted={!hasMarket} />
      </div>
      <p className="text-clamp-1 mt-2 text-xs font-black leading-5 text-slate-100">{safeSummary.predictedOutcomeLabel}</p>
      <p className="text-clamp-2 mt-1 text-[11px] font-semibold leading-4 text-slate-300">{safeSummary.reason}</p>
    </div>
  )
}

function SummaryMetric({ label, value, muted = false }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/15 px-2 py-1.5">
      <p className="text-[9px] font-black uppercase text-slate-500">{label}</p>
      <p className={`text-clamp-1 text-[11px] font-black leading-4 ${muted ? 'text-amber-100' : 'text-white'}`}>{value || '-'}</p>
    </div>
  )
}

function buildReasonList(match, finalPick, analysisSummary, waitingMarket, marketDisplay, professional) {
  if (waitingMarket) return [marketDisplay.reason]
  const pickSummary = match.aiFinalPick?.finalSummary ?? finalPick.pickReason
  const rawReasons = [...(professional?.reasons ?? []), pickSummary, analysisSummary, finalPick.valueReason]
    .filter(Boolean)
    .map((item) => sanitizeUserText(item))
    .filter(Boolean)

  return [...new Set(rawReasons)].slice(0, 3)
}

function buildProfessionalBadges(professional) {
  const recommendation = String(professional?.recommendation ?? '').toUpperCase()
  if (recommendation === 'BET') return ['AI BET', 'Value Found', 'Risk OK']
  if (recommendation === 'LEAN') return ['รอดูราคา', 'มีทรงแต่ยังไม่สุด']
  return ['ผ่านการวิเคราะห์แล้ว แต่ไม่คุ้มเสี่ยง']
}

function buildCardSummary(match, recommendation, confidence, waitingMarket) {
  if (getMatchStatusInfo(match).isFinished) {
    return 'แข่งจบแล้ว ดูผลและการประเมินได้ที่หน้าผลย้อนหลัง'
  }
  if (waitingMarket || isWaitingForMarketData(match)) {
    return 'ข้อมูลตลาดยังไม่พอ ระบบจะอัปเดตอีกครั้งเมื่อมีข้อมูลเพิ่ม'
  }
  const summary = sanitizeUserText(getAnalysisSummary(match))
  if (summary) return summary
  if (String(recommendation).toUpperCase().replace('_', ' ') === 'NO BET') {
    return `ยังไม่ยกระดับเป็นคู่เด่น เพราะ AI Score ${confidence}% ยังไม่ชัดพอ`
  }
  return `AI Score ${confidence}% พร้อมตรวจรายละเอียดราคาและไลน์อัปก่อนตัดสินใจ`
}

function sanitizeUserText(value) {
  return String(value ?? '')
    .replace(/\bSTRONG_SIGNAL\b/g, 'สัญญาณเด่น')
    .replace(/\bNO BET\b/g, 'รอข้อมูลเพิ่ม')
    .replace(/\bSKIP\b/g, 'รอข้อมูลเพิ่ม')
    .replace(/\bWATCH\b/g, 'น่าติดตาม')
    .replace(/\bMARKET_DATA_READY_RECALCULATED\b/g, 'ข้อมูลตลาดพร้อม')
    .replace(/\bINSUFFICIENT_MARKET_DATA\b/g, 'ข้อมูลตลาดยังไม่พอ')
    .replace(/\bNO_MARKET_DATA\b/g, 'ยังไม่มีข้อมูลตลาด')
    .replace(/\bmarket_data_used\b/gi, 'ข้อมูลตลาด')
    .trim()
}

function getFinishedScoreDisplay(match = {}) {
  if (!getMatchStatusInfo(match).isFinished) return ''
  return getScoreDisplay({
    ...match,
    homeScore: match.homeScore ?? match.homeGoals ?? match.home_score ?? match.home_goals,
    awayScore: match.awayScore ?? match.awayGoals ?? match.away_score ?? match.away_goals,
  })
}

function buildCardClass(rank, mode, riskLevel) {
  const risk = String(riskLevel).toUpperCase()
  const base = 'rounded-[18px] border bg-white/[0.045] shadow-[0_12px_32px_rgba(0,0,0,0.22)]'
  const first = rank === 1 ? 'shadow-[0_18px_44px_rgba(0,0,0,0.3)]' : ''

  if (mode === 'waiting') {
    return `${base} ${first} border-slate-400/24 bg-[linear-gradient(145deg,rgba(148,163,184,0.1),rgba(255,255,255,0.035))]`
  }
  if (risk === 'HIGH') {
    return `${base} ${first} border-amber-300/28 bg-[linear-gradient(145deg,rgba(245,158,11,0.09),rgba(255,255,255,0.035))]`
  }
  if (mode === 'strong') {
    return `${base} ${first} border-emerald-300/35 bg-[linear-gradient(145deg,rgba(52,211,153,0.14),rgba(255,255,255,0.04))]`
  }
  return `${base} ${first} border-cyan-300/25 bg-[linear-gradient(145deg,rgba(34,211,238,0.1),rgba(255,255,255,0.04))]`
}
