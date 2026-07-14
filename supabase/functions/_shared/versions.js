export const systemVersions = Object.freeze({
  pipeline_version: 'daily-full-sync-safe-v1',
  selection_algorithm_version: 'market-ready-selection-v1',
  decision_gate_version: 'market-ready-hybrid-gate-v1',
  decision_model_version: 'football-intelligence-v3',
  market_quality_version: 'market-readiness-v1',
  analysis_engine_version: 'data-intelligence-v4',
})

export function getSystemVersions() {
  return { ...systemVersions }
}
