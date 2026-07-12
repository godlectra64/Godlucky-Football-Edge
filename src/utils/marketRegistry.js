export const MARKET_TYPES = Object.freeze({
  ASIAN_HANDICAP: 'ASIAN_HANDICAP',
  OVER_UNDER: 'OVER_UNDER',
  MATCH_WINNER_1X2: 'MATCH_WINNER_1X2',
  DOUBLE_CHANCE: 'DOUBLE_CHANCE',
  CORRECT_SCORE: 'CORRECT_SCORE',
})

export const LEGACY_MARKET_FOCUS = Object.freeze({
  [MARKET_TYPES.ASIAN_HANDICAP]: 'AH',
  [MARKET_TYPES.OVER_UNDER]: 'OU',
  [MARKET_TYPES.MATCH_WINNER_1X2]: 'MATCH_WINNER',
  [MARKET_TYPES.DOUBLE_CHANCE]: 'DOUBLE_CHANCE',
  [MARKET_TYPES.CORRECT_SCORE]: 'CORRECT_SCORE',
})

export const MARKET_TIERS = Object.freeze({
  PRIMARY: 'PRIMARY',
  ALTERNATIVE: 'ALTERNATIVE',
  SUPPORTING: 'SUPPORTING',
})

const aliasEntries = [
  [MARKET_TYPES.ASIAN_HANDICAP, ['AH', 'ASIAN HANDICAP', 'HANDICAP RESULT', 'FULL TIME ASIAN HANDICAP']],
  [MARKET_TYPES.OVER_UNDER, ['OU', 'OVER UNDER', 'OVER/UNDER', 'GOAL LINE', 'GOALS OVER UNDER', 'GOALS OVER/UNDER', 'TOTAL GOALS']],
  [MARKET_TYPES.MATCH_WINNER_1X2, ['MATCH WINNER', 'HOME/DRAW/AWAY', 'HOME DRAW AWAY', '1X2', '3 WAY RESULT']],
  [MARKET_TYPES.DOUBLE_CHANCE, ['DOUBLE CHANCE', '1X', '12', 'X2']],
  [MARKET_TYPES.CORRECT_SCORE, ['CORRECT SCORE', 'EXACT SCORE']],
]

const aliasMap = new Map(aliasEntries.flatMap(([type, aliases]) => aliases.map((alias) => [normalizeAlias(alias), type])))

export function normalizeMarketType(value) {
  const text = normalizeAlias(value)
  if (!text) return null
  if (MARKET_TYPES[text]) return MARKET_TYPES[text]
  if (Object.values(LEGACY_MARKET_FOCUS).includes(text)) {
    return Object.entries(LEGACY_MARKET_FOCUS).find(([, focus]) => focus === text)?.[0] ?? null
  }
  if (aliasMap.has(text)) return aliasMap.get(text)
  if (text.includes('DOUBLE CHANCE')) return MARKET_TYPES.DOUBLE_CHANCE
  if (text.includes('CORRECT SCORE') || text.includes('EXACT SCORE')) return MARKET_TYPES.CORRECT_SCORE
  if (text.includes('ASIAN') || text.includes('HANDICAP')) return MARKET_TYPES.ASIAN_HANDICAP
  if ((text.includes('OVER') || text.includes('UNDER') || text.includes('TOTAL')) && !text.includes('TEAM')) return MARKET_TYPES.OVER_UNDER
  if (text.includes('MATCH WINNER') || text.includes('HOME DRAW AWAY') || text.includes('1X2')) return MARKET_TYPES.MATCH_WINNER_1X2
  return null
}

export function toLegacyMarketFocus(marketType) {
  return LEGACY_MARKET_FOCUS[normalizeMarketType(marketType)] ?? 'NONE'
}

export function getMarketTier(marketType) {
  const type = normalizeMarketType(marketType)
  if ([MARKET_TYPES.ASIAN_HANDICAP, MARKET_TYPES.OVER_UNDER].includes(type)) return MARKET_TIERS.PRIMARY
  if ([MARKET_TYPES.MATCH_WINNER_1X2, MARKET_TYPES.DOUBLE_CHANCE].includes(type)) return MARKET_TIERS.ALTERNATIVE
  if (type === MARKET_TYPES.CORRECT_SCORE) return MARKET_TIERS.SUPPORTING
  return null
}

export function isPrimaryMarket(marketType) {
  return getMarketTier(marketType) === MARKET_TIERS.PRIMARY
}

export function isAlternativeMarket(marketType) {
  return getMarketTier(marketType) === MARKET_TIERS.ALTERNATIVE
}

export function isSupportingMarket(marketType) {
  return getMarketTier(marketType) === MARKET_TIERS.SUPPORTING
}

export function normalizeSelectionKey(value, marketType) {
  const text = normalizeAlias(value)
  const type = normalizeMarketType(marketType)
  if (!text) return null
  if (type === MARKET_TYPES.ASIAN_HANDICAP) {
    if (text.includes('HOME') || text === '1') return 'HOME'
    if (text.includes('AWAY') || text === '2') return 'AWAY'
  }
  if (type === MARKET_TYPES.OVER_UNDER) {
    if (text.includes('OVER')) return 'OVER'
    if (text.includes('UNDER')) return 'UNDER'
  }
  if (type === MARKET_TYPES.MATCH_WINNER_1X2) {
    if (text === '1' || text.includes('HOME')) return 'HOME'
    if (text === '2' || text.includes('AWAY')) return 'AWAY'
    if (text === 'X' || text.includes('DRAW')) return 'DRAW'
  }
  if (type === MARKET_TYPES.DOUBLE_CHANCE) {
    if (['1X', 'HOME DRAW'].includes(text) || (text.includes('HOME') && text.includes('DRAW'))) return '1X'
    if (['12', 'HOME AWAY'].includes(text) || (text.includes('HOME') && text.includes('AWAY'))) return '12'
    if (['X2', 'DRAW AWAY'].includes(text) || (text.includes('DRAW') && text.includes('AWAY'))) return 'X2'
  }
  if (type === MARKET_TYPES.CORRECT_SCORE && /^\d+\s*[-:]\s*\d+$/.test(String(value ?? '').trim())) {
    return String(value).trim().replace(/\s+/g, '')
  }
  return text
}

export function normalizeMarketRecord(row = {}, context = {}) {
  const marketType = normalizeMarketType(row.marketType ?? row.market_type ?? row.market_focus ?? row.marketFocus ?? row.market_name ?? row.marketName ?? row.market ?? row.name)
  if (!marketType) return null
  const price = numberOrNull(row.price ?? row.odd ?? row.odds)
  const capturedAt = row.capturedAt ?? row.captured_at ?? row.snapshotAt ?? row.snapshot_at ?? row.created_at ?? context.capturedAt ?? null
  const selectionName = firstText(row.selectionName, row.selection_name, row.selection, row.value, row.raw?.value)
  return {
    fixtureId: firstText(row.fixtureId, row.fixture_id, row.api_fixture_id, context.fixtureId),
    provider: firstText(row.provider, context.provider),
    bookmakerId: firstText(row.bookmakerId, row.bookmaker_id, row.api_bookmaker_id),
    bookmakerName: firstText(row.bookmakerName, row.bookmaker_name, row.bookmaker),
    marketType,
    marketName: firstText(row.marketName, row.market_name, row.market, row.name, marketType),
    selectionKey: normalizeSelectionKey(row.selectionKey ?? row.selection_key ?? selectionName, marketType),
    selectionName,
    line: numberOrNull(row.line ?? parseLine(selectionName)),
    price,
    capturedAt,
    sourceUpdatedAt: row.sourceUpdatedAt ?? row.source_updated_at ?? row.updated_at ?? null,
    rawMarketId: row.rawMarketId ?? row.raw_market_id ?? row.market_id ?? null,
    rawSelectionId: row.rawSelectionId ?? row.raw_selection_id ?? row.selection_id ?? null,
    isSuspended: Boolean(row.isSuspended ?? row.is_suspended ?? row.suspended),
    isLive: Boolean(row.isLive ?? row.is_live ?? row.live),
    metadata: row.metadata ?? row.raw ?? {},
  }
}

export function validateMarketRecord(record) {
  const reasonCodes = []
  if (!record?.fixtureId) reasonCodes.push('INVALID_FIXTURE_ID')
  if (!record?.marketType) reasonCodes.push('UNKNOWN_MARKET')
  if (!Number.isFinite(Number(record?.price)) || Number(record.price) <= 1) reasonCodes.push('INVALID_PRICE')
  if (!Number.isFinite(new Date(record?.capturedAt ?? '').getTime())) reasonCodes.push('INVALID_CAPTURED_AT')
  if ([MARKET_TYPES.ASIAN_HANDICAP, MARKET_TYPES.OVER_UNDER].includes(record?.marketType) && !Number.isFinite(Number(record.line))) reasonCodes.push('INVALID_LINE')
  if (!record?.selectionKey) reasonCodes.push('INVALID_SELECTION')
  if (record?.isSuspended) reasonCodes.push('SUSPENDED_MARKET')
  if (Object.values(record ?? {}).some((value) => value === '' || Number.isNaN(value) || value === Infinity || value === -Infinity)) reasonCodes.push('INVALID_VALUE')
  return { valid: reasonCodes.length === 0, reasonCodes }
}

function normalizeAlias(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[_()/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseLine(value) {
  const match = String(value ?? '').match(/[+-]?\d+(?:\.\d+)?/)
  return match?.[0] ?? null
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}
