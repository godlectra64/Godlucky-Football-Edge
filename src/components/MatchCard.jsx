import { Clock, Gauge, Medal } from 'lucide-react'
import { getAnalysisSummary, getConfidence, getRecommendation, getRiskLevel } from '../utils/analysisEngine'
import { formatKickoffTime } from '../utils/formatters'
import RiskBadge from './RiskBadge'
import ScoreBadge from './ScoreBadge'

export default function MatchCard({ match, onOpen }) {
  const recommendation = match.recommendation ?? getRecommendation(match)
  const confidence = Math.round(match.confidence ?? getConfidence(match))
  const riskLevel = match.riskLevel ?? getRiskLevel(match)
  const rankingScore = Math.round(match.rankingScore ?? match.ranking_score ?? confidence)
  const rankReason = buildCardReason(match, recommendation, rankingScore)
  const rankBadges = match.rankBadges ?? match.rank_badges ?? []
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
      className="compact-card premium-focus cursor-pointer p-3 transition duration-200 hover:-translate-y-0.5 hover:border-[rgba(var(--page-accent-rgb),0.34)] hover:bg-white/[0.06] active:translate-y-0"
    >
      <div className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-start gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-sm font-black text-[var(--page-accent)]">
          {match.rank ? `#${match.rank}` : <Medal size={18} />}
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-slate-400">
            <Clock size={13} className="shrink-0 text-[var(--page-accent)]" />
            <span className="shrink-0">{formatKickoffTime(match.kickoffAt)}</span>
            <span className="truncate">{match.league?.name ?? 'Unknown league'}</span>
          </div>
          <TeamRow team={match.homeTeam} strong />
          <TeamRow team={match.awayTeam} />
        </div>

        <div className="flex min-w-[66px] shrink-0 flex-col items-end gap-1.5">
          <ScoreBadge recommendation={recommendation} />
          <RiskBadge level={riskLevel} />
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
            <span style={{ width: `${Math.max(4, Math.min(100, confidence))}%` }} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase text-slate-500">Edge</p>
          <p className="text-xl font-black leading-5 text-white">{rankingScore || '-'}</p>
        </div>
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-2">
        <p className="text-clamp-1 min-w-0 flex-1 text-xs font-semibold leading-5 text-slate-300">{rankReason}</p>
        {rankBadges.length ? (
          <span className="semantic-badge shrink-0 border-white/10 bg-white/[0.05] text-slate-300">{rankBadges[0]}</span>
        ) : null}
      </div>
    </article>
  )
}

function TeamRow({ team, strong = false }) {
  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-2">
      {team?.logo ? <img src={team.logo} alt="" className="h-6 w-6 shrink-0 rounded-full bg-white/10 object-contain p-0.5" /> : <div className="h-6 w-6 shrink-0 rounded-full bg-white/10" />}
      <p className={`${strong ? 'text-base font-black text-white' : 'text-sm font-bold text-slate-300'} truncate leading-5`}>
        {team?.name ?? 'Unknown team'}
      </p>
    </div>
  )
}

function buildCardReason(match, recommendation, rankingScore) {
  if (recommendation === 'NO BET' && rankingScore >= 62) {
    return 'Interesting data profile, but not enough edge to play.'
  }
  return match.rankReason ?? match.rank_reason ?? getAnalysisSummary(match)
}
