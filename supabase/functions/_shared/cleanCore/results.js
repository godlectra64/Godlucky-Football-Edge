import { MARKET_TYPE } from './contracts.js'
import { isSettlementSupported, normalizeMarketType } from './markets.js'

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'FINISHED'])
const VOID_STATUSES = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO', 'POSTPONED', 'CANCELLED', 'ABANDONED'])

export function canSettleMarket(value) {
  return isSettlementSupported(value)
}

export function validateSettlementInput(input = {}) {
  const errors = []
  const warnings = []
  const marketType = normalizeMarketType(input.marketType ?? input.market_type ?? input.marketFocus ?? input.market_focus)
  const status = String(input.statusShort ?? input.status_short ?? input.matchStatus ?? input.match_status ?? input.status ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
  const homeScore = score(input.homeScore ?? input.home_score ?? input.homeGoals ?? input.home_goals)
  const awayScore = score(input.awayScore ?? input.away_score ?? input.awayGoals ?? input.away_goals)
  const selection = String(input.selection ?? input.direction ?? input.side ?? '').trim().toUpperCase()
  const line = finiteNumber(input.line ?? input.marketLine ?? input.market_line)

  if (!canSettleMarket(marketType)) errors.push('SETTLEMENT_MARKET_UNSUPPORTED')
  if (!FINISHED_STATUSES.has(status) && !VOID_STATUSES.has(status)) errors.push('SETTLEMENT_STATUS_NOT_TERMINAL')
  if (!VOID_STATUSES.has(status)) {
    if (homeScore === null || awayScore === null) errors.push('SETTLEMENT_SCORE_INVALID')
    if (!selection) errors.push('SETTLEMENT_SELECTION_MISSING')
    if ([MARKET_TYPE.ASIAN_HANDICAP, MARKET_TYPE.OVER_UNDER].includes(marketType) && line === null) errors.push('SETTLEMENT_LINE_INVALID')
    if (marketType === MARKET_TYPE.MATCH_WINNER && !['HOME', 'DRAW', 'AWAY', '1', 'X', '2'].includes(selection)) {
      errors.push('SETTLEMENT_SELECTION_INVALID')
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings }
}

function score(value) {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
