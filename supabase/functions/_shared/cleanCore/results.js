import { MARKET_TYPE } from './contracts.js'
import { getMatchStatusKind, normalizeMatchStatus } from './matchStatus.js'
import { isSettlementSupported, normalizeMarketType } from './markets.js'

export function canSettleMarket(value) {
  return isSettlementSupported(value)
}

export function validateSettlementInput(input = {}) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const errors = []
  const warnings = []
  const marketType = normalizeMarketType(source.marketType ?? source.market_type ?? source.marketFocus ?? source.market_focus)
  const status = normalizeMatchStatus(source.statusShort ?? source.status_short ?? source.matchStatus ?? source.match_status ?? source.status)
  const statusKind = getMatchStatusKind(status)
  const homeScore = score(source.homeScore ?? source.home_score ?? source.homeGoals ?? source.home_goals)
  const awayScore = score(source.awayScore ?? source.away_score ?? source.awayGoals ?? source.away_goals)
  const selection = normalizeSelection(source.selection ?? source.direction ?? source.side)
  const line = parseLine(source.line ?? source.marketLine ?? source.market_line)

  if (!canSettleMarket(marketType)) errors.push('SETTLEMENT_MARKET_UNSUPPORTED')
  if (!['FINISHED', 'VOID'].includes(statusKind)) errors.push('SETTLEMENT_STATUS_NOT_TERMINAL')
  if (statusKind !== 'VOID') {
    if (homeScore === null || awayScore === null) errors.push('SETTLEMENT_SCORE_INVALID')
    if (!selection) errors.push('SETTLEMENT_SELECTION_MISSING')
    if ([MARKET_TYPE.ASIAN_HANDICAP, MARKET_TYPE.OVER_UNDER].includes(marketType) && line === null) {
      errors.push('SETTLEMENT_LINE_INVALID')
    }
    if (marketType === MARKET_TYPE.MATCH_WINNER && !['HOME', 'DRAW', 'AWAY', '1', 'X', '2'].includes(selection)) {
      errors.push('SETTLEMENT_SELECTION_INVALID')
    }
  }

  const reasonCodes = [...new Set(errors)]
  return { valid: reasonCodes.length === 0, errors: reasonCodes, warnings, reasonCodes }
}

function score(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parseLine(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSelection(value) {
  if (!['string', 'number'].includes(typeof value)) return null
  return String(value).trim().toUpperCase() || null
}
