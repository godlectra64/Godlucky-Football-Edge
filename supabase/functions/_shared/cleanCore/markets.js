import { MARKET_TYPE } from './contracts.js'

const capability = (value) => Object.freeze({ ...value })

export const MARKET_CAPABILITIES = Object.freeze({
  [MARKET_TYPE.ASIAN_HANDICAP]: capability({
    parsable: true,
    analyzable: true,
    actionable: true,
    canProduceReady: true,
    settlementSupported: true,
    insightOnly: false,
  }),
  [MARKET_TYPE.OVER_UNDER]: capability({
    parsable: true,
    analyzable: true,
    actionable: true,
    canProduceReady: true,
    settlementSupported: true,
    insightOnly: false,
  }),
  [MARKET_TYPE.MATCH_WINNER]: capability({
    parsable: true,
    analyzable: false,
    actionable: false,
    canProduceReady: false,
    settlementSupported: true,
    insightOnly: true,
  }),
  [MARKET_TYPE.DOUBLE_CHANCE]: capability({
    parsable: true,
    analyzable: false,
    actionable: false,
    canProduceReady: false,
    settlementSupported: false,
    insightOnly: true,
  }),
  [MARKET_TYPE.CORRECT_SCORE]: capability({
    parsable: true,
    analyzable: false,
    actionable: false,
    canProduceReady: false,
    settlementSupported: false,
    insightOnly: true,
  }),
  [MARKET_TYPE.BTTS]: capability({
    parsable: true,
    analyzable: false,
    actionable: false,
    canProduceReady: false,
    settlementSupported: false,
    insightOnly: true,
  }),
  [MARKET_TYPE.UNKNOWN]: capability({
    parsable: false,
    analyzable: false,
    actionable: false,
    canProduceReady: false,
    settlementSupported: false,
    insightOnly: false,
  }),
})

export function normalizeMarketType(value) {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replaceAll('&', ' AND ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (['AH', 'ASIAN_HANDICAP', 'ASIAN_HANDICAPS', 'HANDICAP'].includes(normalized)) return MARKET_TYPE.ASIAN_HANDICAP
  if (['OU', 'O_U', 'OVER_UNDER', 'OVERUNDER', 'TOTAL', 'TOTALS', 'GOALS_OVER_UNDER'].includes(normalized)) return MARKET_TYPE.OVER_UNDER
  if (['1X2', 'MATCH_WINNER', 'MATCH_RESULT', 'HOME_DRAW_AWAY'].includes(normalized)) return MARKET_TYPE.MATCH_WINNER
  if (['DC', 'DOUBLE_CHANCE'].includes(normalized)) return MARKET_TYPE.DOUBLE_CHANCE
  if (['CS', 'CORRECT_SCORE'].includes(normalized)) return MARKET_TYPE.CORRECT_SCORE
  if (['BTTS', 'BOTH_TEAMS_TO_SCORE', 'BOTH_TEAMS_SCORE', 'BOTH_TEAMS_TO_SCORE_YES_NO'].includes(normalized)) return MARKET_TYPE.BTTS
  return MARKET_TYPE.UNKNOWN
}

export function getMarketCapability(value) {
  return MARKET_CAPABILITIES[normalizeMarketType(value)]
}

export function isActionableMarket(value) {
  return getMarketCapability(value).actionable
}

export function canMarketProduceReady(value) {
  return getMarketCapability(value).canProduceReady
}

export function isSettlementSupported(value) {
  return getMarketCapability(value).settlementSupported
}
