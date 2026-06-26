const CONFIDENCE_BINS = [
  { label: '40-49', min: 40, max: 49 },
  { label: '50-59', min: 50, max: 59 },
  { label: '60-69', min: 60, max: 69 },
  { label: '70-79', min: 70, max: 79 },
  { label: '80-89', min: 80, max: 89 },
  { label: '90-100', min: 90, max: 100 },
]

const MODULES = [
  { key: 'team_strength', label: 'Team Strength', path: ['team_strength'] },
  { key: 'recent_form', label: 'Recent Form', path: ['recent_form'] },
  { key: 'attack', label: 'Attack', path: ['attack_quality'] },
  { key: 'defense', label: 'Defense', path: ['defensive_stability'] },
  { key: 'home_away', label: 'Home Away', path: ['home_away_advantage'] },
  { key: 'market', label: 'Market', path: ['market_odds_risk'] },
  { key: 'football_intelligence', label: 'Football Intelligence', path: ['football_intelligence'] },
  { key: 'data_intelligence', label: 'Data Intelligence', path: ['data_intelligence'] },
]

export function analyzeModelPerformance(rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  const confidenceCalibration = buildConfidenceCalibration(normalizedRows)
  const leaguePerformance = buildLeaguePerformance(normalizedRows)
  const recommendationPerformance = buildRecommendationPerformance(normalizedRows)
  const riskPerformance = buildRiskPerformance(normalizedRows)
  const moduleEffectiveness = buildModuleEffectiveness(normalizedRows)
  const trends = buildCalibrationTrendData(normalizedRows)
  const overall = calculateAnalyzerMetrics(normalizedRows)
  const analysis = {
    overall,
    confidenceCalibration,
    leaguePerformance,
    recommendationPerformance,
    riskPerformance,
    moduleEffectiveness,
    trends,
  }

  return {
    ...analysis,
    calibrationSuggestions: buildCalibrationSuggestions({
      overall,
      confidenceCalibration,
      leaguePerformance,
      recommendationPerformance,
      riskPerformance,
      moduleEffectiveness,
    }),
    modelExplainability: buildModelExplainability(analysis),
  }
}

export function buildConfidenceCalibration(rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  return CONFIDENCE_BINS.map((bin) => {
    const binRows = normalizedRows.filter((row) => row.confidence_score >= bin.min && row.confidence_score <= bin.max)
    return {
      range: bin.label,
      min: bin.min,
      max: bin.max,
      ...calculateAnalyzerMetrics(binRows),
      averageRanking: average(binRows.map((row) => row.ranking_score)),
      averageRisk: average(binRows.map((row) => riskToNumber(row.risk_level))),
    }
  })
}

export function buildLeaguePerformance(rows = []) {
  return groupRows(rows.map(normalizePerformanceRow), (row) => row.league ?? 'Unknown')
    .map(([league, groupRowsForLeague]) => ({
      league,
      ...calculateAnalyzerMetrics(groupRowsForLeague),
      averageConfidence: average(groupRowsForLeague.map((row) => row.confidence_score)),
      averageRanking: average(groupRowsForLeague.map((row) => row.ranking_score)),
      recommendationDistribution: buildDistribution(groupRowsForLeague, (row) => row.recommendation ?? 'Unknown'),
    }))
    .sort((a, b) => b.predictions - a.predictions)
}

export function buildRecommendationPerformance(rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  return ['BET', 'LEAN', 'NO BET'].map((recommendation) => {
    const groupRowsForRecommendation = normalizedRows.filter((row) => row.recommendation === recommendation)
    const metrics = calculateAnalyzerMetrics(groupRowsForRecommendation)
    return {
      recommendation,
      predictions: groupRowsForRecommendation.length,
      correct: recommendation === 'NO BET' ? 0 : metrics.correct,
      incorrect: recommendation === 'NO BET' ? 0 : metrics.incorrect,
      pending: metrics.pending,
      noEvaluation: metrics.noEvaluation,
      accuracy: recommendation === 'NO BET' ? 0 : metrics.accuracy,
      averageConfidence: average(groupRowsForRecommendation.map((row) => row.confidence_score)),
      averageRisk: average(groupRowsForRecommendation.map((row) => riskToNumber(row.risk_level))),
    }
  })
}

export function buildRiskPerformance(rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  return ['low', 'medium', 'high'].map((riskLevel) => {
    const groupRowsForRisk = normalizedRows.filter((row) => row.risk_level === riskLevel)
    return {
      riskLevel,
      ...calculateAnalyzerMetrics(groupRowsForRisk),
      averageConfidence: average(groupRowsForRisk.map((row) => row.confidence_score)),
      averageRanking: average(groupRowsForRisk.map((row) => row.ranking_score)),
    }
  })
}

export function buildModuleEffectiveness(rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  return MODULES.map((module) => {
    const samples = normalizedRows
      .map((row) => ({
        row,
        score: getModuleScore(row, module),
      }))
      .filter((sample) => sample.score > 0)
    const correctSamples = samples.filter((sample) => sample.row.evaluation_status === 'correct')
    const incorrectSamples = samples.filter((sample) => sample.row.evaluation_status === 'incorrect')
    const highScoreSamples = samples.filter((sample) => sample.score >= 65)
    const highScoreMetrics = calculateAnalyzerMetrics(highScoreSamples.map((sample) => sample.row))
    const correctAverage = average(correctSamples.map((sample) => sample.score))
    const incorrectAverage = average(incorrectSamples.map((sample) => sample.score))
    const spread = correctSamples.length && incorrectSamples.length ? correctAverage - incorrectAverage : 0
    const effectivenessScore = Math.round(clamp(50 + spread * 1.2 + (highScoreMetrics.accuracy - 50) * 0.35, 0, 100))

    return {
      key: module.key,
      label: module.label,
      samples: samples.length,
      averageScore: average(samples.map((sample) => sample.score)),
      correctAverage,
      incorrectAverage,
      highScoreAccuracy: highScoreMetrics.accuracy,
      effectivenessScore,
    }
  }).sort((a, b) => b.effectivenessScore - a.effectivenessScore)
}

export function buildCalibrationSuggestions(analysis = {}) {
  const suggestions = []
  const weakBins = (analysis.confidenceCalibration ?? []).filter((bin) => bin.predictions >= 3 && bin.accuracy > 0 && bin.accuracy < 50)
  const strongModules = (analysis.moduleEffectiveness ?? []).filter((module) => module.samples >= 3 && module.effectivenessScore >= 68)
  const weakModules = (analysis.moduleEffectiveness ?? []).filter((module) => module.samples >= 3 && module.effectivenessScore <= 42)
  const riskyLevels = (analysis.riskPerformance ?? []).filter((risk) => risk.predictions >= 3 && risk.accuracy > 0 && risk.accuracy < analysis.overall?.accuracy)
  const lowDataAccuracy = (analysis.moduleEffectiveness ?? []).find((module) => module.key === 'data_intelligence')

  weakBins.forEach((bin) => {
    suggestions.push({
      type: 'confidence_calibration',
      title: `Confidence ${bin.range} needs review`,
      message: `ช่วง confidence ${bin.range} มี accuracy ${bin.accuracy}% จาก ${bin.predictions} predictions ควรตรวจว่าความมั่นใจสูง/ต่ำเกินจริงหรือไม่`,
    })
  })
  strongModules.slice(0, 3).forEach((module) => {
    suggestions.push({
      type: 'module_strength',
      title: `${module.label} tracks outcomes well`,
      message: `${module.label} มี effectiveness ${module.effectivenessScore}/100 จาก ${module.samples} samples อาจเป็นสัญญาณที่สัมพันธ์กับผลจริงสูง`,
    })
  })
  weakModules.slice(0, 3).forEach((module) => {
    suggestions.push({
      type: 'module_review',
      title: `${module.label} may be over/under weighted`,
      message: `${module.label} มี effectiveness ${module.effectivenessScore}/100 ควรรีวิวเชิงวิเคราะห์ แต่ระบบจะไม่ปรับน้ำหนักอัตโนมัติ`,
    })
  })
  riskyLevels.forEach((risk) => {
    suggestions.push({
      type: 'risk_calibration',
      title: `${risk.riskLevel} risk needs validation`,
      message: `กลุ่ม risk ${risk.riskLevel} มี accuracy ${risk.accuracy}% เทียบ overall ${analysis.overall?.accuracy ?? 0}% ควรตรวจความสัมพันธ์กับผลจริง`,
    })
  })
  if (lowDataAccuracy && lowDataAccuracy.samples < 3) {
    suggestions.push({
      type: 'data_confidence',
      title: 'Data Intelligence needs more samples',
      message: 'Data Intelligence ยังมีตัวอย่างไม่พอสำหรับสรุป calibration อย่างมั่นใจ',
    })
  }

  return suggestions.length ? suggestions : [{
    type: 'insufficient_data',
    title: 'Keep collecting data',
    message: 'ยังไม่มีสัญญาณ calibration ที่ชัดพอ ระบบจึงแนะนำให้สะสมผลจริงต่อไปก่อนปรับโมเดล',
  }]
}

export function buildModelExplainability(analysis = {}, options = {}) {
  const minSamples = options.minSamples ?? 3
  const overall = analysis.overall ?? {}
  const evaluated = overall.evaluated ?? 0
  const moduleEffectiveness = analysis.moduleEffectiveness ?? []
  const confidenceCalibration = analysis.confidenceCalibration ?? []
  const riskPerformance = analysis.riskPerformance ?? []

  const positiveModules = moduleEffectiveness
    .filter((module) => module.samples >= minSamples && module.effectivenessScore >= 60)
    .slice(0, 5)
    .map((module) => ({
      key: module.key,
      label: module.label,
      samples: module.samples,
      effectivenessScore: module.effectivenessScore,
      reason: `${module.label}: ${module.effectivenessScore}/100 จาก ${module.samples} samples`,
    }))

  const negativeModules = moduleEffectiveness
    .filter((module) => module.samples >= minSamples && module.effectivenessScore <= 45)
    .slice(0, 5)
    .map((module) => ({
      key: module.key,
      label: module.label,
      samples: module.samples,
      effectivenessScore: module.effectivenessScore,
      reason: `${module.label}: ${module.effectivenessScore}/100 จาก ${module.samples} samples`,
    }))

  const overconfidentBins = confidenceCalibration
    .filter((bin) => bin.predictions >= minSamples && bin.accuracy > 0 && bin.max - bin.accuracy >= 10)
    .map((bin) => ({
      range: bin.range,
      predictions: bin.predictions,
      accuracy: bin.accuracy,
      confidenceCeiling: bin.max,
      gap: roundOne(bin.max - bin.accuracy),
    }))

  const riskyRiskGroups = riskPerformance
    .filter((risk) => risk.predictions >= minSamples && risk.accuracy > 0 && risk.accuracy < (overall.accuracy ?? 0))
    .map((risk) => ({
      riskLevel: risk.riskLevel,
      predictions: risk.predictions,
      accuracy: risk.accuracy,
      overallAccuracy: overall.accuracy ?? 0,
      gap: roundOne((overall.accuracy ?? 0) - risk.accuracy),
    }))

  const hasEnoughData = evaluated >= minSamples || positiveModules.length || negativeModules.length || overconfidentBins.length || riskyRiskGroups.length

  return {
    hasEnoughData,
    message: hasEnoughData ? 'Model explainability พร้อมใช้จากผลย้อนหลังจริง' : 'กำลังสะสมข้อมูล',
    positiveModules,
    negativeModules,
    overconfidentBins,
    riskyRiskGroups,
  }
}

export function buildCalibrationTrendData(rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  return {
    accuracyTimeline: groupRows(normalizedRows, (row) => toMonthKey(row.kickoff ?? row.created_at))
      .map(([month, groupRowsForMonth]) => ({ month, accuracy: calculateAnalyzerMetrics(groupRowsForMonth).accuracy, predictions: groupRowsForMonth.length })),
    confidenceTimeline: groupRows(normalizedRows, (row) => toMonthKey(row.kickoff ?? row.created_at))
      .map(([month, groupRowsForMonth]) => ({ month, averageConfidence: average(groupRowsForMonth.map((row) => row.confidence_score)) })),
    recommendationTimeline: groupRows(normalizedRows, (row) => toMonthKey(row.kickoff ?? row.created_at))
      .map(([month, groupRowsForMonth]) => ({ month, distribution: buildDistribution(groupRowsForMonth, (row) => row.recommendation ?? 'Unknown') })),
    leagueTimeline: groupRows(normalizedRows, (row) => row.league ?? 'Unknown')
      .map(([league, groupRowsForLeague]) => ({ league, accuracy: calculateAnalyzerMetrics(groupRowsForLeague).accuracy, predictions: groupRowsForLeague.length })),
  }
}

export function getPredictionReliability(match = {}, rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  const confidence = numberValue(match.confidence ?? match.analysis?.confidence_score ?? match.analysis?.raw?.confidence_score)
  const league = match.league?.name ?? match.league
  const version = match.analysis?.raw?.framework ?? match.analysis?.raw?.analysis_version ?? match.analysis_version
  const dataConfidence = numberValue(match.analysis?.raw?.analysis_breakdown?.data_intelligence?.data_confidence?.score)
  const confidenceRange = findConfidenceBin(confidence)?.label ?? 'unknown'
  const confidenceRows = normalizedRows.filter((row) => findConfidenceBin(row.confidence_score)?.label === confidenceRange)
  const leagueRows = normalizedRows.filter((row) => row.league === league)
  const versionRows = normalizedRows.filter((row) => row.analysis_version === version)

  return {
    confidenceCalibration: calculateAnalyzerMetrics(confidenceRows).accuracy,
    historicalAccuracy: calculateAnalyzerMetrics(versionRows.length ? versionRows : normalizedRows).accuracy,
    leagueAccuracy: calculateAnalyzerMetrics(leagueRows).accuracy,
    dataConfidence,
    sampleSize: versionRows.length || normalizedRows.length,
    label: confidenceRows.length >= 5 || leagueRows.length >= 5 ? 'Prediction Reliability' : 'กำลังสะสมข้อมูล',
  }
}

export function exportPerformanceJson(rows = []) {
  return JSON.stringify(rows.map(normalizePerformanceRow), null, 2)
}

export function exportPerformanceCsv(rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  const headers = [
    'id',
    'match_id',
    'league',
    'recommendation',
    'confidence_score',
    'ranking_score',
    'risk_level',
    'analysis_version',
    'evaluation_status',
    'result_status',
    'kickoff',
    'created_at',
  ]
  const lines = normalizedRows.map((row) => headers.map((header) => escapeCsv(row[header])).join(','))
  return [headers.join(','), ...lines].join('\n')
}

export function calculateAnalyzerMetrics(rows = []) {
  const normalizedRows = rows.map(normalizePerformanceRow)
  const correct = normalizedRows.filter((row) => row.evaluation_status === 'correct').length
  const incorrect = normalizedRows.filter((row) => row.evaluation_status === 'incorrect').length
  const pending = normalizedRows.filter((row) => row.evaluation_status === 'pending' || row.result_status === 'pending').length
  const noEvaluation = normalizedRows.filter((row) => row.evaluation_status === 'no_evaluation').length
  const evaluated = correct + incorrect

  return {
    predictions: normalizedRows.length,
    correct,
    incorrect,
    pending,
    noEvaluation,
    evaluated,
    accuracy: evaluated ? roundOne((correct / evaluated) * 100) : 0,
    winRate: evaluated ? roundOne((correct / evaluated) * 100) : 0,
    averageConfidence: average(normalizedRows.map((row) => row.confidence_score)),
    averageRankingScore: average(normalizedRows.map((row) => row.ranking_score)),
    averageRisk: average(normalizedRows.map((row) => riskToNumber(row.risk_level))),
  }
}

function normalizePerformanceRow(row = {}) {
  return {
    ...row,
    confidence_score: numberValue(row.confidence_score),
    ranking_score: numberValue(row.ranking_score),
    risk_level: row.risk_level ?? 'medium',
    recommendation: row.recommendation ?? 'NO BET',
    analysis_version: row.analysis_version ?? row.raw?.analysis_version ?? row.raw_snapshot?.analysis_version ?? 'unknown',
    result_status: row.result?.status ?? row.result_status ?? 'pending',
    evaluation_status: row.evaluation?.evaluation_status ?? row.evaluation_status ?? 'pending',
  }
}

function getModuleScore(row, module) {
  const breakdown = row.raw?.analysis_breakdown ?? row.raw_snapshot?.analysis_breakdown ?? row.raw?.raw?.analysis_breakdown ?? {}
  const value = module.path.reduce((current, key) => current?.[key], breakdown)

  if (module.key === 'football_intelligence') return averageObjectScores(value)
  if (module.key === 'data_intelligence') return averageObjectScores(value)
  return numberValue(value?.score)
}

function averageObjectScores(value) {
  if (!value || typeof value !== 'object') return 0
  const scores = Object.values(value)
    .map((item) => numberValue(item?.score))
    .filter((score) => score > 0)
  return average(scores)
}

function groupRows(rows, keyFn) {
  const groups = new Map()
  rows.forEach((row) => {
    const key = keyFn(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  })
  return [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))
}

function buildDistribution(rows, keyFn) {
  return rows.reduce((distribution, row) => {
    const key = keyFn(row)
    distribution[key] = (distribution[key] ?? 0) + 1
    return distribution
  }, {})
}

function findConfidenceBin(confidence) {
  return CONFIDENCE_BINS.find((bin) => confidence >= bin.min && confidence <= bin.max) ?? null
}

function toMonthKey(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'unknown'
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function riskToNumber(level) {
  if (level === 'low') return 1
  if (level === 'high') return 3
  return 2
}

function escapeCsv(value) {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

function average(values) {
  const numeric = values.map(numberValue).filter((value) => Number.isFinite(value))
  if (!numeric.length) return 0
  return roundOne(numeric.reduce((total, value) => total + value, 0) / numeric.length)
}

function roundOne(value) {
  return Math.round(value * 10) / 10
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
