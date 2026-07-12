export const ANALYSIS_STATUS = Object.freeze({
  ANALYSIS_READY: 'ANALYSIS_READY',
  PARTIAL_ANALYSIS: 'PARTIAL_ANALYSIS',
  WAITING_DATA: 'WAITING_DATA',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  FINAL_LOCKED: 'FINAL_LOCKED',
  FINISHED: 'FINISHED',
})

export const analysisStatusValues = Object.freeze(Object.values(ANALYSIS_STATUS))

const statusMap = Object.freeze({
  READY: ANALYSIS_STATUS.ANALYSIS_READY,
  READY_PRIMARY: ANALYSIS_STATUS.ANALYSIS_READY,
  READY_ALTERNATIVE: ANALYSIS_STATUS.PARTIAL_ANALYSIS,
  WATCH: ANALYSIS_STATUS.PARTIAL_ANALYSIS,
  WAITING_MARKET: ANALYSIS_STATUS.WAITING_DATA,
  WAITING_DATA: ANALYSIS_STATUS.WAITING_DATA,
  NO_DATA: ANALYSIS_STATUS.INSUFFICIENT_DATA,
  INSUFFICIENT_DATA: ANALYSIS_STATUS.INSUFFICIENT_DATA,
  REJECTED: ANALYSIS_STATUS.INSUFFICIENT_DATA,
  FINAL_LOCKED: ANALYSIS_STATUS.FINAL_LOCKED,
  FINISHED: ANALYSIS_STATUS.FINISHED,
  FT: ANALYSIS_STATUS.FINISHED,
  AET: ANALYSIS_STATUS.FINISHED,
  PEN: ANALYSIS_STATUS.FINISHED,
})

export function normalizeAnalysisStatus(value, fallback = ANALYSIS_STATUS.WAITING_DATA) {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (analysisStatusValues.includes(normalized)) return normalized
  return statusMap[normalized] ?? fallback
}

export function getAnalysisStatusLabelTh(status) {
  const normalized = normalizeAnalysisStatus(status)
  return {
    [ANALYSIS_STATUS.ANALYSIS_READY]: 'พร้อมวิเคราะห์',
    [ANALYSIS_STATUS.PARTIAL_ANALYSIS]: 'วิเคราะห์บางส่วน',
    [ANALYSIS_STATUS.WAITING_DATA]: 'รอข้อมูล',
    [ANALYSIS_STATUS.INSUFFICIENT_DATA]: 'ข้อมูลไม่พอ',
    [ANALYSIS_STATUS.FINAL_LOCKED]: 'ล็อกมุมมองแล้ว',
    [ANALYSIS_STATUS.FINISHED]: 'แข่งจบแล้ว',
  }[normalized]
}

export function getAnalysisStatusTone(status) {
  const normalized = normalizeAnalysisStatus(status)
  if (normalized === ANALYSIS_STATUS.ANALYSIS_READY) return 'good'
  if (normalized === ANALYSIS_STATUS.PARTIAL_ANALYSIS) return 'watch'
  if (normalized === ANALYSIS_STATUS.FINISHED || normalized === ANALYSIS_STATUS.FINAL_LOCKED) return 'neutral'
  if (normalized === ANALYSIS_STATUS.INSUFFICIENT_DATA) return 'risk'
  return 'waiting'
}

export function isAnalysisReadyStatus(status) {
  return normalizeAnalysisStatus(status) === ANALYSIS_STATUS.ANALYSIS_READY
}
