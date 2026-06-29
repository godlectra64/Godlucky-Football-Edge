export const recommendationLabelsTh = {
  BET: 'BET',
  LEAN: 'LEAN',
  WATCH: 'WATCH',
  'NO BET': 'NO BET',
}

export const resultStatusLabelsTh = {
  HIT: 'HIT · เข้าเป้า',
  MISS: 'MISS · ไม่เข้าเป้า',
  PUSH: 'PUSH · เจ๊า',
  PENDING: 'PENDING · รอผล',
  VOID: 'VOID · ไม่นับผล',
}

export const signalLabelsTh = {
  STRONG_SIGNAL: 'STRONG_SIGNAL · สัญญาณแข็งแรง',
  WATCH: 'WATCH · รอติดตาม',
  SKIP: 'SKIP · ข้ามคู่นี้',
}

export const marketLabelsTh = {
  AH: 'AH · ราคาต่อรอง',
  OU: 'OU · สูง/ต่ำ',
  MATCH_WINNER: '1X2 · ผู้ชนะ',
  BTTS: 'BTTS · ทั้งสองทีมยิงได้',
  NONE: 'ไม่มีตลาดหลัก',
}

export const riskLabelsTh = {
  low: 'เสี่ยงต่ำ',
  medium: 'เสี่ยงกลาง',
  high: 'เสี่ยงสูง',
  LOW: 'เสี่ยงต่ำ',
  MEDIUM: 'เสี่ยงกลาง',
  HIGH: 'เสี่ยงสูง',
}

export function formatMarketFocus(value) {
  return marketLabelsTh[String(value ?? '').toUpperCase()] ?? value ?? '-'
}

export function formatRiskLevel(value) {
  const normalized = String(value ?? 'medium').toLowerCase()
  return riskLabelsTh[normalized] ?? value ?? '-'
}

export function formatSignal(value) {
  return signalLabelsTh[String(value ?? 'SKIP').toUpperCase()] ?? value ?? '-'
}
