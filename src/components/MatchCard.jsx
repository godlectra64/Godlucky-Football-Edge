import { ArrowRight, Clock, Medal } from 'lucide-react'
import { buildCanonicalMatchDecision, getDecisionConfidence } from '../utils/bettingDecision'
import { formatKickoffTime } from '../utils/formatters'
import { getMatchStatusInfo, getScoreDisplay } from '../utils/matchStatus'
import { formatAhCardLabel, formatBestPickCardLabel, formatDecisionReasonLine, formatOuCardLabel } from '../utils/uiLabels'

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
  const decision = buildCanonicalMatchDecision(match)
  const confidence = getDecisionConfidence(decision)
  const ahLabel = formatAhCardLabel(decision.ah_pick)
  const ouLabel = formatOuCardLabel(decision.ou_pick)
  const bestPick = formatBestPickCardLabel(decision.final_pick)
  const reasonLine = formatDecisionReasonLine(decision)
  const waitingMarket = providedIsWaitingMarketData ?? decision.status === 'WAITING_MARKET'
  const mode = displayMode || statusMode(decision.status)
  const cardClass = buildCardClass(finalRank ?? match.rank, mode, waitingMarket)
  const activeSide = ['HOME', 'AWAY'].includes(decision.match_view.side) ? decision.match_view.side : ''
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

      <div className="mt-2.5 grid gap-1.5">
        <DecisionRow label="มุมมองผู้ชนะ" value={decision.match_view.label} strong />
        <div className="grid grid-cols-2 gap-1.5">
          <DecisionRow label="AH" value={ahLabel} />
          <DecisionRow label="O/U" value={ouLabel} />
          <DecisionRow label="Best Pick" value={bestPick} />
          <DecisionRow label="ความมั่นใจ" value={`${confidence}%`} />
        </div>
      </div>

      <p className="text-clamp-1 mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-2 text-xs font-semibold leading-5 text-slate-300">
        {reasonLine}
      </p>

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
    <p className={`text-clamp-2 text-[0.98rem] font-black leading-5 ${align === 'right' ? 'text-right' : ''} ${active ? 'text-emerald-100 underline decoration-emerald-300/60 underline-offset-4' : 'text-white'}`}>
      {name}
    </p>
  )
}

function DecisionRow({ label, value, strong = false }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/15 px-2 py-1.5">
      <p className="text-[9px] font-black uppercase text-slate-500">{label}</p>
      <p className={`text-clamp-1 font-black leading-4 text-white ${strong ? 'text-[12px]' : 'text-[11px]'}`}>{value || '-'}</p>
    </div>
  )
}

function statusMode(status) {
  if (status === 'READY') return 'strong'
  if (status === 'WATCH') return 'watch'
  if (status === 'NO_DATA') return 'prediction'
  return 'waiting'
}

function getFinishedScoreDisplay(match = {}) {
  if (!getMatchStatusInfo(match).isFinished) return ''
  return getScoreDisplay({
    ...match,
    homeScore: match.homeScore ?? match.homeGoals ?? match.home_score ?? match.home_goals,
    awayScore: match.awayScore ?? match.awayGoals ?? match.away_score ?? match.away_goals,
  })
}

function buildCardClass(rank, mode, waitingMarket) {
  const base = 'rounded-[18px] border bg-white/[0.045] shadow-[0_12px_32px_rgba(0,0,0,0.22)]'
  const first = rank === 1 ? 'shadow-[0_18px_44px_rgba(0,0,0,0.3)]' : ''

  if (waitingMarket || mode === 'waiting') {
    return `${base} ${first} border-slate-400/24 bg-[linear-gradient(145deg,rgba(148,163,184,0.1),rgba(255,255,255,0.035))]`
  }
  if (mode === 'strong') {
    return `${base} ${first} border-emerald-300/35 bg-[linear-gradient(145deg,rgba(52,211,153,0.14),rgba(255,255,255,0.04))]`
  }
  return `${base} ${first} border-cyan-300/25 bg-[linear-gradient(145deg,rgba(34,211,238,0.1),rgba(255,255,255,0.04))]`
}
