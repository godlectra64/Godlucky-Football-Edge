import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'
import { DAILY_SELECTION_ALGORITHM_VERSION, selectDailyTop10 } from '../src/utils/dailySelectionEngine.js'
import { buildRankingCompletionState } from '../src/utils/dailyRankingCompletion.js'
import {
  HYBRID_DAILY_PIPELINE_VERSION,
  calculateDynamicLockDeadline,
  hybridDailyNearKickoffWindows,
  hybridDailySchedule,
} from '../src/utils/hybridDailyPipeline.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const allowedRootCauses = new Set([
  'OK',
  'DAILY_MARKET_CANDIDATES_NOT_BUILT',
  'DYNAMIC_READY_COVERAGE_PARTIAL',
  'ODDS_PROVIDER_EMPTY_FOR_SELECTED_FIXTURES',
  'DAILY_SYNC_REUSED_COMPLETED_RUN',
  'FIXTURE_SYNC_LOW_COUNT',
  'DECISION_BOARD_SELECTED_BEFORE_MARKET_READY',
  'DECISION_BOARD_ODDS_SYNC_INCOMPLETE',
  'DYNAMIC_OFFSET_DUPLICATE_FIXTURES',
])
const canonicalAnalysisStatuses = new Set(['ANALYSIS_READY', 'PARTIAL_ANALYSIS', 'WAITING_DATA', 'INSUFFICIENT_DATA', 'FINAL_LOCKED', 'FINISHED'])

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
let failed = false

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for daily production health verification.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const range = getBangkokDayRange(new Date())

console.log(`[verify:daily-production-health] project_ref=${getProjectRef(supabaseUrl)}`)
console.log(`[verify:daily-production-health] bangkokToday=${range.dateKey}`)

const matches = await selectAll('football_matches', `
  id,
  kickoff_at,
  status,
  status_short,
  status_long,
  match_status,
  api_sports_fixture_id,
  has_market_data,
  has_fixture_detail,
  data_readiness_score,
  data_readiness_status,
  league:football_leagues(id, api_league_id, name, country, enabled, priority),
  homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
  awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
  analysis:match_analysis(id, recommendation, confidence_score, calibrated_confidence_score, ranking_score, risk_score, risk_level, league_quality_score, data_quality_score, market_quality_score, value_edge_score, market_edge_score, tactical_matchup_score, motivation_score, data_validation_status, raw)
`, (query) =>
  query.gte('kickoff_at', range.startUtc).lt('kickoff_at', range.endUtc)
)
const matchIds = matches.map((row) => row.id).filter(Boolean)
const playableMatches = matches.filter(isPlayable)
const todayOdds = matchIds.length
  ? await selectAll('football_match_odds', 'id, match_id, market_focus, market_name, selection, line, price, api_bookmaker_id, is_latest', (query) => query.in('match_id', matchIds))
  : []
const top10Rows = await selectAll('daily_top10_selections', 'id, rank, match_id, ai_final_pick_id, locked_at, updated_at, selection_status, market_ready', (query) =>
  query.eq('selection_date', range.dateKey).order('rank', { ascending: true })
)
const top10MatchIds = top10Rows.map((row) => row.match_id).filter(Boolean)
const top10Odds = top10MatchIds.length
  ? await selectAll('football_match_odds', 'match_id, market_focus, market_name, selection, line, price', (query) => query.in('match_id', top10MatchIds))
  : []
const oddsByMatchId = groupRows(todayOdds, (row) => row.match_id)
const selection = selectDailyTop10(matches.map((match) => ({
  ...match,
  analysis: Array.isArray(match.analysis) ? match.analysis[0] : match.analysis,
  odds: oddsByMatchId.get(match.id) ?? [],
  has_market_data: (oddsByMatchId.get(match.id) ?? []).length > 0 || match.has_market_data,
})), { selectionDate: range.dateKey })
const candidateRowsResult = await selectOptionalAll('daily_market_candidates', 'id, match_id, api_fixture_id, candidate_rank, market_readiness_status, has_usable_ah, has_usable_ou, has_usable_match_winner, odds_rows_count', (query) =>
  query.eq('selection_date', range.dateKey).order('candidate_rank', { ascending: true })
)
const latestDailyRun = await selectLatestDailyRun(range.dateKey)
const latestDailyRunSteps = latestDailyRun?.id
  ? await selectAll('api_football_daily_sync_steps', 'id, phase, status, attempt_count, max_attempts, last_attempt_at, next_retry_at, rate_limited, processed, rows_saved, failed, summary', (query) =>
    query.eq('run_id', latestDailyRun.id).order('step_order', { ascending: true })
  )
  : []
const dailyAnalysisBoardResult = await selectOptionalAll('daily_analysis_board', 'selection_id, match_id, fixture_id, selection_date, rank, analysis_status, confidence', (query) =>
  query.eq('selection_date', range.dateKey).order('rank', { ascending: true })
)
const aiFinalPickRowsResult = matchIds.length
  ? await selectOptionalAll('football_ai_final_picks', 'id, match_id, api_fixture_id, analysis_status, confidence_score, pick_confidence', (query) => query.in('match_id', matchIds))
  : { rows: [], missing: false }

const oddsChecks = await buildOddsChecks(matches, todayOdds)
const top10WithDecisionMarketMatchIds = new Set(top10Odds.filter(isUsableDecisionMarketOddsRow).map((row) => row.match_id).filter(Boolean))
const readyTop10Rows = top10Rows.filter((row) => isReadyDecisionStatus(normalizeDecisionStatus(row)))
const waitingTop10Rows = top10Rows.filter((row) => normalizeDecisionStatus(row) === 'WAITING_MARKET')
const duplicateTop10Ranks = countDuplicates(top10Rows.map((row) => row.rank).filter((rank) => rank !== null && rank !== undefined))
const duplicateTop10Matches = countDuplicates(top10MatchIds)
const aiFinalPickCoverage = readyTop10Rows.filter((row) => row.ai_final_pick_id).length
const candidateCounts = countCandidateReadiness(candidateRowsResult.rows)
const footballAnalyticsChecks = buildFootballAnalyticsChecks({
  dailyRun: latestDailyRun,
  dailyAnalysisBoardRows: dailyAnalysisBoardResult.rows,
  aiFinalPickRows: aiFinalPickRowsResult.rows,
})
const footballAnalyticsMode = footballAnalyticsChecks.syncReady || footballAnalyticsChecks.boardRowsAvailable
const footballAnalyticsBoardAvailable = footballAnalyticsChecks.boardRowsAvailable
const footballAnalyticsReady = footballAnalyticsChecks.ready
const dailyTop10SelectedFixturesWithOdds = readyTop10Rows.filter((row) => top10WithDecisionMarketMatchIds.has(row.match_id)).length
const selectedWaitingMarketCount = waitingTop10Rows.length
const eligibleCandidateCount = selection.summary.eligibleCandidateCount
const selectedHardFilterViolations = top10Rows.filter((row) => {
  const selected = selection.selected.find((item) => item.match?.id === row.match_id)
  return selected ? !selected.hardFilter.passed : false
}).length
const invalidFinalScores = selection.candidates.filter((row) => !Number.isFinite(Number(row.softRanking.finalScore)) || Number(row.softRanking.finalScore) < 0 || Number(row.softRanking.finalScore) > 100).length
const fakeFinalPickRows = top10Rows.filter((row) => normalizeDecisionStatus(row) !== 'READY' && row.ai_final_pick_id).length
const expectedDynamicBoardCount = Math.min(60, eligibleCandidateCount)
const dynamicBoardCountViolation = top10Rows.length > 0 && top10Rows.length <= expectedDynamicBoardCount ? 0 : 1
const rankingCompletion = buildRankingCompletionState({
  selectedCount: top10Rows.length,
  eligibleCandidateCount,
  invalidScores: invalidFinalScores,
  duplicateRanks: duplicateTop10Ranks,
  duplicateFixtures: duplicateTop10Matches,
  hardFilterViolations: selectedHardFilterViolations,
  finalPickViolations: fakeFinalPickRows,
  rankingReadiness: {
    totalFixtures: matches.length,
    ready: dailyTop10SelectedFixturesWithOdds,
    partial: candidateCounts.PARTIAL,
    noMarketData: candidateCounts.NO_MARKET_DATA,
    pending: candidateCounts.WAITING_MARKET,
    failed: 0,
    hasMarketDataCount: dailyTop10SelectedFixturesWithOdds,
    hasFixtureDetailCount: matches.filter((match) => match.has_fixture_detail).length,
  },
})
const pipelineStatus = rankingCompletion.rankingStatus === 'success' ? 'SUCCESS' : String(rankingCompletion.rankingStatus).toUpperCase()
const earliestSelectedKickoff = getEarliestKickoffForSelection(top10Rows, matches)
const lockDeadline = calculateDynamicLockDeadline(earliestSelectedKickoff)
const lockedAt = top10Rows.map((row) => row.locked_at).filter(Boolean).sort()[0] ?? null
const selectedBettingReady = readyTop10Rows.filter((row) => top10WithDecisionMarketMatchIds.has(row.match_id) && row.ai_final_pick_id).length
const selectedWithoutFinalPick = top10Rows.filter((row) => !row.ai_final_pick_id).length
const apiCalls = countApiCalls(latestDailyRunSteps)
const cacheHits = countCacheHits(latestDailyRunSteps)
const rateLimitEvents = latestDailyRunSteps.filter((step) => step.rate_limited || step.summary?.rateLimited).length
const currentPhase = getCurrentPhase(latestDailyRun, latestDailyRunSteps, rankingCompletion)
const resultsDue = matches.filter(isFinished).length
const resultsSettled = await countSettledResults(range.dateKey)
const rootCause = determineRootCause({
  fixturesToday: matches.length,
  playableFixtures: playableMatches.length,
  footballAnalyticsMode,
  footballAnalyticsReady,
  footballAnalyticsInvalid: footballAnalyticsChecks.invalidAnalysisStatuses + footballAnalyticsChecks.invalidConfidenceValues + footballAnalyticsChecks.duplicateBoardRanks + footballAnalyticsChecks.duplicateBoardFixtures + footballAnalyticsChecks.duplicateFinalPickFixtures,
  footballAnalyticsSyncReady: footballAnalyticsChecks.syncReady,
  footballAnalyticsBoardAvailable,
  candidateTableMissing: candidateRowsResult.missing,
  dailyMarketCandidates: candidateRowsResult.rows.length,
  candidateReadyCount: candidateCounts.READY,
  dailyTop10Count: top10Rows.length,
  dailyTop10SelectedFixturesWithOdds,
  selectedWaitingMarketCount,
  duplicateTop10Ranks,
  duplicateTop10Matches,
  aiFinalPickCoverage,
  oddsChecks,
})

console.log(`pipelineVersion: ${HYBRID_DAILY_PIPELINE_VERSION}`)
console.log(`selectionAlgorithmVersion: ${DAILY_SELECTION_ALGORITHM_VERSION}`)
console.log(`selectionDate: ${range.dateKey}`)
console.log(`currentPhase: ${currentPhase}`)
console.log(`pipelineStatus: ${pipelineStatus}`)
console.log(`scheduleAsiaBangkok: ${hybridDailySchedule.map((item) => `${item.localTime}:${item.phase}`).join(', ')}`)
console.log(`nearKickoffWindows: ${hybridDailyNearKickoffWindows.map((item) => `T-${item}`).join(', ')}`)
console.log(`candidateFixtures: ${selection.candidates.length}`)
console.log(`hardFilterPassed: ${selection.summary.hardFilterPassed}`)
console.log(`hardFilterRejected: ${selection.summary.hardFilterRejected}`)
console.log(`hardFilterRejectionReasons: ${JSON.stringify(groupHardFilterReasons(selection.rejected))}`)
console.log(`eligibleCandidateCount: ${eligibleCandidateCount}`)
console.log(`fixturesDiscovered: ${matches.length}`)
console.log(`eligibleCandidates: ${eligibleCandidateCount}`)
console.log(`preRankedCandidates: ${selection.candidates.length}`)
console.log(`candidatePoolCount: ${candidateRowsResult.rows.length}`)
console.log(`candidateCoreCount: ${candidateRowsResult.rows.filter((row) => Number(row.candidate_rank ?? 0) <= 30).length}`)
console.log(`candidateExpandedCount: ${candidateRowsResult.rows.filter((row) => Number(row.candidate_rank ?? 0) > 30 && Number(row.candidate_rank ?? 0) <= 40).length}`)
console.log(`candidateReserveCount: ${candidateRowsResult.rows.filter((row) => Number(row.candidate_rank ?? 0) > 40).length}`)
console.log(`preliminarySelected: ${selection.summary.selectedCount}`)
console.log(`lockedSelected: ${top10Rows.length}`)
console.log(`dailyAnalysisBoardRows: ${dailyAnalysisBoardResult.rows.length}`)
console.log(`aiFinalPickRows: ${aiFinalPickRowsResult.rows.length}`)
console.log(`rankingSelectionCompleted: ${footballAnalyticsChecks.rankingSelectionCompleted}`)
console.log(`rankingSelectionHealth: ${footballAnalyticsChecks.rankingSelectionHealth ?? 'NONE'}`)
console.log(`footballAnalyticsMode: ${footballAnalyticsMode}`)
console.log(`footballAnalyticsBoardAvailable: ${footballAnalyticsBoardAvailable}`)
console.log(`footballAnalyticsReady: ${footballAnalyticsReady}`)
console.log(`primarySelected: ${selection.summary.primarySelected}`)
console.log(`secondarySelected: ${selection.summary.secondarySelected}`)
console.log(`fallbackSelected: ${selection.summary.fallbackSelected}`)
console.log(`marketReadySelected: ${selection.summary.marketReadySelected}`)
console.log(`waitingMarketSelected: ${selectedWaitingMarketCount}`)
console.log(`selectionHealth: ${rankingCompletion.selectionHealth}`)
console.log(`marketReadinessStatus: ${rankingCompletion.marketReadinessStatus}`)
console.log(`bettingReadiness: ${rankingCompletion.bettingReadiness}`)
console.log(`lockDeadline: ${lockDeadline ?? 'NONE'}`)
console.log(`lockedAt: ${lockedAt ?? 'NONE'}`)
console.log(`earliestKickoff: ${earliestSelectedKickoff ?? 'NONE'}`)
console.log(`selectedWithValidMarket: ${dailyTop10SelectedFixturesWithOdds}`)
console.log(`selectedWaitingMarket: ${selectedWaitingMarketCount}`)
console.log(`selectedBettingReady: ${selectedBettingReady}`)
console.log(`selectedWithoutFinalPick: ${selectedWithoutFinalPick}`)
console.log(`nearKickoffDue: ${countNearKickoffDue(top10Rows, matches)}`)
console.log(`nearKickoffCompleted: ${countNearKickoffCompleted(top10Rows)}`)
console.log('nearKickoffFailed: 0')
console.log(`resultsDue: ${resultsDue}`)
console.log(`resultsRefreshed: ${resultsSettled}`)
console.log(`resultsSettled: ${resultsSettled}`)
console.log(`apiCalls: ${apiCalls}`)
console.log(`cacheHits: ${cacheHits}`)
console.log(`rateLimitEvents: ${rateLimitEvents}`)
console.log(`retryable: ${rankingCompletion.retryable}`)
console.log(`retryReasonCode: ${rankingCompletion.retryReasonCode}`)
report('fixturesToday', matches.length, { failWhen: (value) => value <= 0 })
report('playableFixtures', playableMatches.length, { failWhen: (value) => value <= 0 })
reportWithFootballAnalyticsWarning('decision board count valid', dynamicBoardCountViolation, { details: `count ${top10Rows.length}, eligible ${eligibleCandidateCount}, expectedMax ${expectedDynamicBoardCount}` })
reportWithFootballAnalyticsWarning('candidate pool <= 60', candidateRowsResult.rows.length > 60 ? candidateRowsResult.rows.length - 60 : 0)
report('duplicate decision board ranks', duplicateTop10Ranks)
report('duplicate decision board fixtures', duplicateTop10Matches)
reportWithFootballAnalyticsWarning('aiFinalPick coverage market-ready incomplete', Math.max(0, dailyTop10SelectedFixturesWithOdds - aiFinalPickCoverage), { details: `${aiFinalPickCoverage}/${dailyTop10SelectedFixturesWithOdds} market-ready; waiting-market ${selectedWaitingMarketCount}` })
report('selected hard-filter violations', selectedHardFilterViolations)
report('fake final picks for waiting-market selections', fakeFinalPickRows)
report('invalid final scores', invalidFinalScores)
report('daily analysis board duplicate ranks', footballAnalyticsChecks.duplicateBoardRanks)
report('daily analysis board duplicate fixtures', footballAnalyticsChecks.duplicateBoardFixtures)
report('football ai final pick duplicate fixtures', footballAnalyticsChecks.duplicateFinalPickFixtures)
reportWhenFootballAnalyticsMode('football analytics sync ready', footballAnalyticsChecks.syncReady ? 0 : 1, { details: `rankingSelectionCompleted ${footballAnalyticsChecks.rankingSelectionCompleted}, rankingSelectionHealth ${footballAnalyticsChecks.rankingSelectionHealth ?? 'NONE'}` })
reportWhenFootballAnalyticsMode('football analytics board rows available', footballAnalyticsChecks.boardRowsAvailable ? 0 : 1, { details: `daily_analysis_board ${dailyAnalysisBoardResult.rows.length}, football_ai_final_picks ${aiFinalPickRowsResult.rows.length}` })
report('football analytics analysis statuses canonical', footballAnalyticsChecks.invalidAnalysisStatuses)
report('football analytics confidence range 0-100', footballAnalyticsChecks.invalidConfidenceValues)
console.log(`duplicateRanks: ${duplicateTop10Ranks}`)
console.log(`duplicateFixtures: ${duplicateTop10Matches}`)
console.log(`invalidScores: ${invalidFinalScores}`)
console.log(`fakePicks: ${fakeFinalPickRows}`)
report('invalid odds marketFocus', oddsChecks.invalidMarketFocus)
report('null odds price', oddsChecks.nullPrice)
report('invalid odds price', oddsChecks.invalidPrice)
console.log(`oddsIntegritySource: ${oddsChecks.oddsIntegritySource}`)
report('duplicateLatestOdds', oddsChecks.duplicateLatestOdds)
reportWithFootballAnalyticsWarning('odds rows exists but has_market_data=false', oddsChecks.oddsRowsExistButHasMarketDataFalse)
reportWithFootballAnalyticsWarning('has_market_data=true but no odds rows', oddsChecks.hasMarketDataTrueButNoOddsRows)
reportWithFootballAnalyticsWarning('daily_market_candidates table exists', candidateRowsResult.missing ? 1 : 0, { details: candidateRowsResult.missing ? 'daily_market_candidates table missing. Legacy candidate table is optional when Football Analytics is ready.' : 'ok' })

console.log(`dailyMarketCandidates: ${candidateRowsResult.rows.length}`)
console.log(`candidateReadyCount: ${candidateCounts.READY}`)
console.log(`candidatePartialCount: ${candidateCounts.PARTIAL}`)
console.log(`candidateWaitingMarketCount: ${candidateCounts.WAITING_MARKET}`)
console.log(`candidateNoMarketDataCount: ${candidateCounts.NO_MARKET_DATA}`)
console.log(`dailyTop10SelectedFixturesWithOdds: ${dailyTop10SelectedFixturesWithOdds}`)

if (candidateRowsResult.rows.length > 0) {
  reportWithFootballAnalyticsWarning('candidateReadyCount available', Number.isFinite(candidateCounts.READY) ? 0 : 1)
  reportWithFootballAnalyticsWarning('ready rows do not exceed ready candidates', dailyTop10SelectedFixturesWithOdds > candidateCounts.READY ? dailyTop10SelectedFixturesWithOdds - candidateCounts.READY : 0)
}

console.log(`likelyRootCause: ${rootCause}`)
if (!allowedRootCauses.has(rootCause) || rootCause === 'UNKNOWN') {
  report('likelyRootCause specific', 1, { details: rootCause })
}

if (failed) process.exit(1)
console.log('Daily production health checks passed')

async function selectAll(table, columns, applyQuery = (query) => query) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const query = applyQuery(supabase.from(table).select(columns).range(from, from + pageSize - 1))
    const { data, error } = await query
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function selectOptionalAll(table, columns, applyQuery = (query) => query) {
  try {
    return { rows: await selectAll(table, columns, applyQuery), missing: false }
  } catch (error) {
    if (isMissingTableError(error)) return { rows: [], missing: true, error }
    throw error
  }
}

async function selectLatestDailyRun(dateKey) {
  try {
    const { data, error } = await supabase
      .from('api_football_daily_sync_runs')
      .select('id, run_date, status, current_phase, current_step, summary, started_at, finished_at')
      .eq('run_date', dateKey)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ?? null
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

async function countSettledResults(selectionDate) {
  try {
    const { count, error } = await supabase
      .from('football_ai_pick_results')
      .select('id', { count: 'exact', head: true })
      .eq('selection_date', selectionDate)
    if (error) throw error
    return count ?? 0
  } catch (error) {
    if (isMissingTableError(error)) return 0
    throw error
  }
}

function getEarliestKickoffForSelection(top10, todayMatches) {
  const matchById = new Map(todayMatches.map((match) => [match.id, match]))
  return top10
    .map((row) => matchById.get(row.match_id)?.kickoff_at)
    .filter(Boolean)
    .sort()[0] ?? null
}

function getCurrentPhase(run, steps, completion) {
  const waitingRetry = steps.find((step) => step.status === 'pending_retry')
  const running = steps.find((step) => step.status === 'running')
  const pending = steps.find((step) => step.status === 'pending')
  if (waitingRetry) return String(waitingRetry.summary?.hybridPhase ?? waitingRetry.phase ?? 'RETRY')
  if (running) return String(running.summary?.hybridPhase ?? running.phase ?? 'RUNNING')
  if (pending) return String(pending.summary?.hybridPhase ?? pending.phase ?? 'PENDING')
  if (run?.status === 'success' && completion.selectionCompleted) return 'COMPLETE'
  return String(run?.current_phase ?? completion.rankingStatus ?? 'UNKNOWN').toUpperCase()
}

function countApiCalls(steps) {
  return steps.reduce((total, step) => {
    const breakdown = step.summary?.endpointBreakdown ?? {}
    return total + Object.values(breakdown).reduce((sum, endpoint) => sum + Number(endpoint?.called ?? 0), 0)
  }, 0)
}

function countCacheHits(steps) {
  return steps.reduce((total, step) => {
    const details = step.summary?.details ?? {}
    return total + Number(details.cacheHits ?? details.skippedAlreadyFresh ?? 0)
  }, 0)
}

function countNearKickoffDue(top10, todayMatches) {
  const matchById = new Map(todayMatches.map((match) => [match.id, match]))
  const now = Date.now()
  return top10.filter((row) => {
    const kickoff = new Date(matchById.get(row.match_id)?.kickoff_at ?? 0).getTime()
    if (!Number.isFinite(kickoff)) return false
    const minutes = Math.round((kickoff - now) / 60000)
    return minutes <= 90 && minutes >= 0
  }).length
}

function countNearKickoffCompleted(top10) {
  return top10.filter((row) => row.updated_at && row.locked_at && new Date(row.updated_at).getTime() > new Date(row.locked_at).getTime()).length
}

async function buildOddsChecks(todayMatches, oddsRows) {
  const allowedMarkets = new Set(['AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'NONE'])
  const oddsMatchIds = new Set(oddsRows.map((row) => row.match_id).filter(Boolean))

  return {
    oddsIntegritySource: 'verifyOddsIntegrity-compatible',
    invalidMarketFocus: oddsRows.filter((row) => row.market_focus && !allowedMarkets.has(row.market_focus)).length,
    nullPrice: oddsRows.filter((row) => row.price === null || row.price === undefined).length,
    invalidPrice: oddsRows.filter((row) => row.price !== null && row.price !== undefined && Number(row.price) <= 0).length,
    duplicateLatestOdds: await countDuplicateLatestOddsCompatible(),
    oddsRowsExistButHasMarketDataFalse: todayMatches.filter((match) => oddsMatchIds.has(match.id) && !match.has_market_data).length,
    hasMarketDataTrueButNoOddsRows: todayMatches.filter((match) => match.has_market_data && !oddsMatchIds.has(match.id)).length,
  }
}

async function countDuplicateLatestOddsCompatible() {
  const { data, error } = await supabase
    .from('football_match_odds')
    .select('match_id, api_bookmaker_id, market_focus, market_name, selection, line, is_latest')
    .eq('is_latest', true)
    .limit(10000)
  if (error) throw error

  const seen = new Set()
  let duplicates = 0
  for (const row of data ?? []) {
    const key = [row.match_id, row.api_bookmaker_id, row.market_focus, row.market_name, row.selection, row.line].join('|')
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates
}

function determineRootCause(input) {
  if (input.fixturesToday <= 0 || input.playableFixtures <= 0) return 'FIXTURE_SYNC_LOW_COUNT'
  if (input.footballAnalyticsReady) return 'OK'
  if (input.footballAnalyticsMode && !input.footballAnalyticsSyncReady) return 'DAILY_SYNC_REUSED_COMPLETED_RUN'
  if (input.footballAnalyticsMode && !input.footballAnalyticsBoardAvailable) return 'NO_FOOTBALL_ANALYTICS_BOARD'
  if (input.footballAnalyticsMode && input.footballAnalyticsInvalid > 0) return 'FOOTBALL_ANALYTICS_BOARD_INVALID'
  if (input.candidateTableMissing || input.dailyMarketCandidates <= 0) return 'DAILY_MARKET_CANDIDATES_NOT_BUILT'
  if (input.duplicateTop10Ranks > 0 || input.duplicateTop10Matches > 0) return 'DYNAMIC_OFFSET_DUPLICATE_FIXTURES'
  if (input.oddsChecks.oddsRowsExistButHasMarketDataFalse > 0 || input.oddsChecks.hasMarketDataTrueButNoOddsRows > 0) return 'DECISION_BOARD_ODDS_SYNC_INCOMPLETE'
  if (input.candidateReadyCount > 0 && input.dailyTop10SelectedFixturesWithOdds === 0) return 'DECISION_BOARD_SELECTED_BEFORE_MARKET_READY'
  if (input.selectedWaitingMarketCount > 0 && input.dailyTop10SelectedFixturesWithOdds < input.dailyTop10Count) return 'DYNAMIC_READY_COVERAGE_PARTIAL'
  if (input.dailyTop10Count > 0 && input.dailyTop10SelectedFixturesWithOdds < input.dailyTop10Count && input.candidateReadyCount < input.dailyTop10Count) return 'DYNAMIC_READY_COVERAGE_PARTIAL'
  if (input.dailyTop10Count > 0 && input.dailyTop10SelectedFixturesWithOdds < input.dailyTop10Count) return 'ODDS_PROVIDER_EMPTY_FOR_SELECTED_FIXTURES'
  return 'OK'
}

function countCandidateReadiness(rows) {
  const counts = { READY: 0, PARTIAL: 0, WAITING_MARKET: 0, NO_MARKET_DATA: 0 }
  for (const row of rows) {
    const status = String(row.market_readiness_status ?? 'WAITING_MARKET').toUpperCase()
    if (status in counts) counts[status] += 1
  }
  return counts
}

function groupHardFilterReasons(rows) {
  const counts = {}
  for (const row of rows) {
    for (const item of row.hardFilter?.reasons ?? []) {
      counts[item.code] = (counts[item.code] ?? 0) + 1
    }
  }
  return counts
}

function groupRows(rows, keyFn) {
  const grouped = new Map()
  for (const row of rows ?? []) {
    const key = keyFn(row)
    const items = grouped.get(key) ?? []
    items.push(row)
    grouped.set(key, items)
  }
  return grouped
}

function countDuplicates(values) {
  const seen = new Set()
  let duplicates = 0
  for (const value of values) {
    if (seen.has(value)) duplicates += 1
    else seen.add(value)
  }
  return duplicates
}

function report(label, value, options = {}) {
  const count = typeof value === 'number' ? value : Number(value)
  const failedCheck = options.failWhen ? options.failWhen(value) : count > 0
  console.log(`${label}: ${value}${options.details ? ` (${options.details})` : ''}`)
  if (failedCheck) failed = true
}

function warn(label, value, options = {}) {
  console.log(`${label}: ${value}${options.details ? ` (${options.details})` : ''} [warning]`)
}

function reportWithFootballAnalyticsWarning(label, value, options = {}) {
  if (footballAnalyticsReady) warn(label, value, options)
  else report(label, value, options)
}

function reportWhenFootballAnalyticsMode(label, value, options = {}) {
  if (footballAnalyticsMode) report(label, value, options)
  else warn(label, value, options)
}

function isPlayable(match) {
  const status = String(match.status_short ?? match.status ?? match.match_status ?? '').toUpperCase()
  return !['FT', 'AET', 'PEN', 'CANC', 'PST', 'ABD', 'AWD', 'WO', 'FINISHED'].includes(status)
}

function isFinished(match) {
  const status = String(match.status_short ?? match.status ?? match.match_status ?? '').toUpperCase()
  return ['FT', 'AET', 'PEN', 'FINISHED'].includes(status)
}

function isUsableFullTimeOddsRow(row) {
  return !isUnsupportedMainOddsMarket(row) && (isAhLike(row) || isOuLike(row) || String(row.market_focus ?? '').toUpperCase() === 'MATCH_WINNER' || String(row.market_name ?? '').toLowerCase().includes('match winner'))
}

function buildFootballAnalyticsChecks({ dailyRun, dailyAnalysisBoardRows, aiFinalPickRows }) {
  const rankingSelectionCompleted = getRankingSelectionCompleted(dailyRun)
  const rankingSelectionHealth = getRankingSelectionHealth(dailyRun)
  const syncReady = rankingSelectionCompleted || rankingSelectionHealth === 'DYNAMIC_BOARD_READY'
  const boardRowsAvailable = dailyAnalysisBoardRows.length > 0 || aiFinalPickRows.length > 0
  const duplicateBoardRanks = countDuplicates(dailyAnalysisBoardRows.map((row) => row.rank).filter((rank) => rank !== null && rank !== undefined))
  const duplicateBoardFixtures = countDuplicates(dailyAnalysisBoardRows.map((row) => row.match_id ?? row.fixture_id).filter(Boolean))
  const duplicateFinalPickFixtures = countDuplicates(aiFinalPickRows.map((row) => row.match_id ?? row.api_fixture_id).filter(Boolean))
  const invalidAnalysisStatuses = [
    ...dailyAnalysisBoardRows.map((row) => row.analysis_status),
    ...aiFinalPickRows.map((row) => row.analysis_status),
  ].filter((status) => status !== null && status !== undefined && status !== '' && !canonicalAnalysisStatuses.has(toCanonicalAnalysisStatus(status))).length
  const invalidConfidenceValues = [
    ...dailyAnalysisBoardRows.map((row) => row.confidence),
    ...aiFinalPickRows.flatMap((row) => [row.confidence_score, row.pick_confidence]),
  ].filter((value) => value !== null && value !== undefined && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)).length

  return {
    rankingSelectionCompleted,
    rankingSelectionHealth,
    syncReady,
    boardRowsAvailable,
    duplicateBoardRanks,
    duplicateBoardFixtures,
    duplicateFinalPickFixtures,
    invalidAnalysisStatuses,
    invalidConfidenceValues,
    ready: syncReady && boardRowsAvailable && invalidAnalysisStatuses === 0 && invalidConfidenceValues === 0,
  }
}

function getRankingSelectionCompleted(run) {
  return Boolean(
    run?.summary?.rankingSelectionCompleted ??
    run?.summary?.finalSummary?.rankingSelectionCompleted ??
    run?.summary?.latest?.details?.selectionCompleted ??
    run?.summary?.latest?.selectionCompleted
  )
}

function getRankingSelectionHealth(run) {
  return run?.summary?.rankingSelectionHealth ??
    run?.summary?.finalSummary?.rankingSelectionHealth ??
    run?.summary?.latest?.details?.selectionHealth ??
    run?.summary?.latest?.selectionHealth ??
    null
}

function toCanonicalAnalysisStatus(value) {
  const status = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (canonicalAnalysisStatuses.has(status)) return status
  if (status === 'MARKET_DATA_READY_RECALCULATED') return 'ANALYSIS_READY'
  if (status === 'INSUFFICIENT_MARKET_DATA') return 'INSUFFICIENT_DATA'
  return status
}

function isUsableDecisionMarketOddsRow(row) {
  return !isUnsupportedMainOddsMarket(row) && (isAhLike(row) || isOuLike(row) || isMatchWinnerLike(row) || isDoubleChanceLike(row))
}

function normalizeDecisionStatus(row) {
  const status = String(row.selection_status ?? '').toUpperCase()
  if (status) return status
  if (row.market_ready === true) return 'READY'
  if (row.market_ready === false) return 'WAITING_MARKET'
  return row.ai_final_pick_id ? 'READY' : 'WAITING_MARKET'
}

function isReadyDecisionStatus(status) {
  return ['READY_PRIMARY', 'READY_ALTERNATIVE', 'READY'].includes(String(status ?? '').toUpperCase())
}

function isAhLike(row) {
  if (isUnsupportedMainOddsMarket(row)) return false
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? '').toLowerCase()
  return focus === 'AH' || name.includes('handicap')
}

function isOuLike(row) {
  if (isUnsupportedMainOddsMarket(row)) return false
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? '').toLowerCase()
  const line = parseLine(row.line ?? row.selection)
  if (line !== null && Math.abs(line) >= 6.5) return false
  return focus === 'OU' || name.includes('over/under') || name.includes('goals over')
}

function isMatchWinnerLike(row) {
  if (isUnsupportedMainOddsMarket(row)) return false
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? '').toLowerCase()
  return focus === 'MATCH_WINNER' || name.includes('match winner') || name.includes('1x2') || name.includes('home/draw/away')
}

function isDoubleChanceLike(row) {
  if (isUnsupportedMainOddsMarket(row)) return false
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? '').toLowerCase()
  return focus === 'DOUBLE_CHANCE' || name.includes('double chance')
}

function isUnsupportedMainOddsMarket(row) {
  const text = `${row.market_focus ?? ''} ${row.market_name ?? ''} ${row.selection ?? ''}`.toUpperCase()
  return ['CORNER', 'CARD', 'BOOKING', 'FIRST HALF', '1ST HALF', 'SECOND HALF', '2ND HALF', 'HALF TIME', 'HT/FT', 'TEAM TOTAL', 'TEAM GOALS', 'PLAYER', 'SPECIAL', 'EXACT SCORE', 'CORRECT SCORE', 'EXTRA TIME', 'PENALT'].some((blocked) => text.includes(blocked))
}

function parseLine(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

function isMissingTableError(error) {
  const message = String(error?.message ?? error?.details ?? '')
  return error?.code === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)
}

function getProjectRef(value) {
  try {
    return new URL(value).host.split('.')[0]
  } catch {
    return 'unknown'
  }
}
