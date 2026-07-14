export const decisionStatuses = Object.freeze({ ready: 'READY', watch: 'WATCH', wait: 'WAIT', rejected: 'REJECTED' })

export function classifyDecisionState(input = {}) {
  if (input.hardRejected) return decision('REJECTED', input.hardReasonCodes, input.hardReasonCode ?? 'FIXTURE_INVALID')
  if (String(input.riskLevel ?? '').toUpperCase() === 'CRITICAL') return decision('REJECTED', ['RISK_CRITICAL'])
  if (!input.analysisComplete) return decision('WAIT', ['DATA_INCOMPLETE', 'ANALYSIS_PENDING'])
  if (!input.marketReady) return decision(
    'WAIT',
    [...(input.marketReasonCodes ?? []), !input.finalPickActionable ? 'FINAL_PICK_MISSING' : null],
    input.marketReasonCodes?.length ? null : 'MARKET_MISSING',
  )
  if (!input.finalPickActionable) {
    return input.hasAnalysisDirection && input.hasAnyMarket
      ? decision('WATCH', ['FINAL_PICK_MISSING', 'VALUE_BORDERLINE'])
      : decision('WAIT', ['FINAL_PICK_MISSING'])
  }
  if (String(input.riskLevel ?? '').toUpperCase() === 'HIGH') return decision('WATCH', ['RISK_HIGH'])
  const score = Number(input.readinessScore ?? 0)
  if (score >= Number(input.readyThreshold ?? 80)) return decision('READY', ['READY_SCORE_PASSED', 'ANALYSIS_COMPLETE', 'FINAL_PICK_VALID', 'FINAL_MARKET_READY'])
  if (score >= Number(input.watchThreshold ?? 70)) return decision('WATCH', ['SCORE_BELOW_READY'])
  return decision('WATCH', ['QUALITY_GATE_FAILED', 'SCORE_BELOW_WATCH'])
}

export function getDecisionReasonThai(primaryReasonCode, status) {
  const reasons = {
    FIXTURE_INVALID: 'ไม่ผ่านเกณฑ์: ข้อมูลการแข่งขันไม่สมบูรณ์',
    FIXTURE_POSTPONED: 'ไม่ผ่านเกณฑ์: การแข่งขันถูกเลื่อน',
    FIXTURE_CANCELLED: 'ไม่ผ่านเกณฑ์: การแข่งขันถูกยกเลิก',
    KICKOFF_PASSED: 'ไม่ผ่านเกณฑ์: เวลาเริ่มแข่งขันผ่านไปแล้ว',
    RISK_CRITICAL: 'ไม่ผ่านเกณฑ์: ความเสี่ยงอยู่ในระดับวิกฤต',
    DATA_INCOMPLETE: 'รอข้อมูล: การวิเคราะห์ยังไม่ครบ',
    FINAL_PICK_MISSING: 'รอข้อมูล: ยังไม่มี Final Pick ที่พร้อมใช้',
    MARKET_MISSING: 'รอข้อมูลตลาด: ยังไม่พบตลาดที่รองรับ',
    MARKET_STALE: 'รอข้อมูลตลาด: ราคาล่าสุดเก่าเกินเกณฑ์',
    MARKET_INVALID: 'รอข้อมูลตลาด: line, selection หรือราคาไม่ถูกต้อง',
    MARKET_PARTIAL: 'รอข้อมูลตลาด: ข้อมูลตลาดมาไม่ครบ',
    MARKET_PROVIDER_ERROR: 'รอข้อมูลตลาด: ผู้ให้บริการตอบกลับผิดพลาด',
    MARKET_REFRESH_PENDING: 'รอข้อมูลตลาด: การรีเฟรชยังไม่เสร็จ',
    RISK_HIGH: 'เฝ้าดู: คุณภาพผ่านบางส่วนแต่ความเสี่ยงยังสูง',
    SCORE_BELOW_READY: 'เฝ้าดู: คะแนนความพร้อมยังไม่ถึง READY',
    QUALITY_GATE_FAILED: 'ไม่ผ่านเกณฑ์: คะแนนคุณภาพต่ำกว่าเกณฑ์เฝ้าดู',
    READY_SCORE_PASSED: 'พร้อมตัดสิน: การวิเคราะห์ ตลาด และความเสี่ยงผ่านเกณฑ์',
  }
  return reasons[primaryReasonCode] ?? (status === 'READY' ? reasons.READY_SCORE_PASSED : reasons.DATA_INCOMPLETE)
}

function decision(status, reasonCodes = [], fallback = null) {
  const codes = [...new Set([...(Array.isArray(reasonCodes) ? reasonCodes : []), fallback].filter(Boolean))]
  const primaryReasonCode = codes[0] ?? (status === 'READY' ? 'READY_SCORE_PASSED' : 'DATA_INCOMPLETE')
  return { status, primaryReasonCode, reasonCodes: codes, reasonThai: getDecisionReasonThai(primaryReasonCode, status) }
}
