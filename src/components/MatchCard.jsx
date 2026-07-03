import { ArrowRight, Clock, Medal } from 'lucide-react'
import { getAnalysisSummary, getConfidence, getRecommendation, getRiskLevel, isWaitingForMarketData } from '../utils/analysisEngine'
import { generateAiFinalPick } from '../utils/aiFinalPickEngine'
import { buildAiFinalPick } from '../utils/finalPick'
import { formatKickoffTime } from '../utils/formatters'
import { normalizeOddsRows } from '../utils/oddsUtils'
import { formatMarketFocus } from '../utils/uiLabels'
import MarketDirectionBadge from './MarketDirectionBadge'
import RiskBadge from './RiskBadge'
import ScoreBadge from './ScoreBadge'

export default function MatchCard({ match, onOpen }) {
  const recommendation = match.recommendation ?? getRecommendation(match)
  const confidence = Math.round(match.confidence ?? getConfidence(match))
  const riskLevel = match.riskLevel ?? getRiskLevel(match)
  const finalRank = match.finalRank ?? match.final_rank ?? match.analysis?.final_rank ?? match.rank
  const finalPick = buildAiFinalPick(match)
  const aiPick = match.aiFinalPick ?? generateAiFinalPick(match)
  const analysisSummary = buildCardSummary(match, recommendation, confidence)
  const reasons = buildReasonList(match, finalPick, analysisSummary)
  const odds = normalizeOddsRows(match)
  const waitingMarket = isWaitingForMarketData(match)
  const cardClass = buildCardClass(finalRank ?? match.rank, recommendation, riskLevel)
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
        <span className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-xl border bg-black/25 px-2 text-sm font-black text-[var(--page-accent)] ${finalRank === 1 ? 'border-amber-300/45 shadow-[0_0_20px_rgba(246,196,69,0.18)]' : 'border-white/10'}`}>
          {finalRank ? `#${finalRank}` : <Medal size={17} />}
        </span>
      </div>

      <div className="mt-2.5 rounded-xl border border-white/10 bg-black/18 p-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_30px_minmax(0,1fr)] items-center gap-2">
          <TeamName name={match.homeTeam?.name ?? 'ไม่ทราบทีม'} active={finalPick.pickSide === 'HOME'} />
          <span className="text-center text-xs font-black uppercase text-slate-500">vs</span>
          <TeamName name={match.awayTeam?.name ?? 'ไม่ทราบทีม'} active={finalPick.pickSide === 'AWAY'} align="right" />
        </div>
      </div>

      <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5">
        <ScoreBadge recommendation={recommendation} />
        <RiskBadge level={riskLevel} />
        <MarketDirectionBadge signal={waitingMarket ? 'SKIP' : aiPick.signal} compact />
        <span className="semantic-badge border-white/10 bg-white/[0.04] text-white">{confidence}%</span>
      </div>

      <p className="text-clamp-1 mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-1.5 text-xs font-black leading-5 text-slate-300">
        ตลาด: <span className="text-white">{formatMarketFocus(aiPick.marketFocus)}</span>
        <span className="text-slate-600"> · </span>
        <span className="text-[var(--page-accent)]">{formatDirection(aiPick.direction)}</span>
        <span className="text-slate-600"> · </span>
        <span className="text-slate-500">{odds.length ? 'มีข้อมูลราคา' : 'รอข้อมูลตลาด'}</span>
      </p>

      {reasons[0] ? (
        <p className="text-clamp-1 mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-1.5 text-xs font-semibold leading-5 text-slate-300">
          {reasons[0]}
        </p>
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

function TeamName({ name, active = false, align = 'left' }) {
  return (
    <p className={`text-clamp-1 text-[0.98rem] font-black leading-6 ${align === 'right' ? 'text-right' : ''} ${active ? 'text-emerald-100 underline decoration-emerald-300/60 underline-offset-4' : 'text-white'}`}>
      {name}
    </p>
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

  return [...new Set(rawReasons)].slice(0, 1)
}

function buildCardSummary(match, recommendation, confidence) {
  if (isWaitingForMarketData(match)) {
    return 'ข้อมูลยังไม่พร้อม รอข้อมูลตลาดอัปเดตรอบถัดไป'
  }
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
  const base = 'rounded-[18px] border bg-white/[0.045] shadow-[0_12px_32px_rgba(0,0,0,0.22)]'
  const first = rank === 1 ? 'shadow-[0_18px_44px_rgba(0,0,0,0.3)]' : ''

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

function formatDirection(value) {
  const text = String(value ?? '').trim()
  if (!text || text.toLowerCase() === 'no market direction') return 'ยังไม่มีทิศทางตลาด'
  return text
}
