export const marketFocusValues = ['AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE']

export function normalizeMarketFocus(value) {
  const text = String(value ?? '').toUpperCase()
  if (text.includes('ASIAN') || text === 'AH' || text.includes('HANDICAP')) return 'AH'
  if (text.includes('OVER') || text.includes('UNDER') || text === 'OU' || text.includes('TOTAL')) return 'OU'
  if (text.includes('MATCH WINNER') || text === '1X2' || text.includes('HOME/AWAY')) return 'MATCH_WINNER'
  if (text.includes('BOTH TEAMS') || text.includes('BTTS')) return 'BTTS'
  return marketFocusValues.includes(text) ? text : 'NONE'
}

export function normalizeOddsRows(match = {}) {
  const direct = match.odds ?? match.matchOdds ?? match.match_odds ?? match.enrichment?.odds ?? []
  const raw = match.raw ?? {}
  const rawRows = Array.isArray(direct) ? direct : []
  const nestedRows = Array.isArray(raw.odds) ? raw.odds : []
  return [...rawRows, ...nestedRows]
    .map(normalizeOddsRow)
    .filter((row) => row.marketFocus !== 'NONE')
}

export function normalizeOddsRow(row = {}) {
  const marketFocus = normalizeMarketFocus(row.market_focus ?? row.marketFocus ?? row.market ?? row.market_name ?? row.name)
  return {
    id: row.id ?? null,
    marketFocus,
    marketName: row.market_name ?? row.marketName ?? row.market ?? row.name ?? marketFocus,
    selection: row.selection ?? row.value ?? null,
    line: firstText(row.line, parseLineFromSelection(row.selection ?? row.value)),
    price: numberOrNull(row.price ?? row.odd ?? row.odds),
    oddText: firstText(row.odd_text, row.odd, row.odds, row.price),
    bookmaker: row.bookmaker_name ?? row.bookmaker ?? row.bookmakerName ?? null,
    isOpening: Boolean(row.is_opening ?? row.isOpening),
    isLatest: row.is_latest ?? row.isLatest ?? true,
    snapshotAt: row.snapshot_at ?? row.snapshotAt ?? row.created_at ?? null,
    raw: row.raw ?? row,
  }
}

export function getLatestOddsByMarket(match = {}, marketFocus) {
  const focus = normalizeMarketFocus(marketFocus)
  return normalizeOddsRows(match)
    .filter((row) => row.marketFocus === focus)
    .sort((a, b) => {
      const latestDiff = Number(Boolean(b.isLatest)) - Number(Boolean(a.isLatest))
      const timeDiff = new Date(b.snapshotAt ?? 0).getTime() - new Date(a.snapshotAt ?? 0).getTime()
      return latestDiff || timeDiff
    })
}

export function hasUsableMarket(match = {}, marketFocus) {
  return getLatestOddsByMarket(match, marketFocus).length > 0
}

export function getPrimaryBookmaker(match = {}) {
  return normalizeOddsRows(match).find((row) => row.bookmaker)?.bookmaker ?? null
}

export function getPrimaryOddText(match = {}, marketFocus) {
  return getLatestOddsByMarket(match, marketFocus).find((row) => row.oddText)?.oddText ?? null
}

export function describeMarketMovement(rows = [], direction = '') {
  if (!rows.length) return 'No market data yet'
  const sorted = [...rows].sort((a, b) => new Date(a.snapshotAt ?? 0).getTime() - new Date(b.snapshotAt ?? 0).getTime())
  const first = sorted[0]
  const last = sorted.at(-1)
  if (!first || !last || first === last) return 'Latest market data is available'
  if (first.line !== last.line) return `Line moved ${first.line ?? '-'} to ${last.line ?? '-'}`
  if (first.price !== null && last.price !== null && Math.abs(last.price - first.price) >= 0.08) {
    const side = direction ? ` toward ${direction}` : ''
    return `Price movement${side}`
  }
  return 'Market movement is still neutral'
}

export function movementSupportsDirection(rows = [], direction = '') {
  if (!rows.length) return 'missing'
  const text = `${describeMarketMovement(rows, direction)} ${direction}`.toLowerCase()
  if (text.includes('neutral')) return 'neutral'
  if (direction && text.includes(String(direction).toLowerCase().split(' ')[0])) return 'supports'
  return 'neutral'
}

export function parseLineNumber(value) {
  if (value === null || value === undefined) return null
  const match = String(value).match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

function parseLineFromSelection(value) {
  return parseLineNumber(value)
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

function numberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
