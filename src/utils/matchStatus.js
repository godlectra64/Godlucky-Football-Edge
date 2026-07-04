const FINISHED = new Set(['FT', 'AET', 'PEN', 'FINISHED'])
const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'])
const SCHEDULED = new Set(['TBD', 'NS', 'SCHEDULED'])
const VOID = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO', 'POSTPONED', 'CANCELLED', 'ABANDONED'])

export const matchStatusGroups = {
  upcoming: 'UPCOMING',
  live: 'LIVE',
  finished: 'FINISHED',
  notPlayable: 'NOT_PLAYABLE',
  unknown: 'UNKNOWN',
}

const STATUS_LONG_ALIASES = new Map([
  ['NOT STARTED', 'NS'],
  ['TIME TO BE DEFINED', 'TBD'],
  ['FIRST HALF', '1H'],
  ['HALFTIME', 'HT'],
  ['SECOND HALF', '2H'],
  ['EXTRA TIME', 'ET'],
  ['BREAK TIME', 'BT'],
  ['PENALTY IN PROGRESS', 'P'],
  ['MATCH SUSPENDED', 'SUSP'],
  ['MATCH INTERRUPTED', 'INT'],
  ['MATCH FINISHED', 'FT'],
  ['AFTER EXTRA TIME', 'AET'],
  ['PENALTY SHOOTOUT', 'PEN'],
  ['POSTPONED', 'PST'],
  ['CANCELLED', 'CANC'],
  ['MATCH ABANDONED', 'ABD'],
  ['TECHNICAL LOSS', 'AWD'],
  ['WALKOVER', 'WO'],
])

const THAI_LABELS = {
  FT: 'จบแล้ว',
  FINISHED: 'จบแล้ว',
  AET: 'จบต่อเวลา',
  PEN: 'จบด้วยจุดโทษ',
  NS: 'ยังไม่เริ่ม',
  SCHEDULED: 'ยังไม่เริ่ม',
  TBD: 'รอกำหนดเวลา',
  '1H': 'กำลังแข่ง',
  '2H': 'กำลังแข่ง',
  HT: 'กำลังแข่ง',
  ET: 'กำลังแข่ง',
  BT: 'กำลังแข่ง',
  P: 'กำลังแข่ง',
  SUSP: 'กำลังแข่ง',
  INT: 'กำลังแข่ง',
  LIVE: 'กำลังแข่ง',
  PST: 'เลื่อนแข่ง',
  POSTPONED: 'เลื่อนแข่ง',
  CANC: 'ยกเลิก',
  CANCELLED: 'ยกเลิก',
  ABD: 'ยุติการแข่งขัน',
  ABANDONED: 'ยุติการแข่งขัน',
  AWD: 'ไม่นับผลจำลอง',
  WO: 'ไม่นับผลจำลอง',
  UNKNOWN: 'รออัปเดตสถานะ',
}

export function normalizeApiFootballStatus(statusShort, statusLong) {
  const short = normalizeStatusCode(statusShort || statusLong)
  const long = String(statusLong ?? '').trim()
  return {
    short,
    long,
    category: getMatchStatusCategory(short),
    group: getMatchStatusGroup(short),
    label: getMatchStatusLabel(short),
    finished: isFinishedStatus(short),
    live: isLiveStatus(short),
    scheduled: isScheduledStatus(short),
    void: isVoidStatus(short),
    playable: isPlayableStatus(short),
  }
}

export function normalizeStatusCode(value) {
  const status = String(value ?? '').trim().toUpperCase()
  if (!status) return 'UNKNOWN'
  if (STATUS_LONG_ALIASES.has(status)) return STATUS_LONG_ALIASES.get(status)
  if (status === 'FINISHED') return 'FT'
  if (status === 'POSTPONED') return 'PST'
  if (status === 'CANCELLED') return 'CANC'
  if (status === 'ABANDONED') return 'ABD'
  return status
}

export function getStatusCodeFromMatch(row = {}) {
  return normalizeStatusCode(
    row.statusShort ??
      row.status_short ??
      row.fixture_status_short ??
      row.match_status ??
      row.status ??
      row.statusLong ??
      row.status_long,
  )
}

export function isFinishedStatus(statusShort) {
  return FINISHED.has(normalizeStatusCode(statusShort))
}

export function isLiveStatus(statusShort) {
  return LIVE.has(normalizeStatusCode(statusShort))
}

export function isScheduledStatus(statusShort) {
  return SCHEDULED.has(normalizeStatusCode(statusShort))
}

export function isVoidStatus(statusShort) {
  return VOID.has(normalizeStatusCode(statusShort))
}

export function isPlayableStatus(statusShort) {
  const normalized = normalizeStatusCode(statusShort)
  return isScheduledStatus(normalized) || isLiveStatus(normalized)
}

export function getMatchStatusGroup(statusShort) {
  const normalized = normalizeStatusCode(statusShort)
  if (isScheduledStatus(normalized)) return matchStatusGroups.upcoming
  if (isLiveStatus(normalized)) return matchStatusGroups.live
  if (isFinishedStatus(normalized)) return matchStatusGroups.finished
  if (isVoidStatus(normalized)) return matchStatusGroups.notPlayable
  return matchStatusGroups.unknown
}

export function getMatchStatusInfo(row = {}) {
  const short = getStatusCodeFromMatch(row)
  const group = getMatchStatusGroup(short)
  return {
    short,
    group,
    label: getMatchStatusLabel(short),
    isUpcoming: group === matchStatusGroups.upcoming,
    isLive: group === matchStatusGroups.live,
    isFinished: group === matchStatusGroups.finished,
    isPlayable: group === matchStatusGroups.upcoming || group === matchStatusGroups.live,
    isNotPlayable: group === matchStatusGroups.notPlayable || group === matchStatusGroups.unknown,
  }
}

export function isFinishedMatch(row = {}) {
  return getMatchStatusInfo(row).isFinished
}

export function isPlayableMatch(row = {}) {
  return getMatchStatusInfo(row).isPlayable
}

export function isNotPlayableMatch(row = {}) {
  return getMatchStatusInfo(row).isNotPlayable
}

export function getMatchStatusCategory(statusShort) {
  if (isFinishedStatus(statusShort)) return 'finished'
  if (isLiveStatus(statusShort)) return 'live'
  if (isScheduledStatus(statusShort)) return 'scheduled'
  if (isVoidStatus(statusShort)) return 'void'
  return 'unknown'
}

export function getMatchStatusLabel(statusShort) {
  return THAI_LABELS[normalizeStatusCode(statusShort)] ?? THAI_LABELS.UNKNOWN
}

export function getResultTrackerStatusLabel(row = {}) {
  const status = normalizeStatusCode(row.statusShort ?? row.status_short ?? row.status)
  const settlementStatus = String(row.settlementStatus ?? row.settlement_status ?? '').toUpperCase()
  if (isVoidStatus(status) || settlementStatus === 'VOID') return 'ไม่ประเมิน'
  if (isFinishedStatus(status)) return 'จบแล้ว'
  return 'รอผล'
}

export function hasMatchScore(row = {}) {
  return row.homeScore !== null && row.homeScore !== undefined && row.awayScore !== null && row.awayScore !== undefined
}

export function getScoreDisplay(row = {}) {
  if (hasMatchScore(row)) return `${row.homeScore}-${row.awayScore}`
  const status = normalizeStatusCode(row.statusShort ?? row.status_short ?? row.status)
  if (isFinishedStatus(status) || isScheduledStatus(status)) return 'รอผล'
  return 'รอผล'
}
