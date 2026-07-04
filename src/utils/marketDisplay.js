import { normalizeMarketFocus } from './oddsUtils.js'

export const waitingApiFootballMarketLabel = 'รอข้อมูลจาก API-Football'
export const waitingApiFootballMarketReason = 'คู่นี้อยู่ในชุดคัดเลือกแล้ว แต่ API-Football ยังไม่มีข้อมูลตลาดสำหรับคู่นี้'

const apiFootballMarketLabelsTh = {
  AH: 'แฮนดิแคป',
  OU: 'สูง/ต่ำ',
  MATCH_WINNER: '1X2',
  BTTS: 'ทั้งสองทีมยิงได้',
}

export function getApiFootballMarketDisplay(match = {}, finalPick = {}) {
  const rows = getApiFootballOddsRows(match)
  const primary = choosePrimaryApiFootballMarket(rows, finalPick)

  if (!primary) {
    return {
      label: waitingApiFootballMarketLabel,
      status: 'waiting_api_football_market',
      reason: waitingApiFootballMarketReason,
      hasApiFootballMarket: false,
      marketLabel: '',
      oddsRows: rows,
    }
  }

  const marketLabel = formatApiFootballMarketName(primary)
  return {
    label: `ตลาดจาก API-Football: ${marketLabel}`,
    status: 'api_football_market_ready',
    reason: `ใช้ชื่อตลาดจากข้อมูล odds ของ API-Football`,
    hasApiFootballMarket: true,
    marketLabel,
    marketName: primary.marketName,
    marketFocus: primary.marketFocus,
    oddsRows: rows,
  }
}

export function getApiFootballOddsRows(match = {}) {
  const directRows = asArray(match.odds)
  const matchOdds = asArray(match.matchOdds)
  const snakeMatchOdds = asArray(match.match_odds)
  const enrichmentOdds = asArray(match.enrichment?.odds)
  const rawOdds = asArray(match.raw?.odds)

  return [...directRows, ...matchOdds, ...snakeMatchOdds, ...enrichmentOdds, ...rawOdds]
    .map(normalizeApiFootballOddsRow)
    .filter((row) => row.hasApiFootballSource)
    .filter(uniqueOddsRow)
}

function choosePrimaryApiFootballMarket(rows = [], finalPick = {}) {
  const preferredFocus = normalizeMarketFocus(finalPick.marketFocus ?? finalPick.market_focus)
  const sorted = [...rows].sort((a, b) => {
    const preferredDiff = Number(b.marketFocus === preferredFocus) - Number(a.marketFocus === preferredFocus)
    const knownDiff = Number(b.marketFocus !== 'NONE') - Number(a.marketFocus !== 'NONE')
    const latestDiff = Number(Boolean(b.isLatest)) - Number(Boolean(a.isLatest))
    const timeDiff = new Date(b.snapshotAt ?? 0).getTime() - new Date(a.snapshotAt ?? 0).getTime()
    return preferredDiff || knownDiff || latestDiff || timeDiff
  })
  return sorted.find((row) => row.marketFocus !== 'NONE' || row.marketName) ?? null
}

function normalizeApiFootballOddsRow(row = {}) {
  const marketName = firstText(row.market_name, row.marketName, row.market, row.name, row.raw?.market_name, row.raw?.market)
  const betName = firstText(row.bet_name, row.betName, row.selection, row.value, row.raw?.bet_name, row.raw?.value)
  const marketFocus = normalizeMarketFocus(row.market_focus ?? row.marketFocus ?? marketName)
  const bookmaker = firstText(row.bookmaker_name, row.bookmaker, row.bookmakerName, row.raw?.bookmaker_name)
  const hasApiFootballSource = Boolean(row.id || row.match_id || marketName || betName || bookmaker)

  return {
    id: row.id ?? null,
    matchId: row.match_id ?? row.matchId ?? null,
    marketFocus,
    marketName,
    betName,
    bookmaker,
    hasApiFootballSource,
    isLatest: row.is_latest ?? row.isLatest ?? true,
    snapshotAt: row.snapshot_at ?? row.snapshotAt ?? row.created_at ?? null,
  }
}

function formatApiFootballMarketName(row = {}) {
  if (row.marketFocus && apiFootballMarketLabelsTh[row.marketFocus]) return apiFootballMarketLabelsTh[row.marketFocus]
  return row.marketName || row.betName || waitingApiFootballMarketLabel
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function uniqueOddsRow(row, index, rows) {
  const key = row.id || `${row.matchId}:${row.marketName}:${row.betName}:${row.bookmaker}:${row.snapshotAt}`
  return rows.findIndex((item) => {
    const itemKey = item.id || `${item.matchId}:${item.marketName}:${item.betName}:${item.bookmaker}:${item.snapshotAt}`
    return itemKey === key
  }) === index
}
