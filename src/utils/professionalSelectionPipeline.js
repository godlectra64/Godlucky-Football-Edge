import { getLeagueQualityScore } from './leagueQualityScoring.js'

export const professionalPipelineVersion = 'professional-selection-v1'

export const professionalScoreWeights = {
  leagueQuality: 12,
  dataQuality: 12,
  marketQuality: 12,
  statisticalEdge: 16,
  tacticalEdge: 10,
  motivation: 10,
  riskControl: 10,
  valueEdge: 18,
  aiConfidence: 10,
}

const recommendationPriority = {
  BET: 1,
  LEAN: 2,
  'NO BET': 3,
}

export function buildProfessionalSelectionScore(input = {}) {
  const normalized = normalizeInput(input)
  const reasons = []
  const warnings = []

  const leagueQuality = calculateLeagueQuality(normalized)
  const data = calculateDataQuality(normalized)
  const market = calculateMarketQuality(normalized)
  const statistical = calculateStatisticalEdge({ ...normalized, dataQuality: data.score, marketQuality: market.score })
  const tactical = calculateTacticalEdge({ ...normalized, statisticalEdge: statistical.score })
  const motivation = calculateMotivationScore(normalized)
  const risk = calculateRiskControl({
    ...normalized,
    leagueQuality: leagueQuality.score,
    dataQuality: data.score,
    marketQuality: market.score,
    statisticalEdge: statistical.score,
  })
  const value = calculateValueEdge({
    ...normalized,
    statisticalEdge: statistical.score,
    tacticalEdge: tactical.score,
    marketQuality: market.score,
    riskControl: risk.score,
  })
  const ai = calculateAiConfidence({
    ...normalized,
    dataQuality: data.score,
    marketQuality: market.score,
    statisticalEdge: statistical.score,
    tacticalEdge: tactical.score,
    motivation: motivation.score,
    riskControl: risk.score,
    valueEdge: value.score,
  })

  const scores = {
    leagueQuality: leagueQuality.score,
    dataQuality: data.score,
    marketQuality: market.score,
    statisticalEdge: statistical.score,
    tacticalEdge: tactical.score,
    motivation: motivation.score,
    riskControl: risk.score,
    valueEdge: value.score,
    aiConfidence: ai.score,
  }

  reasons.push(...leagueQuality.reasons, ...data.reasons, ...market.reasons, ...statistical.reasons, ...tactical.reasons, ...motivation.reasons, ...risk.reasons, ...value.reasons, ...ai.reasons)
  warnings.push(...leagueQuality.warnings, ...data.warnings, ...market.warnings, ...statistical.warnings, ...tactical.warnings, ...motivation.warnings, ...risk.warnings, ...value.warnings, ...ai.warnings)

  const totalWeight = Object.values(professionalScoreWeights).reduce((total, weight) => total + weight, 0)
  const totalScore = roundScore(Object.entries(scores).reduce((total, [key, score]) => total + score * professionalScoreWeights[key], 0) / totalWeight)
  const confidenceScore = roundScore(ai.score)
  const gates = {
    passedLeagueFilter: scores.leagueQuality >= 55,
    passedDataQuality: scores.dataQuality >= 50,
    passedMarketQuality: scores.marketQuality >= 45,
    passedRiskFilter: scores.riskControl >= 45,
    passedValueFilter: scores.valueEdge >= 45,
    passedConfidenceFilter: confidenceScore >= 55,
  }

  const hardGatePassed = gates.passedLeagueFilter && gates.passedDataQuality && gates.passedMarketQuality && gates.passedRiskFilter && gates.passedValueFilter && gates.passedConfidenceFilter
  const recommendation = getProfessionalRecommendation({ totalScore, confidenceScore, scores, gates, hardGatePassed })
  const finalPick = buildFinalPick(normalized, recommendation, value, market)
  const pipelineStage = getPipelineStage(gates, recommendation, {
    scores,
    hasOdds: normalized.oddsRows.length > 0,
  })

  if (!hardGatePassed) warnings.push('คู่นี้ไม่ผ่าน gate สำคัญบางส่วน ระบบจึงลดระดับคำแนะนำ')
  if (!normalized.oddsRows.length) warnings.push('ไม่มีข้อมูลราคา ระบบจำกัด Value Edge และไม่ยกระดับเป็น BET')

  return {
    totalScore,
    recommendation,
    confidenceScore,
    pipelineStage,
    scores,
    gates,
    reasons: uniqueItems(reasons).slice(0, 12),
    warnings: uniqueItems(warnings).slice(0, 10),
    finalPick,
  }
}

export function calculateStatisticalEdge(input = {}) {
  const { match, analysis } = normalizeInput(input)
  const homeForm = getForm(match, analysis, 'home')
  const awayForm = getForm(match, analysis, 'away')
  const formGap = formPoints(homeForm) - formPoints(awayForm)
  const goalGap = goalDiff(homeForm) - goalDiff(awayForm)
  const homeAttack = numberValue(homeForm.goals_for) / Math.max(1, numberValue(homeForm.played))
  const awayDefense = numberValue(awayForm.goals_against) / Math.max(1, numberValue(awayForm.played))
  const awayAttack = numberValue(awayForm.goals_for) / Math.max(1, numberValue(awayForm.played))
  const homeDefense = numberValue(homeForm.goals_against) / Math.max(1, numberValue(homeForm.played))
  const standingsGap = getStandingsGap(match, analysis)
  const stored = averagePositive([
    analysis.team_strength_score,
    analysis.form_score,
    analysis.goal_scoring_score,
    analysis.defensive_stability_score,
    analysis.home_advantage_score,
    analysis.away_weakness_score,
    analysis.ai_score,
  ])
  let score = stored || 56
  score += clamp(formGap * 2.5, -14, 14)
  score += clamp(goalGap * 1.8, -12, 12)
  score += clamp((homeAttack - awayDefense) * 8, -8, 10)
  score += clamp((homeDefense - awayAttack) * -5, -8, 8)
  if (standingsGap !== null) score += clamp(standingsGap * 1.6, -10, 10)
  if (numberValue(homeForm.clean_sheets) >= 2) score += 3
  if (numberValue(awayForm.failed_to_score) >= 2) score += 3

  const reasons = []
  const warnings = []
  if (formGap > 2) reasons.push('ฟอร์มล่าสุดของเจ้าบ้านดีกว่าชัดเจน')
  if (goalGap > 2) reasons.push('ผลต่างประตูและคุณภาพเกมรุกหนุนฝั่งเจ้าบ้าน')
  if (standingsGap !== null && standingsGap > 3) reasons.push('อันดับตารางมีช่องว่างพอให้เห็นความได้เปรียบ')
  if (!homeForm.played || !awayForm.played) warnings.push('ข้อมูลฟอร์มล่าสุดยังจำกัด')

  return scoreResult(score, reasons.length ? reasons : ['สถิติรวมอยู่ในระดับใช้งานได้'], warnings)
}

export function calculateTacticalEdge(input = {}) {
  const { match, analysis } = normalizeInput(input)
  const homeForm = getForm(match, analysis, 'home')
  const awayForm = getForm(match, analysis, 'away')
  const attackMismatch = perMatch(homeForm.goals_for, homeForm.played) - perMatch(awayForm.goals_against, awayForm.played)
  const defensiveMismatch = perMatch(awayForm.goals_for, awayForm.played) - perMatch(homeForm.goals_against, homeForm.played)
  const highGoalTrend = perMatch(numberValue(homeForm.goals_for) + numberValue(homeForm.goals_against) + numberValue(awayForm.goals_for) + numberValue(awayForm.goals_against), numberValue(homeForm.played) + numberValue(awayForm.played))
  const stored = averagePositive([analysis.tactical_matchup_score, analysis.home_away_score, analysis.home_advantage_score, analysis.away_weakness_score])
  let score = stored || 55
  score += clamp(attackMismatch * 9, -10, 12)
  score += clamp(defensiveMismatch * -5, -8, 8)
  if (highGoalTrend >= 2.8) score += 4

  const reasons = []
  if (attackMismatch > 0.25) reasons.push('เกมรุกเจ้าบ้านเจอกับเกมรับทีมเยือนที่มีช่องให้โจมตี')
  if (highGoalTrend >= 2.8) reasons.push('แนวโน้มประตูรวมของสองทีมค่อนข้างเปิด')
  return scoreResult(score, reasons.length ? reasons : ['ภาพแท็กติกยังเป็นกลางจากข้อมูลที่มี'], [])
}

export function calculateMotivationScore(input = {}) {
  const { match, analysis } = normalizeInput(input)
  const text = getContextText(match)
  const standingsGap = getStandingsGap(match, analysis)
  let score = averagePositive([analysis.motivation_score]) || 55
  const reasons = []
  const warnings = []
  if (/(final|semi|knockout|playoff|play-off|cup|champions|promotion|relegation|title|derby)/i.test(text)) {
    score += 12
    reasons.push('บริบทการแข่งขันมีแรงจูงใจสูง')
  }
  if (standingsGap !== null && Math.abs(standingsGap) <= 4) {
    score += 4
    reasons.push('ตำแหน่งในตารางใกล้กัน ทำให้เกมมีน้ำหนัก')
  }
  if (/(friendly|test)/i.test(text)) {
    score -= 18
    warnings.push('บริบทเกมอุ่นเครื่องทำให้แรงจูงใจและความจริงจังลดลง')
  }
  if (!reasons.length) reasons.push('ไม่มีข้อมูลแรงจูงใจพิเศษ จึงใช้คะแนนกลาง')
  return scoreResult(score, reasons, warnings)
}

export function calculateRiskControl(input = {}) {
  const normalized = normalizeInput(input)
  const { match, analysis } = normalized
  const text = getContextText(match)
  let score = 100
  const reasons = ['เริ่มจากคะแนนควบคุมความเสี่ยงเต็ม แล้วหักตามปัจจัยเสี่ยง']
  const warnings = []
  const penalties = [
    [isLowTrustLeagueText(text), 24, 'ลีก/รายการมี variance สูง เช่น friendly, youth, reserve หรือ amateur'],
    [numberValue(input.leagueQuality) < 55, 16, 'คุณภาพลีกต่ำกว่าเกณฑ์'],
    [numberValue(input.dataQuality) < 50, 16, 'ข้อมูลประกอบยังไม่ครบ'],
    [numberValue(input.marketQuality) < 45, 15, 'ข้อมูลตลาดยังไม่แข็งแรง'],
    [isMarketVolatile(normalized), 10, 'ราคา/ตลาดมีสัญญาณผันผวน'],
    [isExtremeFavorite(normalized), 8, 'ราคาเป็นต่อจัดจน value อาจบาง'],
    [formIsUnstable(match, analysis), 8, 'ฟอร์มล่าสุดแกว่ง'],
    [normalized.unknownCount >= 4, 12, 'มี unknown หลายส่วน'],
  ]
  for (const [active, penalty, warning] of penalties) {
    if (!active) continue
    score -= penalty
    warnings.push(warning)
  }
  return scoreResult(score, reasons, warnings)
}

export function calculateValueEdge(input = {}) {
  const normalized = normalizeInput(input)
  const { analysis, oddsRows } = normalized
  const hasOdds = oddsRows.length > 0
  const modelConfidence = roundScore(averagePositive([
    input.statisticalEdge,
    input.tacticalEdge,
    analysis.calibrated_confidence_score,
    analysis.confidence_score,
  ]) || 55)
  const implied = getBestImpliedProbability(oddsRows)
  const marketEdge = numberValue(analysis.market_edge_score)
  let score = hasOdds ? 56 : 45
  const reasons = []
  const warnings = []

  if (hasOdds && implied) {
    const modelProbability = clamp(modelConfidence / 100, 0.01, 0.99)
    const edge = modelProbability - implied
    score = 55 + edge * 180
    if (edge >= 0.08) reasons.push('โมเดลให้โอกาสสูงกว่าความน่าจะเป็นจากราคาอย่างมีนัยสำคัญ')
    if (edge < 0.02) warnings.push('ส่วนต่าง value ระหว่างโมเดลกับราคายังบาง')
  } else if (marketEdge > 0) {
    score = 50 + marketEdge * 0.35
    reasons.push('ใช้ market edge score เดิมเป็นตัวแทน value')
  } else {
    warnings.push('ไม่มี odds/line เพียงพอ ระบบจำกัด Value Edge ไม่เกิน 55')
  }

  if (!hasOdds) score = Math.min(score, 55)
  if (isMarketVolatile(normalized)) score -= 8
  if (isExtremeFavorite(normalized)) score -= 5
  if (numberValue(input.riskControl) < 55) score -= 8

  return scoreResult(score, reasons.length ? reasons : ['Value Edge ถูกประเมินจากข้อมูลตลาดที่มี'], warnings)
}

export function calculateAiConfidence(input = {}) {
  const scores = [
    numberValue(input.dataQuality),
    numberValue(input.marketQuality),
    numberValue(input.statisticalEdge),
    numberValue(input.tacticalEdge),
    numberValue(input.motivation),
    numberValue(input.riskControl),
    numberValue(input.valueEdge),
  ].filter((score) => score > 0)
  const average = scores.reduce((total, score) => total + score, 0) / Math.max(1, scores.length)
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 40
  let score = average
  score -= clamp((spread - 24) * 0.35, 0, 12)
  if (scores.length >= 6) score += 3
  if (numberValue(input.dataQuality) < 50) score -= 8
  if (numberValue(input.marketQuality) < 45) score -= 6

  const warnings = []
  if (spread > 38) warnings.push('คะแนนแต่ละโมดูลขัดกันมาก จึงลด AI Confidence')
  return scoreResult(score, ['AI Confidence รวมจากหลักฐาน ความครบของข้อมูล ความเสี่ยง และความสอดคล้องของโมดูล'], warnings)
}

export function compareProfessionalSelections(a, b) {
  const analysisA = getAnalysis(a)
  const analysisB = getAnalysis(b)
  const priorityDiff = getRecommendationPriority(analysisA.recommendation ?? a.recommendation) - getRecommendationPriority(analysisB.recommendation ?? b.recommendation)
  const professionalDiff = scoreField(b, 'professional_score') - scoreField(a, 'professional_score')
  const confidenceDiff = scoreField(b, 'confidence_score') - scoreField(a, 'confidence_score')
  const valueDiff = scoreField(b, 'value_edge_score') - scoreField(a, 'value_edge_score')
  const riskDiff = scoreField(b, 'risk_control_score') - scoreField(a, 'risk_control_score')
  const leagueDiff = scoreField(b, 'league_quality_score') - scoreField(a, 'league_quality_score')
  return priorityDiff || professionalDiff || confidenceDiff || valueDiff || riskDiff || leagueDiff
}

export function isProfessionalTopCandidate(match = {}) {
  const score = scoreField(match, 'professional_score')
  const league = scoreField(match, 'league_quality_score')
  const data = scoreField(match, 'data_quality_score')
  return score >= 55 && league >= 55 && data >= 50
}

export function normalizeProfessionalResultFromAnalysis(match = {}) {
  const analysis = getAnalysis(match)
  const rawPipeline = analysis.raw?.professional_pipeline
  if (rawPipeline?.scores) return rawPipeline
  if (analysis.professional_score !== undefined || analysis.professionalScore !== undefined) {
    return {
      totalScore: roundScore(analysis.professional_score ?? analysis.professionalScore),
      recommendation: normalizeRecommendation(analysis.recommendation),
      confidenceScore: roundScore(analysis.confidence_score ?? match.confidence ?? 0),
      pipelineStage: analysis.pipeline_stage ?? analysis.raw?.pipeline_stage ?? 'stored',
      scores: {
        leagueQuality: roundScore(analysis.league_quality_score),
        dataQuality: roundScore(analysis.data_quality_score),
        marketQuality: roundScore(analysis.market_quality_score),
        statisticalEdge: roundScore(analysis.statistical_edge_score),
        tacticalEdge: roundScore(analysis.tactical_edge_score ?? analysis.tactical_matchup_score),
        motivation: roundScore(analysis.motivation_score),
        riskControl: roundScore(analysis.risk_control_score),
        valueEdge: roundScore(analysis.value_edge_score ?? analysis.market_edge_score),
        aiConfidence: roundScore(analysis.confidence_score ?? match.confidence),
      },
      gates: analysis.raw?.professional_gates ?? {},
      reasons: toArray(analysis.pipeline_reasons ?? analysis.raw?.pipeline_reasons),
      warnings: toArray(analysis.pipeline_warnings ?? analysis.raw?.pipeline_warnings),
      finalPick: analysis.raw?.professional_final_pick ?? null,
    }
  }
  return buildProfessionalSelectionScore(match)
}

function calculateLeagueQuality(normalized) {
  const { match } = normalized
  let score = roundScore(numberValue(getAnalysis(match).league_quality_score) || getLeagueQualityScore(match))
  const text = getContextText(match)
  const warnings = []
  const reasons = []
  if (isLowTrustLeagueText(text)) {
    score = Math.min(score, /(friendly|test)/i.test(text) ? 45 : 54)
    warnings.push('ลีกหรือรายการเข้าข่ายคุณภาพต่ำ/ความผันผวนสูง')
  }
  if (score >= 75) reasons.push('คุณภาพลีกอยู่ในกลุ่มที่มีข้อมูลและความน่าเชื่อถือดี')
  else if (score >= 55) reasons.push('ลีกผ่านเกณฑ์ขั้นต่ำ แต่ยังไม่ใช่กลุ่มคุณภาพสูง')
  else warnings.push('คุณภาพลีกต่ำกว่าเกณฑ์คัดเลือก')
  return scoreResult(score, reasons, warnings)
}

function calculateDataQuality(normalized) {
  const { match, analysis } = normalized
  const checks = [
    ['มีฟอร์มทีมล่าสุด', hasForm(getForm(match, analysis, 'home')) || hasForm(getForm(match, analysis, 'away'))],
    ['มี standings', hasStandings(match, analysis)],
    ['มี goals for/against', hasGoalStats(match, analysis)],
    ['มี recent matches', hasArrayData(match.recentMatches ?? match.raw?.recentMatches ?? analysis.raw?.recentMatches)],
    ['มี H2H', hasArrayData(match.h2h ?? match.h2hMatches ?? analysis.raw?.h2h ?? analysis.raw?.h2hMatches)],
    ['มี market/odds', normalized.oddsRows.length > 0],
    ['มี home/away split', hasHomeAwaySplit(match, analysis)],
  ]
  const available = checks.filter(([, ok]) => ok).map(([label]) => label)
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label)
  const score = roundScore((available.length / checks.length) * 100)
  const warnings = missing.length ? [`ข้อมูลบางส่วนไม่ครบ ระบบลดคะแนนความน่าเชื่อถือ: ${missing.slice(0, 3).join(', ')}`] : []
  return scoreResult(score, [`Data Quality มีข้อมูลพร้อม ${available.length}/${checks.length} หมวด`], warnings)
}

function calculateMarketQuality(normalized) {
  const { analysis, oddsRows } = normalized
  const markets = getMarketFlags(oddsRows, analysis)
  let score = 15
  if (markets.hasAh) score += 28
  if (markets.hasOu) score += 24
  if (markets.hasOneXTwo) score += 20
  if (markets.marketCount > 1) score += 8
  if (markets.hasMovement) score += 6
  if (!oddsRows.length) score = Math.min(score, 30)
  if (markets.volatile) score -= 14
  const reasons = []
  const warnings = []
  if (markets.hasAh && markets.hasOu && markets.hasOneXTwo) reasons.push('ตลาดมี AH, O/U และ 1X2 ครบ')
  else if (markets.hasOneXTwo) reasons.push('มีตลาด 1X2 เป็นอย่างน้อย')
  if (!oddsRows.length) warnings.push('ไม่มี odds ที่ใช้งานได้')
  if (markets.volatile) warnings.push('ราคาเปลี่ยนแรงผิดปกติ')
  return scoreResult(score, reasons.length ? reasons : ['Market Quality ประเมินจากราคาเท่าที่มี'], warnings)
}

function buildFinalPick(normalized, recommendation, value, market) {
  const { match, analysis, oddsRows } = normalized
  const bestOdd = oddsRows[0] ?? {}
  const marketName = bestOdd.market_name ?? bestOdd.market ?? analysis.value_market ?? analysis.market_type ?? null
  const side = normalizePickSide(analysis.pick_side ?? analysis.value_side ?? bestOdd.pick_side ?? bestOdd.selection)
  const line = bestOdd.line ?? bestOdd.handicap ?? bestOdd.value ?? analysis.value_line ?? analysis.market_line ?? null
  const type = recommendation === 'BET' ? 'BET' : recommendation === 'LEAN' ? 'LEAN' : 'NO BET'
  return {
    type,
    side,
    market: marketName,
    line,
    label: type === 'BET' ? 'AI BET' : type === 'LEAN' ? 'รอดูราคา' : 'ผ่านการวิเคราะห์แล้ว แต่ไม่คุ้มเสี่ยง',
    reason: value.score >= 70 && market.score >= 55
      ? 'พบส่วนต่าง value และตลาดมีข้อมูลรองรับ'
      : getTeamLabel(match, side) ? `โมเดลประเมินฝั่ง ${getTeamLabel(match, side)} แต่ edge ยังต้องยืนยันราคา` : 'ยังไม่มีตัวเลือกตลาดที่ชัดพอ',
  }
}

function getProfessionalRecommendation({ totalScore, confidenceScore, scores, gates, hardGatePassed }) {
  const hasCriticalGate = gates.passedLeagueFilter && gates.passedDataQuality && gates.passedMarketQuality && gates.passedRiskFilter
  if (hardGatePassed && totalScore >= 82 && confidenceScore >= 80 && scores.valueEdge >= 70 && scores.riskControl >= 60) return 'BET'
  if (hasCriticalGate && totalScore >= 70 && confidenceScore >= 68) return 'LEAN'
  return 'NO BET'
}

function getPipelineStage(gates, recommendation, context = {}) {
  if (numberValue(context.scores?.dataQuality) < 35) return 'NO_DATA'
  if (!context.hasOdds && recommendation !== 'BET') return 'WATCH'
  if (!gates.passedLeagueFilter) return 'league-filter'
  if (!gates.passedDataQuality) return 'data-quality-filter'
  if (!gates.passedMarketQuality) return 'market-quality-filter'
  if (!gates.passedRiskFilter) return 'risk-filter'
  if (!gates.passedValueFilter) return 'value-filter'
  if (!gates.passedConfidenceFilter) return 'confidence-filter'
  return recommendation === 'BET' ? 'bet-selected' : recommendation === 'LEAN' ? 'lean-selected' : 'no-bet'
}

function normalizeInput(input) {
  const match = input.match ?? input
  const analysis = {
    ...(match.analysis ?? match.match_analysis ?? {}),
    ...(input.analysis ?? {}),
  }
  const oddsRows = normalizeOddsRows(input.market ?? input.odds ?? match.odds ?? match.matchOdds ?? match.match_odds ?? analysis.raw?.odds ?? [])
  const unknownCount = [
    !match.homeTeam?.name && !match.home_team?.name,
    !match.awayTeam?.name && !match.away_team?.name,
    !getContextText(match),
    !hasForm(getForm(match, analysis, 'home')),
    !hasForm(getForm(match, analysis, 'away')),
    !oddsRows.length,
    !hasStandings(match, analysis),
  ].filter(Boolean).length
  return {
    ...input,
    match,
    analysis,
    oddsRows,
    unknownCount,
  }
}

function getAnalysis(match = {}) {
  const analysis = match.analysis ?? match.match_analysis ?? {}
  return Array.isArray(analysis) ? analysis[0] ?? {} : analysis ?? {}
}

function normalizeOddsRows(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : []
  return rows.filter((row) => row && typeof row === 'object')
}

function getMarketFlags(oddsRows, analysis = {}) {
  const text = oddsRows.map((row) => `${row.market_name ?? row.market ?? row.name ?? ''} ${row.selection ?? row.label ?? ''}`).join(' ').toLowerCase()
  const raw = analysis.raw ?? {}
  const marketText = `${text} ${analysis.value_market ?? ''} ${analysis.market_type ?? ''} ${raw.market ?? ''}`.toLowerCase()
  const prices = oddsRows.map((row) => numberValue(row.price ?? row.odd ?? row.odds)).filter((price) => price > 1)
  return {
    hasAh: /asian|handicap|\bah\b/.test(marketText),
    hasOu: /over|under|goals|o\/u|\bou\b/.test(marketText),
    hasOneXTwo: /match winner|1x2|home|draw|away/.test(marketText),
    marketCount: new Set(oddsRows.map((row) => row.market_name ?? row.market ?? row.name).filter(Boolean)).size,
    hasMovement: Boolean(analysis.odds_movement_score || raw.odds_movement_summary || raw.market_movement),
    volatile: numberValue(analysis.odds_movement_score) < 35 && analysis.odds_movement_score !== undefined,
    prices,
  }
}

function getBestImpliedProbability(oddsRows) {
  const prices = oddsRows.map((row) => numberValue(row.price ?? row.odd ?? row.odds)).filter((price) => price > 1)
  if (!prices.length) return null
  return clamp(1 / Math.max(...prices), 0.01, 0.99)
}

function getForm(match, analysis, side) {
  const camel = side === 'home' ? 'homeForm' : 'awayForm'
  const snake = side === 'home' ? 'home_form' : 'away_form'
  return match[camel] ?? match[snake] ?? match.raw?.[camel] ?? analysis.raw?.[camel] ?? analysis.raw?.[snake] ?? {}
}

function hasForm(form) {
  return numberValue(form?.played) > 0 || numberValue(form?.wins) > 0 || numberValue(form?.goals_for) > 0
}

function hasStandings(match, analysis) {
  return hasArrayData(match.standings ?? analysis.raw?.standings) || Boolean(match.homeStanding ?? match.awayStanding ?? analysis.raw?.homeStanding)
}

function hasGoalStats(match, analysis) {
  const home = getForm(match, analysis, 'home')
  const away = getForm(match, analysis, 'away')
  return [home.goals_for, home.goals_against, away.goals_for, away.goals_against].some((value) => numberValue(value) > 0)
}

function hasHomeAwaySplit(match, analysis) {
  return Boolean(match.homeStats ?? match.awayStats ?? analysis.raw?.homeStats ?? analysis.raw?.awayStats ?? analysis.home_away_score ?? analysis.home_advantage_score)
}

function hasArrayData(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(value)
}

function getStandingsGap(match, analysis) {
  const homePosition = numberValue(match.homeStanding?.rank ?? match.homeStanding?.position ?? analysis.raw?.homeStanding?.rank)
  const awayPosition = numberValue(match.awayStanding?.rank ?? match.awayStanding?.position ?? analysis.raw?.awayStanding?.rank)
  if (homePosition && awayPosition) return awayPosition - homePosition
  return null
}

function getContextText(match = {}) {
  return [
    match.league?.name,
    match.league?.country,
    match.competition?.name,
    match.competition?.country,
    match.raw?.apiFootball?.league?.name,
    match.raw?.league?.name,
    match.name,
  ].filter(Boolean).join(' ')
}

function isLowTrustLeagueText(text) {
  return /(friendly|friendlies|club friendly|test|youth|u17|u18|u19|u20|u21|u23|amateur|reserve|reserves|academy)/i.test(text)
}

function isMarketVolatile(normalized) {
  const { analysis } = normalized
  return numberValue(analysis.odds_movement_score) > 0 && numberValue(analysis.odds_movement_score) < 35
}

function isExtremeFavorite(normalized) {
  const prices = getMarketFlags(normalized.oddsRows, normalized.analysis).prices
  return prices.some((price) => price > 1 && price < 1.25)
}

function formIsUnstable(match, analysis) {
  const home = getForm(match, analysis, 'home')
  const away = getForm(match, analysis, 'away')
  const totalLosses = numberValue(home.losses) + numberValue(away.losses)
  const totalPlayed = numberValue(home.played) + numberValue(away.played)
  return totalPlayed >= 6 && totalLosses / totalPlayed >= 0.45
}

function formPoints(form) {
  return numberValue(form.wins) * 3 + numberValue(form.draws)
}

function goalDiff(form) {
  return numberValue(form.goals_for) - numberValue(form.goals_against)
}

function perMatch(value, played) {
  return numberValue(value) / Math.max(1, numberValue(played))
}

function averagePositive(values) {
  const scores = values.map(numberValue).filter((value) => value > 0)
  if (!scores.length) return 0
  return scores.reduce((total, score) => total + score, 0) / scores.length
}

function scoreResult(score, reasons = [], warnings = []) {
  return {
    score: roundScore(clamp(score, 0, 100)),
    reasons: uniqueItems(reasons),
    warnings: uniqueItems(warnings),
  }
}

function normalizeRecommendation(value) {
  const text = String(value ?? '').toUpperCase().replace('_', ' ')
  return ['BET', 'LEAN', 'NO BET'].includes(text) ? text : 'NO BET'
}

function getRecommendationPriority(value) {
  return recommendationPriority[normalizeRecommendation(value)] ?? 4
}

function scoreField(match, key) {
  const analysis = getAnalysis(match)
  const raw = analysis.raw ?? {}
  const camelKey = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())
  return numberValue(match[key] ?? match[camelKey] ?? analysis[key] ?? analysis[camelKey] ?? raw[key] ?? raw.professional_pipeline?.scores?.[camelKey] ?? raw.professional_pipeline?.totalScore)
}

function normalizePickSide(value) {
  const text = String(value ?? '').toUpperCase()
  if (text.includes('HOME')) return 'HOME'
  if (text.includes('AWAY')) return 'AWAY'
  if (text.includes('DRAW')) return 'DRAW'
  if (text.includes('OVER')) return 'OVER'
  if (text.includes('UNDER')) return 'UNDER'
  return 'NONE'
}

function getTeamLabel(match, side) {
  if (side === 'HOME') return match.homeTeam?.name ?? match.home_team?.name
  if (side === 'AWAY') return match.awayTeam?.name ?? match.away_team?.name
  if (side === 'DRAW') return 'เสมอ'
  return ''
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (!value) return []
  return [String(value)]
}

function uniqueItems(items) {
  return [...new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean))]
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function roundScore(value) {
  return Math.round(clamp(value, 0, 100) * 10) / 10
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
