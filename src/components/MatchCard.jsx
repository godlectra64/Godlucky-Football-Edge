import { Clock, Gauge, Medal } from 'lucide-react'
import { getAnalysisSummary, getConfidence, getRecommendation, getRiskLevel } from '../utils/analysisEngine'
import { buildAiFinalPick } from '../utils/finalPick'
import { formatKickoffTime } from '../utils/formatters'
import RiskBadge from './RiskBadge'
import ScoreBadge from './ScoreBadge'

export default function MatchCard({ match, oneBestPick = null, onOpen }) {
  const recommendation = match.recommendation ?? getRecommendation(match)
  const confidence = Math.round(match.confidence ?? getConfidence(match))
  const riskLevel = match.riskLevel ?? getRiskLevel(match)
  const rankingScore = Math.round(match.rankingScore ?? match.ranking_score ?? confidence)
  const finalRank = match.finalRank ?? match.final_rank ?? match.analysis?.final_rank ?? match.rank
  const recommendationTier = match.recommendationTier ?? match.recommendation_tier ?? match.analysis?.recommendation_tier ?? ''
  const aiPickLabel = match.aiPickLabel ?? match.ai_pick_label ?? (finalRank ? `AI PICK #${finalRank}` : '')
  const finalPick = buildAiFinalPick(match)
  const analysisSummary = buildCardSummary(match, recommendation, confidence)
  const oneBestBadge = getOneBestCardBadge(match, oneBestPick)
  const rankBadges = buildDisplayBadges(match, recommendation, riskLevel, confidence, oneBestBadge)
  const v4Metrics = getV4CardMetrics(match)
  const cardClass = buildCardClass(finalRank ?? match.rank, recommendation, riskLevel)
  const confidenceTone = String(riskLevel).toUpperCase() === 'HIGH' ? 'bg-gradient-to-r from-red-400 to-rose-200' : confidence >= 72 ? 'bg-gradient-to-r from-emerald-400 to-cyan-200' : confidence >= 58 ? 'bg-gradient-to-r from-amber-300 to-blue-300' : 'bg-gradient-to-r from-red-400 to-rose-200'
  const open = () => onOpen?.(match.id)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      aria-label={`${match.homeTeam?.name ?? 'home team'} vs ${match.awayTeam?.name ?? 'away team'}`}
      className={`premium-focus cursor-pointer p-3 transition duration-200 hover:-translate-y-0.5 active:translate-y-0 ${cardClass}`}
    >
      <div className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-start gap-2.5">
        <div className={`flex shrink-0 items-center justify-center rounded-2xl border bg-black/25 font-black text-[var(--page-accent)] ${finalRank === 1 ? 'h-12 w-12 border-amber-300/40 text-base shadow-[0_0_22px_rgba(246,196,69,0.16)]' : 'h-10 w-10 border-white/10 text-sm'}`}>
          {finalRank ? `#${finalRank}` : <Medal size={18} />}
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-slate-400">
            <Clock size={13} className="shrink-0 text-[var(--page-accent)]" />
            <span className="shrink-0">{formatKickoffTime(match.kickoffAt)}</span>
            <span className="truncate">{match.league?.name ?? 'Unknown league'}</span>
          </div>
          {aiPickLabel ? <p className="mt-1 text-[10px] font-black uppercase tracking-normal text-[var(--page-accent)]">{aiPickLabel}</p> : null}
          <p className={`mt-1 text-clamp-1 text-xs font-black leading-5 ${finalPick.canHighlight ? 'text-emerald-100' : 'text-slate-400'}`}>
            {finalPick.pickLabel}
          </p>
          <div className="mt-1.5 min-w-0">
            <p className={`truncate text-base font-black leading-5 ${teamTextClass(finalPick.pickSide, 'HOME')}`}>{match.homeTeam?.name ?? 'Unknown team'}</p>
            <p className="mt-0.5 truncate text-xs font-black uppercase leading-4 text-slate-500">vs</p>
            <p className={`truncate text-sm font-bold leading-5 ${teamTextClass(finalPick.pickSide, 'AWAY')}`}>{match.awayTeam?.name ?? 'Unknown team'}</p>
          </div>
        </div>

        <div className="flex min-w-[74px] shrink-0 flex-col items-end gap-1.5">
          <ScoreBadge recommendation={recommendation} />
          <RiskBadge level={riskLevel} />
          {recommendationTier ? <span className="semantic-badge border-white/10 bg-white/[0.05] text-[10px] text-white">{recommendationTier}</span> : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Gauge size={13} />
              Confidence
            </span>
            <span className="text-white">{confidence}%</span>
          </div>
          <div className="progress-bar mt-1.5">
            <span className={confidenceTone} style={{ width: `${Math.max(4, Math.min(100, confidence))}%` }} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase text-slate-500">Ranking</p>
          <p className="text-xl font-black leading-5 text-white">{rankingScore || '-'}</p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <MiniInfo label="Market" value={finalPick.marketType ?? 'รอราคา'} muted={!finalPick.marketType} />
        <MiniInfo label="Line" value={finalPick.marketLine ?? 'ยังไม่มีข้อมูล'} muted={!finalPick.marketLine} />
        <MiniInfo label={finalPick.probabilitySource === 'confidence_estimate' ? 'Model' : 'Win Prob'} value={`${finalPick.modelProbability}%`} />
        <MiniInfo label="Value" value={finalPick.valueLabel} muted={finalPick.valueStatus !== 'YES'} />
      </div>
      {v4Metrics ? (
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          <MiniInfo label="V4 Cal" value={`${v4Metrics.calibrated}%`} />
          <MiniInfo label="Edge" value={`${v4Metrics.edge}%`} muted={!v4Metrics.edge} />
          <MiniInfo label="Depth" value={`${v4Metrics.depth}%`} muted={!v4Metrics.depth} />
          <MiniInfo label="Data" value={v4Metrics.status} muted={v4Metrics.status !== 'ENRICHED'} />
        </div>
      ) : null}

      <p className="text-clamp-2 mt-2 min-w-0 text-xs font-bold leading-5 text-slate-200">{recommendation === 'NO BET' ? 'ไม่แนะนำเดิมพัน' : finalPick.pickReason}</p>
      <p className="text-clamp-2 mt-1 min-w-0 text-[11px] font-semibold leading-5 text-slate-400">{analysisSummary}</p>

      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        {rankBadges.map((badge) => (
          <span key={badge} className={`semantic-badge ${badgeClass(badge)}`}>{badge}</span>
        ))}
      </div>
    </article>
  )
}

function MiniInfo({ label, value, muted = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/18 px-2 py-1.5">
      <p className="text-[9px] font-black uppercase text-slate-500">{label}</p>
      <p className={`truncate text-[11px] font-black leading-4 ${muted ? 'text-slate-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function getV4CardMetrics(match) {
  const analysis = match.analysis ?? match.match_analysis ?? {}
  const calibrated = numberOrNull(match.calibratedConfidence ?? match.calibrated_confidence_score ?? analysis.calibrated_confidence_score)
  const edge = numberOrNull(match.marketEdgeScore ?? match.market_edge_score ?? analysis.market_edge_score)
  const depth = numberOrNull(match.dataDepthScore ?? match.data_depth_score ?? analysis.data_depth_score)
  const status = String(match.enrichmentStatus ?? match.enrichment_status ?? '').toUpperCase()
  if (calibrated === null && edge === null && depth === null && !status) return null
  return {
    calibrated: calibrated ?? Math.round(match.confidence ?? getConfidence(match)),
    edge: edge ?? 0,
    depth: depth ?? 0,
    status: status || 'V4',
  }
}

function numberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric) : null
}

function buildCardSummary(match, recommendation, confidence) {
  const summary = getAnalysisSummary(match)
  if (summary) return summary
  if (recommendation === 'NO BET') {
    return `แนะนำ NO BET เพราะความมั่นใจ ${confidence}% ยังไม่พอหรือความเสี่ยงสูง ควรรอข้อมูลเพิ่ม`
  }
  return `แนะนำ ${recommendation} ด้วยความมั่นใจ ${confidence}% แต่ควรเช็กราคาและไลน์อัปก่อนตัดสินใจ`
}

function buildCardClass(rank, recommendation, riskLevel) {
  const risk = String(riskLevel).toUpperCase()
  const isHighRisk = risk === 'HIGH'
  const base = 'rounded-[18px] border bg-white/[0.045] shadow-[0_14px_38px_rgba(0,0,0,0.22)]'
  const first = rank === 1 ? 'p-3.5 shadow-[0_22px_58px_rgba(0,0,0,0.34)]' : ''

  if (isHighRisk || recommendation === 'NO BET') {
    return `${base} ${first} border-red-300/25 bg-[linear-gradient(90deg,rgba(251,113,133,0.08),rgba(255,255,255,0.035))] hover:border-red-300/40`
  }
  if (recommendation === 'BET') {
    return `${base} ${first} border-emerald-300/35 bg-[linear-gradient(90deg,rgba(52,211,153,0.14),rgba(255,255,255,0.04))] hover:border-emerald-300/50`
  }
  if (recommendation === 'LEAN') {
    return `${base} ${first} border-amber-300/30 bg-[linear-gradient(90deg,rgba(245,158,11,0.11),rgba(255,255,255,0.04))] hover:border-amber-300/45`
  }
  if (recommendation === 'WATCH') {
    return `${base} ${first} border-cyan-300/25 bg-[linear-gradient(90deg,rgba(34,211,238,0.1),rgba(255,255,255,0.04))] hover:border-cyan-300/40`
  }
  return `${base} ${first} border-white/10 hover:border-white/20`
}

function buildDisplayBadges(match, recommendation, riskLevel, confidence, oneBestBadge = '') {
  const rawBadges = match.rankBadges ?? match.rank_badges ?? []
  const badges = oneBestBadge ? [oneBestBadge, ...rawBadges] : [...rawBadges]
  const limitedData = isLimitedData(match)

  if (String(riskLevel).toUpperCase() === 'HIGH' || recommendation === 'NO BET') badges.push('NO BET')
  if (recommendation === 'BET' && String(riskLevel).toUpperCase() !== 'HIGH' && confidence >= 72) badges.push('BEST VALUE')
  if (confidence >= 78) badges.push('HIGH CONFIDENCE')
  if (String(riskLevel).toUpperCase() === 'LOW' && recommendation !== 'NO BET') badges.push('SAFE PICK')
  if (recommendation === 'LEAN' || recommendation === 'WATCH') badges.push('WATCHLIST')
  if (limitedData) badges.push('LIMITED DATA')

  return [...new Set(badges)].slice(0, 6)
}

function getOneBestCardBadge(match, oneBestPick) {
  if (!oneBestPick?.match || oneBestPick.heroType === 'NO_CLEAR_PICK') return ''
  if (String(oneBestPick.match.id) !== String(match.id)) return ''
  return oneBestPick.badgeLabel
}

function isLimitedData(match) {
  const rawBreakdown = match.analysisBreakdown ?? match.analysis?.raw?.analysis_breakdown ?? {}
  const marketLimited = rawBreakdown.market_odds_risk?.has_market_data === false
  const dataLow = rawBreakdown.data_intelligence?.data_confidence?.level === 'low'
  const completeness = Number(match.dataCompleteness ?? match.data_completeness ?? match.analysis?.raw?.data_completeness ?? 100)
  return marketLimited || dataLow || completeness < 65
}

function badgeClass(badge) {
  if (badge === 'FINAL PICK') return 'border-emerald-300/35 bg-emerald-300/12 text-emerald-50'
  if (badge === 'BEST AVAILABLE') return 'border-amber-300/35 bg-amber-300/12 text-amber-50'
  if (badge === 'BEST VALUE' || badge === 'HIGH CONFIDENCE') return 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
  if (badge === 'SAFE PICK') return 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100'
  if (badge === 'WATCHLIST') return 'border-amber-300/30 bg-amber-300/10 text-amber-100'
  if (badge === 'NO BET') return 'border-red-300/30 bg-red-400/10 text-red-100'
  if (badge === 'LIMITED DATA') return 'border-slate-400/25 bg-slate-400/10 text-slate-200'
  return 'border-white/10 bg-white/[0.05] text-slate-300'
}

function teamTextClass(pickSide, side) {
  if (pickSide !== side) return side === 'HOME' ? 'text-white' : 'text-slate-300'
  return 'text-emerald-100 underline decoration-emerald-300/60 underline-offset-4'
}
