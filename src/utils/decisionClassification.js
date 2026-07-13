import { getLatestOddsByMarket, normalizeMarketFocus, normalizeOddsRows, parseLineNumber } from './oddsUtils.js'

export const decisionPipelineVersion = 'market-ready-hybrid-gate-v1'

export const decisionStatuses = {
  ready: 'READY',
  watch: 'WATCH',
  wait: 'WAIT',
  rejected: 'REJECTED',
}

export const readyThreshold = 80
export const watchThreshold = 70

const riskQuality = {
  LOW: 100,
  MEDIUM: 75,
  HIGH: 40,
  CRITICAL: 0,
}

export function normalizeDecisionStatus(value) {
  const status = String(value ?? '').toUpperCase()
  if (status === 'READY') return decisionStatuses.ready
  if (status === 'WATCH') return decisionStatuses.watch
  if (['WAIT', 'WAITING', 'WAITING_MARKET', 'WAIT_MARKET', 'NO_DATA'].includes(status)) return decisionStatuses.wait
  if (status === 'REJECTED') return decisionStatuses.rejected
  return decisionStatuses.wait
}

export function calculateDecisionReadinessScore(input = {}) {
  const dataQualityScore = scoreValue(input.dataQualityScore ?? input.data_quality_score, 0)
  const marketQualityScore = scoreValue(input.marketQualityScore ?? input.market_quality_score, 0)
  const analysisConfidence = scoreValue(input.analysisConfidence ?? input.confidence_score ?? input.confidence, 0)
  const riskQualityScore = scoreValue(input.riskQualityScore ?? riskToQuality(input.riskLevel ?? input.risk_level), 75)
  const featureCompletenessScore = scoreValue(input.featureCompletenessScore ?? input.feature_completeness_score, 0)
  return roundScore(
    dataQualityScore * 0.25 +
    marketQualityScore * 0.20 +
    analysisConfidence * 0.30 +
    riskQualityScore * 0.15 +
    featureCompletenessScore * 0.10,
  )
}

export function classifyDecision(match = {}, input = {}) {
  const analysis = getAnalysis(match)
  const finalPick = input.finalPick ?? input.final_pick ?? {}
  const riskLevel = normalizeRiskLevel(input.riskLevel ?? analysis.risk_level ?? match.riskLevel ?? match.risk_level)
  const analysisComplete = isAnalysisComplete(match, analysis, input)
  const finalPickType = normalizeFinalPickType(finalPick.type ?? finalPick.market ?? input.finalPickMarket)
  const market = evaluateFinalMarketReadiness(match, finalPickType, input)
  const hardGate = evaluateHardGate(match, analysis, { ...input, riskLevel, analysisComplete, finalPickType, market })
  const soft = evaluateSoftFactors(match, analysis, input, market)
  const decisionReadinessScore = calculateDecisionReadinessScore({
    dataQualityScore: soft.dataQualityScore,
    marketQualityScore: soft.marketQualityScore,
    analysisConfidence: soft.analysisConfidence,
    riskLevel,
    featureCompletenessScore: soft.featureCompletenessScore,
  })

  const reasonCodes = [...soft.reasonCodes]
  let status
  let reason

  if (hardGate.rejected) {
    status = decisionStatuses.rejected
    reasonCodes.push(...hardGate.reasonCodes)
    reason = hardGate.reason
  } else if (!analysisComplete) {
    status = decisionStatuses.wait
    reasonCodes.push('ANALYSIS_PENDING', 'WAIT_ANALYSIS')
    reason = 'รอวิเคราะห์: ข้อมูลพื้นฐานพร้อม แต่การวิเคราะห์เชิงลึกยังไม่เสร็จ'
  } else if (!finalPickType || finalPickType === 'NO_DECISION') {
    if (hasAnalysisDirection(analysis) && hasAnyOdds(match)) {
      status = decisionStatuses.watch
      reasonCodes.push('FINAL_PICK_MISSING', 'VALUE_BORDERLINE')
      reason = 'เฝ้าดู: มีทิศทางวิเคราะห์ แต่ Value ยังอยู่ระดับ BORDERLINE'
    } else {
      status = decisionStatuses.wait
      reasonCodes.push('FINAL_PICK_MISSING')
      reason = 'รอข้อมูล: ยังไม่มีตัวเลือกสุดท้ายที่ชัดเจน'
    }
  } else if (!market.ready) {
    status = decisionStatuses.wait
    reasonCodes.push(...market.reasonCodes)
    reason = market.reason
  } else if (riskLevel === 'HIGH') {
    status = decisionStatuses.watch
    reasonCodes.push('RISK_HIGH')
    reason = 'เฝ้าดู: คะแนนดีแต่ความเสี่ยงยังสูง'
  } else if (decisionReadinessScore >= readyThreshold) {
    status = decisionStatuses.ready
    reasonCodes.push('READY_SCORE_PASSED', 'ANALYSIS_COMPLETE', 'FINAL_PICK_VALID', 'FINAL_MARKET_READY')
    reason = 'พร้อมตัดสิน: การวิเคราะห์ครบ ตลาดพร้อม และคะแนนความพร้อมผ่านเกณฑ์'
  } else if (decisionReadinessScore >= watchThreshold) {
    status = decisionStatuses.watch
    reasonCodes.push('SCORE_BELOW_READY')
    reason = 'เฝ้าดู: คะแนนความพร้อมยังไม่ถึง READY'
  } else {
    status = decisionStatuses.rejected
    reasonCodes.push('SCORE_BELOW_WATCH')
    reason = 'ตัดออก: วิเคราะห์และตลาดครบแล้ว แต่คะแนนความพร้อมต่ำกว่าเกณฑ์เฝ้าดู'
  }

  return {
    status,
    decision_status: status,
    legacy_status: status === decisionStatuses.wait && market.reasonCodes.some((code) => code.includes('MARKET') || code.includes('_MISSING')) ? 'WAITING_MARKET' : status,
    decision_readiness_score: decisionReadinessScore,
    decision_reason: reason,
    decision_reason_codes: uniqueItems(reasonCodes),
    market_readiness: market,
    scores: {
      dataQualityScore: soft.dataQualityScore,
      marketQualityScore: soft.marketQualityScore,
      analysisConfidence: soft.analysisConfidence,
      riskQualityScore: riskToQuality(riskLevel),
      featureCompletenessScore: soft.featureCompletenessScore,
    },
    pipeline_version: decisionPipelineVersion,
  }
}

export function evaluateFinalMarketReadiness(match = {}, finalPickType = 'NO_DECISION', input = {}) {
  const marketFocus = normalizeFinalPickType(finalPickType)
  if (!marketFocus || marketFocus === 'NO_DECISION') {
    return { ready: false, market: 'NONE', score: hasAnyOdds(match) ? 45 : 15, reason: 'รอข้อมูล: ยังไม่มีตลาดของตัวเลือกสุดท้าย', reasonCodes: ['FINAL_PICK_MISSING'] }
  }

  const rows = Array.isArray(input.marketRows) ? input.marketRows : getLatestOddsByMarket(match, marketFocus)
  if (!rows.length) {
    const code = marketFocus === 'AH' ? 'AH_MISSING' : marketFocus === 'OU' ? 'OU_MISSING' : 'MARKET_MISSING'
    return { ready: false, market: marketFocus, score: 25, reason: marketFocus === 'AH' ? 'รอราคา: ยังไม่มี AH สำหรับตัวเลือกสุดท้าย' : 'รอราคา: ยังไม่มี O/U สำหรับตัวเลือกสุดท้าย', reasonCodes: ['MARKET_MISSING', code] }
  }

  const validRows = rows.filter((row) => isUsableMarketRow(row, marketFocus))
  if (!validRows.length) {
    return { ready: false, market: marketFocus, score: 40, reason: 'รอราคา: ข้อมูลตลาดมีอยู่แต่ line หรือ price ยังไม่สมบูรณ์', reasonCodes: ['MARKET_INVALID'] }
  }

  const staleRows = validRows.filter(isStaleMarketRow)
  if (staleRows.length === validRows.length) {
    return { ready: false, market: marketFocus, score: 55, reason: 'รอ refresh: ตลาดของตัวเลือกสุดท้ายเริ่มเก่า', reasonCodes: ['MARKET_STALE', 'WAIT_REFRESH'] }
  }

  return {
    ready: true,
    market: marketFocus,
    score: rows.length > 1 ? 95 : 88,
    reason: marketFocus === 'AH' ? 'AH_READY' : marketFocus === 'OU' ? 'OU_READY' : 'MARKET_READY',
    reasonCodes: ['MARKET_READY', marketFocus === 'AH' ? 'AH_READY' : marketFocus === 'OU' ? 'OU_READY' : 'FINAL_MARKET_READY'],
  }
}

export function buildDecisionDiagnostics(matches = []) {
  const rows = Array.isArray(matches) ? matches : []
  const counters = {
    fixtures_discovered: rows.length,
    fixtures_eligible: 0,
    fixtures_rejected_hard_gate: 0,
    candidates_initial: Math.min(30, rows.length),
    candidates_expanded: Math.max(0, Math.min(80, rows.length) - Math.min(30, rows.length)),
    analysis_started: 0,
    analysis_completed: 0,
    market_ah_ready: 0,
    market_ou_ready: 0,
    market_any_ready: 0,
    ready_count: 0,
    watch_count: 0,
    wait_count: 0,
    rejected_count: 0,
  }
  const reasons = {}

  for (const match of rows) {
    const decision = match.bettingDecision ?? match.betting_decision ?? match.decision ?? classifyDecision(match, { finalPick: match.final_pick ?? match.aiFinalPick?.final_pick })
    const status = normalizeDecisionStatus(decision.decision_status ?? decision.status)
    const analysis = getAnalysis(match)
    if (hasBasicFixture(match)) counters.fixtures_eligible += 1
    if (analysis && Object.keys(analysis).length) counters.analysis_started += 1
    if (isAnalysisComplete(match, analysis, {})) counters.analysis_completed += 1
    if (evaluateFinalMarketReadiness(match, 'AH').ready) counters.market_ah_ready += 1
    if (evaluateFinalMarketReadiness(match, 'OU').ready) counters.market_ou_ready += 1
    if (evaluateFinalMarketReadiness(match, 'AH').ready || evaluateFinalMarketReadiness(match, 'OU').ready) counters.market_any_ready += 1
    if (status === 'READY') counters.ready_count += 1
    else if (status === 'WATCH') counters.watch_count += 1
    else if (status === 'REJECTED') {
      counters.rejected_count += 1
      counters.fixtures_rejected_hard_gate += 1
    } else counters.wait_count += 1
    for (const code of decision.decision_reason_codes ?? []) {
      reasons[normalizeReasonBucket(code)] = (reasons[normalizeReasonBucket(code)] ?? 0) + 1
    }
  }

  return { ...counters, not_ready_reasons: reasons, pipeline_version: decisionPipelineVersion }
}

function evaluateHardGate(match, analysis, context) {
  if (!hasBasicFixture(match)) return { rejected: true, reason: 'ตัดออก: ข้อมูล fixture ไม่สมบูรณ์', reasonCodes: ['FIXTURE_INVALID'] }
  if (isBadFixtureStatus(match)) return { rejected: true, reason: 'ตัดออก: fixture ถูกเลื่อน ยกเลิก หรือสถานะไม่พร้อมวิเคราะห์', reasonCodes: ['FIXTURE_INVALID'] }
  if (context.riskLevel === 'CRITICAL') return { rejected: true, reason: 'ตัดออก: ความเสี่ยงอยู่ระดับ CRITICAL', reasonCodes: ['RISK_CRITICAL'] }
  if (context.analysisComplete && isInvalidAnalysisOutput(analysis)) return { rejected: true, reason: 'ตัดออก: analysis output ไม่ถูกต้อง', reasonCodes: ['ANALYSIS_INVALID'] }
  if (context.analysisComplete && context.finalPickType !== 'NO_DECISION' && context.market.reasonCodes.includes('MARKET_INVALID')) {
    return { rejected: true, reason: 'ตัดออก: ข้อมูลตลาดของตัวเลือกสุดท้าย parse ไม่ได้', reasonCodes: ['MARKET_INVALID'] }
  }
  return { rejected: false, reason: '', reasonCodes: [] }
}

function evaluateSoftFactors(match, analysis, input, market) {
  const dataQualityScore = scoreValue(analysis.data_quality_score ?? analysis.match_quality_score ?? input.dataQualityScore ?? getFixtureDataScore(match, analysis), 0)
  const marketQualityScore = scoreValue(input.marketQualityScore ?? analysis.market_quality_score ?? market.score, market.score)
  const analysisConfidence = scoreValue(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? input.analysisConfidence ?? input.confidence, 0)
  let featureCompletenessScore = scoreValue(input.featureCompletenessScore ?? analysis.feature_completeness_score ?? getFeatureCompletenessScore(match, analysis), 0)
  const reasonCodes = []
  if (!hasArrayData(match.injuries ?? analysis.raw?.injuries)) {
    featureCompletenessScore = Math.max(0, featureCompletenessScore - 5)
    reasonCodes.push('INJURY_DATA_INCOMPLETE', 'DATA_PARTIAL')
  }
  if (!hasArrayData(match.lineups ?? analysis.raw?.lineups) && !isNearKickoff(match)) reasonCodes.push('LINEUP_NOT_AVAILABLE_YET', 'DATA_PARTIAL')
  return { dataQualityScore, marketQualityScore, analysisConfidence, featureCompletenessScore, reasonCodes }
}

function isUsableMarketRow(row, marketFocus) {
  const focus = normalizeMarketFocus(row.marketFocus ?? row.market_focus ?? row.marketName ?? row.market_name ?? row.market)
  const line = parseLineNumber(row.line ?? row.selection ?? row.value)
  const price = Number(row.price ?? row.odd ?? row.odds)
  if (focus !== marketFocus) return false
  if (!Number.isFinite(price) || price <= 1) return false
  return marketFocus === 'AH' || marketFocus === 'OU' ? line !== null : true
}

function isStaleMarketRow(row) {
  if (!row.snapshotAt && !row.snapshot_at && !row.created_at) return false
  const time = new Date(row.snapshotAt ?? row.snapshot_at ?? row.created_at).getTime()
  return Number.isFinite(time) && Date.now() - time > 12 * 60 * 60 * 1000
}

function normalizeFinalPickType(value) {
  const focus = normalizeMarketFocus(value)
  if (focus === 'AH' || focus === 'OU') return focus
  const text = String(value ?? '').toUpperCase()
  if (text === 'NO_DECISION' || text === 'NONE' || !text) return 'NO_DECISION'
  return focus === 'MATCH_WINNER' || focus === 'BTTS' ? focus : 'NO_DECISION'
}

function isAnalysisComplete(match, analysis, input) {
  if (input.analysisComplete !== undefined) return Boolean(input.analysisComplete)
  if (analysis.analysis_complete !== undefined) return Boolean(analysis.analysis_complete)
  if (analysis.analysis_status) return !['PENDING', 'QUEUED', 'RUNNING'].includes(String(analysis.analysis_status).toUpperCase())
  return Boolean(analysis.recommendation || analysis.confidence_score || match.aiFinalPick || match.ai_final_pick)
}

function hasBasicFixture(match) {
  return Boolean(
    (match.id ?? match.fixture_id ?? match.api_fixture_id ?? match.api_sports_fixture_id) &&
    firstText(match.homeTeam?.name, match.home_team?.name, match.home_name) &&
    firstText(match.awayTeam?.name, match.away_team?.name, match.away_name),
  )
}

function isBadFixtureStatus(match) {
  const status = String(match.statusShort ?? match.status_short ?? match.match_status ?? match.status ?? '').toUpperCase()
  return ['CANC', 'CANCELLED', 'PST', 'POSTPONED', 'ABD', 'AWD', 'WO'].includes(status)
}

function isInvalidAnalysisOutput(analysis) {
  const confidence = Number(analysis.confidence_score ?? analysis.calibrated_confidence_score)
  return confidence !== undefined && Number.isFinite(confidence) && (confidence < 0 || confidence > 100)
}

function getFixtureDataScore(match, analysis) {
  const checks = [
    Boolean(match.id ?? match.fixture_id),
    Boolean(match.kickoffAt ?? match.kickoff_at),
    Boolean(match.league?.name ?? match.competition?.name),
    Boolean(firstText(match.homeTeam?.name, match.home_team?.name)),
    Boolean(firstText(match.awayTeam?.name, match.away_team?.name)),
    Boolean(match.homeForm ?? analysis.raw?.homeForm),
    Boolean(match.awayForm ?? analysis.raw?.awayForm),
    Boolean(analysis.team_strength_score ?? analysis.form_score ?? analysis.home_advantage_score),
  ]
  return roundScore((checks.filter(Boolean).length / checks.length) * 100)
}

function getFeatureCompletenessScore(match, analysis) {
  const checks = [
    hasArrayData(match.injuries ?? analysis.raw?.injuries),
    hasArrayData(match.h2h ?? analysis.raw?.h2h),
    hasArrayData(match.lineups ?? analysis.raw?.lineups),
    hasArrayData(match.statistics ?? analysis.raw?.statistics),
    Boolean(match.venue ?? analysis.raw?.venue),
    Boolean(match.coach ?? analysis.raw?.coach),
  ]
  if (!checks.some(Boolean)) return 80
  return roundScore((checks.filter(Boolean).length / checks.length) * 100)
}

function isNearKickoff(match) {
  const kickoff = new Date(match.kickoffAt ?? match.kickoff_at ?? 0).getTime()
  return Number.isFinite(kickoff) && kickoff - Date.now() <= 2 * 60 * 60 * 1000
}

function hasAnyOdds(match) {
  return normalizeOddsRows(match).length > 0
}

function hasAnalysisDirection(analysis = {}) {
  const recommendation = String(analysis.recommendation ?? '').toUpperCase().replace('_', ' ')
  return ['BET', 'LEAN', 'WATCH'].includes(recommendation) || Boolean(analysis.pick_side && String(analysis.pick_side).toUpperCase() !== 'NONE')
}

function hasArrayData(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(value)
}

function getAnalysis(match = {}) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis ?? match.match_analysis ?? {}
  return analysis ?? {}
}

function riskToQuality(value) {
  return riskQuality[normalizeRiskLevel(value)] ?? 75
}

function normalizeRiskLevel(value) {
  const text = String(value ?? '').toUpperCase()
  if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(text)) return text
  return 'MEDIUM'
}

function normalizeReasonBucket(code) {
  const text = String(code ?? '').toLowerCase()
  if (text.includes('market') || text.includes('ah_missing') || text.includes('ou_missing')) return 'market_missing'
  if (text.includes('stale')) return 'market_stale'
  if (text.includes('invalid')) return 'market_invalid'
  if (text.includes('score_below_ready')) return 'score_below_ready'
  if (text.includes('score_below_watch')) return 'score_below_watch'
  if (text.includes('risk_high')) return 'risk_high'
  if (text.includes('risk_critical')) return 'risk_critical'
  if (text.includes('data')) return 'data_incomplete'
  if (text.includes('fixture')) return 'fixture_invalid'
  if (text.includes('analysis')) return 'missing_analysis'
  if (text.includes('final_pick')) return 'missing_final_pick'
  return text || 'unknown'
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function uniqueItems(items) {
  return [...new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean))]
}

function scoreValue(value, fallback = 0) {
  const numeric = Number(value)
  return clamp(Number.isFinite(numeric) ? numeric : fallback, 0, 100)
}

function roundScore(value) {
  return Math.round(clamp(value, 0, 100) * 10) / 10
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
