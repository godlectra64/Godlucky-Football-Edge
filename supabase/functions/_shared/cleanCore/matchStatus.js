import { deepFreeze } from './immutable.js'
import { MATCH_STATUS_CATEGORY } from './contracts.js'

const STATUS_GROUPS = deepFreeze({
  prematchDecisionEligible: ['NS', 'TBD', 'SCHEDULED'],
  startedOrLive: ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE', 'IN_PLAY'],
  finished: ['FT', 'AET', 'PEN'],
  void: ['CANC', 'ABD', 'AWD', 'WO'],
  retryableNotReady: ['PST'],
})

const STATUS_ALIASES = deepFreeze({
  NOT_STARTED: 'NS',
  TIME_TO_BE_DEFINED: 'TBD',
  TIMED: 'SCHEDULED',
  FIRST_HALF: '1H',
  HALFTIME: 'HT',
  SECOND_HALF: '2H',
  EXTRA_TIME: 'ET',
  BREAK_TIME: 'BT',
  PENALTY_IN_PROGRESS: 'P',
  MATCH_SUSPENDED: 'SUSP',
  MATCH_INTERRUPTED: 'INT',
  MATCH_FINISHED: 'FT',
  FINISHED: 'FT',
  AFTER_EXTRA_TIME: 'AET',
  PENALTY_SHOOTOUT: 'PEN',
  POSTPONED: 'PST',
  CANCELLED: 'CANC',
  ABANDONED: 'ABD',
  MATCH_ABANDONED: 'ABD',
  TECHNICAL_LOSS: 'AWD',
  WALKOVER: 'WO',
})

export function normalizeMatchStatus(value) {
  if (typeof value !== 'string') return 'UNKNOWN'
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return STATUS_ALIASES[normalized] ?? (normalized || 'UNKNOWN')
}

export function getMatchStatusKind(value) {
  const status = normalizeMatchStatus(value)
  if (STATUS_GROUPS.prematchDecisionEligible.includes(status)) return 'SCHEDULED'
  if (STATUS_GROUPS.startedOrLive.includes(status)) return 'LIVE'
  if (STATUS_GROUPS.finished.includes(status)) return 'FINISHED'
  if (STATUS_GROUPS.void.includes(status)) return 'VOID'
  if (STATUS_GROUPS.retryableNotReady.includes(status)) return 'RETRYABLE'
  return 'UNKNOWN'
}

export function getMatchStatusCategory(value) {
  const status = normalizeMatchStatus(value)
  if (STATUS_GROUPS.prematchDecisionEligible.includes(status)) {
    return MATCH_STATUS_CATEGORY.PREMATCH_DECISION_ELIGIBLE
  }
  if (STATUS_GROUPS.startedOrLive.includes(status)) return MATCH_STATUS_CATEGORY.STARTED_OR_LIVE
  if ([...STATUS_GROUPS.finished, ...STATUS_GROUPS.void].includes(status)) {
    return MATCH_STATUS_CATEGORY.TERMINAL_OR_VOID
  }
  if (STATUS_GROUPS.retryableNotReady.includes(status)) return MATCH_STATUS_CATEGORY.RETRYABLE_NOT_READY
  return MATCH_STATUS_CATEGORY.UNKNOWN
}

export function isEligibleForNewDecision(value) {
  return getMatchStatusCategory(value) === MATCH_STATUS_CATEGORY.PREMATCH_DECISION_ELIGIBLE
}

export function isStartedMatchStatus(value) {
  return getMatchStatusCategory(value) === MATCH_STATUS_CATEGORY.STARTED_OR_LIVE
}

export function isTerminalMatchStatus(value) {
  return getMatchStatusCategory(value) === MATCH_STATUS_CATEGORY.TERMINAL_OR_VOID
}

export function isRetryableMatchStatus(value) {
  return getMatchStatusCategory(value) === MATCH_STATUS_CATEGORY.RETRYABLE_NOT_READY
}

export function isDisplayableMatchStatus(value) {
  return [
    MATCH_STATUS_CATEGORY.PREMATCH_DECISION_ELIGIBLE,
    MATCH_STATUS_CATEGORY.STARTED_OR_LIVE,
    MATCH_STATUS_CATEGORY.RETRYABLE_NOT_READY,
  ].includes(getMatchStatusCategory(value))
}
