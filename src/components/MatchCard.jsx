import { ArrowRight, Clock, Medal } from 'lucide-react'
import { buildSimpleBettingDecision, getDecisionConfidence } from '../utils/bettingDecision'
import { getRiskLevel } from '../utils/analysisEngine'
import { formatKickoffTime } from '../utils/formatters'
import { getMatchStatusInfo, getScoreDisplay } from '../utils/matchStatus'

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
  const finalRank = match.finalRank ?? match.final_rank ?? match.analysis?.final_rank ?? match.rank
  const decision = buildSimpleBettingDecision(match)
  const confidence = getDecisionConfidence(decision)
  const bestPick = getBestPickLabel(decision)
  const riskLevel = match.riskLevel ?? getRiskLevel(match)
  const waitingMarket = providedIsWaitingMarketData ?? false
  const mode = displayMode || (decision.final_recommendation === 'BET' ? 'strong' : decision.final_recommendation === 'LEAN' ? 'watch' : 'waiting')
  const cardClass = buildCardClass(finalRank ?? match.rank, mode, riskLevel, waitingMarket)
  const activeSide = decision.final_pick === 'AH' && decision.ah_pick.startsWith('HOME')
    ? 'HOME'
    : decision.final_pick === 'AH' && decision.ah_pick.startsWith('AWAY')
      ? 'AWAY'
      : ''
  const scoreDisplay = getFinishedScoreDisplay(match)
  const open = () => onOpen?.(match.id)

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
          <TeamName name={match.homeTeam?.name ?? 'ไม่ทราบทีม'} active={activeSide === 'HOME'} />
          <span className="text-center text-xs font-black uppercase text-slate-500">{isFinished && scoreDisplay ? scoreDisplay : 'vs'}</span>
          <TeamName name={match.awayTeam?.name ?? 'ไม่ทราบทีม'} active={activeSide === 'AWAY'} align="right" />
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <DecisionMetric label="AH Pick" value={decision.ah_pick} />
        <DecisionMetric label="O/U Pick" value={decision.ou_pick} />
        <DecisionMetric label="Best Pick" value={bestPick} tone={decision.final_recommendation} />
        <DecisionMetric label="Confidence" value={`${confidence}%`} />
      </div>

      <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className={`semantic-badge shrink-0 ${recommendationTone(decision.final_recommendation)}`}>
            {decision.final_recommendation}
          </span>
          <span className="text-[11px] font-black text-slate-400">{decision.final_pick}</span>
        </div>
        <p className="text-clamp-2 mt-1.5 text-xs font-semibold leading-5 text-slate-300">{decision.final_reason}</p>
      </div>

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

function TeamName({ name, active = false, align = 'left' }) {
  return (
    <p className={`text-clamp-1 text-[0.98rem] font-black leading-6 ${align === 'right' ? 'text-right' : ''} ${active ? 'text-emerald-100 underline decoration-emerald-300/60 underline-offset-4' : 'text-white'}`}>
      {name}
    </p>
  )
}

function DecisionMetric({ label, value, tone = '' }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/15 px-2 py-1.5">
      <p className="text-[9px] font-black uppercase text-slate-500">{label}</p>
      <p className={`text-clamp-1 text-[11px] font-black leading-4 ${tone === 'NO BET' ? 'text-slate-300' : 'text-white'}`}>{value || '-'}</p>
    </div>
  )
}

function getBestPickLabel(decision) {
  if (decision.final_pick === 'AH') return decision.ah_pick
  if (decision.final_pick === 'OU') return decision.ou_pick
  return 'NO BET'
}

function recommendationTone(recommendation) {
  if (recommendation === 'BET') return 'badge-bet'
  if (recommendation === 'LEAN') return 'badge-lean'
  return 'badge-no-bet'
}

function getFinishedScoreDisplay(match = {}) {
  if (!getMatchStatusInfo(match).isFinished) return ''
  return getScoreDisplay({
    ...match,
    homeScore: match.homeScore ?? match.homeGoals ?? match.home_score ?? match.home_goals,
    awayScore: match.awayScore ?? match.awayGoals ?? match.away_score ?? match.away_goals,
  })
}

function buildCardClass(rank, mode, riskLevel, waitingMarket) {
  const risk = String(riskLevel).toUpperCase()
  const base = 'rounded-[18px] border bg-white/[0.045] shadow-[0_12px_32px_rgba(0,0,0,0.22)]'
  const first = rank === 1 ? 'shadow-[0_18px_44px_rgba(0,0,0,0.3)]' : ''

  if (waitingMarket || mode === 'waiting') {
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
