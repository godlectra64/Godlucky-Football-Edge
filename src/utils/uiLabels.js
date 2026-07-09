export const recommendationLabelsTh = {
  BET: 'พร้อมตัดสิน',
  LEAN: 'น่าติดตาม',
  WATCH: 'เฝ้าดู',
  'NO BET': 'รอข้อมูลเพิ่ม',
}

export const resultStatusLabelsTh = {
  HIT: 'เข้าเป้า',
  MISS: 'ไม่เข้าเป้า',
  PUSH: 'เจ๊า',
  PENDING: 'รอผล',
  VOID: 'ไม่นับผล',
}

export const signalLabelsTh = {
  STRONG_SIGNAL: 'สัญญาณเด่น',
  WATCH: 'น่าติดตาม',
  SKIP: 'รอข้อมูลเพิ่ม',
}

export const marketLabelsTh = {
  AH: 'แฮนดิแคป',
  OU: 'สูง/ต่ำ',
  MATCH_WINNER: '1X2',
  BTTS: 'ทั้งสองทีมยิงได้',
  NONE: 'ยังไม่มีข้อมูลราคา',
}

export const riskLabelsTh = {
  low: 'เสี่ยงต่ำ',
  medium: 'เสี่ยงกลาง',
  high: 'เสี่ยงสูง',
  LOW: 'เสี่ยงต่ำ',
  MEDIUM: 'เสี่ยงกลาง',
  HIGH: 'เสี่ยงสูง',
}

export function formatRecommendationLabel(value) {
  const normalized = String(value ?? 'NO BET').toUpperCase().replace('_', ' ')
  return recommendationLabelsTh[normalized] ?? recommendationLabelsTh['NO BET']
}

export function formatMarketFocus(value) {
  const normalized = String(value ?? 'NONE').toUpperCase()
  return marketLabelsTh[normalized] ?? String(value ?? '-')
}

export function formatRiskLevel(value) {
  const normalized = String(value ?? 'medium').toLowerCase()
  return riskLabelsTh[normalized] ?? String(value ?? '-')
}

export function formatSignal(value) {
  const normalized = String(value ?? 'SKIP').toUpperCase()
  return signalLabelsTh[normalized] ?? signalLabelsTh.SKIP
}

export function formatAhCardLabel(pick = {}) {
  if (String(pick.side ?? 'NONE').toUpperCase() === 'NONE') return 'รอเส้น'
  return stripMarketSuffix(pick.label)
}

export function formatOuCardLabel(pick = {}) {
  if (String(pick.side ?? 'NONE').toUpperCase() === 'NONE') return 'รอราคา'
  const side = String(pick.side ?? '').toUpperCase()
  if (side === 'OVER') return stripMarketSuffix(pick.label).replace(/^OVER\b/i, 'สูง')
  if (side === 'UNDER') return stripMarketSuffix(pick.label).replace(/^UNDER\b/i, 'ต่ำ')
  return stripMarketSuffix(pick.label)
}

export function formatBestPickCardLabel(finalPick = {}) {
  if (finalPick.type !== 'NO_DECISION') return finalPick.label || '-'
  const text = `${finalPick.label ?? ''} ${finalPick.reason ?? ''}`.toLowerCase()
  if (text.includes('ผ่าน') || text.includes('เกณฑ์') || text.includes('market')) return 'ยังไม่ผ่าน'
  return 'รอตลาด'
}

export function formatDecisionReasonLine(decision = {}) {
  if (decision.status === 'WAITING_MARKET' || decision.final_pick?.label === 'รอตลาด') {
    return 'รอข้อมูลราคาเพื่อยืนยัน AH/O-U'
  }
  return decision.final_pick?.reason || decision.match_view?.reason || 'ข้อมูลยังไม่พอสำหรับสรุป'
}

function stripMarketSuffix(value) {
  return String(value ?? '-')
    .replace(/\s+AH$/i, '')
    .replace(/\s+O\/U$/i, '')
    .trim()
}
