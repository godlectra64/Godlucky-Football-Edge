import { getConfidence, getRecommendation, getRiskLevel } from './analysisEngine.js'
import { getAiPickDisplay } from './pickSide.js'

const valueStatuses = ['YES', 'NO', 'WAITING_DATA', 'NOT_APPLICABLE']

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

  const market = parseLineNumber(context.marketLine)
  const fair = parseLineNumber(context.fairLine)
  if (market === null || fair === null) return 'NO'
  return market > fair ? 'YES' : 'NO'
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

function parseLineNumber(value) {
  if (value === null || value === undefined) return null
  const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? '').toUpperCase()
  return ['BET', 'LEAN', 'NO BET'].includes(normalized) ? normalized : 'NO BET'
}

function normalizeRiskLevel(value) {
  const normalized = String(value ?? '').toUpperCase()
  return ['LOW', 'MEDIUM', 'HIGH'].includes(normalized) ? normalized : 'MEDIUM'
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
