import { Clock, Gauge, Medal, Star } from 'lucide-react'
import { getAnalysisSummary, getConfidence, getRecommendation, getRiskLevel } from '../utils/analysisEngine'
import { formatKickoffTime } from '../utils/formatters'
import RiskBadge from './RiskBadge'
import ScoreBadge from './ScoreBadge'

export default function MatchCard({ match, onOpen }) {
  const recommendation = match.recommendation ?? getRecommendation(match)
  const confidence = match.confidence ?? getConfidence(match)
  const riskLevel = match.riskLevel ?? getRiskLevel(match)
  const rankingScore = Math.round(match.rankingScore ?? match.ranking_score ?? confidence)
  const rankReason = buildCardReason(match, recommendation, rankingScore)
  const rankBadges = match.rankBadges ?? match.rank_badges ?? []
  const meaningfulForms = [
    formatMeaningfulForm('ฟอร์มเหย้า', match.homeForm),
    formatMeaningfulForm('ฟอร์มเยือน', match.awayForm),
  ].filter(Boolean)

  const open = () => onOpen(match.id)

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
      className="premium-card premium-focus cursor-pointer p-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300/35 hover:shadow-[0_22px_52px_rgba(0,0,0,0.36)] active:translate-y-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {match.rank ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 font-black text-amber-100">
                <Medal size={13} />
                #{match.rank} วันนี้
              </span>
            ) : null}
            <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-slate-300">
              <Clock size={14} />
              {formatKickoffTime(match.kickoffAt)}
            </span>
            <span className="min-w-0 truncate text-slate-400">{match.league?.name ?? 'ไม่ระบุลีก'}</span>
          </div>
          <TeamLine team={match.homeTeam} strong />
          <TeamLine team={match.awayTeam} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <ScoreBadge recommendation={recommendation} />
          <RiskBadge level={riskLevel} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <InfoTile icon={Gauge} label="Confidence" value={`${confidence}%`} highlight />
        <InfoTile icon={Star} label="Edge Score" value={rankingScore ? `${rankingScore}` : '-'} accent />
      </div>

      {rankBadges.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rankBadges.slice(0, 3).map((badge) => (
            <span key={badge} className="rounded-full border border-white/10 bg-white/[0.045] px-2 py-0.5 text-[11px] font-bold text-slate-300">
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      <p className="text-clamp-2 mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-5 text-slate-200">
        {rankReason}
      </p>

      {meaningfulForms.length ? <p className="mt-2 text-[11px] font-semibold text-slate-500">{meaningfulForms.join(' · ')}</p> : null}
    </article>
  )
}

function TeamLine({ team, strong = false }) {
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2">
      {team?.logo ? <img src={team.logo} alt="" className="h-7 w-7 rounded-full bg-white/10 object-contain p-1" /> : <div className="h-7 w-7 rounded-full bg-white/10" />}
      <p className={`${strong ? 'text-lg font-black text-white' : 'text-base font-bold text-slate-200'} truncate leading-tight`}>
        {team?.name ?? 'ไม่ระบุทีม'}
      </p>
    </div>
  )
}

function InfoTile({ icon: Icon, label, value, highlight = false, accent = false }) {
  return (
    <div className={`metric-card p-2.5 ${accent ? 'border-amber-300/25 bg-amber-300/10' : ''}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
        <Icon size={14} />
        {label}
      </p>
      <p className={`mt-1 text-lg font-black leading-6 ${highlight ? 'text-emerald-100' : accent ? 'text-amber-100' : 'text-white'}`}>{value || '-'}</p>
    </div>
  )
}

function formatMeaningfulForm(label, form) {
  if (!form) return ''
  const wins = Number(form.wins ?? 0)
  const draws = Number(form.draws ?? 0)
  const losses = Number(form.losses ?? 0)
  if (wins + draws + losses <= 0) return ''
  return `${label} ${wins}-${draws}-${losses}`
}

function buildCardReason(match, recommendation, rankingScore) {
  if (recommendation === 'NO BET' && rankingScore >= 62) {
    return 'น่าสนใจเชิงข้อมูล แต่ยังไม่ผ่านเกณฑ์เล่น'
  }
  return match.rankReason ?? match.rank_reason ?? getAnalysisSummary(match)
}
