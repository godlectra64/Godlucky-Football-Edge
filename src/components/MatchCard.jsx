import { ArrowRight, Clock, Medal } from 'lucide-react'
import { getAnalysisSummary, getConfidence, getRecommendation, getRiskLevel } from '../utils/analysisEngine'
import { buildAiFinalPick } from '../utils/finalPick'
import { formatKickoffTime } from '../utils/formatters'
import { normalizeOddsRows } from '../utils/oddsUtils'
import AiFinalPickCard from './AiFinalPickCard'
import MarketOddsCard from './MarketOddsCard'
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
  const reasons = buildReasonList(match, finalPick, analysisSummary)
  const oneBestBadge = getOneBestCardBadge(match, oneBestPick)
  const rankBadges = buildDisplayBadges(match, recommendation, riskLevel, confidence, oneBestBadge)
  const odds = normalizeOddsRows(match)
  const cardClass = buildCardClass(finalRank ?? match.rank, recommendation, riskLevel)
  const open = () => onOpen?.(match.id)

  return (
    <article
      onClick={open}
      className={`premium-focus cursor-pointer p-3.5 transition duration-200 active:translate-y-[1px] ${cardClass}`}
      aria-label={`${match.homeTeam?.name ?? 'home team'} vs ${match.awayTeam?.name ?? 'away team'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="semantic-badge border-white/10 bg-white/[0.05] text-white">
            <Clock size={12} />
            {formatKickoffTime(match.kickoffAt)}
          </span>
          <span className="semantic-badge min-w-0 max-w-[172px] border-[rgba(var(--page-accent-rgb),0.28)] bg-[rgba(var(--page-accent-rgb),0.1)] text-[var(--page-accent)]">
            <span className="truncate">{match.league?.name ?? 'ไม่ทราบลีก'}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {aiPickLabel ? <span className="hidden text-[10px] font-black text-[var(--page-accent)] min-[390px]:inline">{aiPickLabel}</span> : null}
          <span className={`flex h-9 min-w-9 items-center justify-center rounded-2xl border bg-black/25 px-2 text-sm font-black text-[var(--page-accent)] ${finalRank === 1 ? 'border-amber-300/45 shadow-[0_0_20px_rgba(246,196,69,0.18)]' : 'border-white/10'}`}>
            {finalRank ? `#${finalRank}` : <Medal size={17} />}
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-black/18 p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)] items-center gap-2">
          <TeamName name={match.homeTeam?.name ?? 'ไม่ทราบทีม'} active={finalPick.pickSide === 'HOME'} />
          <span className="text-center text-xs font-black uppercase text-slate-500">vs</span>
          <TeamName name={match.awayTeam?.name ?? 'ไม่ทราบทีม'} active={finalPick.pickSide === 'AWAY'} align="right" />
        </div>
      </div>

      <div className="mt-3">
        <AiFinalPickCard match={match} compact />
      </div>

      <div className="mt-3">
        <MarketOddsCard odds={odds} compact />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniInfo label="คะแนนอันดับ" value={rankingScore || '-'} />
        <div className="min-w-0 rounded-xl border border-white/10 bg-black/18 px-2 py-2">
          <p className="text-[10px] font-black uppercase text-slate-500">สัญญาณ</p>
          <div className="mt-1"><ScoreBadge recommendation={recommendation} /></div>
        </div>
        <div className="min-w-0 rounded-xl border border-white/10 bg-black/18 px-2 py-2">
          <p className="text-[10px] font-black uppercase text-slate-500">ความเสี่ยง</p>
          <div className="mt-1"><RiskBadge level={riskLevel} /></div>
        </div>
      </div>

      <div className="mt-3 grid gap-1.5">
        {reasons.map((reason) => (
          <p key={reason} className="text-clamp-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold leading-5 text-slate-300">
            {reason}
          </p>
        ))}
      </div>

      {rankBadges.length || recommendationTier ? (
        <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
          {recommendationTier ? <span className="semantic-badge border-white/10 bg-white/[0.05] text-white">{recommendationTier}</span> : null}
          {rankBadges.map((badge) => (
            <span key={badge} className={`semantic-badge ${badgeClass(badge)}`}>{badge}</span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          open()
        }}
        className="premium-button premium-focus mt-3 flex min-h-11 w-full items-center justify-center gap-2 px-4 text-sm"
      >
        ดูวิเคราะห์เต็ม
        <ArrowRight size={16} />
      </button>
    </article>
  )
}

function TeamName({ name, active = false, align = 'left' }) {
  return (
    <p className={`text-clamp-2 text-[1.02rem] font-black leading-6 ${align === 'right' ? 'text-right' : ''} ${active ? 'text-emerald-100 underline decoration-emerald-300/60 underline-offset-4' : 'text-white'}`}>
      {name}
    </p>
  )
}

function MiniInfo({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/18 px-2 py-2">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <p className="mt-1 truncate text-base font-black leading-5 text-white">{value}</p>
    </div>
  )
}

function buildReasonList(match, finalPick, analysisSummary) {
  const pickSummary = match.aiFinalPick?.finalSummary ?? finalPick.pickReason
  const rawReasons = [
    pickSummary,
    analysisSummary,
    finalPick.valueReason,
  ]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter(Boolean)

  return [...new Set(rawReasons)].slice(0, 3)
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
  const base = 'rounded-[20px] border bg-white/[0.045] shadow-[0_16px_42px_rgba(0,0,0,0.26)]'
  const first = rank === 1 ? 'shadow-[0_22px_58px_rgba(0,0,0,0.36)]' : ''

  if (isHighRisk || recommendation === 'NO BET') {
    return `${base} ${first} border-red-300/25 bg-[linear-gradient(145deg,rgba(251,113,133,0.08),rgba(255,255,255,0.035))]`
  }
  if (recommendation === 'BET') {
    return `${base} ${first} border-emerald-300/35 bg-[linear-gradient(145deg,rgba(52,211,153,0.14),rgba(255,255,255,0.04))]`
  }
  if (recommendation === 'LEAN') {
    return `${base} ${first} border-amber-300/30 bg-[linear-gradient(145deg,rgba(245,158,11,0.11),rgba(255,255,255,0.04))]`
  }
  if (recommendation === 'WATCH') {
    return `${base} ${first} border-cyan-300/25 bg-[linear-gradient(145deg,rgba(34,211,238,0.1),rgba(255,255,255,0.04))]`
  }
  return `${base} ${first} border-white/10`
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

  return [...new Set(badges)].slice(0, 5)
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
