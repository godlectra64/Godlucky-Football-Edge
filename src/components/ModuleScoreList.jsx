import { getModuleScores } from '../utils/analysisEngine'

export default function ModuleScoreList({ match }) {
  return (
    <div className="space-y-3">
      {getModuleScores(match).map(({ key, label, score, max }) => (
        <div key={key}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-200">{label}</span>
            <span className="font-semibold text-white">{score}/{max}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.round((score / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
