import {
  MARKET_TIERS,
  MARKET_TYPES,
  getMarketTier,
  normalizeMarketRecord,
  normalizeMarketType,
  validateMarketRecord,
} from './marketRegistry.js'

export const MARKET_QUALITY_VERSION = 'market-quality-v2'
export const DECISION_MODEL_VERSION = 'multi-market-decision-v1'
export const PIPELINE_VERSION = 'market-ready-dynamic-pipeline-v2'

export const marketQualityConfig = Object.freeze({
  maxSnapshotAgeMinutes: Number(import.meta?.env?.VITE_MARKET_MAX_SNAPSHOT_AGE_MINUTES ?? 240),
  maxOverround: Number(import.meta?.env?.VITE_MARKET_MAX_OVERROUND ?? 1.28),
  minBookmakers: Number(import.meta?.env?.VITE_MARKET_MIN_BOOKMAKERS ?? 1),
})

export function evaluateMarketQuality(rows = [], options = {}) {
  const records = rows.map((row) => normalizeMarketRecord(row, options)).filter(Boolean)
  const byType = new Map()
  for (const record of records) {
    const items = byType.get(record.marketType) ?? []
    items.push(record)
    byType.set(record.marketType, items)
  }
  const markets = Object.values(MARKET_TYPES).map((marketType) => evaluateMarketType(byType.get(marketType) ?? [], marketType, options))
  const primary = markets.filter((item) => item.valid && item.tier === MARKET_TIERS.PRIMARY)
  const alternative = markets.filter((item) => item.valid && item.tier === MARKET_TIERS.ALTERNATIVE)
  const supporting = markets.filter((item) => item.valid && item.tier === MARKET_TIERS.SUPPORTING)
  const bestDecisionMarket = [...primary, ...alternative].sort(compareMarketQuality)[0] ?? null

  return {
    valid: Boolean(bestDecisionMarket),
    status: primary.length ? 'READY_PRIMARY' : alternative.length ? 'READY_ALTERNATIVE' : 'WAITING_MARKET',
    decisionMarket: bestDecisionMarket?.marketType ?? null,
    decisionTier: bestDecisionMarket?.tier ?? null,
    primaryMarketReady: primary.length > 0,
    alternativeMarketReady: alternative.length > 0,
    supportingMarkets: supporting.map((item) => item.marketType),
    availableMarkets: markets.filter((item) => item.present).map((item) => item.marketType),
    marketQualityVersion: MARKET_QUALITY_VERSION,
    decisionModelVersion: DECISION_MODEL_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    markets,
  }
}

export function evaluateMarketType(rows = [], marketTypeInput, options = {}) {
  const marketType = normalizeMarketType(marketTypeInput)
  const tier = getMarketTier(marketType)
  const now = new Date(options.now ?? Date.now())
  const reasons = []
  const validRows = []

  for (const row of rows) {
    const validation = validateMarketRecord(row)
    if (validation.valid) validRows.push(row)
    else reasons.push(...validation.reasonCodes)
    if (row.isLive && options.allowLive !== true) reasons.push('LIVE_MARKET_NOT_ALLOWED')
    if (isStale(row.capturedAt, now, options.maxSnapshotAgeMinutes)) reasons.push('STALE_SNAPSHOT')
  }

  const selectedBookmaker = chooseBookmaker(validRows)
  const selectedRows = selectedBookmaker ? validRows.filter((row) => effectiveBookmakerKey(row) === selectedBookmaker.key) : []
  const selectionKeys = new Set(selectedRows.map((row) => row.selectionKey))
  const lineValues = new Set(selectedRows.map((row) => row.line).filter((value) => value !== null && value !== undefined).map(String))

  if (!validRows.length) reasons.push(rows.length ? 'NO_VALID_PRICE_ROWS' : 'MARKET_NOT_AVAILABLE')
  if ([MARKET_TYPES.ASIAN_HANDICAP, MARKET_TYPES.OVER_UNDER].includes(marketType) && lineValues.size !== 1) reasons.push('LINE_MISMATCH')
  if (marketType === MARKET_TYPES.ASIAN_HANDICAP && !hasSelections(selectionKeys, ['HOME', 'AWAY'])) reasons.push('INCOMPLETE_SELECTIONS')
  if (marketType === MARKET_TYPES.OVER_UNDER && !hasSelections(selectionKeys, ['OVER', 'UNDER'])) reasons.push('INCOMPLETE_SELECTIONS')
  if (marketType === MARKET_TYPES.MATCH_WINNER_1X2 && !hasSelections(selectionKeys, ['HOME', 'DRAW', 'AWAY'])) reasons.push('INCOMPLETE_SELECTIONS')
  if (marketType === MARKET_TYPES.DOUBLE_CHANCE && !hasSelections(selectionKeys, ['1X', '12', 'X2'])) reasons.push('INCOMPLETE_SELECTIONS')
  if (marketType === MARKET_TYPES.CORRECT_SCORE && selectedRows.length < 3) reasons.push('SUPPORTING_ONLY')

  const overround = marketType === MARKET_TYPES.MATCH_WINNER_1X2 ? calculateOverround(selectedRows) : null
  if (overround !== null && overround > (options.maxOverround ?? marketQualityConfig.maxOverround)) reasons.push('ABNORMAL_OVERROUND')
  if (tier === MARKET_TIERS.SUPPORTING) reasons.push('SUPPORTING_ONLY')

  const uniqueReasons = [...new Set(reasons)]
  const valid = selectedRows.length > 0 && tier !== MARKET_TIERS.SUPPORTING && !uniqueReasons.some(isBlockingReason)
  const freshnessScore = freshnessFromRows(selectedRows, now, options.maxSnapshotAgeMinutes)
  const consensusScore = Math.min(100, 45 + selectedBookmaker?.rowCount * 15 || 0)
  const qualityScore = clamp(Math.round((freshnessScore * 0.45) + (consensusScore * 0.35) + (selectedRows.length ? 20 : 0)))

  return {
    valid,
    present: rows.length > 0,
    marketType,
    tier,
    qualityScore,
    freshnessScore,
    consensusScore,
    reasonCodes: uniqueReasons,
    snapshotAt: latestDate(selectedRows.map((row) => row.capturedAt)),
    bookmakerCount: new Set(validRows.map(bookmakerKey).filter(Boolean)).size,
    selectedBookmaker: selectedBookmaker?.name ?? null,
    selections: selectedRows,
    overround,
    impliedProbabilities: overround ? buildImpliedProbabilities(selectedRows, overround) : null,
  }
}

export function classifyDecisionFromMarkets(rows = [], options = {}) {
  const quality = evaluateMarketQuality(rows, options)
  if (quality.status === 'READY_PRIMARY' || quality.status === 'READY_ALTERNATIVE') return quality
  if (rows.length > 0) return { ...quality, status: 'WAITING_MARKET' }
  return { ...quality, status: 'WAITING_MARKET' }
}

function isBlockingReason(code) {
  return !['SUPPORTING_ONLY'].includes(code)
}

function isStale(value, now, maxAge = marketQualityConfig.maxSnapshotAgeMinutes) {
  const time = new Date(value ?? '').getTime()
  if (!Number.isFinite(time)) return true
  return now.getTime() - time > maxAge * 60000
}

function chooseBookmaker(rows) {
  const grouped = new Map()
  for (const row of rows) {
    const key = effectiveBookmakerKey(row)
    const item = grouped.get(key) ?? { key, name: row.bookmakerName ?? row.bookmakerId ?? key, rowCount: 0, latest: 0 }
    item.rowCount += 1
    item.latest = Math.max(item.latest, new Date(row.capturedAt ?? 0).getTime())
    grouped.set(key, item)
  }
  return [...grouped.values()].sort((a, b) => b.rowCount - a.rowCount || b.latest - a.latest || String(a.name).localeCompare(String(b.name)))[0] ?? null
}

function bookmakerKey(row) {
  return String(row.bookmakerId ?? row.bookmakerName ?? '').trim()
}

function effectiveBookmakerKey(row) {
  return bookmakerKey(row) || 'unknown'
}

function hasSelections(selectionKeys, required) {
  return required.every((key) => selectionKeys.has(key))
}

function calculateOverround(rows) {
  const prices = rows.map((row) => Number(row.price)).filter((value) => Number.isFinite(value) && value > 1)
  if (prices.length < 3) return null
  return prices.reduce((total, price) => total + 1 / price, 0)
}

function buildImpliedProbabilities(rows, overround) {
  return Object.fromEntries(rows.map((row) => [row.selectionKey, {
    raw: 1 / Number(row.price),
    normalized: (1 / Number(row.price)) / overround,
  }]))
}

function freshnessFromRows(rows, now, maxAge = marketQualityConfig.maxSnapshotAgeMinutes) {
  if (!rows.length) return 0
  const latest = latestDate(rows.map((row) => row.capturedAt))
  const age = now.getTime() - new Date(latest).getTime()
  if (!Number.isFinite(age) || age < 0) return 0
  return clamp(Math.round(100 - (age / (maxAge * 60000)) * 100))
}

function latestDate(values) {
  return values.filter(Boolean).sort((a, b) => new Date(a).getTime() - new Date(b).getTime()).at(-1) ?? null
}

function compareMarketQuality(a, b) {
  const tierDiff = tierPriority(a.tier) - tierPriority(b.tier)
  return tierDiff || b.qualityScore - a.qualityScore || String(a.marketType).localeCompare(String(b.marketType))
}

function tierPriority(tier) {
  if (tier === MARKET_TIERS.PRIMARY) return 1
  if (tier === MARKET_TIERS.ALTERNATIVE) return 2
  return 3
}

function clamp(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}
