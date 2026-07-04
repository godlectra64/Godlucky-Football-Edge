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

export function derivePickTeamFromApiFootballOdds(match = {}, oddsRows = null) {
  const rows = Array.isArray(oddsRows) ? oddsRows.map(normalizeApiFootballOddsRow).filter((row) => row.hasApiFootballSource) : getApiFootballOddsRows(match)
  const primary = choosePrimaryApiFootballMarket(rows, {})
  const empty = {
    pickTeam: null,
    pickTeamId: null,
    pickSide: 'NONE',
    pickMarket: null,
    pickSelection: null,
    pickPrice: null,
    pickSource: 'NONE',
    reason: 'ยังไม่มีข้อมูลราคา',
    marketPriority: 0,
    hasApiFootballOdds: false,
    hasPrimaryMarket: false,
  }
  if (!primary) return empty

  const homeName = firstText(match.homeTeam?.name, match.home_team?.name, match.home_team, match.home)
  const awayName = firstText(match.awayTeam?.name, match.away_team?.name, match.away_team, match.away)
  const homeId = match.homeTeam?.api_team_id ?? match.homeTeam?.id ?? match.home_team_id ?? match.homeTeamId ?? null
  const awayId = match.awayTeam?.api_team_id ?? match.awayTeam?.id ?? match.away_team_id ?? match.awayTeamId ?? null
  const selection = firstText(primary.betName, primary.selection, primary.rawSelection)
  const market = primary.marketFocus === 'NONE' && primary.marketName ? 'OTHER' : primary.marketFocus
  const base = {
    pickTeam: null,
    pickTeamId: null,
    pickSide: 'NONE',
    pickMarket: market,
    pickMarketId: primary.marketId,
    pickSelection: selection || null,
    pickPrice: primary.price,
    pickSource: 'API_FOOTBALL_ODDS',
    reason: '',
    marketPriority: getApiFootballMarketPriority(market),
    hasApiFootballOdds: true,
    hasPrimaryMarket: true,
  }

  if (market === 'AH') {
    const side = inferTeamSide(selection, homeName, awayName)
    if (side === 'HOME') return { ...base, pickTeam: homeName || null, pickTeamId: homeId, pickSide: 'HOME', reason: 'เลือกทีมจากตลาดแฮนดิแคปของ API-Football' }
    if (side === 'AWAY') return { ...base, pickTeam: awayName || null, pickTeamId: awayId, pickSide: 'AWAY', reason: 'เลือกทีมจากตลาดแฮนดิแคปของ API-Football' }
    return { ...base, pickSource: 'NONE', reason: 'ไม่สามารถระบุทีมจากตลาดแฮนดิแคปได้' }
  }

  if (market === 'MATCH_WINNER') {
    const side = inferTeamSide(selection, homeName, awayName)
    if (side === 'HOME') return { ...base, pickTeam: homeName || null, pickTeamId: homeId, pickSide: 'HOME', reason: 'เลือกทีมจากตลาด 1X2 ของ API-Football' }
    if (side === 'AWAY') return { ...base, pickTeam: awayName || null, pickTeamId: awayId, pickSide: 'AWAY', reason: 'เลือกทีมจากตลาด 1X2 ของ API-Football' }
    if (isDrawSelection(selection)) return { ...base, pickSide: 'DRAW', reason: 'ตลาดนี้เป็นผลเสมอ ไม่มีทีมที่เลือก' }
    return { ...base, pickSource: 'NONE', reason: 'ไม่สามารถระบุทีมจากตลาด 1X2 ได้' }
  }

  if (market === 'OU') {
    return { ...base, pickSide: inferOverUnderSide(selection), reason: 'ตลาดสูงต่ำไม่มีทีมที่เลือก' }
  }

  if (market === 'BTTS') {
    return { ...base, pickSide: inferYesNoSide(selection), reason: 'ตลาดทั้งสองทีมยิงได้ไม่มีทีมที่เลือก' }
  }

  return { ...base, pickSide: 'NONE', reason: 'ตลาดจาก API-Football ไม่ใช่ตลาดเลือกทีม' }
}

export function getApiFootballMarketPriority(marketFocus) {
  const normalized = normalizeMarketFocus(marketFocus)
  if (normalized === 'AH') return 100
  if (normalized === 'OU') return 90
  if (normalized === 'MATCH_WINNER') return 80
  if (normalized === 'BTTS') return 70
  return normalized === 'NONE' ? (String(marketFocus ?? '').trim() && String(marketFocus).toUpperCase() !== 'NONE' ? 50 : 0) : 50
}

export function buildStrictApiFootballSelection(matches = [], options = {}) {
  const limit = positiveNumber(options.limit, 10)
  const candidates = (Array.isArray(matches) ? matches : [])
    .map(buildStrictApiFootballCandidate)
    .sort(compareStrictApiFootballCandidates)
  const selected = candidates.slice(0, limit).map((candidate, index) => ({
    ...candidate.match,
    strictApiFootball: candidate,
    rank: index + 1,
    finalRank: index + 1,
    final_rank: index + 1,
    displayRank: index + 1,
    display_rank: index + 1,
  }))
  return {
    selected,
    candidates,
    selectedCount: selected.length,
    matchesWithOddsCount: candidates.filter((row) => row.hasApiFootballOdds).length,
    selectedWithOddsCount: selected.filter((match) => match.strictApiFootball.hasApiFootballOdds).length,
    selectedWithoutOddsCount: selected.filter((match) => !match.strictApiFootball.hasApiFootballOdds).length,
    selectedWithPickTeamCount: selected.filter((match) => Boolean(match.strictApiFootball.pickTeam)).length,
    selectedWithoutPickTeamCount: selected.filter((match) => !match.strictApiFootball.pickTeam).length,
    primaryMarketCount: selected.filter((match) => match.strictApiFootball.hasPrimaryMarket).length,
    marketPrioritySummary: summarizeMarketPriority(selected.map((match) => match.strictApiFootball)),
    pickTeamCoverage: summarizePickTeamCoverage(selected.map((match) => match.strictApiFootball)),
    usedRollingWindow: false,
    usedNextDateFallback: false,
  }
}

export function buildStrictApiFootballCandidate(match = {}) {
  const pick = derivePickTeamFromApiFootballOdds(match)
  const oddsRows = getApiFootballOddsRows(match)
  return {
    match,
    matchId: match.id,
    hasApiFootballOdds: oddsRows.length > 0,
    hasPrimaryMarket: pick.hasPrimaryMarket,
    marketPriority: pick.marketPriority,
    primaryMarket: pick.pickMarket,
    pickTeam: pick.pickTeam,
    pickTeamId: pick.pickTeamId,
    pickSide: pick.pickSide,
    pickMarket: pick.pickMarket,
    pickSelection: pick.pickSelection,
    pickPrice: pick.pickPrice,
    pickSource: pick.pickSource,
    reason: pick.reason,
    completenessScore: getCompletenessScore(match, oddsRows),
    completenessBreakdown: getCompletenessBreakdown(match, oddsRows),
    hasFixtureStatistics: hasRows(match.statistics ?? match.enrichment?.statistics ?? match.raw?.statistics),
    hasLineups: hasRows(match.lineups ?? match.enrichment?.lineups ?? match.raw?.lineups),
    leagueQualityScore: numberValue(match.leagueQualityScore ?? match.league_quality_score ?? match.analysis?.league_quality_score ?? match.league?.priority),
    kickoffTime: new Date(match.kickoffAt ?? match.kickoff_at ?? 0).getTime() || 0,
    stableId: String(match.id ?? match.api_fixture_id ?? match.api_sports_fixture_id ?? ''),
  }
}

export function compareStrictApiFootballCandidates(a, b) {
  return (
    Number(b.hasApiFootballOdds) - Number(a.hasApiFootballOdds) ||
    Number(b.hasPrimaryMarket) - Number(a.hasPrimaryMarket) ||
    b.marketPriority - a.marketPriority ||
    b.completenessScore - a.completenessScore ||
    Number(Boolean(b.pickTeam)) - Number(Boolean(a.pickTeam)) ||
    Number(b.hasFixtureStatistics) - Number(a.hasFixtureStatistics) ||
    Number(b.hasLineups) - Number(a.hasLineups) ||
    b.leagueQualityScore - a.leagueQualityScore ||
    a.kickoffTime - b.kickoffTime ||
    a.stableId.localeCompare(b.stableId)
  )
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
    const priorityDiff = getApiFootballMarketPriority(b.marketFocus === 'NONE' ? b.marketName : b.marketFocus) - getApiFootballMarketPriority(a.marketFocus === 'NONE' ? a.marketName : a.marketFocus)
    const knownDiff = Number(b.marketFocus !== 'NONE') - Number(a.marketFocus !== 'NONE')
    const latestDiff = Number(Boolean(b.isLatest)) - Number(Boolean(a.isLatest))
    const timeDiff = new Date(b.snapshotAt ?? 0).getTime() - new Date(a.snapshotAt ?? 0).getTime()
    return preferredDiff || priorityDiff || knownDiff || latestDiff || timeDiff
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
    marketId: row.market_id ?? row.marketId ?? row.raw?.market_id ?? null,
    marketName,
    betName,
    selection: row.selection ?? row.value ?? null,
    rawSelection: row.raw?.selection ?? row.raw?.value ?? null,
    price: numberOrNull(row.price ?? row.odd ?? row.odds ?? row.raw?.price ?? row.raw?.odd),
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

function inferTeamSide(selection, homeName, awayName) {
  const text = normalizeName(selection)
  if (!text) return 'NONE'
  if (['home', '1'].includes(text)) return 'HOME'
  if (['away', '2'].includes(text)) return 'AWAY'
  const home = normalizeName(homeName)
  const away = normalizeName(awayName)
  if (home && (text === home || text.includes(home) || home.includes(text))) return 'HOME'
  if (away && (text === away || text.includes(away) || away.includes(text))) return 'AWAY'
  return 'NONE'
}

function inferOverUnderSide(selection) {
  const text = String(selection ?? '').toUpperCase()
  if (text.includes('UNDER')) return 'UNDER'
  if (text.includes('OVER')) return 'OVER'
  return 'NONE'
}

function inferYesNoSide(selection) {
  const text = String(selection ?? '').toUpperCase()
  if (['YES', 'Y'].includes(text) || text.includes('YES')) return 'YES'
  if (['NO', 'N'].includes(text) || text.includes('NO')) return 'NO'
  return 'NONE'
}

function isDrawSelection(selection) {
  const text = normalizeName(selection)
  return ['draw', 'x', 'เสมอ'].includes(text)
}

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ก-๙]+/g, ' ')
    .trim()
}

function getCompletenessScore(match, oddsRows) {
  const breakdown = getCompletenessBreakdown(match, oddsRows)
  return Object.values(breakdown).reduce((total, value) => total + value, 0)
}

function getCompletenessBreakdown(match, oddsRows) {
  return {
    odds: oddsRows.length ? 45 : 0,
    fixture: match.has_fixture_detail || match.hasFixtureDetail ? 15 : 0,
    stats: hasRows(match.statistics ?? match.enrichment?.statistics ?? match.raw?.statistics) ? 15 : 0,
    lineups: hasRows(match.lineups ?? match.enrichment?.lineups ?? match.raw?.lineups) ? 10 : 0,
    readiness: ['READY', 'PARTIAL'].includes(String(match.data_readiness_status ?? match.dataReadinessStatus ?? '').toUpperCase()) ? 15 : 0,
  }
}

function summarizeMarketPriority(candidates = []) {
  return candidates.reduce((summary, item) => {
    const key = item.primaryMarket ?? 'NONE'
    summary[key] = (summary[key] ?? 0) + 1
    return summary
  }, {})
}

function summarizePickTeamCoverage(candidates = []) {
  return {
    withPickTeam: candidates.filter((item) => Boolean(item.pickTeam)).length,
    withoutPickTeam: candidates.filter((item) => !item.pickTeam).length,
  }
}

function hasRows(value) {
  return Array.isArray(value) && value.length > 0
}

function positiveNumber(value, fallback) {
  const numeric = Number(value ?? fallback)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function numberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function uniqueOddsRow(row, index, rows) {
  const key = row.id || `${row.matchId}:${row.marketName}:${row.betName}:${row.bookmaker}:${row.snapshotAt}`
  return rows.findIndex((item) => {
    const itemKey = item.id || `${item.matchId}:${item.marketName}:${item.betName}:${item.bookmaker}:${item.snapshotAt}`
    return itemKey === key
  }) === index
}
