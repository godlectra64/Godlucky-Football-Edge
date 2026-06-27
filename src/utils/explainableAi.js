import { normalizeDataPlatform } from './dataPlatform.js'

const LIMITED_DATA = 'ข้อมูลจำกัด'
const CONTRIBUTION_LIMIT = 10

export function buildExplainableAi(input = {}) {
  const platform = hasPlatformShape(input) ? input : normalizeDataPlatform(input)
  const breakdown = platform.analysis?.breakdown ?? {}
  const baseConfidence = findBaseConfidence(platform, breakdown)
  const finalConfidence = clampScore(platform.analysis?.confidence ?? platform.prediction?.confidence ?? baseConfidence)
  const contributions = [
    buildBaseContribution(baseConfidence),
    ...buildModuleContributions(breakdown),
    buildFootballIntelligenceContribution(breakdown),
    buildDataIntelligenceContribution(breakdown),
    buildRankingContribution(platform.ranking?.score),
    buildRiskContribution(platform.analysis?.riskLevel),
    buildDataConfidenceContribution(breakdown),
  ].filter(Boolean)

  if (contributions.length <= 1) {
    contributions.push({
      key: 'limited_data',
      label: LIMITED_DATA,
      type: 'neutral',
      value: 0,
      reason: 'ยังไม่มีข้อมูลประกอบเพียงพอสำหรับแยกปัจจัย',
    })
  }

  const boundedContributions = contributions.map((item) => ({
    ...item,
    value: boundContribution(item.value),
    type: item.type ?? toneFromValue(item.value),
  }))

  return {
    baseConfidence,
    finalConfidence,
    recommendation: platform.analysis?.recommendation ?? 'NO BET',
    riskImpact: getRiskImpact(platform.analysis?.riskLevel),
    dataConfidenceImpact: getDataConfidenceImpact(breakdown),
    positive: boundedContributions.filter((item) => item.type === 'positive'),
    negative: boundedContributions.filter((item) => item.type === 'negative'),
    neutral: boundedContributions.filter((item) => item.type === 'neutral'),
    contributions: boundedContributions,
    summary: buildSummary(baseConfidence, finalConfidence, boundedContributions),
  }
}

function buildBaseContribution(baseConfidence) {
  return {
    key: 'base_confidence',
    label: 'Base Confidence',
    type: 'neutral',
    value: 0,
    score: baseConfidence,
    reason: `จุดตั้งต้นของโมเดลอยู่ที่ ${baseConfidence}%`,
  }
}

function buildModuleContributions(breakdown) {
  const moduleMap = [
    ['team_strength', 'Team Strength'],
    ['recent_form', 'Recent Form'],
    ['attack_quality', 'Attack Quality'],
    ['defensive_stability', 'Defensive Stability'],
    ['home_away_advantage', 'Home/Away'],
    ['motivation_context', 'Motivation'],
    ['market_odds_risk', 'Market Risk'],
  ]

  return moduleMap
    .map(([key, label]) => {
      const module = breakdown[key]
      const score = numberOrNull(module?.score)
      if (score === null) return null
      const rawValue = (score - 58) / 5
      return {
        key,
        label,
        score,
        value: rawValue,
        type: toneFromValue(rawValue),
        reason: module?.reason || `${label} score ${Math.round(score)}/100`,
      }
    })
    .filter(Boolean)
}

function buildFootballIntelligenceContribution(breakdown) {
  const intelligence = breakdown.football_intelligence
  if (!intelligence || typeof intelligence !== 'object') return null
  const scores = Object.entries(intelligence)
    .filter(([key]) => key !== 'ai_explanation')
    .map(([, value]) => numberOrNull(value?.score))
    .filter((score) => score !== null)
  if (!scores.length) return null
  const averageScore = average(scores)
  const value = (averageScore - 58) / 6
  return {
    key: 'football_intelligence',
    label: 'Football Intelligence',
    score: averageScore,
    value,
    type: toneFromValue(value),
    reason: intelligence.ai_explanation?.summary || `Football Intelligence average ${Math.round(averageScore)}/100`,
  }
}

function buildDataIntelligenceContribution(breakdown) {
  const intelligence = breakdown.data_intelligence
  if (!intelligence || typeof intelligence !== 'object') return null
  const scores = Object.entries(intelligence)
    .filter(([key]) => key !== 'data_confidence')
    .map(([, value]) => numberOrNull(value?.score))
    .filter((score) => score !== null)
  if (!scores.length) return null
  const averageScore = average(scores)
  const value = (averageScore - 58) / 6
  return {
    key: 'data_intelligence',
    label: 'Data Intelligence',
    score: averageScore,
    value,
    type: toneFromValue(value),
    reason: `Data Intelligence average ${Math.round(averageScore)}/100`,
  }
}

function buildRankingContribution(rankingScore) {
  const score = numberOrNull(rankingScore)
  if (score === null) return null
  const value = (score - 65) / 8
  return {
    key: 'ranking_score',
    label: 'Ranking Score',
    score,
    value,
    type: toneFromValue(value),
    reason: `Ranking score ${Math.round(score)}/100`,
  }
}

function buildRiskContribution(riskLevel) {
  const impact = getRiskImpact(riskLevel)
  return {
    key: 'risk_level',
    label: 'Risk Impact',
    value: impact.value,
    type: toneFromValue(impact.value),
    reason: impact.reason,
  }
}

function buildDataConfidenceContribution(breakdown) {
  const score = numberOrNull(breakdown.data_intelligence?.data_confidence?.score)
  if (score === null) return null
  const impact = getDataConfidenceImpact(breakdown)
  return {
    key: 'data_confidence',
    label: 'Data Confidence',
    score,
    value: impact.value,
    type: toneFromValue(impact.value),
    reason: impact.reason,
  }
}

function getRiskImpact(riskLevel = 'medium') {
  const normalized = String(riskLevel).toLowerCase()
  if (normalized === 'low') return { value: 2, label: 'Low Risk', reason: 'ความเสี่ยงต่ำช่วยหนุนความมั่นใจ' }
  if (normalized === 'high') return { value: -6, label: 'High Risk', reason: 'ความเสี่ยงสูงกดคะแนนความมั่นใจ' }
  return { value: -2, label: 'Medium Risk', reason: 'ความเสี่ยงระดับกลางทำให้โมเดลระมัดระวัง' }
}

function getDataConfidenceImpact(breakdown) {
  const score = numberOrNull(breakdown.data_intelligence?.data_confidence?.score)
  if (score === null) return { value: 0, label: LIMITED_DATA, reason: 'ยังไม่มี data confidence แยกชัดเจน' }
  if (score >= 75) return { value: 3, label: 'High Data Confidence', reason: `data confidence ${Math.round(score)}% ช่วยหนุนผลวิเคราะห์` }
  if (score < 45) return { value: -4, label: 'Low Data Confidence', reason: `data confidence ${Math.round(score)}% ทำให้ต้องลดความมั่นใจ` }
  return { value: 0, label: 'Medium Data Confidence', reason: `data confidence ${Math.round(score)}% อยู่ในระดับกลาง` }
}

function findBaseConfidence(platform, breakdown) {
  const rawCandidates = [
    breakdown.base_confidence?.score,
    breakdown.base_confidence_score,
    platform.analysis?.baseConfidence,
    platform.match?.raw?.base_confidence_score,
    platform.analysis?.confidence,
    platform.prediction?.confidence,
  ]
  const value = rawCandidates.map(numberOrNull).find((item) => item !== null)
  return clampScore(value ?? 0)
}

function buildSummary(baseConfidence, finalConfidence, contributions) {
  const positiveCount = contributions.filter((item) => item.type === 'positive').length
  const negativeCount = contributions.filter((item) => item.type === 'negative').length
  if (!positiveCount && !negativeCount) return 'กำลังสะสมข้อมูลสำหรับอธิบายคะแนน'
  return `เริ่มจาก ${baseConfidence}% แล้วปรับเป็น ${finalConfidence}% จากปัจจัยบวก ${positiveCount} รายการ และปัจจัยลบ ${negativeCount} รายการ`
}

function hasPlatformShape(input) {
  return Boolean(input?.match && input?.teams && input?.analysis)
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function toneFromValue(value) {
  if (value > 0.4) return 'positive'
  if (value < -0.4) return 'negative'
  return 'neutral'
}

function boundContribution(value) {
  return Math.round(clamp(Number(value ?? 0), -CONTRIBUTION_LIMIT, CONTRIBUTION_LIMIT) * 10) / 10
}

function clampScore(value) {
  return Math.round(clamp(Number(value ?? 0), 0, 100))
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
