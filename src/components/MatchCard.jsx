import { ChevronRight, Clock, Gauge, Goal, Medal, RefreshCcw, Star } from 'lucide-react'
import { getAnalysisSummary, getConfidence, getRecommendation, getRiskLevel } from '../utils/analysisEngine'
import { formatKickoffTime, formatUpdatedAt } from '../utils/formatters'
import RiskBadge from './RiskBadge'
import ScoreBadge from './ScoreBadge'

export default function MatchCard({ match, onOpen }) {
  const recommendation = match.recommendation ?? getRecommendation(match)
  const confidence = match.confidence ?? getConfidence(match)
  const riskLevel = match.riskLevel ?? getRiskLevel(match)
  const rankingScore = Math.round(match.rankingScore ?? match.ranking_score ?? confidence)
  const rankReason = match.rankReason ?? match.rank_reason ?? getAnalysisSummary(match)
  const rankBadges = match.rankBadges ?? match.rank_badges ?? []

  const open = () => onOpen(match.id)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') open()
      }}
      className="cursor-pointer rounded-lg border border-white/10 bg-pitch-800 p-4 shadow-glow transition hover:border-emerald-300/30 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {match.rank ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 font-bold text-emerald-100">
                <Medal size={13} />
                #{match.rank}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Clock size={14} />
              {formatKickoffTime(match.kickoffAt)}
            </span>
            <span className="truncate">{match.league?.name ?? 'ไม่ระบุลีก'}</span>
          </div>
          <TeamLine team={match.homeTeam} strong />
          <TeamLine team={match.awayTeam} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ScoreBadge recommendation={recommendation} />
          <RiskBadge level={riskLevel} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <InfoTile icon={Star} label="Ranking" value={`${rankingScore}/100`} />
        <InfoTile icon={Gauge} label="มั่นใจ" value={`${confidence}%`} />
        <InfoTile icon={Goal} label="ฟอร์มเหย้า" value={formatForm(match.homeForm)} />
        <InfoTile icon={Goal} label="ฟอร์มเยือน" value={formatForm(match.awayForm)} />
        <InfoTile icon={RefreshCcw} label="อัปเดต" value={formatUpdatedAt(match.updatedAt)} wide />
      </div>

      {rankBadges.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {rankBadges.map((badge) => (
            <span key={badge} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-slate-200">
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 rounded-lg bg-white/[0.04] p-3">
        <p className="text-clamp-3 text-sm leading-6 text-slate-200">{rankReason}</p>
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          open()
        }}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 text-base font-bold text-pitch-950"
      >
        ดูรายละเอียด
        <ChevronRight size={20} />
      </button>
    </article>
  )
}

function TeamLine({ team, strong = false }) {
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2">
      {team?.logo ? <img src={team.logo} alt="" className="h-8 w-8 rounded-full bg-white/10 object-contain p-1" /> : <div className="h-8 w-8 rounded-full bg-white/10" />}
      <p className={`${strong ? 'text-xl font-black text-white' : 'text-sm font-semibold text-slate-300'} truncate`}>
        {team?.name ?? 'ไม่ระบุทีม'}
      </p>
    </div>
  )
}

function InfoTile({ icon: Icon, label, value, wide = false }) {
  return (
    <div className={`rounded-lg border border-white/10 bg-pitch-900 p-3 ${wide ? 'col-span-2' : ''}`}>
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Icon size={14} />
        {label}
      </p>
      <p className="mt-1 text-sm font-bold text-white">{value || '-'}</p>
    </div>
  )
}

function formatForm(form) {
  if (!form) return 'รอข้อมูล'
  return `${form.wins ?? 0}-${form.draws ?? 0}-${form.losses ?? 0}`
}
