import { normalizeMarketFocus } from './oddsUtils.js'

export const waitingApiFootballMarketLabel = 'ยังไม่มีข้อมูลราคา'
export const waitingApiFootballMarketReason = 'ยังไม่มีข้อมูลราคา'
export const strictDailyTiers = {
  ready: 'READY',
  watch: 'WATCH',
  noData: 'NO_DATA',
}

export function getApiFootballMarketDisplay(match = {}, finalPick = {}) {
  const rows = getApiFootballOddsRows(match)
  const primary = choosePrimaryApiFootballMarket(rows, finalPick)

  if (!primary?.marketName) {
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
  if (!primary) return withPickSummary(empty, match, rows)

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
    if (side === 'HOME') return withPickSummary({ ...base, pickTeam: homeName || null, pickTeamId: homeId, pickSide: 'HOME', reason: 'เลือกทีมจากตลาดแฮนดิแคปของ API-Football' }, match, rows)
    if (side === 'AWAY') return withPickSummary({ ...base, pickTeam: awayName || null, pickTeamId: awayId, pickSide: 'AWAY', reason: 'เลือกทีมจากตลาดแฮนดิแคปของ API-Football' }, match, rows)
    return withPickSummary({ ...base, pickSource: 'NONE', reason: 'ไม่สามารถระบุทีมจากตลาดแฮนดิแคปได้' }, match, rows)
  }

  if (market === 'MATCH_WINNER') {
    const side = inferTeamSide(selection, homeName, awayName)
    if (side === 'HOME') return withPickSummary({ ...base, pickTeam: homeName || null, pickTeamId: homeId, pickSide: 'HOME', reason: 'เลือกทีมจากตลาด 1X2 ของ API-Football' }, match, rows)
    if (side === 'AWAY') return withPickSummary({ ...base, pickTeam: awayName || null, pickTeamId: awayId, pickSide: 'AWAY', reason: 'เลือกทีมจากตลาด 1X2 ของ API-Football' }, match, rows)
    if (isDrawSelection(selection)) return withPickSummary({ ...base, pickSide: 'DRAW', reason: 'ตลาดนี้เป็นผลเสมอ ไม่มีทีมที่เลือก' }, match, rows)
    return withPickSummary({ ...base, pickSource: 'NONE', reason: 'ไม่สามารถระบุทีมจากตลาด 1X2 ได้' }, match, rows)
  }

  if (market === 'OU') {
    return withPickSummary({ ...base, pickSide: inferOverUnderSide(selection), reason: 'ตลาดสูงต่ำไม่มีทีมที่เลือก' }, match, rows)
  }

  if (market === 'BTTS') {
    return withPickSummary({ ...base, pickSide: inferYesNoSide(selection), reason: 'ตลาดทั้งสองทีมยิงได้ไม่มีทีมที่เลือก' }, match, rows)
  }

  return withPickSummary({ ...base, pickSide: 'NONE', reason: 'ตลาดจาก API-Football ไม่ใช่ตลาดเลือกทีม' }, match, rows)
}

export function buildPickSummaryFromApiFootballOdds(match = {}, oddsRows = null) {
  return derivePickTeamFromApiFootballOdds(match, oddsRows).pickSummary
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
  const scoreParts = getStrictDailyScoreParts(match, oddsRows, pick)
  return {
    match,
    matchId: match.id,
    hasApiFootballOdds: oddsRows.length > 0,
    hasRealMarketData: oddsRows.length > 0,
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
    pickSummary: pick.pickSummary,
    pickSummaryTitle: pick.pickSummaryTitle,
    pickSummarySide: pick.pickSummarySide,
    pickSummaryTeam: pick.pickSummaryTeam,
    pickSummaryMarket: pick.pickSummaryMarket,
    pickSummaryReason: pick.pickSummaryReason,
    predictedOutcomeLabel: pick.predictedOutcomeLabel,
    reason: pick.reason,
    completenessScore: getCompletenessScore(match, oddsRows),
    completenessBreakdown: getCompletenessBreakdown(match, oddsRows),
    hasFixtureStatistics: hasRows(match.statistics ?? match.enrichment?.statistics ?? match.raw?.statistics),
    hasLineups: hasRows(match.lineups ?? match.enrichment?.lineups ?? match.raw?.lineups),
    leagueQualityScore: numberValue(match.leagueQualityScore ?? match.league_quality_score ?? match.analysis?.league_quality_score ?? match.league?.priority),
    kickoffTime: new Date(match.kickoffAt ?? match.kickoff_at ?? 0).getTime() || 0,
    stableId: String(match.id ?? match.api_fixture_id ?? match.api_sports_fixture_id ?? ''),
    baseFixtureQualityScore: scoreParts.baseFixtureQualityScore,
    dataReadinessScore: scoreParts.dataReadinessScore,
    marketReadinessScore: scoreParts.marketReadinessScore,
    safetyPenalty: scoreParts.safetyPenalty,
    strictRankingScore: scoreParts.strictRankingScore,
    recommendedTier: scoreParts.recommendedTier,
  }
}

export function compareStrictApiFootballCandidates(a, b) {
  return (
    strictTierPriority(b.recommendedTier) - strictTierPriority(a.recommendedTier) ||
    b.strictRankingScore - a.strictRankingScore ||
    b.dataReadinessScore - a.dataReadinessScore ||
    b.baseFixtureQualityScore - a.baseFixtureQualityScore ||
    b.marketReadinessScore - a.marketReadinessScore ||
    b.marketPriority - a.marketPriority ||
    b.completenessScore - a.completenessScore ||
    Number(b.hasApiFootballOdds) - Number(a.hasApiFootballOdds) ||
    Number(b.hasPrimaryMarket) - Number(a.hasPrimaryMarket) ||
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

  return [...directRows, ...matchOdds, ...snakeMatchOdds, ...enrichmentOdds]
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
  const hasApiFootballSource = Boolean(row.id || row.match_id || row.matchId)

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
  return row.marketName || waitingApiFootballMarketLabel
}

function withPickSummary(pick, match, oddsRows) {
  const summary = createPickSummary(match, pick, oddsRows)
  return {
    ...pick,
    pickSummary: summary,
    pickSummaryTitle: summary.title,
    pickSummarySide: summary.sideLabel,
    pickSummaryTeam: summary.team,
    pickSummaryMarket: summary.market,
    pickSummaryReason: summary.reason,
    predictedOutcomeLabel: summary.predictedOutcomeLabel,
  }
}

function createPickSummary(match = {}, pick = {}, oddsRows = []) {
  const hasOdds = Array.isArray(oddsRows) && oddsRows.length > 0
  const confidence = Math.round(numberValue(match.confidence ?? match.confidence_score ?? match.aiFinalPick?.confidence_score ?? match.analysis?.calibrated_confidence_score ?? match.analysis?.confidence_score))
  const market = pick.pickMarket ? (pick.pickMarket === 'OTHER' ? (pick.pickSelection ? 'API-Football' : waitingApiFootballMarketLabel) : pick.pickMarket) : waitingApiFootballMarketLabel
  const marketName = getPrimaryMarketName(oddsRows) || market
  const sideLabel = getPickSideLabel(pick)
  const team = pick.pickTeam || null
  const predictedOutcomeLabel = getPredictedOutcomeLabel(pick, team)
  const reason = hasOdds
    ? getPickSummaryReason(pick)
    : 'ระบบยังไม่พบข้อมูลราคาจาก API-Football สำหรับคู่นี้'

  return {
    title: 'สรุปมุมมองระบบ',
    side: pick.pickSide ?? 'NONE',
    sideLabel,
    team,
    market: hasOdds ? marketName : waitingApiFootballMarketLabel,
    reason,
    predictedOutcomeLabel,
    confidenceLabel: confidence ? `${confidence}%` : 'รอข้อมูลเพิ่ม',
    hasApiFootballOdds: hasOdds,
  }
}

function getPrimaryMarketName(oddsRows = []) {
  return firstText(oddsRows[0]?.marketName, oddsRows[0]?.market_name)
}

function getPickSideLabel(pick = {}) {
  if (pick.pickTeam) return pick.pickTeam
  const labels = {
    HOME: 'เจ้าบ้าน',
    AWAY: 'ทีมเยือน',
    DRAW: 'เสมอ',
    OVER: 'สูง',
    UNDER: 'ต่ำ',
    YES: 'ใช่',
    NO: 'ไม่ใช่',
    NONE: 'ยังไม่เลือกฝั่ง',
  }
  return labels[pick.pickSide] ?? labels.NONE
}

function getPredictedOutcomeLabel(pick = {}, team = '') {
  const side = String(pick.pickSide ?? 'NONE').toUpperCase()
  const market = String(pick.pickMarket ?? '').toUpperCase()
  if (!pick.hasApiFootballOdds) return waitingApiFootballMarketLabel
  if (team && market === 'AH') return `${team} เป็นฝั่งที่ระบบให้ภาษีดีกว่า`
  if (team && market === 'MATCH_WINNER') return `${team} มีโอกาสเหนือกว่า`
  if (side === 'DRAW') return 'เกมมีโอกาสออกเสมอ'
  if (side === 'OVER') return 'เกมมีแนวโน้มประตูรวมสูง'
  if (side === 'UNDER') return 'เกมมีแนวโน้มประตูรวมต่ำ'
  if (side === 'YES') return 'มีแนวโน้มที่ทั้งสองทีมทำประตูได้'
  if (side === 'NO') return 'มีแนวโน้มที่อย่างน้อยหนึ่งทีมทำประตูไม่ได้'
  return 'รอข้อมูลเพิ่มก่อนเลือกฝั่ง'
}

function getPickSummaryReason(pick = {}) {
  const market = String(pick.pickMarket ?? '').toUpperCase()
  if (market === 'AH') return 'อ้างอิงตลาดแฮนดิแคปจริงจาก API-Football'
  if (market === 'MATCH_WINNER') return 'อ้างอิงตลาดผลแพ้ชนะจริงจาก API-Football'
  if (market === 'OU') return 'อ้างอิงตลาดประตูรวมจริงจาก API-Football'
  if (market === 'BTTS') return 'อ้างอิงตลาดทั้งสองทีมทำประตูจริงจาก API-Football'
  return 'อ้างอิงข้อมูลราคาจริงจาก API-Football'
}

function getStrictDailyScoreParts(match, oddsRows, pick) {
  const baseFixtureQualityScore = clampScore(
    (hasTeamNames(match) ? 30 : 0) +
    (hasLeagueName(match) ? 20 : 0) +
    (hasKickoff(match) ? 20 : 0) +
    Math.min(30, numberValue(match.leagueQualityScore ?? match.league_quality_score ?? match.analysis?.league_quality_score ?? match.league?.priority) * 0.3)
  )
  const dataReadinessScore = clampScore(
    (match.has_fixture_detail || match.hasFixtureDetail ? 25 : 0) +
    (hasRows(match.statistics ?? match.enrichment?.statistics ?? match.raw?.statistics) ? 20 : 0) +
    (hasRows(match.lineups ?? match.enrichment?.lineups ?? match.raw?.lineups) ? 15 : 0) +
    Math.min(30, numberValue(match.data_readiness_score ?? match.dataReadinessScore ?? match.analysis?.data_readiness_score)) +
    (['READY', 'PARTIAL'].includes(String(match.data_readiness_status ?? match.dataReadinessStatus ?? '').toUpperCase()) ? 10 : 0)
  )
  const marketReadinessScore = clampScore(
    (oddsRows.length ? 45 : 0) +
    (pick.hasPrimaryMarket ? 25 : 0) +
    Math.min(30, numberValue(pick.marketPriority) * 0.3)
  )
  const safetyPenalty = getStrictDailySafetyPenalty(match, oddsRows)
  const strictRankingScore = clampScore((baseFixtureQualityScore * 0.44) + (dataReadinessScore * 0.32) + (marketReadinessScore * 0.24) - safetyPenalty)
  const recommendedTier = getStrictDailyTier({ strictRankingScore, dataReadinessScore, marketReadinessScore, safetyPenalty, hasOdds: oddsRows.length > 0 })
  return { baseFixtureQualityScore, dataReadinessScore, marketReadinessScore, safetyPenalty, strictRankingScore, recommendedTier }
}

function getStrictDailySafetyPenalty(match, oddsRows) {
  let penalty = 0
  if (!hasTeamNames(match)) penalty += 30
  if (!hasLeagueName(match)) penalty += 15
  if (!hasKickoff(match)) penalty += 25
  if (!oddsRows.length) penalty += 8
  if (numberValue(match.leagueQualityScore ?? match.league_quality_score ?? match.analysis?.league_quality_score ?? match.league?.priority) < 20) penalty += 5
  return Math.min(60, penalty)
}

function getStrictDailyTier({ strictRankingScore, dataReadinessScore, marketReadinessScore, safetyPenalty, hasOdds }) {
  if (hasOdds && marketReadinessScore >= 45 && dataReadinessScore >= 25 && strictRankingScore >= 45 && safetyPenalty < 35) return strictDailyTiers.ready
  if (strictRankingScore >= 35 && safetyPenalty < 45) return strictDailyTiers.watch
  return strictDailyTiers.noData
}

function strictTierPriority(tier) {
  if (tier === strictDailyTiers.ready) return 3
  if (tier === strictDailyTiers.watch) return 2
  return 1
}

function hasTeamNames(match = {}) {
  return Boolean(firstText(match.homeTeam?.name, match.home_team?.name, match.home_team, match.home)) &&
    Boolean(firstText(match.awayTeam?.name, match.away_team?.name, match.away_team, match.away))
}

function hasLeagueName(match = {}) {
  return Boolean(firstText(match.league?.name, match.league_name, match.league))
}

function hasKickoff(match = {}) {
  return Boolean(new Date(match.kickoffAt ?? match.kickoff_at ?? 0).getTime())
}

function clampScore(value) {
  const numeric = numberValue(value)
  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100))
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
