const FINISHED_STATUSES = new Set(['FINISHED', 'FT', 'AET', 'PEN'])
const EVALUATED_RECOMMENDATIONS = new Set(['BET', 'LEAN'])

export function createPredictionSnapshot(input = {}, createdAt = new Date().toISOString()) {
  const analysis = input.analysis ?? {}
  const raw = analysis.raw ?? analysis
  const analysisBreakdown = raw.analysis_breakdown ?? {}
  const analysisVersion = raw.framework ?? analysis.framework ?? input.analysisVersion ?? 'unknown'

  return {
    match_id: input.matchId ?? input.match_id ?? input.id ?? null,
    fixture_id: String(input.fixtureId ?? input.fixture_id ?? input.apiFixtureId ?? input.api_fixture_id ?? ''),
    home_team: input.homeTeam?.name ?? input.home_team ?? null,
    away_team: input.awayTeam?.name ?? input.away_team ?? null,
    league: input.league?.name ?? input.league ?? null,
    kickoff: input.kickoffAt ?? input.kickoff_at ?? input.kickoff ?? null,
    recommendation: analysis.recommendation ?? input.recommendation ?? 'NO BET',
    confidence_score: numberValue(analysis.confidence_score ?? input.confidence_score ?? input.confidence),
    ranking_score: numberValue(input.rankingScore ?? input.ranking_score ?? raw.ranking_score ?? analysis.ranking_score ?? analysis.confidence_score ?? input.confidence_score),
    risk_level: analysis.risk_level ?? input.risk_level ?? input.riskLevel ?? 'medium',
    analysis_version: analysisVersion,
    predicted_outcome: input.predictedOutcome ?? input.predicted_outcome ?? inferPredictedOutcome(analysisBreakdown),
    raw_snapshot: {
      analysis_version: analysisVersion,
      analysis_breakdown: analysisBreakdown,
    },
    created_at: createdAt,
  }
}

export function addImmutableSnapshot(existingSnapshots, snapshot) {
  const key = getSnapshotKey(snapshot)
  if ((existingSnapshots ?? []).some((item) => getSnapshotKey(item) === key)) return existingSnapshots
  return [...(existingSnapshots ?? []), snapshot]
}

export function getResultTracking(match = {}) {
  const status = normalizeMatchStatus(match.status)
  const homeGoals = nullableNumber(match.homeGoals ?? match.home_goals)
  const awayGoals = nullableNumber(match.awayGoals ?? match.away_goals)
  const finished = FINISHED_STATUSES.has(status) && homeGoals !== null && awayGoals !== null

  return {
    status: finished ? 'finished' : 'pending',
    home_goals: homeGoals,
    away_goals: awayGoals,
    result: finished ? getResult(homeGoals, awayGoals) : null,
    finished_at: finished ? (match.finishedAt ?? match.finished_at ?? match.updatedAt ?? match.updated_at ?? new Date().toISOString()) : null,
  }
}

export function evaluatePrediction(snapshot = {}, result = {}) {
  if (result.status !== 'finished' || !result.result) {
    return {
      evaluation_status: 'pending',
      evaluation_reason: 'Result is not finished yet',
      evaluated_at: null,
    }
  }

  const recommendation = String(snapshot.recommendation ?? '').toUpperCase()
  if (!EVALUATED_RECOMMENDATIONS.has(recommendation)) {
    return {
      evaluation_status: 'no_evaluation',
      evaluation_reason: 'NO BET is tracked but not evaluated as a prediction',
      evaluated_at: new Date().toISOString(),
    }
  }

  const predicted = snapshot.predicted_outcome ?? inferPredictedOutcome(snapshot.raw_snapshot?.analysis_breakdown)
  if (!['home', 'draw', 'away'].includes(predicted)) {
    return {
      evaluation_status: 'no_evaluation',
      evaluation_reason: 'No explicit predicted outcome was available',
      evaluated_at: new Date().toISOString(),
    }
  }

  const correct = predicted === result.result
  return {
    evaluation_status: correct ? 'correct' : 'incorrect',
    evaluation_reason: correct ? 'Predicted outcome matched final result' : 'Predicted outcome did not match final result',
    evaluated_at: new Date().toISOString(),
  }
}

export function normalizePerformanceRows(snapshots = [], results = [], evaluations = []) {
  const resultBySnapshot = new Map(results.map((item) => [item.snapshot_id, item]))
  const evaluationBySnapshot = new Map(evaluations.map((item) => [item.snapshot_id, item]))
  return snapshots.map((snapshot) => ({
    ...snapshot,
    result: resultBySnapshot.get(snapshot.id) ?? null,
    evaluation: evaluationBySnapshot.get(snapshot.id) ?? null,
  }))
}

export function filterPerformanceRows(rows = [], filters = {}) {
  return rows.filter((row) => {
    if (filters.league && row.league !== filters.league) return false
    if (filters.recommendation && row.recommendation !== filters.recommendation) return false
    if (filters.version && row.analysis_version !== filters.version) return false
    if (filters.dateFrom && new Date(row.kickoff ?? row.created_at) < new Date(filters.dateFrom)) return false
    if (filters.dateTo && new Date(row.kickoff ?? row.created_at) > new Date(filters.dateTo)) return false
    return true
  })
}

export function calculatePerformanceMetrics(rows = []) {
  const totalPredictions = rows.length
  const totalBet = rows.filter((row) => row.recommendation === 'BET').length
  const totalLean = rows.filter((row) => row.recommendation === 'LEAN').length
  const totalNoBet = rows.filter((row) => row.recommendation === 'NO BET').length
  const correct = rows.filter((row) => row.evaluation?.evaluation_status === 'correct').length
  const incorrect = rows.filter((row) => row.evaluation?.evaluation_status === 'incorrect').length
  const evaluated = correct + incorrect
  const pending = rows.filter((row) => row.result?.status !== 'finished' || row.evaluation?.evaluation_status === 'pending').length

  return {
    totalPredictions,
    totalBet,
    totalLean,
    totalNoBet,
    correct,
    incorrect,
    pending,
    winRate: evaluated ? Math.round((correct / evaluated) * 100) : 0,
    accuracy: evaluated ? Math.round((correct / evaluated) * 100) : 0,
    averageConfidence: average(rows.map((row) => row.confidence_score)),
    averageRankingScore: average(rows.map((row) => row.ranking_score)),
    averageRisk: average(rows.map((row) => riskToNumber(row.risk_level))),
    evaluated,
    lastUpdate: rows.map((row) => row.evaluation?.updated_at ?? row.result?.updated_at ?? row.created_at).filter(Boolean).sort().at(-1) ?? null,
  }
}

export function getPerformanceReadiness(rows = [], minEvaluated = 10) {
  const metrics = calculatePerformanceMetrics(rows)

  if (!rows.length) {
    return {
      hasEnoughData: false,
      metrics,
      title: 'กำลังสะสมข้อมูล',
      message: 'ยังไม่มีข้อมูลเพียงพอสำหรับสรุป AI Performance',
    }
  }

  if (metrics.evaluated < minEvaluated) {
    return {
      hasEnoughData: false,
      metrics,
      title: 'ยังไม่มีข้อมูลเพียงพอ',
      message: `มีข้อมูลประเมินแล้ว ${metrics.evaluated}/${minEvaluated} คู่ ระบบจึงยังไม่สรุป Win Rate หรือ Accuracy เป็นสถิติจริง`,
    }
  }

  return {
    hasEnoughData: true,
    metrics,
    title: 'พร้อมสรุปผล',
    message: `สรุปจากข้อมูลที่ประเมินแล้ว ${metrics.evaluated} คู่`,
  }
}

export function buildPerformanceGroups(rows = []) {
  return {
    byLeague: groupMetrics(rows, (row) => row.league ?? 'Unknown'),
    byRecommendation: groupMetrics(rows, (row) => row.recommendation ?? 'Unknown'),
    byMonth: groupMetrics(rows, (row) => toMonthKey(row.kickoff ?? row.created_at)),
    byVersion: groupMetrics(rows, (row) => row.analysis_version ?? 'unknown'),
  }
}

export function buildTrendDatasets(rows = []) {
  const groups = buildPerformanceGroups(rows)
  return {
    winRateTimeline: Object.entries(groups.byMonth).map(([month, metrics]) => ({ month, winRate: metrics.winRate, evaluated: metrics.evaluated })),
    confidenceDistribution: bucketNumbers(rows.map((row) => row.confidence_score)),
    recommendationDistribution: Object.entries(groups.byRecommendation).map(([recommendation, metrics]) => ({ recommendation, total: metrics.totalPredictions })),
    leagueComparison: Object.entries(groups.byLeague).map(([league, metrics]) => ({ league, winRate: metrics.winRate, evaluated: metrics.evaluated })),
  }
}

export function getPerformanceContext(rows = [], version = '') {
  const scoped = version ? rows.filter((row) => row.analysis_version === version) : rows
  const metrics = calculatePerformanceMetrics(scoped)
  if (metrics.evaluated < 10) return 'กำลังสะสมข้อมูล'
  return `โมเดลเวอร์ชันนี้มี Win Rate ${metrics.winRate}% จากการประเมิน ${metrics.evaluated} คู่`
}

export function getPerformanceFilterOptions(rows = []) {
  return {
    leagues: unique(rows.map((row) => row.league).filter(Boolean)),
    recommendations: unique(rows.map((row) => row.recommendation).filter(Boolean)),
    versions: unique(rows.map((row) => row.analysis_version).filter(Boolean)),
  }
}

export function inferPredictedOutcome(analysisBreakdown = {}) {
  const data = analysisBreakdown?.data_intelligence ?? {}
  const leagueEdge = data.league_position?.edge
  const venueEdge = data.home_away_form?.advantage
  const h2hScore = numberValue(data.head_to_head?.score)
  const moduleHomeAdvantage = numberValue(analysisBreakdown?.home_away_advantage?.score)

  if (leagueEdge === 'home' || venueEdge === 'home') return 'home'
  if (leagueEdge === 'away' || venueEdge === 'away') return 'away'
  if (h2hScore >= 64 || moduleHomeAdvantage >= 65) return 'home'
  if (h2hScore > 0 && h2hScore <= 50) return 'away'
  return 'unknown'
}

function groupMetrics(rows, keyFn) {
  return rows.reduce((groups, row) => {
    const key = keyFn(row)
    groups[key] = calculatePerformanceMetrics([...(groups[key]?.rows ?? []), row])
    groups[key].rows = [...(groups[key].rows ?? []), row]
    return groups
  }, {})
}

function getSnapshotKey(snapshot) {
  return `${snapshot.match_id ?? ''}:${snapshot.analysis_version ?? ''}`
}

function getResult(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'home'
  if (homeGoals < awayGoals) return 'away'
  return 'draw'
}

function normalizeMatchStatus(status) {
  return String(status ?? '').toUpperCase()
}

function riskToNumber(level) {
  if (level === 'low') return 1
  if (level === 'high') return 3
  return 2
}

function toMonthKey(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'unknown'
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function bucketNumbers(values) {
  const buckets = [
    { label: '0-49', min: 0, max: 49, count: 0 },
    { label: '50-61', min: 50, max: 61, count: 0 },
    { label: '62-74', min: 62, max: 74, count: 0 },
    { label: '75-100', min: 75, max: 100, count: 0 },
  ]
  values.forEach((value) => {
    const numeric = numberValue(value)
    const bucket = buckets.find((item) => numeric >= item.min && numeric <= item.max)
    if (bucket) bucket.count += 1
  })
  return buckets
}

function average(values) {
  const numeric = values.map(numberValue).filter((value) => Number.isFinite(value))
  if (!numeric.length) return 0
  return Math.round(numeric.reduce((total, value) => total + value, 0) / numeric.length)
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)))
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}
