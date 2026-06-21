import { analysisModuleLabels } from '../data/demoMatches'

export default function ModuleScoreList({ modules }) {
  return (
    <div className="space-y-3">
      {Object.entries(analysisModuleLabels).map(([key, label]) => {
        const score = Number(modules?.[key] ?? 0)
        return (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-200">{label}</span>
              <span className="font-semibold text-white">{score}/10</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${score * 10}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
