import { analyzeAsianHandicap } from './ahAnalysisEngine.js'
import { classifyDecision } from './decisionClassification.js'
import { analyzeOverUnder } from './ouAnalysisEngine.js'
import { getLatestOddsByMarket, normalizeOddsRows } from './oddsUtils.js'

const statuses = ['READY', 'WATCH', 'WAIT', 'WAITING_MARKET', 'NO_DATA', 'REJECTED']
const finalTypes = ['TEAM', 'AH', 'OU', 'NO_DECISION']

export function buildSimpleBettingDecision(match = {}) {
  const stored = getStoredDecision(match)
  if (hasNestedDecisionFields(stored)) return normalizeDecision(stored, match)

  const oddsRows = normalizeOddsRows(match)
  const hasAnyMarket = oddsRows.length > 0
  const ahRows = getLatestOddsByMarket(match, 'AH')
  const ouRows = getLatestOddsByMarket(match, 'OU')
  const matchView = buildMatchView(match, hasAnyMarket)
  const ahPick = buildAhPick(match, ahRows)
  const ouPick = buildOuPick(match, ouRows)
  const finalPick = buildFinalPick({ ahPick, ouPick, matchView, hasAnyMarket, marketQuality: getMarketQualityScore(match) })
  const classification = classifyDecision(match, { finalPick, analysisComplete: hasAnalysisOutput(match) })
  const status = classification.status
  const confidence = getDecisionConfidence({ match_view: matchView, ah_pick: ahPick, ou_pick: ouPick, final_pick: finalPick, status })

  return {
    match_view: matchView,
    ah_pick: ahPick,
    ou_pick: ouPick,
    final_pick: finalPick,
    confidence,
    status,
    decision_status: classification.decision_status,
    legacy_status: classification.legacy_status,
    decision_readiness_score: classification.decision_readiness_score,
    decision_reason: classification.decision_reason,
    decision_reason_codes: classification.decision_reason_codes,
    market_readiness: classification.market_readiness,
    decision_scores: classification.scores,
    pipeline_version: classification.pipeline_version,
  }
}

export function getDecisionConfidence(decision = {}) {
  if (decision.final_pick?.type === 'AH') return scoreValue(decision.ah_pick?.confidence)
  if (decision.final_pick?.type === 'OU') return scoreValue(decision.ou_pick?.confidence)
  return scoreValue(decision.match_view?.confidence)
}

export function getBestPickLabel(decision = {}) {
  return decision.final_pick?.label ?? 'ยังไม่มี Best Pick'
}

export function getDecisionReason(decision = {}) {
  return decision.final_pick?.reason || decision.match_view?.reason || 'ข้อมูลยังไม่พอสำหรับสรุป'
}

export function getLegacyDecisionFields(decision = {}) {
  return {
    ah_pick_label: decision.ah_pick?.label ?? 'รอเส้น AH',
    ah_confidence: scoreValue(decision.ah_pick?.confidence),
    ah_reason: decision.ah_pick?.reason ?? 'ยังไม่มีข้อมูล Asian Handicap จาก API-Football',
    ou_pick_label: decision.ou_pick?.label ?? 'รอราคา O/U',
    ou_confidence: scoreValue(decision.ou_pick?.confidence),
    ou_reason: decision.ou_pick?.reason ?? 'ยังไม่มีข้อมูล Over/Under จาก API-Football',
    final_pick_type: decision.final_pick?.type ?? 'NO_DECISION',
    final_pick_label: decision.final_pick?.label ?? 'ยังไม่มี Best Pick',
    final_reason: decision.final_pick?.reason ?? 'รอข้อมูลราคาเพื่อยืนยัน AH/O-U',
    final_recommendation: statusToRecommendation(decision.status),
  }
}

function normalizeDecision(value = {}, match = {}) {
  const fresh = buildFreshDecision(match)
  const matchView = normalizeMatchView(value.match_view ?? value.matchView, fresh.match_view)
  const ahPick = normalizeAhPick(value.ah_pick ?? value.ahPick, fresh.ah_pick)
  const ouPick = normalizeOuPick(value.ou_pick ?? value.ouPick, fresh.ou_pick)
  const finalPick = normalizeFinalPickObject(value.final_pick ?? value.finalPick, fresh.final_pick)
  const status = statuses.includes(String(value.status ?? value.decision_status ?? '').toUpperCase()) ? String(value.status ?? value.decision_status).toUpperCase() : fresh.status
  return {
    match_view: matchView,
    ah_pick: ahPick,
    ou_pick: ouPick,
    final_pick: finalPick,
    confidence: scoreValue(value.confidence ?? fresh.confidence),
    status,
    decision_status: value.decision_status ?? fresh.decision_status,
    legacy_status: value.legacy_status ?? fresh.legacy_status,
    decision_readiness_score: scoreValue(value.decision_readiness_score ?? fresh.decision_readiness_score),
    decision_reason: firstText(value.decision_reason, fresh.decision_reason),
    decision_reason_codes: Array.isArray(value.decision_reason_codes) ? value.decision_reason_codes : fresh.decision_reason_codes,
    market_readiness: value.market_readiness ?? fresh.market_readiness,
    decision_scores: value.decision_scores ?? fresh.decision_scores,
    pipeline_version: value.pipeline_version ?? fresh.pipeline_version,
  }
}

function buildFreshDecision(match = {}) {
  const matchCopy = { ...match }
  delete matchCopy.bettingDecision
  delete matchCopy.betting_decision
  if (matchCopy.aiFinalPick?.bettingDecision) {
    matchCopy.aiFinalPick = { ...matchCopy.aiFinalPick }
    delete matchCopy.aiFinalPick.bettingDecision
  }
  if (matchCopy.ai_final_pick?.betting_decision) {
    matchCopy.ai_final_pick = { ...matchCopy.ai_final_pick }
    delete matchCopy.ai_final_pick.betting_decision
  }
  return buildSimpleBettingDecision(matchCopy)
}

function buildMatchView(match = {}, hasAnyMarket = false) {
  const analysis = getAnalysis(match)
  const homeTeam = match.homeTeam ?? match.home_team ?? {}
  const awayTeam = match.awayTeam ?? match.away_team ?? {}
  const homeName = homeTeam.name ?? match.home_name ?? 'เจ้าบ้าน'
  const awayName = awayTeam.name ?? match.away_name ?? 'ทีมเยือน'
  const dataScore = getFixtureDataScore(match, analysis)
  if (dataScore < 35) {
    return {
      side: 'NONE',
      team_name: null,
      label: 'ข้อมูลยังไม่พอประเมินฝั่งชนะ',
      confidence: 0,
      reason: 'ข้อมูลทีมและตลาดยังไม่พอสำหรับสรุปฝั่ง',
      source: 'INSUFFICIENT_DATA',
    }
  }

  const homeScore = average([
    analysis.home_advantage_score,
    analysis.home_away_score,
    analysis.team_strength_score,
    analysis.form_score,
    100 - Number(analysis.away_weakness_score ?? 45),
    formSignal(match.homeForm ?? analysis.raw?.homeForm),
  ], 56)
  const awayScore = average([
    100 - Number(analysis.home_advantage_score ?? 56),
    analysis.team_strength_score ? 100 - Number(analysis.team_strength_score) : null,
    analysis.form_score ? 100 - Number(analysis.form_score) : null,
    analysis.away_weakness_score,
    formSignal(match.awayForm ?? analysis.raw?.awayForm),
  ], 52)
  const gap = Math.abs(homeScore - awayScore)
  const side = gap < 3 ? 'DRAW' : homeScore >= awayScore ? 'HOME' : 'AWAY'
  const teamName = side === 'HOME' ? homeName : side === 'AWAY' ? awayName : null
  const source = hasAnyMarket ? 'MARKET_MODEL' : 'FIXTURE_MODEL'
  const baseConfidence = Math.round(52 + gap * 0.55 + dataScore * 0.08)
  const confidence = scoreValue(hasAnyMarket ? Math.min(baseConfidence + 6, 82) : Math.min(baseConfidence, 60))

  if (side === 'DRAW') {
    return {
      side,
      team_name: null,
      label: 'ภาพรวมสูสี',
      confidence,
      reason: 'คะแนนทีมใกล้กัน จึงประเมินเป็นเกมสูสี',
      source,
    }
  }

  return {
    side,
    team_name: teamName,
    label: `${teamName} มีโอกาสเหนือกว่า${confidence >= 58 ? '' : 'เล็กน้อย'}`,
    confidence,
    reason: hasAnyMarket
      ? 'ประเมินจากข้อมูลทีมร่วมกับตลาดราคาที่มีอยู่'
      : 'ประเมินจากคุณภาพลีก ข้อมูลทีม และความพร้อมข้อมูลพื้นฐาน',
    source,
  }
}

function buildAhPick(match = {}, rows = []) {
  if (!rows.length) {
    return {
      side: 'NONE',
      team_name: null,
      label: 'รอเส้น AH',
      reason: 'ยังไม่มีข้อมูล Asian Handicap จาก API-Football',
      requires_market: true,
    }
  }

  const analysis = analyzeAsianHandicap(match)
  const side = String(analysis.direction ?? '').toLowerCase().startsWith('away') ? 'AWAY' : 'HOME'
  const row = findMarketRow(rows, side === 'HOME' ? 'home' : 'away') ?? rows[0]
  const line = firstText(row.line, String(row.selection ?? '').match(/[+-]?\d+(?:\.\d+)?/)?.[0], '0')
  const teamName = side === 'HOME' ? match.homeTeam?.name ?? null : match.awayTeam?.name ?? null
  const confidence = scoreValue(analysis.confidenceScore)

  return {
    side,
    team_name: teamName,
    label: `${side} ${formatSignedLine(line)}`,
    reason: confidence >= 60 ? `มีเส้น AH แล้ว ระบบให้น้ำหนักฝั่ง${side === 'HOME' ? 'เจ้าบ้าน' : 'ทีมเยือน'}` : 'มีเส้น AH แล้ว แต่คะแนนยังไม่ผ่านเกณฑ์',
    requires_market: true,
    confidence,
  }
}

function buildOuPick(match = {}, rows = []) {
  if (!rows.length) {
    return {
      side: 'NONE',
      label: 'รอราคา O/U',
      reason: 'ยังไม่มีข้อมูล Over/Under จาก API-Football',
      requires_market: true,
    }
  }

  const analysis = analyzeOverUnder(match)
  const side = String(analysis.direction ?? '').toLowerCase().startsWith('under') ? 'UNDER' : 'OVER'
  const row = findMarketRow(rows, side.toLowerCase()) ?? rows[0]
  const line = firstText(row.line, String(row.selection ?? '').match(/\d+(?:\.\d+)?/)?.[0], '2.5')
  const confidence = scoreValue(analysis.confidenceScore)

  return {
    side,
    label: `${side} ${line}`,
    reason: confidence >= 60 ? `มีราคา O/U แล้ว ระบบให้น้ำหนักฝั่ง ${side}` : 'มีราคา O/U แล้ว แต่คะแนนยังไม่ผ่านเกณฑ์',
    requires_market: true,
    confidence,
  }
}

function buildFinalPick({ ahPick, ouPick, matchView, hasAnyMarket, marketQuality }) {
  if (!hasAnyMarket || (ahPick.side === 'NONE' && ouPick.side === 'NONE')) {
    return {
      type: 'NO_DECISION',
      label: 'ยังไม่มี Best Pick',
      reason: 'รอข้อมูลราคาเพื่อยืนยัน AH/O-U',
    }
  }

  const candidates = [
    ahPick.side !== 'NONE' && scoreValue(ahPick.confidence) >= 60 && marketQuality >= 60 ? { type: 'AH', label: ahPick.label, confidence: scoreValue(ahPick.confidence) } : null,
    ouPick.side !== 'NONE' && scoreValue(ouPick.confidence) >= 60 && marketQuality >= 60 ? { type: 'OU', label: ouPick.label, confidence: scoreValue(ouPick.confidence) } : null,
  ].filter(Boolean)

  if (!candidates.length) {
    return {
      type: 'NO_DECISION',
      label: 'ยังไม่ผ่านเกณฑ์',
      reason: 'ข้อมูลตลาดมีแล้ว แต่คะแนนความคุ้มค่า/ความเสี่ยงยังไม่ผ่าน',
    }
  }

  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0]
  return {
    type: best.type,
    label: best.label,
    reason: `เลือก ${best.type} เพราะคะแนนตลาดนี้สูงสุด และมุมมองผู้ชนะคือ ${matchView.label}`,
  }
}

function getMarketQualityScore(match = {}) {
  const analysis = getAnalysis(match)
  return scoreValue(analysis.market_edge_score ?? analysis.market_quality_score ?? analysis.raw?.market_edge_score ?? 60)
}

function hasAnalysisOutput(match = {}) {
  const analysis = getAnalysis(match)
  return Boolean(analysis.recommendation || analysis.confidence_score || analysis.analysis_status || match.aiFinalPick || match.ai_final_pick)
}

function normalizeMatchView(value = {}, fallback) {
  return {
    side: ['HOME', 'AWAY', 'DRAW', 'NONE'].includes(String(value.side ?? '').toUpperCase()) ? String(value.side).toUpperCase() : fallback.side,
    team_name: value.team_name ?? value.teamName ?? fallback.team_name,
    label: firstText(value.label, fallback.label),
    confidence: scoreValue(value.confidence ?? fallback.confidence),
    reason: firstText(value.reason, fallback.reason),
    source: ['MARKET_MODEL', 'FIXTURE_MODEL', 'INSUFFICIENT_DATA'].includes(String(value.source ?? '').toUpperCase()) ? String(value.source).toUpperCase() : fallback.source,
  }
}

function normalizeAhPick(value = {}, fallback) {
  return {
    side: ['HOME', 'AWAY', 'NONE'].includes(String(value.side ?? '').toUpperCase()) ? String(value.side).toUpperCase() : fallback.side,
    team_name: value.team_name ?? value.teamName ?? fallback.team_name,
    label: firstText(value.label, fallback.label),
    reason: firstText(value.reason, fallback.reason),
    requires_market: true,
    confidence: scoreValue(value.confidence ?? fallback.confidence),
  }
}

function normalizeOuPick(value = {}, fallback) {
  return {
    side: ['OVER', 'UNDER', 'NONE'].includes(String(value.side ?? '').toUpperCase()) ? String(value.side).toUpperCase() : fallback.side,
    label: firstText(value.label, fallback.label),
    reason: firstText(value.reason, fallback.reason),
    requires_market: true,
    confidence: scoreValue(value.confidence ?? fallback.confidence),
  }
}

function normalizeFinalPickObject(value = {}, fallback) {
  const type = String(value.type ?? '').toUpperCase()
  return {
    type: finalTypes.includes(type) ? type : fallback.type,
    label: firstText(value.label, fallback.label),
    reason: firstText(value.reason, fallback.reason),
  }
}

function getStoredDecision(match = {}) {
  const analysis = getAnalysis(match)
  return match.bettingDecision
    ?? match.betting_decision
    ?? match.aiFinalPick?.bettingDecision
    ?? match.ai_final_pick?.betting_decision
    ?? analysis.betting_decision
    ?? analysis.raw?.betting_decision
    ?? null
}

function hasNestedDecisionFields(value) {
  return Boolean(value && typeof value === 'object' && (value.match_view || value.matchView || value.final_pick?.type || value.finalPick?.type))
}

function getAnalysis(match = {}) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis ?? match.match_analysis ?? {}
  return analysis ?? {}
}

function getFixtureDataScore(match, analysis) {
  const checks = [
    Boolean(match.id),
    Boolean(match.kickoffAt ?? match.kickoff_at),
    Boolean(match.league?.name ?? match.competition?.name),
    Boolean(match.homeTeam?.name),
    Boolean(match.awayTeam?.name),
    Boolean(match.homeForm ?? analysis.raw?.homeForm),
    Boolean(match.awayForm ?? analysis.raw?.awayForm),
    Boolean(analysis.team_strength_score ?? analysis.form_score ?? analysis.home_advantage_score),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function findMarketRow(rows, pattern) {
  const text = String(pattern ?? '').toLowerCase()
  return rows.find((row) => String(row.selection ?? row.raw?.value ?? '').toLowerCase().includes(text)) ?? null
}

function formSignal(form) {
  if (!form) return null
  const played = Number(form.played ?? 0)
  if (!played) return null
  const points = Number(form.wins ?? 0) * 3 + Number(form.draws ?? 0)
  return Math.max(0, Math.min(100, (points / Math.max(played * 3, 1)) * 100))
}

function average(values, fallback) {
  const numbers = values.map(Number).filter(Number.isFinite)
  if (!numbers.length) return fallback
  return numbers.reduce((total, value) => total + value, 0) / numbers.length
}

function formatSignedLine(value) {
  const text = String(value ?? '0').trim()
  if (!text || text === '0') return '0'
  return text.startsWith('-') || text.startsWith('+') ? text : `+${text}`
}

function statusToRecommendation(status) {
  if (status === 'READY') return 'BET'
  if (status === 'WATCH') return 'LEAN'
  return 'NO BET'
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function scoreValue(value) {
  const numeric = Number(value)
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(numeric) ? numeric : 0)))
}
