import { ChevronRight, Clock, Gauge, Goal, Percent } from 'lucide-react'
import { calculateAnalysisScore, calculateSelectionScore, getConfidence, getRecommendation } from '../utils/analysisEngine'
import RiskBadge from './RiskBadge'
import ScoreBadge from './ScoreBadge'

export default function MatchCard({ match, onOpen }) {
  const recommendation = match.recommendation ?? getRecommendation(match)
  const confidence = match.confidence ?? getConfidence(match)
  const analysisScore = match.totalAnalysisScore ?? calculateAnalysisScore(match)
  const selectionScore = match.selectionScore ?? calculateSelectionScore(match)
  const reasons = (match.supportReasons ?? []).filter(Boolean).slice(0, 4)

  return (
    <article className="rounded-lg border border-white/10 bg-pitch-800 p-4 shadow-glow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Clock size={14} />
              {match.time}
            </span>
            <span>{match.league}</span>
          </div>
          <h2 className="mt-2 text-xl font-bold leading-tight text-white">{match.homeTeam}</h2>
          <p className="text-sm font-semibold text-slate-400">vs {match.awayTeam}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ScoreBadge recommendation={recommendation} />
          <RiskBadge level={match.riskLevel} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <InfoTile icon={Gauge} label="AH ล่าสุด" value={match.ahLine} />
        <InfoTile icon={Goal} label="OU ล่าสุด" value={match.ouLine} />
        <InfoTile icon={Percent} label="ตลาดแนะนำ" value={match.recommendedMarket} />
        <InfoTile icon={Gauge} label="มั่นใจ" value={`${confidence}%`} />
      </div>

      <div className="mt-4 rounded-lg bg-white/[0.04] p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
          <span>Selection {selectionScore}/100</span>
          <span>Analysis {analysisScore}/100</span>
        </div>
        <ul className="space-y-1.5 text-sm text-slate-200">
          {reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => onOpen(match.id)}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 text-base font-bold text-pitch-950"
      >
        ดูวิเคราะห์เต็ม
        <ChevronRight size={20} />
      </button>
    </article>
  )
}

function InfoTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Icon size={14} />
        {label}
      </p>
      <p className="mt-1 text-sm font-bold text-white">{value || '-'}</p>
    </div>
  )
}
