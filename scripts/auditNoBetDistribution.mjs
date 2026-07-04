import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'
import { getMatchStatusInfo, matchStatusGroups } from '../src/utils/matchStatus.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for no-bet distribution audit.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const dayMs = 24 * 60 * 60 * 1000
const days = buildRecentBangkokDays(7)
const firstRange = getBangkokDayRange(days[0])
const lastRange = getBangkokDayRange(days.at(-1))

console.log(`[diagnose:no-bet] project_ref=${getSupabaseProjectRef(supabaseUrl)}`)
console.log(`[diagnose:no-bet] window=${firstRange.dateKey}..${lastRange.dateKey} Bangkok`)

const matches = await fetchMatches(firstRange.startUtc, lastRange.endUtc)
const matchIds = matches.map((row) => row.id).filter(Boolean)
const [oddsRows, finalPicks, top10Rows, resultRows] = await Promise.all([
  fetchByMatchIds('football_match_odds', matchIds, '*'),
  fetchByMatchIds('football_ai_final_picks', matchIds, '*'),
  fetchTop10Rows(firstRange.dateKey, lastRange.dateKey),
  fetchByMatchIds('football_ai_pick_results', matchIds, '*'),
])

const oddsByMatch = groupBy(oddsRows, (row) => row.match_id)
const finalPickByMatch = new Map(finalPicks.map((row) => [row.match_id, row]))
const top10ByDate = groupBy(top10Rows, (row) => row.selection_date)
const resultByMatch = groupBy(resultRows, (row) => row.match_id)
const matchesByDate = groupBy(matches, (row) => getBangkokDateKey(row.kickoff_at))

let allTop10NoBet = true

for (const dateKey of days) {
  const dayMatches = matchesByDate.get(dateKey) ?? []
  const dayTop10 = getDailyTop10Rows(dateKey, dayMatches, top10ByDate)
  const dayMatchIds = new Set(dayMatches.map((row) => row.id))
  const dayOdds = oddsRows.filter((row) => dayMatchIds.has(row.match_id))
  const dayFinalPicks = finalPicks.filter((row) => dayMatchIds.has(row.match_id))
  const dayResults = resultRows.filter((row) => dayMatchIds.has(row.match_id))

  const analyses = dayMatches.map(getAnalysis).filter(Boolean)
  const top10Analyses = dayTop10.map((item) => item.analysis).filter(Boolean)
  const marketReadyCandidates = dayMatches.filter(isMarketReadyCandidate)
  const marketReadyInTop10 = dayTop10.filter((item) => isMarketReadyCandidate(item.match)).length
  const waitingMarketInTop10 = dayTop10.filter((item) => isWaitingMarketData(item.match)).length
  const top10StatusCounts = buildMatchStatusCounts(dayTop10.map((item) => item.match))
  const playableTodayCount = top10StatusCounts.upcomingCount + top10StatusCounts.liveCount
  const finishedTop10Count = top10StatusCounts.finishedCount
  const resultsPageEligibleCount = dayMatches.filter((match) => getMatchStatusInfo(match).isFinished).length
  const top10MatchIds = new Set(dayTop10.map((item) => item.match?.id).filter(Boolean))
  const staleNoMarketLockCount = dayTop10.filter((item) => item.source === 'daily_top10_selections' && isWaitingMarketData(item.match)).length
  const readyButNotDisplayedCount = marketReadyCandidates.filter((match) => !top10MatchIds.has(match.id)).length
  const displayedSignalCount = dayTop10.filter((item) => ['STRONG_SIGNAL', 'WATCH'].includes(normalizeSignal(finalPickByMatch.get(item.match.id)?.signal))).length
  const betFinalPickMismatchCount = dayMatches.filter((match) => {
    const analysis = getAnalysis(match)
    const finalPick = finalPickByMatch.get(match.id)
    return normalizeRecommendation(analysis?.recommendation) === 'BET' &&
      isMarketReadyCandidate(match) &&
      normalizeSignal(finalPick?.signal) !== 'STRONG_SIGNAL'
  }).length
  if (top10Analyses.some((analysis) => normalizeRecommendation(analysis.recommendation) === 'BET')) allTop10NoBet = false

  console.log('')
  console.log(`## ${dateKey}`)
  printCount('matches', dayMatches.length)
  printCount('top10', dayTop10.length)
  printDistribution('recommendation', analyses.map((row) => normalizeRecommendation(row.recommendation)))
  printDistribution('top10Recommendation', top10Analyses.map((row) => normalizeRecommendation(row.recommendation)))
  printDistribution('signal', dayFinalPicks.map((row) => normalizeSignal(row.signal)))
  printStats('confidence_score', analyses.map((row) => row.confidence_score))
  printStats('ranking_score', analyses.map((row) => row.ranking_score))
  printStats('calibrated_confidence_score', analyses.map((row) => row.calibrated_confidence_score))
  printStats('market_edge_score', analyses.map((row) => row.market_edge_score))
  printStats('data_depth_score', analyses.map((row) => row.data_depth_score))
  printDistribution('value_status', analyses.map((row) => row.value_status ?? 'NULL'))
  printDistribution('data_validation_status', analyses.map((row) => row.data_validation_status ?? 'NULL'))
  printDistribution('risk_level', analyses.map((row) => normalizeRisk(row.risk_level)))
  printDistribution('analysis_status', analyses.map((row) => row.analysis_status ?? row.raw?.analysis_status ?? 'NULL'))
  printDistribution('readiness', dayMatches.map((row) => row.data_readiness_status ?? 'NULL'))
  printCount('oddsRows', dayOdds.length)
  printCount('matchesWithOddsRows', new Set(dayOdds.map((row) => row.match_id)).size)
  printCount('matchesWithMarketLine', analyses.filter((row) => hasText(row.market_line ?? row.value_line ?? row.latest_line)).length)
  printCount('matchesWithFairLine', analyses.filter((row) => hasText(row.fair_line)).length)
  printCount('matchesWithPickSide', analyses.filter((row) => normalizePickSide(row.pick_side) !== 'NONE').length)
  printCount('matchesWithPickTeam', analyses.filter((row) => hasText(row.pick_team)).length)
  printCount('marketDataMissingDowngrades', analyses.filter(isMarketMissingDowngrade).length)
  printCount('marketReadyCandidates', marketReadyCandidates.length)
  printCount('upcomingCount', top10StatusCounts.upcomingCount)
  printCount('liveCount', top10StatusCounts.liveCount)
  printCount('finishedCount', top10StatusCounts.finishedCount)
  printCount('playableTodayCount', playableTodayCount)
  printCount('finishedTop10Count', finishedTop10Count)
  printCount('resultsPageEligibleCount', resultsPageEligibleCount)
  printCount('marketReadyInTop10', marketReadyInTop10)
  printCount('waitingMarketInTop10', waitingMarketInTop10)
  printCount('staleNoMarketLockCount', staleNoMarketLockCount)
  printCount('readyButNotDisplayedCount', readyButNotDisplayedCount)
  printCount('displayedSignalCount', displayedSignalCount)
  printCount('betFinalPickMismatchCount', betFinalPickMismatchCount)
  console.log(`rootCause: ${getRootCause({
    dayMatches,
    dayTop10,
    top10StatusCounts,
    marketReadyCandidates,
    marketReadyInTop10,
    waitingMarketInTop10,
    readyButNotDisplayedCount,
    betFinalPickMismatchCount,
    staleNoMarketLockCount,
  })}`)
  printCount('aiFinalPicks', dayFinalPicks.length)
  printCount('pickResults', dayResults.length)
  printTop10Reasons(dateKey, dayTop10)
}

console.log('')
console.log('## Overall Finding Hints')
console.log(`allTop10NoBet=${allTop10NoBet}`)
console.log(`totalMatches=${matches.length}`)
console.log(`totalOddsRows=${oddsRows.length}`)
console.log(`totalMatchesWithOddsRows=${new Set(oddsRows.map((row) => row.match_id)).size}`)
console.log(`totalFinalPicks=${finalPicks.length}`)
console.log(`totalTop10Rows=${top10Rows.length}`)

function buildRecentBangkokDays(count) {
  const today = getBangkokDayRange().dateKey
  const todayStart = new Date(`${today}T00:00:00+07:00`).getTime()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(todayStart - (count - 1 - index) * dayMs)
    return getBangkokDayRange(date).dateKey
  })
}

async function fetchMatches(startUtc, endUtc) {
  const { data, error } = await supabase
    .from('football_matches')
    .select(`
      id,
      api_fixture_id,
      api_sports_fixture_id,
      kickoff_at,
      status,
      status_short,
      status_long,
      match_status,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      data_readiness_score,
      odds_updated_at,
      league:football_leagues(name, country),
      homeTeam:football_teams!football_matches_home_team_id_fkey(name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(name),
      analysis:match_analysis(
        id,
        match_id,
        recommendation,
        confidence_score,
        ranking_score,
        calibrated_confidence_score,
        risk_level,
        risk_score,
        market_edge_score,
        data_depth_score,
        value_status,
        data_validation_status,
        analysis_status,
        recommendation_reason,
        market_data_used,
        odds_rows_used,
        market_line,
        fair_line,
        value_line,
        latest_line,
        pick_side,
        pick_team,
        is_top_pick,
        final_rank,
        raw
      )
    `)
    .gte('kickoff_at', startUtc)
    .lt('kickoff_at', endUtc)
    .order('kickoff_at', { ascending: true })

  if (error) throw new Error(`fetch football_matches failed: ${formatSupabaseError(error)}`)
  return data ?? []
}

async function fetchByMatchIds(table, matchIds, select) {
  if (!matchIds.length) return []
  const uniqueIds = [...new Set(matchIds)]
  const allRows = []

  for (let index = 0; index < uniqueIds.length; index += 80) {
    const chunk = uniqueIds.slice(index, index + 80)
    let from = 0
    const pageSize = 1000

    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .in('match_id', chunk)
        .range(from, from + pageSize - 1)

      if (error) {
        console.warn(`[diagnose:no-bet] ${table} unavailable: ${formatSupabaseError(error)}`)
        return allRows
      }

      allRows.push(...(data ?? []))
      if (!data || data.length < pageSize) break
      from += pageSize
    }
  }

  return allRows
}

async function fetchTop10Rows(fromDate, toDate) {
  const { data, error } = await supabase
    .from('daily_top10_selections')
    .select('*')
    .gte('selection_date', fromDate)
    .lte('selection_date', toDate)
    .order('selection_date', { ascending: true })
    .order('rank', { ascending: true })

  if (error) {
    console.warn(`[diagnose:no-bet] daily_top10_selections unavailable: ${formatSupabaseError(error)}`)
    return []
  }
  return data ?? []
}

function getDailyTop10Rows(dateKey, dayMatches, top10ByDate) {
  const storedTop10 = top10ByDate.get(dateKey) ?? []
  if (storedTop10.length) {
    return storedTop10
      .map((row) => {
        const match = dayMatches.find((item) => item.id === row.match_id)
        return { source: 'daily_top10_selections', rank: row.rank, match, analysis: getAnalysis(match), stored: row }
      })
      .filter((item) => item.match)
  }

  return dayMatches
    .map((match) => ({ source: 'match_analysis', rank: Number(getAnalysis(match)?.final_rank ?? 999), match, analysis: getAnalysis(match), stored: null }))
    .filter((item) => item.analysis?.is_top_pick || Number.isFinite(item.rank) && item.rank < 999)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)
}

function printTop10Reasons(dateKey, top10Rows) {
  console.log('top10NoBetReasons:')
  if (!top10Rows.length) {
    console.log('  - none')
    return
  }

  for (const item of top10Rows) {
    const match = item.match
    const analysis = item.analysis ?? {}
    const finalPick = finalPickByMatch.get(match.id)
    const odds = oddsByMatch.get(match.id) ?? []
    const reasons = explainNoBet({ match, analysis, finalPick, odds })
    console.log(`  - rank=${item.rank ?? '-'} ${formatMatch(match)} rec=${normalizeRecommendation(analysis.recommendation)} signal=${normalizeSignal(finalPick?.signal)} blockers=${reasons.blockers.join('|') || 'none'} reason=${reasons.reason}`)
  }
}

function explainNoBet({ match, analysis, finalPick, odds }) {
  const blockers = []
  const recommendation = normalizeRecommendation(analysis.recommendation)
  const signal = normalizeSignal(finalPick?.signal)
  const confidence = Number(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? 0)
  const ranking = Number(analysis.ranking_score ?? 0)
  const risk = normalizeRisk(analysis.risk_level)
  const marketEdge = Number(analysis.market_edge_score ?? 0)
  const depth = Number(analysis.data_depth_score ?? 0)
  const readiness = String(match.data_readiness_status ?? '').toUpperCase()
  const marketDataUsed = Boolean(analysis.market_data_used ?? analysis.raw?.market_data_used)
  const oddsRowsUsed = Number(analysis.odds_rows_used ?? analysis.raw?.odds_rows_used ?? odds.length)

  if (recommendation !== 'BET') blockers.push(`recommendation_${recommendation.replaceAll(' ', '_')}`)
  if (signal !== 'STRONG_SIGNAL') blockers.push(`signal_${signal}`)
  if (!['READY', 'PARTIAL'].includes(readiness)) blockers.push(`readiness_${readiness || 'NULL'}`)
  if (!marketDataUsed) blockers.push('market_data_not_used')
  if (oddsRowsUsed <= 0 || odds.length <= 0) blockers.push('market_data_missing')
  if (confidence < 72) blockers.push(`confidence_lt_72:${confidence || 0}`)
  if (ranking < 60) blockers.push(`ranking_lt_60:${ranking || 0}`)
  if (risk === 'HIGH') blockers.push('high_risk')
  if (marketEdge <= 0) blockers.push('market_edge_zero')
  else if (marketEdge < 60) blockers.push(`market_edge_lt_60:${marketEdge}`)
  if (depth < 50) blockers.push(`data_depth_lt_50:${depth || 0}`)
  if (normalizePickSide(analysis.pick_side) === 'NONE') blockers.push('no_pick_side')
  if (!hasText(analysis.market_line ?? analysis.value_line ?? analysis.latest_line)) blockers.push('missing_market_line')
  if (!hasText(analysis.fair_line)) blockers.push('missing_fair_line')

  return {
    blockers,
    reason: analysis.recommendation_reason ?? analysis.raw?.recommendation_reason ?? finalPick?.market_signal ?? 'no stored reason',
  }
}

function isMarketReadyCandidate(match) {
  const analysis = getAnalysis(match) ?? {}
  const finalPick = finalPickByMatch.get(match?.id) ?? {}
  const odds = oddsByMatch.get(match?.id) ?? []
  const hasOdds = odds.length > 0 || Number(analysis.odds_rows_used ?? analysis.raw?.odds_rows_used ?? finalPick.odds_rows_used ?? 0) > 0
  const readiness = String(match?.data_readiness_status ?? analysis.raw?.data_readiness_status ?? '').toUpperCase()
  const analysisStatus = String(analysis.analysis_status ?? analysis.raw?.analysis_status ?? finalPick.analysis_status ?? '').toUpperCase()
  const validationStatus = String(analysis.data_validation_status ?? 'VALID').toUpperCase()
  const marketDataUsed = Boolean(analysis.market_data_used ?? analysis.raw?.market_data_used ?? finalPick.market_data_used)
  const marketEdge = Number(analysis.market_edge_score ?? analysis.raw?.market_edge_score ?? 0)
  const confidence = Number(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? finalPick.confidence_score ?? 0)
  const risk = normalizeRisk(analysis.risk_level ?? finalPick.risk_level)

  return hasOdds &&
    ['VALID', 'PARTIAL'].includes(validationStatus) &&
    (marketDataUsed || analysisStatus === 'MARKET_DATA_READY_RECALCULATED' || ['READY', 'PARTIAL'].includes(readiness)) &&
    marketEdge > 0 &&
    confidence >= 58 &&
    risk !== 'HIGH'
}

function isWaitingMarketData(match) {
  const analysis = getAnalysis(match) ?? {}
  const finalPick = finalPickByMatch.get(match?.id) ?? {}
  const odds = oddsByMatch.get(match?.id) ?? []
  const hasOdds = odds.length > 0 || Number(analysis.odds_rows_used ?? analysis.raw?.odds_rows_used ?? finalPick.odds_rows_used ?? 0) > 0
  return !hasOdds
}

function getRootCause({ dayMatches, dayTop10, top10StatusCounts, marketReadyCandidates, marketReadyInTop10, waitingMarketInTop10, readyButNotDisplayedCount, betFinalPickMismatchCount, staleNoMarketLockCount }) {
  if (!dayMatches.length && !dayTop10.length) return 'no_matches_today'
  if (dayTop10.length > 0 && top10StatusCounts.finishedCount === dayTop10.length) return 'all_matches_finished'
  if (waitingMarketInTop10 > 0 && marketReadyInTop10 === 0 && top10StatusCounts.finishedCount === 0) return 'waiting_market_data'
  if (!marketReadyCandidates.length) return 'no_market_ready_candidates'
  if (readyButNotDisplayedCount > 0) return 'bug_ready_not_displayed: มี market-ready candidates แต่ไม่ได้ถูกเลือกขึ้น Today'
  if (betFinalPickMismatchCount > 0) return 'bug_final_pick_mismatch: มี BET ใน analysis แต่ final pick ไม่ตรง'
  if (staleNoMarketLockCount > marketReadyCandidates.length) return 'stale_lock_issue: Top10 ถูก lock จากคู่ไม่มี market data'
  return 'ready_display_ok'
}

function buildMatchStatusCounts(matches) {
  return (matches ?? []).reduce((counts, match) => {
    const group = getMatchStatusInfo(match).group
    if (group === matchStatusGroups.upcoming) counts.upcomingCount += 1
    else if (group === matchStatusGroups.live) counts.liveCount += 1
    else if (group === matchStatusGroups.finished) counts.finishedCount += 1
    else counts.notPlayableCount += 1
    return counts
  }, {
    upcomingCount: 0,
    liveCount: 0,
    finishedCount: 0,
    notPlayableCount: 0,
  })
}

function isMarketMissingDowngrade(analysis) {
  return normalizeRecommendation(analysis.recommendation) === 'NO BET' &&
    !Boolean(analysis.market_data_used ?? analysis.raw?.market_data_used) &&
    String(analysis.analysis_status ?? analysis.raw?.analysis_status ?? '').toUpperCase().includes('MARKET')
}

function getAnalysis(match) {
  const analysis = Array.isArray(match?.analysis) ? match.analysis[0] : match?.analysis
  return analysis ?? null
}

function printCount(label, value) {
  console.log(`${label}: ${value}`)
}

function printDistribution(label, values) {
  console.log(`${label}: ${JSON.stringify(countBy(values.map((value) => value ?? 'NULL')))}`)
}

function printStats(label, values) {
  const numbers = values.map(Number).filter(Number.isFinite)
  if (!numbers.length) {
    console.log(`${label}: {"min":null,"avg":null,"max":null}`)
    return
  }
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  const avg = numbers.reduce((total, value) => total + value, 0) / numbers.length
  console.log(`${label}: ${JSON.stringify({ min: round(min), avg: round(avg), max: round(max) })}`)
}

function groupBy(rows, getKey) {
  const groups = new Map()
  for (const row of rows ?? []) {
    const key = getKey(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return groups
}

function countBy(values) {
  return values.reduce((counts, value) => {
    const key = String(value ?? 'NULL')
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function getBangkokDateKey(value) {
  if (!value) return 'unknown'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? 'NO BET').toUpperCase().replace('_', ' ')
  return ['BET', 'LEAN', 'WATCH', 'NO BET'].includes(normalized) ? normalized : 'NO BET'
}

function normalizeSignal(value) {
  const normalized = String(value ?? 'NO_SIGNAL').toUpperCase()
  return ['STRONG_SIGNAL', 'WATCH', 'SKIP'].includes(normalized) ? normalized : 'NO_SIGNAL'
}

function normalizeRisk(value) {
  const normalized = String(value ?? 'NULL').toUpperCase()
  return ['LOW', 'MEDIUM', 'HIGH'].includes(normalized) ? normalized : 'NULL'
}

function normalizePickSide(value) {
  const normalized = String(value ?? 'NONE').toUpperCase()
  return ['HOME', 'AWAY', 'DRAW'].includes(normalized) ? normalized : 'NONE'
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function formatMatch(match) {
  const home = match?.homeTeam?.name ?? 'home'
  const away = match?.awayTeam?.name ?? 'away'
  const league = match?.league?.name ?? 'unknown league'
  return `${home} vs ${away} (${league})`
}

function getSupabaseProjectRef(value) {
  try {
    return new URL(value).hostname.split('.')[0]
  } catch {
    return 'unknown'
  }
}

function formatSupabaseError(error) {
  return `${error.code ?? 'NO_CODE'} ${error.message ?? error.details ?? 'unknown error'}`
}

function round(value) {
  return Math.round(value * 10) / 10
}
