export const recommendationLabelsTh = {
  BET: 'คู่เด่น',
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
  NONE: 'รอข้อมูลจาก API-Football',
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
