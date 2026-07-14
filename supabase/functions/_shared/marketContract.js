export const marketTypes = Object.freeze({
  asianHandicap: 'AH',
  overUnder: 'OU',
  matchWinner: 'MATCH_WINNER',
  doubleChance: 'DOUBLE_CHANCE',
  correctScore: 'CORRECT_SCORE',
  bothTeamsToScore: 'BTTS',
  none: 'NONE',
})

export const actionableMarketTypes = Object.freeze([
  marketTypes.asianHandicap,
  marketTypes.overUnder,
  marketTypes.matchWinner,
  marketTypes.doubleChance,
])

export function normalizeMarketType(value) {
  const text = String(value ?? '').trim().toUpperCase().replaceAll('_', ' ')
  if (!text) return marketTypes.none
  if (text === 'AH' || text.includes('ASIAN') || text.includes('HANDICAP')) return marketTypes.asianHandicap
  if (text === 'OU' || text.includes('OVER') || text.includes('UNDER') || text.includes('GOALS') || text.includes('TOTAL')) return marketTypes.overUnder
  if (text === '1X2' || text.includes('MATCH WINNER') || text.includes('HOME/AWAY')) return marketTypes.matchWinner
  if (text === 'DC' || text.includes('DOUBLE CHANCE')) return marketTypes.doubleChance
  if (text.includes('CORRECT SCORE')) return marketTypes.correctScore
  if (text.includes('BOTH TEAMS') || text.includes('BTTS')) return marketTypes.bothTeamsToScore
  return Object.values(marketTypes).includes(text.replaceAll(' ', '_')) ? text.replaceAll(' ', '_') : marketTypes.none
}

export function normalizeMarketSelection(marketType, value) {
  const type = normalizeMarketType(marketType)
  const text = String(value ?? '').trim()
  const upper = text.toUpperCase().replaceAll(' ', '')
  if (type === marketTypes.doubleChance) {
    if (['1X', 'X1'].includes(upper)) return '1X'
    if (['X2', '2X'].includes(upper)) return 'X2'
    if (['12', '1/2', 'HOME/AWAY'].includes(upper)) return '12'
    return null
  }
  if (type === marketTypes.matchWinner) {
    if (['1', 'HOME'].includes(upper)) return 'HOME'
    if (['X', 'DRAW'].includes(upper)) return 'DRAW'
    if (['2', 'AWAY'].includes(upper)) return 'AWAY'
    return null
  }
  if (type === marketTypes.correctScore) {
    const score = upper.match(/^(\d{1,2})[:-](\d{1,2})$/)
    return score ? `${score[1]}-${score[2]}` : null
  }
  if (type === marketTypes.bothTeamsToScore) {
    if (['YES', 'Y'].includes(upper)) return 'YES'
    if (['NO', 'N'].includes(upper)) return 'NO'
    return null
  }
  return text || null
}

export function normalizeMarketRow(row = {}, options = {}) {
  const marketType = normalizeMarketType(row.normalized_market_type ?? row.normalizedMarketType ?? row.market_type ?? row.market_focus ?? row.marketFocus ?? row.market_name ?? row.marketName ?? row.market ?? row.name)
  const selection = normalizeMarketSelection(marketType, row.normalized_selection ?? row.normalizedSelection ?? row.selection ?? row.value)
  const price = numberOrNull(row.price ?? row.odd ?? row.odds)
  const line = parseLine(row.line ?? selection ?? row.selection ?? row.value)
  const bookmaker = firstText(row.bookmaker_name, row.bookmaker, row.bookmakerName)
  const provider = firstText(row.provider, row.api_provider, options.provider)
  const providerSourceAt = validTimestamp(row.provider_source_at ?? row.providerSourceAt ?? row.source_updated_at ?? row.sourceUpdatedAt)
  const fetchedAt = validTimestamp(row.fetched_at ?? row.fetchedAt ?? row.snapshot_at ?? row.snapshotAt ?? row.created_at)
  const normalizedAt = validTimestamp(row.normalized_at ?? row.normalizedAt) ?? new Date(options.now ?? Date.now()).toISOString()
  const insightOnly = marketType === marketTypes.correctScore
  const actionable = actionableMarketTypes.includes(marketType) && !insightOnly
  const lineValid = ![marketTypes.asianHandicap, marketTypes.overUnder].includes(marketType) || line !== null
  const selectionValid = selection !== null
  const valid = marketType !== marketTypes.none && selectionValid && lineValid && price !== null && price > 1
  return {
    marketType,
    selection,
    line,
    price,
    bookmaker,
    provider,
    providerSourceAt,
    fetchedAt,
    normalizedAt,
    insightOnly,
    actionable,
    valid,
    reasonCodes: valid ? [] : validationReasonCodes({ marketType, selectionValid, lineValid, price }),
  }
}

export function evaluateMarketFreshness(row = {}, options = {}) {
  const normalized = normalizeMarketRow(row, options)
  const timestamp = normalized.providerSourceAt ?? normalized.fetchedAt
  if (!timestamp) return { status: 'UNKNOWN', fresh: false, stale: false, ageMs: null, timestamp: null }
  const now = new Date(options.now ?? Date.now()).getTime()
  const time = new Date(timestamp).getTime()
  if (!Number.isFinite(now) || !Number.isFinite(time)) return { status: 'INVALID', fresh: false, stale: false, ageMs: null, timestamp }
  const ageMs = Math.max(0, now - time)
  const staleAfterMs = Number(options.staleAfterMs ?? 12 * 60 * 60 * 1000)
  return { status: ageMs > staleAfterMs ? 'STALE' : 'FRESH', fresh: ageMs <= staleAfterMs, stale: ageMs > staleAfterMs, ageMs, timestamp }
}

export function isActionableMarketType(value) {
  return actionableMarketTypes.includes(normalizeMarketType(value))
}

export function buildOddsNaturalKey(row = {}) {
  const normalized = normalizeMarketRow(row, { now: row.normalized_at ?? row.normalizedAt ?? row.snapshot_at ?? row.snapshotAt ?? 0 })
  return [
    row.match_id ?? row.matchId ?? '',
    row.api_fixture_id ?? row.apiFixtureId ?? '',
    row.api_bookmaker_id ?? row.bookmaker_name ?? row.bookmaker ?? '',
    normalized.marketType,
    normalized.selection ?? '',
    normalized.line ?? '',
    normalized.price ?? '',
  ].join('|')
}

function validationReasonCodes({ marketType, selectionValid, lineValid, price }) {
  const codes = []
  if (marketType === marketTypes.none) codes.push('MARKET_UNSUPPORTED')
  if (!selectionValid) codes.push('MARKET_SELECTION_INVALID')
  if (!lineValid) codes.push('MARKET_LINE_INVALID')
  if (price === null || price <= 1) codes.push('MARKET_PRICE_INVALID')
  return codes
}

function parseLine(value) {
  if (value === null || value === undefined) return null
  const match = String(value).match(/-?\d+(?:\.\d+)?/)
  const number = match ? Number(match[0]) : NaN
  return Number.isFinite(number) ? number : null
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function validTimestamp(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return null
}
