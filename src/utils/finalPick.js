import { getConfidence, getRecommendation, getRiskLevel } from './analysisEngine.js'
import { getAiPickDisplay } from './pickSide.js'

const valueStatuses = ['YES', 'NO', 'WAITING_DATA', 'NOT_APPLICABLE']
const oneBestPickCopy = {
  FINAL_PICK: {
    title: 'AI FINAL PICK',
    subtitle: 'คู่ที่ AI มั่นใจที่สุดของวันนี้',
    badgeLabel: 'FINAL PICK',
    note: 'วันนี้ AI เลือกคู่นี้เป็นอันดับ 1 ของวัน',
  },
  BEST_AVAILABLE: {
    title: 'BEST AVAILABLE PICK',
    subtitle: 'คู่ที่ดีที่สุดของวันนี้ แม้ยังไม่ถึงระดับ BET',
    badgeLabel: 'BEST AVAILABLE',
    note: 'อันดับ 1 วันนี้ยังไม่ถึงระดับ BET แต่เป็นคู่ที่ AI ประเมินดีที่สุด',
  },
  WATCHLIST: {
    title: 'WATCHLIST',
    subtitle: 'มีทรงน่าสนใจ แต่ควรรอข้อมูลเพิ่ม',
    badgeLabel: 'WATCHLIST',
    note: 'อันดับ 1 วันนี้ยังมีความเสี่ยงสูง AI ไม่แนะนำให้เดิมพัน แต่เป็นคู่ที่น่าติดตามที่สุดของวัน',
  },
  NO_CLEAR_PICK: {
    title: 'NO CLEAR PICK',
    subtitle: 'วันนี้ AI ยังไม่พบคู่ที่มีคุณภาพเพียงพอ',
    badgeLabel: '',
    note: 'วันนี้ AI ยังไม่พบคู่ที่มีคุณภาพพอให้เลือกเป็นตัวหลัก',
  },
}

export function buildAiFinalPick(match = {}) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const raw = {
    ...(match.raw ?? {}),
    ...(analysis.raw?.raw_match ?? {}),
  }
  const recommendation = normalizeRecommendation(analysis.recommendation ?? match.recommendation ?? getRecommendation(match))
  const riskLevel = normalizeRiskLevel(analysis.risk_level ?? match.riskLevel ?? getRiskLevel(match))
  const confidence = Math.round(clamp(Number(analysis.confidence_score ?? match.confidence ?? getConfidence(match)), 0, 100))
  const pickDisplay = getAiPickDisplay(match)
  const marketType = firstText(
    analysis.market_type,
    analysis.bet_market,
    analysis.recommended_market,
    analysis.raw?.market_type,
    analysis.raw?.bet_market,
    analysis.raw?.recommended_market,
    raw.market_type,
    raw.bet_market,
    raw.recommended_market,
    raw.market?.type,
    raw.odds?.market_type,
  )
  const marketLine = firstText(
    analysis.market_line,
    analysis.odds_line,
    analysis.handicap_line,
    analysis.current_line,
    analysis.raw?.market_line,
    analysis.raw?.odds_line,
    analysis.raw?.handicap_line,
    analysis.raw?.current_line,
    raw.market_line,
    raw.odds_line,
    raw.handicap_line,
    raw.current_line,
    raw.market?.line,
    raw.odds?.line,
  )
  const fairLine = firstText(analysis.fair_line, analysis.raw?.fair_line, raw.fair_line)
  const probability = getProbability(analysis, raw, pickDisplay.pickSide, confidence)
  const valueStatus = normalizeValueStatus(
    analysis.value_status ?? analysis.value_bet ?? analysis.edge_status ?? analysis.raw?.value_status ?? raw.value_status,
    {
      recommendation,
      pickSide: pickDisplay.pickSide,
      marketLine,
      fairLine,
    },
  )
  const valueReason = getValueReason(valueStatus, analysis.value_reason ?? analysis.raw?.value_reason, marketLine, fairLine)

  return {
    recommendation,
    riskLevel,
    confidence,
    pickSide: pickDisplay.pickSide,
    pickTeam: pickDisplay.pickTeam,
    pickLabel: pickDisplay.label,
    pickReason: pickDisplay.pickReason,
    canHighlight: pickDisplay.canHighlight,
    marketType,
    marketLine,
    fairLine,
    modelProbability: probability.value,
    probabilityLabel: probability.label,
    probabilitySource: probability.source,
    valueStatus,
    valueLabel: getValueLabel(valueStatus),
    valueReason,
    marketTypeLabel: marketType ? `ตลาด: ${marketType}` : 'ตลาด: ยังไม่มีข้อมูลราคา',
    marketLineLabel: marketLine ? `ราคาตลาด: ${marketLine}` : 'ราคาตลาด: ยังไม่มีข้อมูล',
    fairLineLabel: fairLine ? `Fair Line: ${fairLine}` : 'Fair Line: รอข้อมูลเพิ่มเติม',
    valueStatusLabel: `Value: ${getValueLabel(valueStatus)}`,
    matchLabel: `${match.homeTeam?.name ?? 'เจ้าบ้าน'} vs ${match.awayTeam?.name ?? 'ทีมเยือน'}`,
    leagueName: match.league?.name ?? raw.competition?.name ?? 'Unknown league',
    kickoffAt: match.kickoffAt ?? match.kickoff_at ?? raw.utcDate ?? null,
  }
}

export function getOneBestPickOfDay(matches = []) {
  const validMatches = (matches ?? [])
    .filter(Boolean)
    .filter(hasRecommendationData)
    .map((match) => ({
      match,
      finalPick: buildAiFinalPick(match),
      combinedModuleScore: getCombinedModuleScore(match),
    }))

  const topPick = pickStoredFinal(validMatches) ?? pickStoredRankOne(validMatches) ?? sortOneBestCandidates(validMatches)[0]
  if (!topPick) return null

  if (topPick.finalPick.recommendation === 'BET') return buildOneBestResult(topPick.match, 'FINAL_PICK')
  if (topPick.finalPick.recommendation === 'LEAN') return buildOneBestResult(topPick.match, 'BEST_AVAILABLE')
  return buildOneBestResult(topPick.match, 'WATCHLIST')
}

function getProbability(analysis, raw, pickSide, confidence) {
  const direct = pickSide === 'HOME'
    ? firstNumber(analysis.home_win_probability, analysis.raw?.home_win_probability, raw.home_win_probability)
    : pickSide === 'AWAY'
      ? firstNumber(analysis.away_win_probability, analysis.raw?.away_win_probability, raw.away_win_probability)
      : pickSide === 'DRAW'
        ? firstNumber(analysis.draw_probability, analysis.raw?.draw_probability, raw.draw_probability)
        : null
  const storedModel = firstNumber(analysis.model_probability, analysis.raw?.model_probability, raw.model_probability, analysis.win_probability, raw.win_probability)
  const value = Math.round(clamp(direct ?? storedModel ?? confidence, 0, 100))

  return {
    value,
    label: direct !== null || storedModel !== null ? `Win Probability: ${value}%` : `โอกาสตามโมเดล: ${value}%`,
    source: direct !== null || storedModel !== null ? 'provided' : 'confidence_estimate',
  }
}

function normalizeValueStatus(value, context) {
  const recommendation = normalizeRecommendation(context.recommendation)
  const pickSide = String(context.pickSide ?? 'NONE').toUpperCase()
  if (recommendation === 'NO BET' || pickSide === 'NONE') return 'NOT_APPLICABLE'
  if (!context.marketLine || !context.fairLine) return 'WAITING_DATA'

  const normalized = String(value ?? '').toUpperCase()
  if (valueStatuses.includes(normalized)) return normalized
  return 'NO'
}

function getValueLabel(status) {
  if (status === 'YES') return 'YES'
  if (status === 'NO') return 'NO'
  if (status === 'NOT_APPLICABLE') return 'ไม่เหมาะเดิมพัน'
  return 'รอข้อมูลราคา'
}

function getValueReason(status, storedReason, marketLine, fairLine) {
  if (storedReason) return String(storedReason)
  if (status === 'YES') return 'ราคาตลาดดีกว่า Fair Line จากข้อมูลจริงที่มี'
  if (status === 'NO') return 'มีข้อมูลราคาแล้ว แต่ส่วนต่างยังไม่คุ้มพอ'
  if (status === 'NOT_APPLICABLE') return 'ไม่ใช่จังหวะเดิมพัน จึงไม่ประเมิน Value เชิงรุก'
  if (!marketLine || !fairLine) return 'ยังไม่มีราคาตลาดหรือ Fair Line เพียงพอสำหรับประเมิน Value'
  return 'รอข้อมูลราคาเพิ่มเติม'
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

function buildOneBestResult(match, heroType) {
  const copy = oneBestPickCopy[heroType] ?? oneBestPickCopy.NO_CLEAR_PICK
  const note = match?.analysis?.final_pick_note ?? match?.finalPickNote ?? match?.final_pick_note ?? getNoteForRecommendation(getStoredRecommendation(match ?? {}), copy.note)
  return {
    match,
    heroType,
    title: copy.title,
    subtitle: copy.subtitle,
    badgeLabel: copy.badgeLabel,
    note,
  }
}

function pickStoredFinal(items) {
  return sortOneBestCandidates(items.filter((item) => Boolean(item.match?.isFinalPick ?? item.match?.is_final_pick ?? item.match?.analysis?.is_final_pick)))[0] ?? null
}

function pickStoredRankOne(items) {
  return items.find((item) => Number(item.match?.finalRank ?? item.match?.final_rank ?? item.match?.analysis?.final_rank) === 1) ?? null
}

function getNoteForRecommendation(recommendation, fallback) {
  if (recommendation === 'LEAN') return 'อันดับ 1 วันนี้ยังไม่ถึงระดับ BET แต่เป็นคู่ที่ AI ประเมินดีที่สุด'
  if (recommendation === 'NO BET') return 'อันดับ 1 วันนี้ยังมีความเสี่ยงสูง AI ไม่แนะนำให้เดิมพัน แต่เป็นคู่ที่น่าติดตามที่สุดของวัน'
  if (recommendation === 'WATCH') return 'มีทรงน่าสนใจ แต่ควรรอข้อมูลเพิ่ม'
  return fallback
}

function getStoredRecommendation(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  return normalizeRecommendation(analysis.recommendation ?? match.recommendation)
}

function hasRecommendationData(match) {
  const analysis = match.analysis ?? match.match_analysis ?? {}
  return Boolean(analysis.recommendation ?? match.recommendation)
}

function sortOneBestCandidates(items) {
  return [...items].sort((a, b) => {
    const rankA = Number(a.match?.finalRank ?? a.match?.final_rank ?? a.match?.analysis?.final_rank ?? 999)
    const rankB = Number(b.match?.finalRank ?? b.match?.final_rank ?? b.match?.analysis?.final_rank ?? 999)
    const rankDiff = rankA - rankB
    const recommendationDiff = recommendationPriority(getStoredRecommendation(a.match)) - recommendationPriority(getStoredRecommendation(b.match))
    const rankingDiff = Number(b.match?.rankingScore ?? b.match?.ranking_score ?? b.match?.analysis?.ranking_score ?? 0) - Number(a.match?.rankingScore ?? a.match?.ranking_score ?? a.match?.analysis?.ranking_score ?? 0)
    const confidenceDiff = b.finalPick.confidence - a.finalPick.confidence
    const riskDiff = riskPriority(a.finalPick.riskLevel) - riskPriority(b.finalPick.riskLevel)
    const moduleDiff = b.combinedModuleScore - a.combinedModuleScore
    const kickoffA = new Date(a.match.kickoffAt ?? a.match.kickoff_at ?? 0).getTime()
    const kickoffB = new Date(b.match.kickoffAt ?? b.match.kickoff_at ?? 0).getTime()
    return rankDiff || recommendationDiff || rankingDiff || confidenceDiff || riskDiff || moduleDiff || kickoffA - kickoffB
  })
}

function recommendationPriority(recommendation) {
  if (recommendation === 'BET') return 1
  if (recommendation === 'LEAN') return 2
  if (recommendation === 'WATCH') return 3
  if (recommendation === 'NO BET') return 4
  return 4
}

function riskPriority(riskLevel) {
  if (riskLevel === 'LOW') return 0
  if (riskLevel === 'MEDIUM') return 1
  return 2
}

function getCombinedModuleScore(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const breakdown = analysis.raw?.analysis_breakdown ?? analysis.analysis_breakdown ?? {}
  const scores = [
    analysis.home_advantage_score ?? breakdown.home_away_advantage?.score ?? analysis.home_away_score,
    analysis.away_weakness_score ?? breakdown.away_weakness?.score,
    analysis.goal_scoring_score ?? breakdown.attack_quality?.score ?? analysis.goal_quality_score,
    analysis.defensive_stability_score ?? breakdown.defensive_stability?.score,
    analysis.market_risk_score ?? breakdown.market_odds_risk?.score ?? analysis.risk_score,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

  if (!scores.length) return 0
  return Math.round(scores.reduce((total, score) => total + clamp(score, 0, 100), 0) / scores.length)
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? '').toUpperCase().replace('_', ' ')
  return ['BET', 'LEAN', 'WATCH', 'NO BET'].includes(normalized) ? normalized : 'NO BET'
}

function normalizeRiskLevel(value) {
  const normalized = String(value ?? '').toUpperCase()
  return ['LOW', 'MEDIUM', 'HIGH'].includes(normalized) ? normalized : 'MEDIUM'
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
