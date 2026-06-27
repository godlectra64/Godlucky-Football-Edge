import {
  calculateFootballMasterAnalysis,
  footballMasterModules,
  getAnalysisSummary,
  getConfidence,
  getRecommendation,
  getRiskLevel,
} from './analysisEngine.js'
import { dataIntelligenceSections, normalizeDataIntelligence } from './dataIntelligence.js'
import { buildAiFinalPick } from './finalPick.js'
import { deriveAiPickSide, getAiPickDisplay } from './pickSide.js'

const intelligenceFallback = {
  h2h: { score: 58, confidence: 'low', reason: 'ยังไม่มีข้อมูล H2H เพียงพอ', signals: ['missing_h2h'] },
  league_context: { type: 'unknown', score: 58, risk_modifier: 0, reason: 'ยังจำแนกประเภทการแข่งขันไม่ได้ชัด จึงให้ค่ากลาง' },
  rest_days: { home_rest_days: null, away_rest_days: null, score: 58, advantage: 'none', reason: 'ยังไม่มีข้อมูลวันพักทีมล่าสุด' },
  schedule_difficulty: { score: 58, difficulty: 'unknown', reason: 'ยังไม่มีข้อมูลคุณภาพคู่แข่ง 3-5 นัดล่าสุดเพียงพอ', confidence: 'low' },
  squad_context: { score: 58, confidence: 'low', reason: 'ยังไม่มีข้อมูลตัวผู้เล่น/อาการบาดเจ็บเพียงพอ', signals: ['missing_squad_data'] },
  momentum: { score: 56, momentum: 'unknown', signals: ['missing_detailed_form'], reason: 'ยังไม่มีข้อมูลโมเมนตัมละเอียด จึงไม่เดาเพิ่มจากข้อมูลที่ไม่มี' },
  match_importance: { score: 58, importance: 'unknown', risk_modifier: 0, reason: 'ยังไม่มี league table context เพียงพอ จึงไม่สรุป must-win เอง' },
  ai_explanation: { summary: 'Football intelligence v3 ใช้ข้อมูลที่มีแบบระมัดระวัง', signals: [], data_confidence: 'low' },
  modifier: 0,
  signals: [],
}

export function getMatchRoute(matchId) {
  return `/match/${encodeURIComponent(matchId ?? '')}`
}

export function getScoreLabel(score) {
  const value = Number(score ?? 0)
  if (value >= 75) return { scoreLabel: 'ดี', tone: 'good' }
  if (value >= 55) return { scoreLabel: 'กลาง', tone: 'medium' }
  return { scoreLabel: 'เสี่ยง', tone: 'risk' }
}

export function getRiskLabel(risk) {
  const normalized = ['low', 'medium', 'high'].includes(String(risk).toLowerCase()) ? String(risk).toLowerCase() : 'medium'
  const labels = { low: 'ต่ำ', medium: 'กลาง', high: 'สูง' }
  return { value: normalized, label: labels[normalized] }
}

export function formatRecommendation(recommendation) {
  return ['BET', 'LEAN', 'WATCH', 'NO BET'].includes(recommendation) ? recommendation : 'NO BET'
}

export function extractAnalysisBreakdown(match) {
  const rawBreakdown = match?.analysisBreakdown ?? match?.analysis?.raw?.analysis_breakdown ?? match?.match_analysis?.raw?.analysis_breakdown
  if (rawBreakdown) return rawBreakdown
  return calculateFootballMasterAnalysis(match ?? {}).analysisBreakdown
}

export function extractFootballIntelligence(match) {
  const breakdown = extractAnalysisBreakdown(match)
  return {
    ...intelligenceFallback,
    ...(breakdown?.football_intelligence ?? {}),
    ai_explanation: {
      ...intelligenceFallback.ai_explanation,
      ...(breakdown?.football_intelligence?.ai_explanation ?? {}),
    },
  }
}

export function extractDataIntelligence(match) {
  const breakdown = extractAnalysisBreakdown(match)
  return normalizeDataIntelligence(breakdown?.data_intelligence, match)
}

export function getModuleBreakdownItems(match) {
  const breakdown = extractAnalysisBreakdown(match)
  const items = footballMasterModules.map((module) => {
    const item = breakdown?.[module.breakdownKey] ?? {}
    return {
      key: module.breakdownKey,
      label: module.label,
      score: Math.round(clamp(Number(item.score ?? 0), 0, 100)),
      reason: item.reason || 'ข้อมูลจำกัด',
      ...getScoreLabel(item.score),
    }
  })
  const overallRisk = breakdown?.overall_risk ?? {}
  return [
    ...items,
    {
      key: 'overall_risk',
      label: 'Overall Risk',
      score: riskToScore(overallRisk.level),
      reason: overallRisk.reason || 'ข้อมูลจำกัด',
      ...riskToScoreLabel(overallRisk.level),
    },
  ]
}

export function getDataQuality(match) {
  const breakdown = extractAnalysisBreakdown(match)
  const intelligence = extractFootballIntelligence(match)
  const raw = match?.analysis?.raw ?? {}
  const available = []
  const missing = []

  addQuality(Boolean(match?.id), 'Fixtures', available, missing)
  addQuality(Boolean(match?.homeTeam?.name && match?.awayTeam?.name), 'Team names', available, missing)
  addQuality(Boolean(match?.league?.name), 'Competition', available, missing)
  addQuality(Boolean(breakdown), 'Analysis breakdown', available, missing)
  addQuality(Boolean(breakdown?.football_intelligence), 'Football intelligence', available, missing)
  addQuality(Boolean(breakdown?.data_intelligence), 'Data intelligence', available, missing)
  addQuality(Boolean(raw.odds || raw.market || raw.bookmakers), 'Odds movement', available, missing)
  addQuality(Boolean(raw.ahLine || raw.ouLine || raw.odds), 'AH / OU line', available, missing)
  addQuality(intelligence.squad_context?.confidence !== 'low', 'Confirmed lineup / injuries', available, missing)
  addQuality(intelligence.h2h?.confidence !== 'low', 'H2H จริง', available, missing)

  const score = Math.round((available.length / Math.max(available.length + missing.length, 1)) * 100)
  return { score, available, missing }
}

export function normalizeDetailPayload(match) {
  const safeMatch = match ?? {}
  const breakdown = extractAnalysisBreakdown(safeMatch)
  const intelligence = extractFootballIntelligence(safeMatch)
  const dataIntelligence = extractDataIntelligence(safeMatch)
  const dataQuality = getDataQuality(safeMatch)
  const rankingScore = Math.round(safeMatch.rankingScore ?? safeMatch.ranking_score ?? safeMatch.analysis?.raw?.ranking_score ?? getConfidence(safeMatch))
  const aiPick = deriveAiPickSide(safeMatch)
  const aiPickDisplay = getAiPickDisplay(safeMatch)
  const finalPick = buildAiFinalPick(safeMatch)

  return {
    ...safeMatch,
    recommendation: formatRecommendation(getRecommendation(safeMatch)),
    confidence: getConfidence(safeMatch),
    riskLevel: getRiskLevel(safeMatch),
    rankingScore,
    rank: safeMatch.rank ?? null,
    aiPickRank: safeMatch.aiPickRank ?? safeMatch.ai_pick_rank ?? safeMatch.rank ?? null,
    aiPickLabel: safeMatch.aiPickLabel ?? safeMatch.ai_pick_label ?? (safeMatch.rank ? `AI PICK #${safeMatch.rank}` : ''),
    pickSide: aiPick.pickSide,
    pickTeam: aiPick.pickTeam,
    pickReason: aiPick.pickReason,
    aiPickDisplay,
    finalPick,
    rankReason: safeMatch.rankReason ?? safeMatch.rank_reason ?? 'ข้อมูลอันดับยังจำกัด',
    rankBadges: safeMatch.rankBadges ?? safeMatch.rank_badges ?? [],
    analysisSummary: getAnalysisSummary(safeMatch),
    analysisBreakdown: breakdown,
    footballIntelligence: intelligence,
    dataIntelligence,
    dataIntelligenceItems: getDataIntelligenceItems(dataIntelligence),
    moduleItems: getModuleBreakdownItems(safeMatch),
    dataQuality,
  }
}

export function buildAiVerdict(match) {
  const detail = normalizeDetailPayload(match)
  const intelligence = detail.footballIntelligence
  const reasons = [
    detail.rankReason,
    detail.analysisSummary,
    intelligence.momentum?.reason,
    intelligence.league_context?.reason,
  ].filter(Boolean)
  const cautions = buildRiskFactors(detail).slice(0, 5)
  const playable = detail.recommendation === 'BET'
    ? 'เหมาะพิจารณาเล่นได้ แต่ยังต้องตรวจ lineup และตลาดก่อนแข่ง'
    : detail.recommendation === 'LEAN'
      ? 'เหมาะติดตามหรือรอข้อมูลเพิ่ม ยังไม่ใช่จุด BET เต็ม'
      : 'ไม่เหมาะเล่นก่อนข้อมูลชัดขึ้น'

  return {
    verdict: detail.recommendation,
    reasons: uniqueSentences(reasons).slice(0, 5),
    cautions,
    playable,
  }
}

export function buildRiskFactors(detail) {
  const factors = []
  const intelligence = detail.footballIntelligence ?? extractFootballIntelligence(detail)
  const dataIntelligence = detail.dataIntelligence ?? extractDataIntelligence(detail)
  const consistency = detail.analysisBreakdown?.overall_risk?.reason

  if (String(detail.riskLevel).toLowerCase() === 'high') factors.push('ความเสี่ยงรวมอยู่ระดับสูง จึงไม่ควรบังคับเล่น')
  if (intelligence.h2h?.confidence === 'low') factors.push('ข้อมูล H2H ยังจำกัด')
  if (intelligence.squad_context?.confidence === 'low') factors.push('ยังไม่มีข้อมูลตัวผู้เล่น/อาการบาดเจ็บเพียงพอ')
  if (intelligence.league_context?.risk_modifier > 0) factors.push('บริบทการแข่งขันมีความผันผวน')
  if (intelligence.match_importance?.risk_modifier > 0) factors.push('ความสำคัญของเกมเพิ่ม variance')
  if (detail.dataQuality?.missing?.includes('Odds movement')) factors.push('ยังไม่มีราคาบอล AH/OU จริงหรือ movement ชัดเจน')
  if (dataIntelligence.data_confidence?.level === 'low') factors.push('Football Data Intelligence ยังมีข้อมูลจริงจำกัด')
  if (consistency) factors.push(consistency)

  return uniqueSentences(factors)
}

export function getDataIntelligenceItems(dataIntelligence) {
  const labels = {
    league_position: 'League Position',
    recent_form: 'Recent Form',
    home_away_form: 'Home/Away Form',
    head_to_head: 'Head to Head',
    strength_of_schedule: 'Strength of Schedule',
    goal_statistics: 'Goal Statistics',
  }
  const items = dataIntelligenceSections.map((key) => {
    const item = dataIntelligence?.[key] ?? {}
    return {
      key,
      label: labels[key],
      score: Math.round(clamp(Number(item.score ?? 0), 0, 100)),
      confidence: item.confidence ?? item.level ?? 'low',
      reason: item.reason || 'ข้อมูลจำกัด',
      available: item.available ?? [],
      missing: item.missing ?? [],
      ...getScoreLabel(item.score),
    }
  })
  const confidence = dataIntelligence?.data_confidence ?? {}

  return [
    ...items,
    {
      key: 'data_confidence',
      label: 'Data Confidence',
      score: Math.round(clamp(Number(confidence.score ?? 0), 0, 100)),
      confidence: confidence.level ?? 'low',
      reason: confidence.reason || 'ข้อมูลจำกัด',
      available: confidence.available ?? [],
      missing: confidence.missing ?? [],
      ...getScoreLabel(confidence.score),
    },
  ]
}

export function splitSummary(summary) {
  return String(summary || 'ข้อมูลสรุปยังจำกัด')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4)
}

function addQuality(hasData, label, available, missing) {
  if (hasData) available.push(label)
  else missing.push(label)
}

function riskToScore(level) {
  const normalized = getRiskLabel(level).value
  if (normalized === 'low') return 82
  if (normalized === 'high') return 38
  return 62
}

function riskToScoreLabel(level) {
  const normalized = getRiskLabel(level).value
  if (normalized === 'low') return { scoreLabel: 'ดี', tone: 'good' }
  if (normalized === 'high') return { scoreLabel: 'เสี่ยง', tone: 'risk' }
  return { scoreLabel: 'กลาง', tone: 'medium' }
}

function uniqueSentences(items) {
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))]
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
