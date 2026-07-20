import { FIXTURE_ONLY_CONFIDENCE_CAP, RISK_LEVEL } from './contracts.js'

const COMPONENT_WEIGHTS = Object.freeze({
  dataQuality: 0.25,
  analysisQuality: 0.25,
  modelAgreement: 0.2,
  marketCompleteness: 0.15,
  marketFreshness: 0.15,
})

export function calculateDecisionConfidence(input = {}) {
  const components = Object.fromEntries(
    Object.entries(COMPONENT_WEIGHTS).map(([name, weight]) => [name, round(normalizedScore(input[name]) * weight)]),
  )
  const penalties = {
    riskPenalty: normalizedPenalty(input.riskPenalty),
    missingDataPenalty: normalizedPenalty(input.missingDataPenalty),
    contradictionPenalty: normalizedPenalty(input.contradictionPenalty),
  }
  const componentTotal = round(Object.values(components).reduce((sum, value) => sum + value, 0))
  const penaltyTotal = round(Object.values(penalties).reduce((sum, value) => sum + value, 0))
  const rawScore = round(componentTotal - penaltyTotal)
  const uncappedScore = round(clamp(rawScore))
  let score = uncappedScore
  let capReason = null

  if (input.fixtureOnly === true && score > FIXTURE_ONLY_CONFIDENCE_CAP) {
    score = FIXTURE_ONLY_CONFIDENCE_CAP
    capReason = 'FIXTURE_ONLY'
  }
  if (String(input.riskLevel ?? input.risk ?? '').toUpperCase() === RISK_LEVEL.CRITICAL && score > 0) {
    score = 0
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
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clamp(parsed) : 0
}

function normalizedPenalty(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clamp(parsed) : 0
}

function clamp(value) {
  return Math.min(100, Math.max(0, value))
}

function round(value) {
  return Math.round(value * 100) / 100
}
