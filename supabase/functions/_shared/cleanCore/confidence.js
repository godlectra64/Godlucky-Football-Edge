import { CONFIDENCE_COMPONENT_WEIGHTS, FIXTURE_ONLY_CONFIDENCE_CAP, RISK_LEVEL } from './contracts.js'

export function calculateDecisionConfidence(input = {}) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const components = Object.fromEntries(
    Object.entries(CONFIDENCE_COMPONENT_WEIGHTS).map(([name, weight]) => [name, round(normalizedScore(source[name]) * weight)]),
  )
  const penalties = {
    riskPenalty: normalizedPenalty(source.riskPenalty),
    missingDataPenalty: normalizedPenalty(source.missingDataPenalty),
    contradictionPenalty: normalizedPenalty(source.contradictionPenalty),
  }
  const componentTotal = round(Object.values(components).reduce((sum, value) => sum + value, 0))
  const penaltyTotal = round(Object.values(penalties).reduce((sum, value) => sum + value, 0))
  const rawScore = round(componentTotal - penaltyTotal)
  const uncappedScore = round(clamp(rawScore))
  let score = uncappedScore
  let capReason = null

  if (source.fixtureOnly === true && score > FIXTURE_ONLY_CONFIDENCE_CAP) {
    score = FIXTURE_ONLY_CONFIDENCE_CAP
    capReason = 'FIXTURE_ONLY'
  }
  if (String(source.riskLevel ?? source.risk ?? '').toUpperCase() === RISK_LEVEL.CRITICAL) {
    if (score > 0) score = 0
    capReason = 'RISK_CRITICAL'
  }

  return {
    score,
    capped: score !== uncappedScore,
    capReason,
    components,
    penalties,
    componentTotal,
    penaltyTotal,
    rawScore,
    uncappedScore,
  }
}

function normalizedScore(value) {
  if (!['number', 'string'].includes(typeof value) || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clamp(parsed) : 0
}

function normalizedPenalty(value) {
  if (!['number', 'string'].includes(typeof value) || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clamp(parsed) : 0
}

function clamp(value) {
  return Math.min(100, Math.max(0, value))
}

function round(value) {
  return Math.round(value * 100) / 100
}
