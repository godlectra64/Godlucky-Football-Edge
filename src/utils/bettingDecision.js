import { analyzeAsianHandicap } from './ahAnalysisEngine.js'
import { analyzeOverUnder } from './ouAnalysisEngine.js'

const finalRecommendations = ['BET', 'LEAN', 'NO BET']

export function buildSimpleBettingDecision(match = {}) {
  const stored = getStoredDecision(match)
  if (hasDecisionFields(stored)) return normalizeDecision(stored, match)

  const ahAnalysis = match.aiFinalPick?.ahAnalysis ?? match.ai_final_pick?.ah_analysis ?? analyzeAsianHandicap(match)
  const ouAnalysis = match.aiFinalPick?.ouAnalysis ?? match.ai_final_pick?.ou_analysis ?? analyzeOverUnder(match)
  const ahConfidence = scoreValue(ahAnalysis.confidenceScore ?? ahAnalysis.confidence_score)
  const ouConfidence = scoreValue(ouAnalysis.confidenceScore ?? ouAnalysis.confidence_score)
  const ahPick = buildAhPick(ahAnalysis.direction, ahConfidence)
  const ouPick = buildOuPick(ouAnalysis.direction, ouConfidence)
  const ahRecommendation = recommendationFromConfidence(ahConfidence)
  const ouRecommendation = recommendationFromConfidence(ouConfidence)
  const selectedMarket = chooseFinalMarket({ ahPick, ahConfidence, ouPick, ouConfidence })
  const finalConfidence = selectedMarket === 'AH' ? ahConfidence : selectedMarket === 'OU' ? ouConfidence : Math.max(ahConfidence, ouConfidence)
  const finalRecommendation = selectedMarket === 'NO BET' ? 'NO BET' : recommendationFromConfidence(finalConfidence)

  return {
    ah_pick: ahPick,
    ah_confidence: ahConfidence,
    ah_reason: buildAhReason(ahPick, ahConfidence, ahRecommendation),
    ou_pick: ouPick,
    ou_confidence: ouConfidence,
    ou_reason: buildOuReason(ouPick, ouConfidence, ouRecommendation),
    final_pick: finalRecommendation === 'NO BET' ? 'NO BET' : selectedMarket,
    final_recommendation: finalRecommendation,
    final_reason: buildFinalReason(selectedMarket, finalRecommendation, ahConfidence, ouConfidence),
  }
}

export function recommendationFromConfidence(confidence) {
  const score = scoreValue(confidence)
  if (score >= 75) return 'BET'
  if (score >= 60) return 'LEAN'
  return 'NO BET'
}

export function getDecisionConfidence(decision = {}) {
  if (decision.final_pick === 'AH') return scoreValue(decision.ah_confidence)
  if (decision.final_pick === 'OU') return scoreValue(decision.ou_confidence)
  return Math.max(scoreValue(decision.ah_confidence), scoreValue(decision.ou_confidence))
}

function normalizeDecision(value = {}, match = {}) {
  const fallback = {
    ah_pick: null,
    ah_confidence: null,
    ah_reason: null,
    ou_pick: null,
    ou_confidence: null,
    ou_reason: null,
    final_pick: null,
    final_recommendation: null,
    final_reason: null,
  }
  const merged = { ...fallback, ...value }
  const ahConfidence = scoreValue(merged.ah_confidence ?? merged.ahConfidence)
  const ouConfidence = scoreValue(merged.ou_confidence ?? merged.ouConfidence)
  const ahPick = normalizePickText(merged.ah_pick ?? merged.ahPick) ?? buildAhPick(analyzeAsianHandicap(match).direction, ahConfidence)
  const ouPick = normalizePickText(merged.ou_pick ?? merged.ouPick) ?? buildOuPick(analyzeOverUnder(match).direction, ouConfidence)
  const selectedMarket = normalizeFinalPick(merged.final_pick ?? merged.finalPick) ?? chooseFinalMarket({ ahPick, ahConfidence, ouPick, ouConfidence })
  const finalRecommendation = normalizeFinalRecommendation(merged.final_recommendation ?? merged.finalRecommendation)
    ?? recommendationFromConfidence(selectedMarket === 'AH' ? ahConfidence : selectedMarket === 'OU' ? ouConfidence : Math.max(ahConfidence, ouConfidence))

  return {
    ah_pick: ahPick,
    ah_confidence: ahConfidence,
    ah_reason: firstText(merged.ah_reason, merged.ahReason) ?? buildAhReason(ahPick, ahConfidence, recommendationFromConfidence(ahConfidence)),
    ou_pick: ouPick,
    ou_confidence: ouConfidence,
    ou_reason: firstText(merged.ou_reason, merged.ouReason) ?? buildOuReason(ouPick, ouConfidence, recommendationFromConfidence(ouConfidence)),
    final_pick: finalRecommendation === 'NO BET' ? 'NO BET' : selectedMarket,
    final_recommendation: finalRecommendation,
    final_reason: firstText(merged.final_reason, merged.finalReason) ?? buildFinalReason(selectedMarket, finalRecommendation, ahConfidence, ouConfidence),
  }
}

function getStoredDecision(match = {}) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis ?? match.match_analysis ?? {}
  return match.bettingDecision
    ?? match.betting_decision
    ?? match.aiFinalPick?.bettingDecision
    ?? match.ai_final_pick?.betting_decision
    ?? analysis.betting_decision
    ?? analysis.raw?.betting_decision
    ?? null
}

function hasDecisionFields(value) {
  if (!value || typeof value !== 'object') return false
  return Boolean(
    value.ah_pick
      ?? value.ahPick
      ?? value.ou_pick
      ?? value.ouPick
      ?? value.final_pick
      ?? value.finalPick,
  )
}

function buildAhPick(direction, confidence) {
  if (scoreValue(confidence) < 60) return 'NO BET'
  const text = String(direction ?? '').trim()
  const side = text.toLowerCase().startsWith('away') ? 'AWAY' : 'HOME'
  const line = text.match(/[+-]?\d+(?:\.\d+)?/)?.[0] ?? '+0.25'
  return `${side} ${line.startsWith('-') || line.startsWith('+') ? line : `+${line}`}`
}

function buildOuPick(direction, confidence) {
  if (scoreValue(confidence) < 60) return 'NO BET'
  const text = String(direction ?? '').trim()
  const side = text.toLowerCase().startsWith('under') ? 'UNDER' : 'OVER'
  const line = text.match(/\d+(?:\.\d+)?/)?.[0] ?? '2.5'
  return `${side} ${line}`
}

function chooseFinalMarket({ ahPick, ahConfidence, ouPick, ouConfidence }) {
  const ahAvailable = ahPick !== 'NO BET' && ahConfidence >= 60
  const ouAvailable = ouPick !== 'NO BET' && ouConfidence >= 60
  if (!ahAvailable && !ouAvailable) return 'NO BET'
  if (ahAvailable && !ouAvailable) return 'AH'
  if (ouAvailable && !ahAvailable) return 'OU'
  return ahConfidence >= ouConfidence ? 'AH' : 'OU'
}

function buildAhReason(pick, confidence, recommendation) {
  if (pick === 'NO BET' || recommendation === 'NO BET') return `คะแนน AH ${confidence}% ต่ำกว่าเกณฑ์ 60 จึงไม่เลือกฝั่งนี้`
  const side = pick.startsWith('HOME') ? 'เจ้าบ้าน' : 'ทีมเยือน'
  return `คะแนน AH ${confidence}% หนุนฝั่ง${side} ชัดกว่าอีกฝั่ง`
}

function buildOuReason(pick, confidence, recommendation) {
  if (pick === 'NO BET' || recommendation === 'NO BET') return `คะแนน O/U ${confidence}% ต่ำกว่าเกณฑ์ 60 จึงไม่เลือกสูง/ต่ำ`
  const side = pick.startsWith('UNDER') ? 'Under' : 'Over'
  return `คะแนน O/U ${confidence}% หนุน ${side} ตามจังหวะเกมและไลน์`
}

function buildFinalReason(finalPick, finalRecommendation, ahConfidence, ouConfidence) {
  if (finalRecommendation === 'NO BET' || finalPick === 'NO BET') {
    return `AH ${ahConfidence}% และ O/U ${ouConfidence}% ยังไม่ถึงเกณฑ์ 60`
  }
  const label = finalPick === 'AH' ? 'AH' : 'O/U'
  return `เลือก ${label} เพราะความมั่นใจสูงกว่าอีกตลาด (${ahConfidence}% vs ${ouConfidence}%)`
}

function normalizePickText(value) {
  const text = firstText(value)
  return text ? text.toUpperCase().replace(/\s+/g, ' ') : null
}

function normalizeFinalPick(value) {
  const text = String(value ?? '').toUpperCase().replace('_', ' ')
  return ['AH', 'OU', 'NO BET'].includes(text) ? text : null
}

function normalizeFinalRecommendation(value) {
  const text = String(value ?? '').toUpperCase().replace('_', ' ')
  return finalRecommendations.includes(text) ? text : null
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

function scoreValue(value) {
  const numeric = Number(value)
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(numeric) ? numeric : 0)))
}
