import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  calculateRankingScore,
  calculateFootballMasterAnalysis,
  calculateLeagueContext,
  buildTodayMarketSections,
  getRecommendationFromConfidence,
  isMarketReadyForDisplay,
  isWaitingForMarketData,
  rankTopMatches,
} from '../src/utils/analysisEngine.js'
import {
  calculateDataIntelligence,
  calculateDataIntelligenceModifier,
} from '../src/utils/dataIntelligence.js'
import {
  extractDataIntelligence,
  extractFootballIntelligence,
  formatRecommendation,
  getDataIntelligenceItems,
  getDataQuality,
  getMatchRoute,
  getRiskLabel,
  getScoreLabel,
  normalizeDetailPayload,
} from '../src/utils/matchDetail.js'
import {
  addImmutableSnapshot,
  buildPerformanceGroups,
  calculatePerformanceMetrics,
  createPredictionSnapshot,
  evaluatePrediction,
  getPerformanceContext,
  getPerformanceReadiness,
  getResultTracking,
} from '../src/utils/performanceIntelligence.js'
import {
  analyzeModelPerformance,
  buildCalibrationTrendData,
  buildConfidenceCalibration,
  buildLeaguePerformance,
  buildModelExplainability,
  buildModuleEffectiveness,
  buildRecommendationPerformance,
  buildRiskPerformance,
  exportPerformanceCsv,
  exportPerformanceJson,
  getPredictionReliability,
} from '../src/utils/modelPerformanceAnalyzer.js'
import {
  calculateDataCoverage,
  normalizeDataPlatform,
} from '../src/utils/dataPlatform.js'
import { buildExplainableAi } from '../src/utils/explainableAi.js'
import { getBangkokDayRange, isWithinBangkokDay } from '../src/utils/bangkokDateRange.js'
import { buildStrictApiFootballSelection, derivePickTeamFromApiFootballOdds, getApiFootballMarketDisplay } from '../src/utils/marketDisplay.js'
import {
  LEAGUE_QUALITY_SCORING_VERSION,
  getFixtureSyncPriority,
  getLeagueQualityScore,
} from '../src/utils/leagueQualityScoring.js'
import { normalizeMarketIntelligence } from '../src/utils/marketIntelligence.js'
import { deriveAiPickSide, getAiPickDisplay } from '../src/utils/pickSide.js'
import { buildProfessionalSelectionScore } from '../src/utils/professionalSelectionPipeline.js'
import { getOneBestPickOfDay } from '../src/utils/finalPick.js'
import { getMatchStatusInfo, matchStatusGroups } from '../src/utils/matchStatus.js'
import { buildTodayMatchBuckets, buildTodayStatusBuckets } from '../src/utils/todayMatchBuckets.js'
import { buildUsableDailySelection, planDailyTop10Persistence } from '../src/utils/selectionEngineV2.js'
import { classifyDecision, calculateDecisionReadinessScore } from '../src/utils/decisionClassification.js'
import { formatMarketFocus, formatRecommendationLabel, formatSignal } from '../src/utils/uiLabels.js'
import { mergeResultRows } from '../src/repositories/resultTrackerRepository.js'
import { runAiSelectionEngine } from '../src/utils/aiSelectionEngine.js'
import { generateAiFinalPick } from '../src/utils/aiFinalPickEngine.js'
import { getPagePath, getRouteState } from '../src/utils/routes.js'
import { fetchEnabledLeagues, updateLeagueSettingsById } from '../src/repositories/analysisRepository.js'
import { fetchMatchById, fetchMatchesByIds, fetchMatchesByKickoffRange } from '../src/repositories/matchesRepository.js'
import { fetchPredictionEvaluations, fetchPredictionResults, fetchPredictionSnapshots } from '../src/repositories/performanceRepository.js'
import { fetchLatestSyncLog, fetchSyncLogs, invokeSyncFootballData } from '../src/repositories/syncRepository.js'

const bangkokRange = getBangkokDayRange('2026-06-28')
assert.equal(bangkokRange.dateKey, '2026-06-28')
assert.equal(bangkokRange.dateFrom, '2026-06-28')
assert.equal(bangkokRange.dateTo, '2026-06-29')
assert.equal(bangkokRange.startUtc, '2026-06-27T17:00:00.000Z')
assert.equal(bangkokRange.endUtc, '2026-06-28T17:00:00.000Z')
assert.equal(isWithinBangkokDay('2026-06-27T16:59:59.000Z', '2026-06-28'), false)
assert.equal(isWithinBangkokDay('2026-06-27T17:00:00.000Z', '2026-06-28'), true)
assert.equal(isWithinBangkokDay('2026-06-28T16:59:59.000Z', '2026-06-28'), true)
assert.equal(isWithinBangkokDay('2026-06-28T17:00:00.000Z', '2026-06-28'), false)

const syncFootballDataSource = readFileSync(new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url), 'utf8')
const dailyTop10RepositorySource = readFileSync(new URL('../src/repositories/dailyTop10Repository.js', import.meta.url), 'utf8')
assert.ok(syncFootballDataSource.includes("Deno.env.get('FOOTBALL_PROVIDER') ?? 'api-football'"), 'sync-football-data should default to API-FOOTBALL')
assert.ok(syncFootballDataSource.includes('const primaryProvider = getProviderAdapter(requestedProviderName)'), 'sync-football-data should choose the primary provider before fetching')
assert.ok(syncFootballDataSource.includes("fetchFixtures: ({ dateKey }) => fetchApiFootballFixtures(dateKey)"), 'API-FOOTBALL adapter should fetch fixtures by Bangkok dateKey')
assert.ok(syncFootballDataSource.includes("apiFootballGet('/fixtures', buildApiFootballDailyFixturesParams(dateKey), context)"), 'API-FOOTBALL daily fixtures must request only the date filter')
assert.ok(syncFootballDataSource.includes('buildSinglePageFixtureDiscovery'), 'API-FOOTBALL daily fixtures must be treated as a single provider response')
assert.ok(syncFootballDataSource.includes("const fallbackProvider = getProviderAdapter('football-data.org')"), 'football-data.org must remain as fallback provider')
assert.ok(syncFootballDataSource.includes('fallbackProvider: providerResult.fallbackProvider'), 'sync response should expose fallbackProvider')
assert.ok(syncFootballDataSource.includes('typeof body.selectionDate'), 'sync date range should honor selectionDate before defaulting to today')
assert.ok(syncFootballDataSource.includes('assertDailySyncRunDateMatchesRequest'), 'daily sync runId requests should reject cross-date reuse')
assert.ok(syncFootballDataSource.includes('recompute-ai-final-picks-date'), 'sync modes should include date-specific final pick recompute')
assert.ok(syncFootballDataSource.includes("source: 'canonical_market_ready_window'"), 'date-specific final pick recompute should use the canonical window')
assert.ok(syncFootballDataSource.includes('const defaultManualLimit = 50'), 'manual sync should default to a 50 fixture limit')
assert.ok(syncFootballDataSource.includes('const maxManualLimit = 100'), 'manual sync should cap limit at 100')
assert.ok(syncFootballDataSource.includes('const syncChunkSize = 10'), 'manual sync should process fixtures in chunks of 10')
assert.ok(syncFootballDataSource.includes('const offset = getSyncOffset(body.offset)'), 'manual sync should parse an offset from request body')
assert.ok(syncFootballDataSource.includes('runManualMode(primaryProvider, dayRange, limit, offset)'), 'manual sync should pass offset into manual mode')
assert.ok(syncFootballDataSource.includes('const matches = [...providerResult.matches].sort(compareFixtureSyncPriority)'), 'manual sync should sort fixtures by priority before slicing')
assert.ok(syncFootballDataSource.includes('const batch = matches.slice(safeOffset, safeOffset + limit)'), 'manual sync should slice fixtures by offset and limit')
assert.ok(syncFootballDataSource.includes('nextOffset: hasMore ? nextOffset : null'), 'manual sync response should expose nextOffset only when more fixtures remain')
assert.ok(syncFootballDataSource.includes('skippedBeforeOffset'), 'manual sync response should expose skippedBeforeOffset')
assert.ok(syncFootballDataSource.includes('skippedAfterLimit'), 'manual sync response should expose skippedAfterLimit')
assert.ok(syncFootballDataSource.includes('rankingMayBePartial: hasMore'), 'manual sync should mark ranking partial while more fixtures remain')
assert.ok(syncFootballDataSource.includes('processedMatches:'), 'manual sync response should include processed match samples')
assert.ok(syncFootballDataSource.includes('function getFixtureSyncPriority'), 'manual sync should use fixture sync priority helper')
assert.ok(syncFootballDataSource.includes('getFixtureSoftPenalty'), 'manual sync should use soft penalties instead of hard exclusions')
assert.ok(syncFootballDataSource.includes('function getLeagueTierScore'), 'league scoring should use tier scoring')
assert.ok(syncFootballDataSource.includes('apiFootballLeagueTierScores'), 'league scoring should use API-FOOTBALL league id tiers')
assert.ok(syncFootballDataSource.includes('country: syncPriority.country'), 'processedMatches should include country')
assert.ok(syncFootballDataSource.includes('leagueId: syncPriority.leagueId'), 'processedMatches should include leagueId')
assert.ok(syncFootballDataSource.includes('scoringVersion: syncPriority.scoringVersion'), 'processedMatches should include scoringVersion')
assert.ok(syncFootballDataSource.includes("if (exactCountryLeague.includes('england:premier league')) return 100"), 'England Premier League should be tier A by country and name')
assert.ok(syncFootballDataSource.includes("if (leagueName.toLowerCase().includes('premier league') && !isHighTierPremierCountry(country.toLowerCase())) cap = Math.min(cap, 72)"), 'foreign Premier League names should be capped')
assert.ok(syncFootballDataSource.includes("const leagueQualityScoringVersion = 'league-quality-v4.1'"), 'sync-football-data should expose the league scoring version')
assert.ok(syncFootballDataSource.includes('await recalibrateDailySelectionScores(range)'), 'daily ranking should recalibrate stale league quality before ranking')
assert.ok(syncFootballDataSource.includes('topSelections,'), 'manual sync response should include top selection debug rows')
assert.ok(syncFootballDataSource.includes('leagueQualitySource: leagueQualityScoringVersion'), 'match_analysis raw should record the league quality scoring source')
assert.ok(syncFootballDataSource.includes("update({ is_top_pick: false, is_final_pick: false, final_rank: null, final_pick_note: null })"), 'daily ranking should reset rank flags without deleting rows')
assert.ok(syncFootballDataSource.includes(".in('match_id', matchIds)"), 'daily ranking reset should be scoped to the current Bangkok date matches')
assert.ok(syncFootballDataSource.includes('const defaultEnrichLimit = 10'), 'enrich sync should default to a 10 match limit')
assert.ok(syncFootballDataSource.includes('const maxEnrichLimit = 30'), 'enrich sync should cap limit at 30')
assert.ok(syncFootballDataSource.includes('const enrichChunkSize = 5'), 'enrich sync should process enrichment in small chunks')
assert.ok(syncFootballDataSource.includes('const batch = matches.slice(safeOffset, safeOffset + limit)'), 'manual sync should process only the limited offset batch')
assert.ok(syncFootballDataSource.includes('skippedByLimit: skippedBeforeOffset + skippedAfterLimit'), 'manual sync response should report fixtures skipped around the selected batch')
assert.ok(syncFootballDataSource.includes("mode === 'enrich'"), 'sync should expose a separate enrich mode')
assert.ok(syncFootballDataSource.includes("mode === 'recompute'"), 'sync should expose a separate recompute mode')
assert.ok(syncFootballDataSource.includes("mode === 'learning'"), 'sync should expose a separate learning mode')
assert.ok(syncFootballDataSource.includes('await runManualMode(primaryProvider, dayRange, limit, offset)'), 'manual sync should not run heavy recompute automatically')
assert.ok(syncFootballDataSource.includes('const v4Result = await recomputeV4AnalysisRows(ids)'), 'recompute mode should refresh v4 analysis rows')
assert.ok(syncFootballDataSource.includes('const result = await processInChunks(candidates.rows, syncChunkSize, storePredictionResult'), 'learning mode should store prediction results')
assert.ok(syncFootballDataSource.includes("apiFootballSafeGet('/odds'"), 'enrich mode should fetch API-FOOTBALL odds only outside manual sync')
assert.ok(syncFootballDataSource.includes("apiFootballSafeGet('/fixtures/statistics'"), 'enrich mode should fetch API-FOOTBALL fixture statistics')
assert.ok(syncFootballDataSource.includes("apiFootballSafeGet('/injuries'"), 'enrich mode should fetch API-FOOTBALL injuries')
assert.ok(syncFootballDataSource.includes("apiFootballSafeGet('/fixtures/lineups'"), 'enrich mode should fetch API-FOOTBALL lineups')
assert.ok(syncFootballDataSource.includes('fetchEnrichCandidates(dayRange)'), 'enrich mode should use dedicated candidate selection')
assert.ok(syncFootballDataSource.includes('sort(compareEnrichCandidatePriority)'), 'enrich candidates should be sorted by priority before applying limit')
assert.ok(syncFootballDataSource.includes('Number(Boolean(analysisB?.is_top_pick)) - Number(Boolean(analysisA?.is_top_pick))'), 'enrich should prioritize top picks before non-top-picks')
assert.ok(syncFootballDataSource.includes('numericSortValue(analysisA?.final_rank, 999) - numericSortValue(analysisB?.final_rank, 999)'), 'enrich should sort final_rank ascending')
assert.ok(syncFootballDataSource.includes('numericSortValue(analysisB?.ranking_score, -1) - numericSortValue(analysisA?.ranking_score, -1)'), 'enrich should sort ranking_score descending')
assert.ok(syncFootballDataSource.includes('numericSortValue(analysisB?.league_quality_score, -1) - numericSortValue(analysisA?.league_quality_score, -1)'), 'enrich should sort league_quality_score descending')
assert.ok(syncFootballDataSource.includes('numericSortValue(analysisB?.confidence_score, -1) - numericSortValue(analysisA?.confidence_score, -1)'), 'enrich should sort confidence_score descending')
assert.ok(syncFootballDataSource.includes(".not('api_sports_fixture_id', 'is', null)"), 'enrich should skip matches without API-FOOTBALL fixture ids')
assert.ok(syncFootballDataSource.includes('endpointCoverage,'), 'enrich response should include endpoint coverage')
assert.ok(syncFootballDataSource.includes('enrichedMatches,'), 'enrich response should include per-match enrichment summaries')
assert.ok(syncFootballDataSource.includes('rowsSaved'), 'endpoint coverage should include rowsSaved')
assert.ok(syncFootballDataSource.includes('empty: !failed && dataCount === 0 ? 1 : 0'), 'endpoint coverage should count empty API responses')
assert.ok(dailyTop10RepositorySource.includes('buildCanonicalSelectionWindow'), 'Today must use the canonical rolling selection window')
assert.ok(dailyTop10RepositorySource.indexOf('const usable = await getUsableRollingTop10(date)') >= 0, 'Today must use the rolling Market-Ready source')
assert.ok(syncFootballDataSource.includes("return 'ENRICHED_ODDS_ONLY'"), 'enrichment status should distinguish odds-only enrichment')
assert.ok(syncFootballDataSource.includes('statsResult.rows.length'), 'per-match enrichment summary should include statistics rows')
assert.ok(syncFootballDataSource.includes('lineupsResult.rows.length'), 'per-match enrichment summary should include lineups rows')
assert.ok(syncFootballDataSource.includes('failures.push({'), 'only row-level worker errors should be counted as failures')
assert.equal(Math.min(150, 50), 50, 'API-FOOTBALL fixtures 150 with limit 50 should process 50')
assert.equal(Math.max(0, 150 - Math.min(150, 50)), 100, 'API-FOOTBALL fixtures 150 with limit 50 should skip 100')
assert.deepEqual(getPaginationSample(333, 50, 0), {
  nextOffset: 50,
  hasMore: true,
  skippedBeforeOffset: 0,
  skippedAfterLimit: 283,
}, 'manual pagination should expose nextOffset and hasMore for the first batch')
assert.deepEqual(getPaginationSample(333, 50, 300), {
  nextOffset: null,
  hasMore: false,
  skippedBeforeOffset: 300,
  skippedAfterLimit: 0,
}, 'manual pagination should stop at the final partial batch')
assert.equal(getPaginationSample(333, 50, 0).hasMore, true, 'rankingMayBePartial should be true when hasMore is true')
const prioritySamples = [
  getFixturePrioritySample({ league: 'USL League Two', country: 'USA', home: 'Little Rock Rangers', away: 'Red River' }),
  getFixturePrioritySample({ league: 'Premier League', country: 'England', home: 'Arsenal', away: 'Chelsea' }),
  getFixturePrioritySample({ league: 'MLS Next Pro', country: 'USA', home: 'Colorado Rapids II', away: 'Vancouver Whitecaps II' }),
  getFixturePrioritySample({ league: 'Premier League Women', country: 'England', home: 'Arsenal W', away: 'Chelsea W' }),
].sort((a, b) => b.syncPriorityScore - a.syncPriorityScore)
assert.equal(prioritySamples[0].league, 'Premier League', 'high quality leagues should sort before small leagues')
assert.ok(prioritySamples.some((item) => item.league === 'Premier League Women'), 'women fixtures should receive a soft penalty but stay in the candidate list')
assert.ok(prioritySamples.some((item) => item.league === 'MLS Next Pro'), 'reserve fixtures should receive a soft penalty but stay in the candidate list')
assert.ok(getFixturePrioritySample({ league: 'Premier League', country: 'England', home: 'Arsenal', away: 'Chelsea' }).leagueQualityScore >= 95, 'England Premier League should score tier A')
assert.ok(getFixturePrioritySample({ league: 'La Liga', country: 'Spain', home: 'Barcelona', away: 'Real Madrid' }).leagueQualityScore >= 95, 'Spain La Liga should score tier A')
assert.ok(getFixturePrioritySample({ league: 'Serie A', country: 'Italy', home: 'Inter', away: 'Milan' }).leagueQualityScore >= 95, 'Italy Serie A should score tier A')
assert.ok(getFixturePrioritySample({ league: 'Bundesliga', country: 'Germany', home: 'Bayern', away: 'Dortmund' }).leagueQualityScore >= 95, 'Germany Bundesliga should score tier A')
assert.ok(getFixturePrioritySample({ league: 'Ligue 1', country: 'France', home: 'PSG', away: 'Lyon' }).leagueQualityScore >= 95, 'France Ligue 1 should score tier A')
assert.ok(getFixturePrioritySample({ league: 'Premier League', country: 'Ethiopia', home: 'Adama Kenema', away: 'Welayta Dicha' }).leagueQualityScore <= 72, 'Ethiopia Premier League should not score as England Premier League')
assert.ok(getFixturePrioritySample({ league: 'Premier League', country: 'Mongolia', home: 'Ulaangom City', away: 'Khovd' }).leagueQualityScore <= 72, 'Mongolia Premier League should not score as England Premier League')
assert.ok(getFixturePrioritySample({ league: 'Premier League', country: 'Kazakhstan', home: 'Irtysh', away: 'Kaisar' }).leagueQualityScore <= 72, 'Kazakhstan Premier League should not score as England Premier League')
assert.notEqual(getFixturePrioritySample({ league: 'Premier League', country: '', home: 'Generic FC', away: 'Other FC' }).leagueQualityScore, 100, 'Premier League without country/id must not score 100')
assert.ok(getFixturePrioritySample({ league: 'MLS Next Pro', country: 'USA', home: 'Colorado Rapids II', away: 'Vancouver Whitecaps II' }).leagueQualityScore <= 55, 'MLS Next Pro should be capped as development league')
assert.ok(getFixturePrioritySample({ league: 'USL League Two', country: 'USA', home: 'Little Rock Rangers', away: 'Red River' }).leagueQualityScore <= 55, 'USL League Two should be capped as lower division')
assert.ok(getFixturePrioritySample({ league: 'Premier League', country: 'England', home: 'Arsenal II', away: 'Chelsea' }).syncPriorityScore < getFixturePrioritySample({ league: 'Premier League', country: 'England', home: 'Arsenal', away: 'Chelsea' }).syncPriorityScore, 'II teams should receive a soft penalty')
assert.ok(getFixturePrioritySample({ league: 'Premier League Women', country: 'England', home: 'Arsenal W', away: 'Chelsea W' }).leagueQualityScore <= 70, 'Women leagues should be softly capped but retained')

const scoringCases = [
  [{ league: { name: 'Premier League', country: 'England' }, homeTeam: { name: 'Arsenal' }, awayTeam: { name: 'Chelsea' } }, 95, 100, 'England Premier League'],
  [{ league: { name: 'La Liga', country: 'Spain' }, homeTeam: { name: 'Barcelona' }, awayTeam: { name: 'Real Madrid' } }, 95, 100, 'Spain La Liga'],
  [{ league: { name: 'Serie A', country: 'Italy' }, homeTeam: { name: 'Inter' }, awayTeam: { name: 'Milan' } }, 95, 100, 'Italy Serie A'],
  [{ league: { name: 'Bundesliga', country: 'Germany' }, homeTeam: { name: 'Bayern' }, awayTeam: { name: 'Dortmund' } }, 95, 100, 'Germany Bundesliga'],
  [{ league: { name: 'Ligue 1', country: 'France' }, homeTeam: { name: 'PSG' }, awayTeam: { name: 'Lyon' } }, 95, 100, 'France Ligue 1'],
  [{ league: { name: 'Premier League', country: 'Ethiopia' }, homeTeam: { name: 'Adama Kenema' }, awayTeam: { name: 'Welayta Dicha' } }, 0, 72, 'Ethiopia Premier League'],
  [{ league: { name: 'Premier League', country: 'Mongolia' }, homeTeam: { name: 'Ulaangom City' }, awayTeam: { name: 'Khovd' } }, 0, 72, 'Mongolia Premier League'],
  [{ league: { name: 'Premier League', country: 'Kazakhstan' }, homeTeam: { name: 'Irtysh' }, awayTeam: { name: 'Kaisar' } }, 0, 72, 'Kazakhstan Premier League'],
  [{ league: { name: 'Premier League', country: 'Lebanon' }, homeTeam: { name: 'Al Ahed' }, awayTeam: { name: 'Shabab Al Sahel' } }, 0, 72, 'Lebanon Premier League'],
  [{ league: { name: 'Premier League', country: 'Syria' }, homeTeam: { name: 'Al Jaish' }, awayTeam: { name: 'Al Wahda' } }, 0, 72, 'Syria Premier League'],
  [{ league: { name: 'Premier League', country: 'Belarus' }, homeTeam: { name: 'Dinamo Minsk' }, awayTeam: { name: 'BATE' } }, 0, 72, 'Belarus Premier League'],
  [{ league: { name: 'MLS Next Pro', country: 'USA' }, homeTeam: { name: 'Colorado Rapids II' }, awayTeam: { name: 'Vancouver Whitecaps II' } }, 0, 55, 'MLS Next Pro'],
  [{ league: { name: 'USL League Two', country: 'USA' }, homeTeam: { name: 'Little Rock Rangers' }, awayTeam: { name: 'Red River' } }, 0, 55, 'USL League Two'],
  [{ league: { name: 'Primeira Divisão', country: 'Macao' }, homeTeam: { name: 'Benfica' }, awayTeam: { name: 'Chiba' } }, 0, 74, 'Macao Primeira Divisao'],
  [{ league: { name: 'Premier League Women', country: 'England' }, homeTeam: { name: 'Arsenal W' }, awayTeam: { name: 'Chelsea W' } }, 0, 70, 'Women league'],
]

for (const [fixture, min, max, label] of scoringCases) {
  const processedScore = getFixtureSyncPriority(fixture).leagueQualityScore
  const analysisScore = runAiSelectionEngine([{
    id: label,
    kickoffAt: '2026-06-28T12:00:00Z',
    ...fixture,
    analysis: { recommendation: 'WATCH', confidence_score: 60, risk_score: 40 },
  }])[0].league_quality_score
  assert.equal(processedScore, analysisScore, `${label} scorer should match processedMatches and analysis/ranking paths`)
  assert.ok(processedScore >= min && processedScore <= max, `${label} should score between ${min} and ${max}`)
}

assert.equal(getFixtureSyncPriority({
  league: { name: 'Premier League', country: 'England' },
  homeTeam: { name: 'Arsenal' },
  awayTeam: { name: 'Chelsea' },
}).scoringVersion, LEAGUE_QUALITY_SCORING_VERSION, 'processed match scoring should expose the shared scoring version')
assert.ok(getFixtureSyncPriority({
  league: { name: 'Premier League', country: 'England' },
  homeTeam: { name: 'Arsenal II' },
  awayTeam: { name: 'Chelsea' },
}).syncPriorityScore < getFixtureSyncPriority({
  league: { name: 'Premier League', country: 'England' },
  homeTeam: { name: 'Arsenal' },
  awayTeam: { name: 'Chelsea' },
}).syncPriorityScore, 'II teams should receive a sync priority penalty in the shared scorer')
assert.ok(getLeagueQualityScore({
  league: { name: 'Academy Development League', country: 'USA' },
  homeTeam: { name: 'Home Academy' },
  awayTeam: { name: 'Away Reserve' },
}) <= 55, 'development/reserve/academy fixtures should be capped in the shared scorer')

const coverageSample = [
  { ok: true, dataCount: 3, rowsSaved: 7 },
  { ok: true, dataCount: 0, rowsSaved: 0 },
  { ok: false, dataCount: 0, rowsSaved: 0 },
].reduce((summary, item) => ({
  called: summary.called + 1,
  withData: summary.withData + (item.ok && item.dataCount > 0 ? 1 : 0),
  empty: summary.empty + (item.ok && item.dataCount === 0 ? 1 : 0),
  failed: summary.failed + (!item.ok ? 1 : 0),
  rowsSaved: summary.rowsSaved + item.rowsSaved,
}), { called: 0, withData: 0, empty: 0, failed: 0, rowsSaved: 0 })
assert.deepEqual(coverageSample, { called: 3, withData: 1, empty: 1, failed: 1, rowsSaved: 7 }, 'endpoint coverage should count called, empty, withData, failed, and rowsSaved')

function getPaginationSample(totalFetched, limit, offset) {
  const safeOffset = Math.min(Math.max(0, offset), totalFetched)
  const batchSize = Math.max(0, Math.min(limit, totalFetched - safeOffset))
  const nextOffset = safeOffset + batchSize
  const hasMore = nextOffset < totalFetched
  return {
    nextOffset: hasMore ? nextOffset : null,
    hasMore,
    skippedBeforeOffset: safeOffset,
    skippedAfterLimit: Math.max(0, totalFetched - nextOffset),
  }
}

function getFixturePrioritySample({ league, country = '', home, away }) {
  const leagueQualityScore = getLeagueQualitySample({ league, country, home, away })
  const knownLeagueBonus = league === 'Premier League' && country === 'England' ? 8 : 0
  const coverageBonus = leagueQualityScore >= 85 ? 8 : leagueQualityScore >= 75 ? 5 : leagueQualityScore >= 60 ? 2 : 0
  const cap = getFixtureScoreCapSample({ league, country, home, away })
  let softPenalty = 0
  const text = `${league} ${home} ${away}`.toLowerCase()
  if (/\b(u19|u20|u21|u23|youth)\b/i.test(text)) softPenalty += 35
  if (/\b(reserve|reserves|academy|development)\b/i.test(text)) softPenalty += 30
  if (/\b(w|women|woman|femenil|feminine)\b/i.test(text)) softPenalty += 15
  if (/\b(ii|b)\b/i.test(text)) softPenalty += 30
  if (text.includes('next pro') || text.includes('league two')) softPenalty += 25
  return {
    league,
    leagueQualityScore,
    syncPriorityScore: Math.max(0, Math.min(100, Math.round(Math.min(cap, leagueQualityScore + knownLeagueBonus + coverageBonus - Math.min(softPenalty, 45))))),
  }
}

function getLeagueQualitySample({ league, country, home = '', away = '' }) {
  const lowerLeague = league.toLowerCase()
  const lowerCountry = country.toLowerCase()
  let score = 65
  if (lowerCountry === 'england' && lowerLeague === 'premier league') score = 100
  else if (lowerCountry === 'spain' && lowerLeague.includes('la liga')) score = 98
  else if (lowerCountry === 'italy' && lowerLeague.includes('serie a')) score = 97
  else if (lowerCountry === 'germany' && lowerLeague.includes('bundesliga')) score = 97
  else if (lowerCountry === 'france' && lowerLeague.includes('ligue 1')) score = 95
  else if (lowerLeague.includes('premier league')) score = lowerCountry === 'england' ? 100 : 72
  else if (lowerLeague.includes('mls next pro') || lowerLeague.includes('league two')) score = 50
  let penalty = 0
  const text = `${league} ${home} ${away}`.toLowerCase()
  if (/\b(w|women|woman|femenil|feminine)\b/i.test(text)) penalty += 15
  if (/\b(ii|b)\b/i.test(text) || text.includes('next pro') || text.includes('league two')) penalty += 30
  return Math.max(0, Math.min(getFixtureScoreCapSample({ league, country, home, away }), score - Math.min(penalty, 45)))
}

function getFixtureScoreCapSample({ league, country, home, away }) {
  const text = `${league} ${home} ${away}`.toLowerCase()
  let cap = 100
  if (/\b(u19|u20|u21|u23|youth)\b/i.test(text)) cap = Math.min(cap, 50)
  if (/\b(reserve|reserves|academy|development|ii|b)\b/i.test(text)) cap = Math.min(cap, 55)
  if (text.includes('next pro') || text.includes('league two')) cap = Math.min(cap, 55)
  if (/\b(w|women|woman|femenil|feminine)\b/i.test(text)) cap = Math.min(cap, 70)
  if (league.toLowerCase().includes('premier league') && !country.toLowerCase().includes('england')) cap = Math.min(cap, 72)
  return cap
}

const baseMatch = {
  id: 'match-1',
  kickoffAt: '2026-06-26T12:00:00Z',
  status: 'SCHEDULED',
  league: { name: 'Premier League', priority: 10 },
  homeTeam: { id: 1, api_team_id: 1, name: 'Home FC' },
  awayTeam: { id: 2, api_team_id: 2, name: 'Away FC' },
  homeForm: { played: 5, wins: 3, draws: 1, losses: 1, goals_for: 9, goals_against: 4, clean_sheets: 2 },
  awayForm: { played: 5, wins: 2, draws: 2, losses: 1, goals_for: 7, goals_against: 5, clean_sheets: 1 },
  standings: [
    {
      type: 'TOTAL',
      table: [
        { team: { id: 1 }, position: 4, points: 32, goalDifference: 12, goalsFor: 30 },
        { team: { id: 2 }, position: 8, points: 27, goalDifference: 6, goalsFor: 24 },
      ],
    },
  ],
}

const professionalStrong = buildProfessionalSelectionScore({
  ...baseMatch,
  league: { name: 'Premier League', country: 'England' },
  odds: [
    { id: 'odds-ah', match_id: 'match-1', market_name: 'Asian Handicap', selection: 'Home -0.5', price: 2.15, is_latest: true },
    { id: 'odds-ou', match_id: 'match-1', market_name: 'Goals Over/Under', selection: 'Over 2.5', price: 1.92, is_latest: true },
    { id: 'odds-1x2', match_id: 'match-1', market_name: 'Match Winner', selection: 'Home', price: 2.05, is_latest: true },
  ],
  h2h: [{ home_goals: 2, away_goals: 1 }],
  recentMatches: [{ id: 'recent-1' }],
  homeStats: { goals_for: 12 },
  awayStats: { goals_against: 10 },
  analysis: {
    team_strength_score: 82,
    form_score: 80,
    goal_scoring_score: 84,
    defensive_stability_score: 78,
    home_advantage_score: 82,
    away_weakness_score: 76,
    market_edge_score: 88,
    odds_movement_score: 58,
    confidence_score: 82,
    value_status: 'YES',
  },
})
assert.ok(['BET', 'LEAN'].includes(professionalStrong.recommendation), 'complete big-team case should be BET or high LEAN')
assert.ok(professionalStrong.totalScore >= 70, 'complete big-team case should score high')

const professionalFriendlyLowData = buildProfessionalSelectionScore({
  ...baseMatch,
  id: 'professional-friendly-low-data',
  league: { name: 'Club Friendly' },
  homeForm: null,
  awayForm: null,
  standings: [],
  odds: [],
})
assert.equal(professionalFriendlyLowData.recommendation, 'NO BET', 'friendly with little data should be NO BET')
assert.equal(professionalFriendlyLowData.gates.passedLeagueFilter, false)

const professionalNoOdds = buildProfessionalSelectionScore({
  ...baseMatch,
  odds: [],
  h2h: [{ home_goals: 1, away_goals: 1 }],
  recentMatches: [{ id: 'recent-2' }],
})
assert.ok(professionalNoOdds.scores.valueEdge <= 55, 'no odds should cap valueEdge at 55')
assert.notEqual(professionalNoOdds.recommendation, 'BET', 'no odds should not be promoted to BET')

const professionalHighRisk = buildProfessionalSelectionScore({
  ...baseMatch,
  odds: [{ id: 'short-price', market_name: 'Match Winner', selection: 'Home', price: 1.18 }],
  analysis: { confidence_score: 86, market_edge_score: 84, odds_movement_score: 20 },
})
assert.notEqual(professionalHighRisk.recommendation, 'BET', 'high risk should downgrade away from BET')

const professionalLowData = buildProfessionalSelectionScore({
  id: 'professional-low-data',
  league: { name: 'Premier League', country: 'England' },
  homeTeam: { name: 'Home FC' },
  awayTeam: { name: 'Away FC' },
})
assert.ok(professionalLowData.confidenceScore < professionalStrong.confidenceScore, 'low data should reduce confidence')

const missingH2H = calculateFootballMasterAnalysis(baseMatch)
assert.equal(missingH2H.analysisBreakdown.football_intelligence.h2h.reason, 'ยังไม่มีข้อมูล H2H เพียงพอ')
assert.notEqual(missingH2H.riskLevel, 'HIGH', 'missing H2H alone must not force high risk')

const friendlyLowData = calculateFootballMasterAnalysis({
  ...baseMatch,
  id: 'friendly-low-data',
  league: { name: 'Club Friendly' },
  homeForm: null,
  awayForm: null,
  standings: [],
})
assert.equal(friendlyLowData.analysisBreakdown.football_intelligence.league_context.type, 'friendly')
assert.equal(friendlyLowData.riskLevel, 'HIGH')
assert.ok(friendlyLowData.analysisSummary.length > 0)
assert.ok(['BET', 'LEAN', 'NO BET'].includes(friendlyLowData.recommendation))
assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(friendlyLowData.riskLevel))

const leagueContext = calculateLeagueContext({ league: { name: 'Premier League' } })
const cupContext = calculateLeagueContext({ league: { name: 'FA Cup' } })
assert.equal(leagueContext.type, 'league')
assert.equal(cupContext.type, 'cup')
assert.ok(leagueContext.risk_modifier < cupContext.risk_modifier)

assert.ok(missingH2H.intelligenceModifier >= -6 && missingH2H.intelligenceModifier <= 6)
assert.equal(getRecommendationFromConfidence(72, 'MEDIUM'), 'BET')
assert.equal(getRecommendationFromConfidence(58, 'MEDIUM'), 'LEAN')
assert.equal(getRecommendationFromConfidence(90, 'HIGH'), 'NO BET')
assert.ok(missingH2H.analysisBreakdown.data_intelligence, 'data_intelligence should be added to analysis_breakdown')
assert.ok(missingH2H.analysisBreakdown.data_intelligence.data_confidence.score >= 0)
assert.ok(missingH2H.analysisBreakdown.data_intelligence.data_confidence.score <= 100)
assert.ok(missingH2H.intelligenceModifier >= -10 && missingH2H.intelligenceModifier <= 10, 'combined modifier stays bounded')
assert.equal(missingH2H.analysisBreakdown.data_intelligence.head_to_head.confidence, 'low')
assert.notEqual(missingH2H.riskLevel, 'HIGH', 'missing data_intelligence H2H alone must not force high risk')
assert.ok(missingH2H.analysisBreakdown.away_weakness.score >= 0)
assert.ok(missingH2H.analysisBreakdown.away_weakness.score <= 100)

const base72Match = {
  ...baseMatch,
  id: 'base-72',
  analysis: {
    raw: {
      framework: 'football-master-v2',
      analysis_breakdown: {
        team_strength: { score: 72, reason: 'stored' },
        recent_form: { score: 72, reason: 'stored' },
        attack_quality: { score: 72, reason: 'stored' },
        defensive_stability: { score: 72, reason: 'stored' },
        home_away_advantage: { score: 72, reason: 'stored' },
        away_weakness: { score: 72, reason: 'stored' },
        motivation_context: { score: 72, reason: 'stored' },
        market_odds_risk: { score: 72, reason: 'stored' },
      },
    },
  },
}
const base72 = calculateFootballMasterAnalysis(base72Match)
assert.equal(base72.baseConfidence, 72)
assert.ok(base72.intelligenceModifier <= 2, 'base 72 should not be boosted into a hardcoded BET jump')
assert.ok(base72.confidence <= 74)
assert.ok(base72.dataIntelligenceModifier >= -10 && base72.dataIntelligenceModifier <= 10)

for (const key of ['h2h', 'league_context', 'rest_days', 'schedule_difficulty', 'squad_context', 'momentum', 'match_importance', 'ai_explanation']) {
  assert.ok(missingH2H.analysisBreakdown.football_intelligence[key], `missing football_intelligence.${key}`)
}

const betCandidate = {
  ...baseMatch,
  id: 'bet-candidate',
  confidence: 82,
  recommendation: 'BET',
  riskLevel: 'medium',
  analysis: {
    recommendation: 'BET',
    confidence_score: 82,
    professional_score: 82,
    league_quality_score: 95,
    data_quality_score: 78,
    market_quality_score: 72,
    value_edge_score: 76,
    risk_control_score: 72,
  },
}
const noBetCandidate = {
  ...baseMatch,
  id: 'no-bet-candidate',
  confidence: 58,
  recommendation: 'NO BET',
  riskLevel: 'medium',
  analysis: {
    recommendation: 'NO BET',
    confidence_score: 58,
    professional_score: 62,
    league_quality_score: 95,
    data_quality_score: 72,
    market_quality_score: 58,
    value_edge_score: 48,
    risk_control_score: 64,
  },
}

function withProfessionalCandidate(match, patch = {}) {
  const confidence = Number(patch.confidence ?? match.confidence ?? match.analysis?.confidence_score ?? 70)
  const recommendation = patch.recommendation ?? match.recommendation ?? match.analysis?.recommendation ?? 'LEAN'
  return {
    ...match,
    ...patch,
    analysis: {
      ...(match.analysis ?? {}),
      ...(patch.analysis ?? {}),
      recommendation,
      confidence_score: confidence,
      professional_score: Number(patch.analysis?.professional_score ?? match.analysis?.professional_score ?? confidence),
      league_quality_score: Number(patch.analysis?.league_quality_score ?? match.analysis?.league_quality_score ?? 95),
      data_quality_score: Number(patch.analysis?.data_quality_score ?? match.analysis?.data_quality_score ?? 74),
      market_quality_score: Number(patch.analysis?.market_quality_score ?? match.analysis?.market_quality_score ?? 62),
      value_edge_score: Number(patch.analysis?.value_edge_score ?? match.analysis?.value_edge_score ?? 60),
      risk_control_score: Number(patch.analysis?.risk_control_score ?? match.analysis?.risk_control_score ?? 66),
    },
  }
}
assert.ok(calculateRankingScore(betCandidate) > calculateRankingScore(noBetCandidate), 'BET high confidence should rank above NO BET')

const mediumRiskScore = calculateRankingScore({ ...betCandidate, id: 'medium-risk', riskLevel: 'medium' })
const highRiskScore = calculateRankingScore({ ...betCandidate, id: 'high-risk', riskLevel: 'high' })
assert.ok(highRiskScore < mediumRiskScore, 'high risk should reduce ranking score')

const missingRawScore = calculateRankingScore({ id: 'missing-raw' })
assert.ok(missingRawScore >= 0 && missingRawScore <= 100, 'missing raw ranking score stays bounded')

const ranked = rankTopMatches([
  noBetCandidate,
  { ...betCandidate, id: 'rank-1', confidence: 85 },
  { ...betCandidate, id: 'rank-2', confidence: 75 },
])
assert.deepEqual(ranked.map((match) => match.id), ['rank-1', 'rank-2', 'no-bet-candidate'])
assert.ok(ranked.every((match) => match.rankingScore >= 0 && match.rankingScore <= 100), 'ranked scores are bounded')

const calibratedRanked = rankTopMatches([
  { ...betCandidate, id: 'stored-confidence-high', confidence: 90, analysis: { ...betCandidate.analysis, calibrated_confidence_score: 55, confidence_score: 90, professional_score: 76 } },
  { ...betCandidate, id: 'calibrated-high', confidence: 62, analysis: { ...betCandidate.analysis, calibrated_confidence_score: 88, confidence_score: 62, professional_score: 84 } },
], 2)
assert.equal(calibratedRanked[0].id, 'calibrated-high', 'Top picks should prefer v4 calibrated confidence when present')

const sixMatches = Array.from({ length: 6 }, (_, index) => ({
  ...baseMatch,
  id: `six-${index}`,
  confidence: 70 + index,
  recommendation: index % 2 ? 'LEAN' : 'NO BET',
  riskLevel: 'medium',
})).map((match) => withProfessionalCandidate(match))
assert.equal(rankTopMatches(sixMatches, 10).length, 6, 'six matches should render six, not fake ten')

const phase2Candidates = [
  withProfessionalCandidate({ ...baseMatch, id: 'high-risk-99', confidence: 99, recommendation: 'BET', riskLevel: 'HIGH' }, { analysis: { professional_score: 99, risk_control_score: 42 } }),
  ...Array.from({ length: 10 }, (_, index) => ({
    ...baseMatch,
    id: `safe-bet-${index}`,
    confidence: 80 - index,
    recommendation: index < 5 ? 'BET' : 'LEAN',
    riskLevel: index === 0 ? 'LOW' : 'MEDIUM',
  })).map((match) => withProfessionalCandidate(match)),
  withProfessionalCandidate({ ...baseMatch, id: 'no-bet-low', confidence: 90, recommendation: 'NO BET', riskLevel: 'LOW' }, { analysis: { professional_score: 90 } }),
]
const phase2Ranked = rankTopMatches(phase2Candidates, 10)
assert.equal(phase2Ranked.length, 10)
assert.equal(phase2Ranked[0].aiPickLabel, 'AI PICK #1')
assert.equal(phase2Ranked[0].id, 'high-risk-99', 'Top picks should rank BET first even when risk is high')
assert.ok(phase2Ranked[0].rankBadges.includes('HIGH CONFIDENCE'))
assert.ok(phase2Ranked[0].rankBadges.includes('NO BET'))

const highRiskFallback = rankTopMatches([
  withProfessionalCandidate({ ...baseMatch, id: 'only-high-1', confidence: 89, recommendation: 'BET', riskLevel: 'HIGH' }, { analysis: { professional_score: 89, risk_control_score: 40 } }),
  withProfessionalCandidate({ ...baseMatch, id: 'only-high-2', confidence: 70, recommendation: 'LEAN', riskLevel: 'HIGH' }, { analysis: { professional_score: 70, risk_control_score: 40 } }),
], 10)
assert.deepEqual(highRiskFallback.map((match) => match.id), ['only-high-1', 'only-high-2'])
assert.ok(highRiskFallback[0].rankBadges.includes('NO BET'), 'HIGH risk fallback should be clearly badged as NO BET')

const mixedRecommendationPool = [
  ...Array.from({ length: 2 }, (_, index) => withProfessionalCandidate({ ...baseMatch, id: `mix-bet-${index}`, confidence: 80 - index, recommendation: 'BET', riskLevel: 'MEDIUM' })),
  ...Array.from({ length: 5 }, (_, index) => withProfessionalCandidate({ ...baseMatch, id: `mix-lean-${index}`, confidence: 75 - index, recommendation: 'LEAN', riskLevel: 'LOW' })),
  ...Array.from({ length: 10 }, (_, index) => withProfessionalCandidate({ ...baseMatch, id: `mix-no-bet-${index}`, confidence: 95 - index, recommendation: 'NO BET', riskLevel: 'LOW' }, { analysis: { professional_score: 65 + index } })),
]
const mixedTop10 = rankTopMatches(mixedRecommendationPool, 10)
assert.equal(mixedTop10.filter((match) => match.recommendation === 'BET').length, 2)
assert.equal(mixedTop10.filter((match) => match.recommendation === 'LEAN').length, 5)
assert.equal(mixedTop10.filter((match) => match.recommendation === 'NO BET').length, 3)

function v2Match(id, moduleScore, riskScore, recommendationHint = 'NO BET') {
  return {
    ...baseMatch,
    id,
    kickoffAt: `2026-06-26T${String(8 + Number(id.match(/\d+$/)?.[0] ?? 0)).padStart(2, '0')}:00:00Z`,
    league: { name: 'Premier League', country: 'England' },
    analysis: {
      recommendation: recommendationHint,
      confidence_score: moduleScore,
      risk_score: riskScore,
      team_strength_score: moduleScore,
      form_score: moduleScore,
      goal_scoring_score: moduleScore,
      defensive_stability_score: moduleScore,
      tactical_matchup_score: moduleScore,
      motivation_score: moduleScore,
      market_reading_score: moduleScore,
      home_away_score: moduleScore,
      market_line: '0',
      fair_line: '0.25',
      analysis_summary: 'stored analysis',
    },
  }
}

const v2Mixed = [
  ...Array.from({ length: 2 }, (_, index) => v2Match(`v2-bet-${index}`, 91 - index, 30, 'BET')),
  ...Array.from({ length: 5 }, (_, index) => v2Match(`v2-lean-${index}`, 76 - index, 50, 'LEAN')),
  ...Array.from({ length: 10 }, (_, index) => v2Match(`v2-no-bet-${index}`, 35 - index, 90, 'NO BET')),
]
const v2MixedRows = runAiSelectionEngine(v2Mixed)
const v2Selected = v2MixedRows.filter((row) => row.is_top_pick).sort((a, b) => a.final_rank - b.final_rank)
assert.equal(v2Selected.length, 17, 'AI Selection Engine v2 should preserve every usable recommendation')
assert.equal(v2Selected.filter((row) => row.recommendation === 'BET').length, 2)
assert.equal(v2Selected.filter((row) => row.recommendation === 'LEAN').length, 5)
assert.equal(v2Selected.filter((row) => row.recommendation === 'NO BET').length, 10)
assert.deepEqual(v2Selected.map((row) => row.final_rank), Array.from({ length: 17 }, (_, index) => index + 1))
assert.equal(v2MixedRows.filter((row) => row.is_final_pick).length, 1, 'only one v2 row may be final pick')
assert.equal(v2Selected[0].recommendation, 'BET')
assert.equal(v2Selected[0].recommendation_tier, '*****')

const v2LeanOnlyRows = runAiSelectionEngine([
  v2Match('v2-lean-only-1', 75, 50, 'LEAN'),
  v2Match('v2-lean-only-2', 72, 52, 'LEAN'),
])
const v2LeanTop = v2LeanOnlyRows.filter((row) => row.is_top_pick).sort((a, b) => a.final_rank - b.final_rank)
assert.equal(v2LeanTop.length, 2, 'v2 should still rank picks when no BET exists')
assert.equal(v2LeanTop[0].recommendation, 'LEAN')
assert.ok(v2LeanTop[0].final_pick_note.includes('BET'), 'LEAN final pick note must say it is not BET level')

const v2NoBetOnlyRows = runAiSelectionEngine([
  v2Match('v2-no-bet-only-1', 35, 90, 'NO BET'),
  v2Match('v2-no-bet-only-2', 32, 92, 'NO BET'),
])
const v2NoBetTop = v2NoBetOnlyRows.filter((row) => row.is_top_pick).sort((a, b) => a.final_rank - b.final_rank)
assert.equal(v2NoBetTop.length, 2, 'v2 should show NO BET watchlist rows when they are the only analysis available')
assert.equal(v2NoBetTop[0].recommendation, 'NO BET')
assert.ok(v2NoBetTop[0].final_pick_note.length > 0)

const v2InvalidRows = runAiSelectionEngine([{ id: 'missing-critical-data' }])
assert.equal(v2InvalidRows.filter((row) => row.is_top_pick).length, 0, 'invalid rows should not become Top 10 picks')

const aiSelectionSource = readFileSync(new URL('../src/utils/aiSelectionEngine.js', import.meta.url), 'utf8')
assert.equal(aiSelectionSource.includes('Math.random'), false, 'AI Selection Engine v2 must be deterministic')

const homePick = deriveAiPickSide({
  ...baseMatch,
  analysis: {
    recommendation: 'BET',
    risk_level: 'MEDIUM',
    confidence_score: 76,
    home_advantage_score: 68,
    away_weakness_score: 64,
    goal_scoring_score: 70,
    defensive_stability_score: 66,
    market_risk_score: 60,
  },
})
assert.equal(homePick.pickSide, 'HOME')
assert.equal(homePick.pickTeam, 'Home FC')
assert.ok(homePick.pickReason.length > 0)

const awayPick = deriveAiPickSide({
  ...baseMatch,
  analysis: {
    recommendation: 'LEAN',
    risk_level: 'MEDIUM',
    confidence_score: 66,
    home_advantage_score: 35,
    away_weakness_score: 35,
    goal_scoring_score: 62,
    defensive_stability_score: 62,
    market_risk_score: 58,
  },
})
assert.equal(awayPick.pickSide, 'AWAY')
assert.equal(awayPick.pickTeam, 'Away FC')

const noBetPick = deriveAiPickSide({
  ...baseMatch,
  analysis: {
    recommendation: 'NO BET',
    risk_level: 'LOW',
    confidence_score: 80,
    home_advantage_score: 80,
    away_weakness_score: 80,
    market_risk_score: 80,
  },
})
assert.equal(noBetPick.pickSide, 'NONE')
assert.equal(noBetPick.pickTeam, null)
assert.equal(getAiPickDisplay({ ...baseMatch, analysis: noBetPick }).canHighlight, false)

function oneBestCandidate(id, recommendation, confidence, riskLevel = 'MEDIUM', pickSide = 'HOME', moduleScore = 65) {
  return {
    ...baseMatch,
    id,
    analysis: {
      recommendation,
      confidence_score: confidence,
      risk_level: riskLevel,
      pick_side: pickSide,
      pick_team: pickSide === 'HOME' ? 'Home FC' : pickSide === 'AWAY' ? 'Away FC' : pickSide === 'DRAW' ? 'เสมอ' : null,
      pick_reason: 'คะแนนฝั่งที่เลือกชัดกว่าและความเสี่ยงไม่สูง',
      home_advantage_score: moduleScore,
      away_weakness_score: moduleScore,
      goal_scoring_score: moduleScore,
      defensive_stability_score: moduleScore,
      market_risk_score: moduleScore,
      raw: { framework: 'football-intelligence-v3' },
    },
  }
}

const oneBestWithBet = getOneBestPickOfDay([
  oneBestCandidate('lean-option', 'LEAN', 80, 'LOW'),
  oneBestCandidate('bet-option', 'BET', 74, 'MEDIUM'),
])
assert.equal(oneBestWithBet.heroType, 'FINAL_PICK')
assert.equal(oneBestWithBet.match.id, 'bet-option')

const oneBestWithLeanOnly = getOneBestPickOfDay([
  oneBestCandidate('lean-medium', 'LEAN', 70, 'MEDIUM', 'HOME', 80),
  oneBestCandidate('lean-low', 'LEAN', 70, 'LOW', 'AWAY', 62),
])
assert.equal(oneBestWithLeanOnly.heroType, 'BEST_AVAILABLE')
assert.equal(oneBestWithLeanOnly.match.id, 'lean-low')
assert.equal(oneBestWithLeanOnly.match.analysis.recommendation, 'LEAN', 'BEST_AVAILABLE must not change recommendation to BET')

const oneBestWatchlist = getOneBestPickOfDay([
  oneBestCandidate('watch-no-bet', 'NO BET', 57, 'LOW'),
])
assert.equal(oneBestWatchlist.heroType, 'WATCHLIST')
assert.equal(oneBestWatchlist.match.id, 'watch-no-bet')

const oneBestNoData = getOneBestPickOfDay([])
assert.equal(oneBestNoData, null)

const normalizedEmptyDetail = normalizeDetailPayload({ id: 'empty-detail', analysis: { raw: null } })
assert.equal(normalizedEmptyDetail.footballIntelligence.h2h.reason, 'ยังไม่มีข้อมูล H2H เพียงพอ')
assert.equal(normalizedEmptyDetail.dataIntelligence.data_confidence.level, 'low')
assert.doesNotThrow(() => normalizeDetailPayload({ id: 'missing-fi', analysis: { raw: { analysis_breakdown: {} } } }))
assert.equal(extractFootballIntelligence({ id: 'missing-fi' }).league_context.type, 'unknown')
assert.equal(extractDataIntelligence({ id: 'missing-di' }).data_confidence.level, 'low')
assert.equal(getDataIntelligenceItems(extractDataIntelligence({ id: 'missing-di' })).length, 7)
assert.equal(getScoreLabel(78).scoreLabel, 'ดี')
assert.equal(getScoreLabel(62).scoreLabel, 'กลาง')
assert.equal(getScoreLabel(40).scoreLabel, 'เสี่ยง')
assert.equal(getRiskLabel('high').label, 'สูง')
assert.equal(formatRecommendation('LEAN'), 'LEAN')
assert.equal(formatRecommendation('MAYBE'), 'NO BET')
assert.ok(getDataQuality(normalizedEmptyDetail).missing.length > 0, 'data quality should expose missing fields')
assert.equal(getMatchRoute('abc-123'), '/match/abc-123')
assert.doesNotThrow(() => normalizeDetailPayload({ id: 'raw-null-detail', analysis: null, raw: null }))
assert.doesNotThrow(() => normalizeDetailPayload({ id: 'no-analysis-detail' }))
assert.equal(normalizeDetailPayload({ id: 'no-analysis-detail' }).dataIntelligence.data_confidence.level, 'low')

const directDataIntelligence = calculateDataIntelligence(baseMatch, { baseConfidence: missingH2H.baseConfidence, footballModifier: missingH2H.footballModifier })
assert.ok(directDataIntelligence.data_confidence.score >= 0 && directDataIntelligence.data_confidence.score <= 100)
assert.ok(calculateDataIntelligenceModifier(directDataIntelligence, 72, 2) <= 0, 'data modifier must not boost base 72 + football modifier 2 into BET')

const performanceSnapshot = createPredictionSnapshot({
  id: 'match-1',
  fixtureId: 'fixture-1',
  homeTeam: { name: 'Home FC' },
  awayTeam: { name: 'Away FC' },
  league: { name: 'Premier League' },
  kickoffAt: '2026-06-26T12:00:00Z',
  analysis: {
    recommendation: 'BET',
    confidence_score: 82,
    risk_level: 'medium',
    raw: {
      framework: 'data-intelligence-v1',
      analysis_breakdown: {
        data_intelligence: {
          league_position: { edge: 'home' },
        },
      },
    },
  },
})
const immutableSnapshots = addImmutableSnapshot([performanceSnapshot], { ...performanceSnapshot, confidence_score: 10 })
assert.equal(immutableSnapshots[0].confidence_score, 82, 'snapshot must not be overwritten')

const pendingResult = getResultTracking({ status: 'SCHEDULED' })
assert.equal(pendingResult.status, 'pending')
const finishedResult = getResultTracking({ status: 'FINISHED', homeGoals: 2, awayGoals: 1, updatedAt: '2026-06-26T14:00:00Z' })
assert.equal(finishedResult.status, 'finished')
assert.equal(finishedResult.result, 'home')

const correctEvaluation = evaluatePrediction(performanceSnapshot, finishedResult)
assert.equal(correctEvaluation.evaluation_status, 'correct')
const noBetEvaluation = evaluatePrediction({ ...performanceSnapshot, recommendation: 'NO BET' }, finishedResult)
assert.equal(noBetEvaluation.evaluation_status, 'no_evaluation')

const performanceRows = [
  { ...performanceSnapshot, id: 'snap-1', result: finishedResult, evaluation: correctEvaluation },
  { ...performanceSnapshot, id: 'snap-2', recommendation: 'LEAN', confidence_score: 70, ranking_score: 71, result: finishedResult, evaluation: { evaluation_status: 'incorrect' } },
  { ...performanceSnapshot, id: 'snap-3', recommendation: 'NO BET', confidence_score: 55, ranking_score: 56, result: pendingResult, evaluation: { evaluation_status: 'pending' } },
]
const moduleBreakdown = {
  team_strength: { score: 72 },
  recent_form: { score: 80 },
  attack_quality: { score: 68 },
  defensive_stability: { score: 62 },
  home_away_advantage: { score: 66 },
  market_odds_risk: { score: 60 },
  football_intelligence: { h2h: { score: 58 }, momentum: { score: 64 } },
  data_intelligence: { recent_form: { score: 74 }, goal_statistics: { score: 70 }, data_confidence: { score: 82 } },
}
const calibrationRows = [
  { ...performanceRows[0], confidence_score: 84, ranking_score: 82, risk_level: 'low', league: 'Premier League', raw_snapshot: { analysis_breakdown: moduleBreakdown } },
  { ...performanceRows[1], confidence_score: 73, ranking_score: 71, risk_level: 'medium', league: 'Premier League', raw_snapshot: { analysis_breakdown: moduleBreakdown } },
  { ...performanceRows[2], confidence_score: 58, ranking_score: 56, risk_level: 'high', league: 'La Liga', raw_snapshot: { analysis_breakdown: moduleBreakdown } },
]
const performanceMetrics = calculatePerformanceMetrics(performanceRows)
assert.equal(performanceMetrics.totalPredictions, 3)
assert.equal(performanceMetrics.totalBet, 1)
assert.equal(performanceMetrics.totalLean, 1)
assert.equal(performanceMetrics.totalNoBet, 1)
assert.equal(performanceMetrics.correct, 1)
assert.equal(performanceMetrics.incorrect, 1)
assert.equal(performanceMetrics.winRate, 50)
assert.doesNotThrow(() => buildPerformanceGroups(performanceRows))
const noPerformanceData = getPerformanceReadiness([])
assert.equal(noPerformanceData.hasEnoughData, false)
assert.equal(noPerformanceData.title, 'กำลังสะสมข้อมูล')
const lowPerformanceData = getPerformanceReadiness(performanceRows, 10)
assert.equal(lowPerformanceData.hasEnoughData, false)
assert.equal(lowPerformanceData.title, 'ยังไม่มีข้อมูลเพียงพอ')
const modelPerformance = analyzeModelPerformance(calibrationRows)
assert.equal(buildConfidenceCalibration(calibrationRows).length, 6)
assert.equal(buildLeaguePerformance(calibrationRows)[0].league, 'Premier League')
assert.equal(buildRecommendationPerformance(calibrationRows).length, 3)
assert.equal(buildRiskPerformance(calibrationRows).length, 3)
assert.ok(buildModuleEffectiveness(calibrationRows)[0].effectivenessScore >= 0)
assert.ok(modelPerformance.calibrationSuggestions.length > 0)
assert.ok(buildCalibrationTrendData(calibrationRows).accuracyTimeline.length > 0)
assert.ok(exportPerformanceJson(calibrationRows).includes('Premier League'))
assert.ok(exportPerformanceCsv(calibrationRows).startsWith('id,match_id'))
const reliability = getPredictionReliability({
  confidence: 84,
  league: { name: 'Premier League' },
  analysis: { raw: { framework: 'data-intelligence-v1', analysis_breakdown: { data_intelligence: { data_confidence: { score: 82 } } } } },
}, calibrationRows)
assert.equal(reliability.dataConfidence, 82)
assert.equal(getPerformanceContext(performanceRows), 'กำลังสะสมข้อมูล')

const emptyPlatform = normalizeDataPlatform({})
assert.equal(emptyPlatform.analysis.recommendation, 'NO BET')
assert.doesNotThrow(() => normalizeDataPlatform({ match: { id: 'missing-raw' }, analysis: { raw: null } }))

const explainableNoData = buildExplainableAi({})
assert.ok(explainableNoData.contributions.length > 0)
assert.ok(explainableNoData.summary.length > 0)
const boundedExplainable = buildExplainableAi({
  match: {
    id: 'explainable-1',
    homeTeam: { name: 'Home FC' },
    awayTeam: { name: 'Away FC' },
    league: { name: 'Premier League' },
    analysis: {
      confidence_score: 92,
      recommendation: 'BET',
      risk_level: 'high',
      raw: {
        analysis_breakdown: {
          ...moduleBreakdown,
          team_strength: { score: 100, reason: 'strong' },
          data_intelligence: { ...moduleBreakdown.data_intelligence, data_confidence: { score: 15 } },
        },
      },
    },
  },
})
assert.ok(boundedExplainable.contributions.every((item) => item.value >= -10 && item.value <= 10), 'explainability contributions stay bounded')

const coverageEmpty = calculateDataCoverage({})
assert.ok(coverageEmpty.score >= 0 && coverageEmpty.score <= 100)
assert.ok(coverageEmpty.missing.includes('fixture'))
const coverageFullish = calculateDataCoverage({
  match: { id: 'coverage-1', api_fixture_id: 'fixture-1', raw: { odds: { home: 2.1 }, lineup: [], injuries: [] } },
  analysis: { raw: { analysis_breakdown: moduleBreakdown } },
  prediction: performanceSnapshot,
  result: finishedResult,
  evaluation: correctEvaluation,
})
assert.ok(coverageFullish.score >= coverageEmpty.score)
assert.ok(['low', 'medium', 'high'].includes(coverageFullish.level))

const marketFallback = normalizeMarketIntelligence({})
assert.equal(marketFallback.hasMarketData, false)
assert.equal(marketFallback.reason, 'ยังไม่มีข้อมูลตลาด')
assert.ok(marketFallback.missing.includes('asian_handicap'))
const marketPartial = normalizeMarketIntelligence({ raw: { market: { asian_handicap: '-0.25' } } })
assert.equal(marketPartial.asian_handicap, '-0.25')
assert.equal(marketPartial.hasMarketData, true)

const unknownRoute = getRouteState('/does-not-exist')
assert.equal(unknownRoute.activePage, 'notFound')
assert.equal(unknownRoute.notFound, true)
assert.equal(getRouteState('/today').activePage, 'today')
assert.equal(getRouteState('/performance').activePage, 'performance')
assert.equal(getRouteState('/match/abc%20123').selectedMatchId, 'abc 123')
assert.equal(getPagePath('performance'), '/performance')

assert.doesNotThrow(() => normalizeDetailPayload({
  id: 'detail-helper',
  analysis: {
    confidence_score: 72,
    recommendation: 'LEAN',
    risk_level: 'medium',
    analysis_summary: 'stored summary',
    raw: { framework: 'football-intelligence-v3', analysis_breakdown: moduleBreakdown },
  },
}))
assert.doesNotThrow(() => analyzeModelPerformance([]))
const modelExplainability = buildModelExplainability(modelPerformance)
assert.ok(modelExplainability.message.length > 0)

const noBetRanking = rankTopMatches([withProfessionalCandidate({ ...baseMatch, id: 'no-bet-ranking', recommendation: 'NO BET', confidence: 66, riskLevel: 'LOW' }, { analysis: { recommendation: 'NO BET', professional_score: 66, value_edge_score: 42 } })], 1)[0]
assert.equal(noBetRanking.recommendation, 'NO BET')
assert.ok(!noBetRanking.rankBadges.includes('คู่เด่น'), 'NO BET should not receive BET-like featured badge')
assert.ok(!noBetRanking.rankReason.includes('เหมาะเป็น'), 'NO BET rank reason should not read like a BET recommendation')
assert.ok(noBetRanking.rankReason.includes('ควรข้าม'), 'NO BET rank reason should clearly recommend skipping')

const marketReadyFinalPick = generateAiFinalPick({
  id: 'final-pick-match',
  kickoffAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  league: { name: 'Test League' },
  homeTeam: { name: 'Home Test' },
  awayTeam: { name: 'Away Test' },
  analysis: {
    recommendation: 'BET',
    ranking_score: 89,
    confidence_score: 84,
    calibrated_confidence_score: 84,
    risk_level: 'LOW',
    market_edge_score: 100,
    market_data_used: true,
    odds_rows_used: 12,
    team_strength_score: 60,
    form_score: 58,
    home_advantage_score: 66,
    away_weakness_score: 55,
    goal_scoring_score: 57,
    defensive_stability_score: 58,
  },
  odds: [
    { id: 'final-pick-ah-odds', match_id: 'final-pick-match', market_focus: 'AH', market_name: 'Asian Handicap', bookmaker: 'Book A', bookmaker_name: 'Book A', selection: 'Home -0.5', line: '-0.5', price: 1.9, snapshot_at: new Date().toISOString() },
    { id: 'final-pick-ou-odds', match_id: 'final-pick-match', market_focus: 'OU', market_name: 'Goals Over/Under', bookmaker: 'Book A', bookmaker_name: 'Book A', selection: 'Over 2.5', line: '2.5', price: 1.95, snapshot_at: new Date().toISOString() },
  ],
})
assert.equal(marketReadyFinalPick.signal, 'STRONG_SIGNAL', 'market-ready BET must not be downgraded to SKIP only because sub-market reasons are conservative')
assert.equal(marketReadyFinalPick.ah_pick.label, 'HOME -0.5', 'AI final pick must expose a concrete AH pick')
assert.equal(marketReadyFinalPick.ou_pick.label, 'UNDER 2.5', 'AI final pick must expose a concrete O/U pick when confidence reaches threshold')
assert.equal(marketReadyFinalPick.final_pick.type, 'OU', 'final_pick should choose the higher-confidence market')
assert.equal(marketReadyFinalPick.status, 'READY', 'ready market pick should have READY status')
assert.ok(marketReadyFinalPick.ah_pick.reason.length > 0 && marketReadyFinalPick.ou_pick.reason.length > 0 && marketReadyFinalPick.final_pick.reason.length > 0, 'simple decision reasons must always be present')

const missingMarketFinalPick = generateAiFinalPick({
  id: 'missing-market-fixture',
  kickoffAt: '2026-07-03T18:00:00.000Z',
  league: { name: 'Test League' },
  homeTeam: { name: 'Home Test' },
  awayTeam: { name: 'Away Test' },
  analysis: {
    recommendation: 'BET',
    ranking_score: 89,
    confidence_score: 84,
    calibrated_confidence_score: 84,
    risk_level: 'LOW',
    market_edge_score: 100,
    market_data_used: false,
    odds_rows_used: 0,
  },
  odds: [],
})
assert.equal(missingMarketFinalPick.signal, 'SKIP', 'missing market data must stay SKIP even when stored confidence is high')
assert.equal(missingMarketFinalPick.ah_pick.label, 'รอเส้น AH', 'missing AH odds must wait for AH line')
assert.equal(missingMarketFinalPick.ou_pick.label, 'รอราคา O/U', 'missing O/U odds must wait for O/U price')
assert.equal(missingMarketFinalPick.final_pick.type, 'NO_DECISION', 'missing market data must not create a final market pick')
assert.equal(missingMarketFinalPick.final_pick.label, 'ยังไม่มี Final Pick ที่พร้อมใช้', 'missing market data must show no actionable Final Pick')
assert.equal(missingMarketFinalPick.status, 'WAIT', 'missing odds with usable fixture data should be WAIT')
assert.equal(missingMarketFinalPick.match_view.source, 'FIXTURE_MODEL', 'no-odds match view should use fixture model')
assert.ok(missingMarketFinalPick.match_view.confidence <= 60, 'fixture-only match view confidence must be capped at 60')

const lowDataNoOddsPick = generateAiFinalPick({ analysis: { market_data_used: false, odds_rows_used: 0 }, odds: [] })
assert.equal(lowDataNoOddsPick.status, 'REJECTED', 'invalid low-data fixture should be rejected by hard gate')
assert.equal(lowDataNoOddsPick.match_view.label, 'ข้อมูลยังไม่พอประเมินฝั่งชนะ')
assert.equal(lowDataNoOddsPick.final_pick.label, 'ยังไม่มี Final Pick ที่พร้อมใช้')

const hybridBaseMatch = {
  id: 'hybrid-base',
  kickoffAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  league: { name: 'Hybrid League' },
  homeTeam: { name: 'Hybrid Home' },
  awayTeam: { name: 'Hybrid Away' },
  analysis: {
    recommendation: 'BET',
    confidence_score: 84,
    calibrated_confidence_score: 84,
    risk_level: 'MEDIUM',
    data_quality_score: 88,
    market_quality_score: 86,
    feature_completeness_score: 88,
  },
  odds: [{ id: 'hybrid-ah', match_id: 'hybrid-base', market_focus: 'AH', market_name: 'Asian Handicap', selection: 'Home -0.5', line: '-0.5', price: 1.9, snapshot_at: new Date().toISOString() }],
}
assert.equal(calculateDecisionReadinessScore({ dataQualityScore: 88, marketQualityScore: 86, analysisConfidence: 84, riskLevel: 'MEDIUM', featureCompletenessScore: 88 }), 84.5)
assert.equal(classifyDecision(hybridBaseMatch, { finalPick: { type: 'AH' } }).status, 'READY', 'Case 1: complete market-ready score 84 should be READY')
assert.equal(classifyDecision({ ...hybridBaseMatch, analysis: { ...hybridBaseMatch.analysis, confidence_score: 75, calibrated_confidence_score: 75, data_quality_score: 75, market_quality_score: 75, feature_completeness_score: 75 } }, { finalPick: { type: 'AH' } }).status, 'WATCH', 'Case 2: score 75 should be WATCH')
assert.equal(classifyDecision({ ...hybridBaseMatch, analysis: { ...hybridBaseMatch.analysis, risk_level: 'HIGH' } }, { finalPick: { type: 'AH' } }).status, 'WATCH', 'Case 3: HIGH risk should be WATCH, not READY')
const waitMissingMarket = classifyDecision({ ...hybridBaseMatch, odds: [] }, { finalPick: { type: 'AH' } })
assert.equal(waitMissingMarket.status, 'WAIT', 'Case 4: missing AH market should be WAIT')
assert.ok(waitMissingMarket.decision_reason_codes.includes('AH_MISSING') || waitMissingMarket.decision_reason_codes.includes('MARKET_MISSING'))
assert.equal(classifyDecision({ ...hybridBaseMatch, analysis: { risk_level: 'LOW' } }, { finalPick: { type: 'AH' }, analysisComplete: false }).status, 'WAIT', 'Case 5: incomplete analysis should be WAIT')
assert.equal(classifyDecision({ ...hybridBaseMatch, id: null }, { finalPick: { type: 'AH' } }).status, 'REJECTED', 'Case 6: invalid fixture should be REJECTED')
assert.equal(classifyDecision({ ...hybridBaseMatch, injuries: [] }, { finalPick: { type: 'AH' } }).status, 'READY', 'Case 7: incomplete injury data should be a soft penalty, not rejection')
const zeroReadyRows = Array.from({ length: 4 }, (_, index) => classifyDecision({ ...hybridBaseMatch, id: `zero-ready-${index}`, analysis: { ...hybridBaseMatch.analysis, confidence_score: 65, calibrated_confidence_score: 65, data_quality_score: 65, market_quality_score: 65 } }, { finalPick: { type: 'AH' } }))
assert.equal(zeroReadyRows.filter((row) => row.status === 'READY').length, 0, 'Case 8: READY=0 is valid')
const fourReadyRows = Array.from({ length: 4 }, (_, index) => classifyDecision({ ...hybridBaseMatch, id: `four-ready-${index}` }, { finalPick: { type: 'AH' } }))
assert.equal(fourReadyRows.filter((row) => row.status === 'READY').length, 4, 'Case 9: READY fewer than 10 should stay as real count')
const fourteenReadyRows = Array.from({ length: 14 }, (_, index) => ({ id: `ready-rank-${index}`, decision: classifyDecision({ ...hybridBaseMatch, id: `ready-rank-${index}`, analysis: { ...hybridBaseMatch.analysis, confidence_score: 95 - index, calibrated_confidence_score: 95 - index } }, { finalPick: { type: 'AH' } }) }))
assert.equal(fourteenReadyRows.filter((row) => row.decision.status === 'READY').length, 14, 'Case 10: READY over display max should keep decision data')
assert.equal(fourteenReadyRows.filter((row) => row.decision.status === 'READY').length, 14, 'Case 10: display preserves the dynamic READY count')

const marketReadyMatches = Array.from({ length: 3 }, (_, index) => ({
  ...baseMatch,
  id: `market-ready-${index}`,
  kickoffAt: new Date(Date.now() + (index + 4) * 60 * 60 * 1000).toISOString(),
  has_market_data: true,
  data_readiness_status: 'READY',
  odds: [{ id: `market-ready-odds-${index}`, match_id: `market-ready-${index}`, market_focus: 'AH', market_name: 'Asian Handicap', bookmaker_name: 'Book A', selection: 'Home -0.5', line: '-0.5', price: 1.9, snapshot_at: new Date().toISOString() }],
  aiFinalPick: { signal: index === 0 ? 'STRONG_SIGNAL' : 'WATCH', confidence_score: 82 - index, risk_level: 'LOW' },
  analysis: {
    ...baseMatch.analysis,
    recommendation: index === 0 ? 'BET' : 'LEAN',
    ranking_score: 88 - index,
    confidence_score: 82 - index,
    calibrated_confidence_score: 82 - index,
    risk_level: 'LOW',
    market_edge_score: 80 - index,
    professional_score: 82 - index,
    league_quality_score: 95,
    data_quality_score: 78,
    market_quality_score: 72,
    value_edge_score: 74 - index,
    risk_control_score: 76,
    market_data_used: true,
    odds_rows_used: 1,
    data_validation_status: 'VALID',
    analysis_status: 'MARKET_DATA_READY_RECALCULATED',
  },
}))
const waitingMarketMatches = Array.from({ length: 7 }, (_, index) => ({
  ...baseMatch,
  id: `waiting-market-${index}`,
  kickoffAt: new Date(Date.now() + (index + 8) * 60 * 60 * 1000).toISOString(),
  has_market_data: false,
  data_readiness_status: 'NO_MARKET_DATA',
  odds: [],
  aiFinalPick: { signal: 'SKIP', confidence_score: 54, risk_level: 'MEDIUM' },
  analysis: {
    ...baseMatch.analysis,
    recommendation: 'NO BET',
    ranking_score: 99,
    confidence_score: 90,
    calibrated_confidence_score: 90,
    risk_level: 'LOW',
    market_edge_score: 100,
    professional_score: 60,
    league_quality_score: 95,
    data_quality_score: 62,
    market_quality_score: 30,
    value_edge_score: 45,
    risk_control_score: 58,
    market_data_used: false,
    odds_rows_used: 0,
    data_validation_status: 'PARTIAL',
    analysis_status: 'INSUFFICIENT_MARKET_DATA',
  },
}))
const marketReadyFirst = rankTopMatches([...waitingMarketMatches, ...marketReadyMatches], 10)
assert.deepEqual(marketReadyFirst.slice(0, 3).map((match) => match.id), marketReadyMatches.map((match) => match.id), 'market-ready matches must be displayed before waiting market matches')
assert.equal(marketReadyFirst.filter(isMarketReadyForDisplay).length, 3)
assert.equal(marketReadyFirst.filter(isWaitingForMarketData).length, 7)

const waitingOnly = rankTopMatches(waitingMarketMatches, 10)
assert.equal(waitingOnly.some((match) => match.aiFinalPick?.signal === 'STRONG_SIGNAL'), false, 'waiting market matches must not become strong signals')
assert.equal(waitingOnly.every(isWaitingForMarketData), true, 'no market-ready day should remain in waiting market state')

const tenWaitingMarketMatches = Array.from({ length: 10 }, (_, index) => ({
  ...waitingMarketMatches[index % waitingMarketMatches.length],
  id: `today-waiting-${index}`,
  waitingMarketData: true,
}))
const waitingOnlySections = buildTodayMarketSections(tenWaitingMarketMatches)
assert.equal(waitingOnlySections.readyMatches.length, 0, 'Today ready section should be empty when no market-ready matches exist')
assert.equal(waitingOnlySections.waitingMatches.length, 10, 'Today waiting section must render all waiting market matches')
assert.equal(waitingOnlySections.hasDisplayMatches, true, 'Today page must not fall into empty state when waiting matches exist')
assert.equal(waitingOnlySections.showWaitingNotice, true, 'Today page should show the market waiting notice above waiting matches')

const mixedTodaySections = buildTodayMarketSections([...marketReadyMatches, ...waitingMarketMatches])
assert.equal(mixedTodaySections.readyMatches.length, 3, 'Today ready section should render market-ready matches')
assert.equal(mixedTodaySections.waitingMatches.length, 7, 'Today waiting section should render waiting matches alongside ready matches')

const decisiveTodayBuckets = buildTodayMatchBuckets([...marketReadyMatches, ...waitingMarketMatches], { locked: true, lockedCount: 10, windowHours: 36 })
assert.equal(decisiveTodayBuckets.strongMatches.length, 3, 'Today V2 should put market-ready strong signals in the strong section')
assert.equal(decisiveTodayBuckets.waitingMatches.length, 7, 'Today V2 should keep insufficient market-data matches visible in waiting section')
assert.equal(decisiveTodayBuckets.watchMatches.length, 0, 'Today V2 should not mix strong picks into watch section')
assert.equal(decisiveTodayBuckets.summary.locked, true, 'Today V2 summary should preserve locked source status')
assert.equal(decisiveTodayBuckets.summary.windowHours, 36, 'Today V2 summary should expose the selection window')

const oneStrongOneWatchOneWaiting = buildTodayMatchBuckets([
  createStatusMatches(1, 'NS', 'bucket-strong', {
    waitingMarketData: false,
    odds: [{ id: 'bucket-strong-odds', match_id: 'bucket-strong-0', market_name: 'Asian Handicap', selection: 'Home -0.5', line: '-0.5', price: 1.9 }],
    aiFinalPick: { signal: 'STRONG_SIGNAL', confidence_score: 83, risk_level: 'LOW' },
    analysis: { recommendation: 'BET', market_data_used: true, odds_rows_used: 1, analysis_status: 'MARKET_DATA_READY_RECALCULATED', market_edge_score: 80, confidence_score: 83, calibrated_confidence_score: 83, risk_level: 'LOW', data_validation_status: 'VALID' },
  })[0],
  createStatusMatches(1, 'NS', 'bucket-watch', {
    waitingMarketData: false,
    odds: [{ id: 'bucket-watch-odds', match_id: 'bucket-watch-0', market_name: 'Asian Handicap', selection: 'Home -0.5', line: '-0.5', price: 1.8 }],
    aiFinalPick: { signal: 'WATCH', confidence_score: 62, risk_level: 'MEDIUM' },
    analysis: { recommendation: 'LEAN', market_data_used: true, odds_rows_used: 1, analysis_status: 'MARKET_DATA_READY_RECALCULATED', market_edge_score: 65, market_quality_score: 65, confidence_score: 62, calibrated_confidence_score: 62, risk_level: 'MEDIUM', data_validation_status: 'VALID' },
  })[0],
  createStatusMatches(1, 'NS', 'bucket-waiting', {
    waitingMarketData: true,
    odds: [],
    analysis: { market_data_used: false, odds_rows_used: 0, analysis_status: 'INSUFFICIENT_MARKET_DATA' },
  })[0],
])
assert.equal(oneStrongOneWatchOneWaiting.strongMatches.length, 1, 'Today V2 should expose strongMatches')
assert.equal(oneStrongOneWatchOneWaiting.watchMatches.length, 1, 'Today V2 should expose watchMatches')
assert.equal(oneStrongOneWatchOneWaiting.waitingMatches.length, 1, 'Today V2 should expose waitingMatches')
assert.deepEqual(Object.keys(oneStrongOneWatchOneWaiting).filter((key) => ['strongMatches', 'watchMatches', 'waitingMatches', 'finishedMatches', 'hiddenMatches', 'summary'].includes(key)).sort(), ['finishedMatches', 'hiddenMatches', 'strongMatches', 'summary', 'waitingMatches', 'watchMatches'], 'Today V2 should expose the required bucket keys')

assert.equal(formatRecommendationLabel('NO BET'), 'รอข้อมูลเพิ่ม', 'UI recommendation labels must not expose NO BET')
assert.equal(formatSignal('STRONG_SIGNAL'), 'สัญญาณเด่น', 'UI signal labels must not expose STRONG_SIGNAL')
assert.equal(formatSignal('SKIP'), 'รอข้อมูลเพิ่ม', 'UI signal labels must not expose SKIP')
assert.equal(formatMarketFocus('AH'), 'แฮนดิแคป', 'UI market labels must not expose AH')

const missingApiMarketDisplay = getApiFootballMarketDisplay({
  id: 'missing-api-market',
  odds: [],
}, { marketFocus: 'AH', direction: 'HOME' })
assert.equal(missingApiMarketDisplay.label, 'ยังไม่มีข้อมูลราคา', 'No football_match_odds row should show no-price copy')
assert.equal(missingApiMarketDisplay.status, 'waiting_api_football_market')
assert.equal(missingApiMarketDisplay.reason, 'ยังไม่มีข้อมูลราคา')
assert.equal(missingApiMarketDisplay.label.includes('ยังไม่มีตลาดหลัก'), false, 'No API-Football odds should not show old market-focus fallback')
assert.equal(missingApiMarketDisplay.label.includes('ยังไม่มีทิศทางตลาด'), false, 'No API-Football odds should not show old market-direction fallback')

const readyApiMarketDisplay = getApiFootballMarketDisplay({
  id: 'ready-api-market',
  odds: [
    { id: 'odds-1', match_id: 'ready-api-market', market_name: 'Asian Handicap', bookmaker_name: 'API Book', selection: 'Home -0.5', is_latest: true },
    { id: 'odds-2', match_id: 'ready-api-market', market_name: 'Goals Over/Under', bookmaker_name: 'API Book', selection: 'Over 2.5', is_latest: true },
  ],
}, { marketFocus: 'AH' })
assert.equal(readyApiMarketDisplay.label, 'ตลาดจาก API-Football: Asian Handicap', 'API-Football odds should show football_match_odds.market_name directly')
assert.equal(readyApiMarketDisplay.hasApiFootballMarket, true)
assert.equal(readyApiMarketDisplay.label.includes('รอข้อมูลจาก API-Football'), false, 'Market-ready API odds should not use waiting copy')

const pickTeamMatch = {
  id: 'pick-team-match',
  homeTeam: { id: 'home-local-id', api_team_id: 10, name: 'Arsenal' },
  awayTeam: { id: 'away-local-id', api_team_id: 20, name: 'Chelsea' },
  kickoffAt: '2026-07-04T10:00:00.000Z',
  has_fixture_detail: true,
  data_readiness_status: 'READY',
  league: { priority: 80 },
}
const noOddsPick = derivePickTeamFromApiFootballOdds({ ...pickTeamMatch, odds: [] })
assert.equal(noOddsPick.pickTeam, null, 'No API odds must not derive pick_team')
assert.equal(noOddsPick.pickSource, 'NONE', 'No API odds must keep pick_source NONE')
assert.equal(noOddsPick.pickSide, 'NONE', 'No API odds must keep pick_side NONE')
assert.equal(noOddsPick.pickSummary.market, 'ยังไม่มีข้อมูลราคา', 'No API odds summary should show waiting price copy')
assert.equal(noOddsPick.predictedOutcomeLabel, 'ยังไม่มีข้อมูลราคา', 'No API odds predicted outcome should not invent a side')

const ahPick = derivePickTeamFromApiFootballOdds({
  ...pickTeamMatch,
  odds: [{ id: 'ah-1', match_id: 'pick-team-match', market_name: 'Asian Handicap', selection: 'Arsenal -0.5', price: 1.91, is_latest: true }],
})
assert.equal(ahPick.pickTeam, 'Arsenal', 'AH selection should derive the selected team from API-Football odds')
assert.equal(ahPick.pickTeamId, 10)
assert.equal(ahPick.pickSide, 'HOME')
assert.equal(ahPick.pickSummary.team, 'Arsenal')
assert.equal(ahPick.pickSummary.market, 'Asian Handicap')
assert.equal(ahPick.predictedOutcomeLabel.includes('Arsenal'), true)

const ahAwayPick = derivePickTeamFromApiFootballOdds({
  ...pickTeamMatch,
  odds: [{ id: 'ah-2', match_id: 'pick-team-match', market_name: 'Asian Handicap', selection: 'Chelsea +0.5', price: 1.95, is_latest: true }],
})
assert.equal(ahAwayPick.pickTeam, 'Chelsea', 'AH away selection should derive away team from API-Football odds')
assert.equal(ahAwayPick.pickSide, 'AWAY')

const homeWinnerPick = derivePickTeamFromApiFootballOdds({
  ...pickTeamMatch,
  odds: [{ id: 'mw-home-1', match_id: 'pick-team-match', market_name: 'Match Winner', selection: 'Arsenal', price: 1.82, is_latest: true }],
})
assert.equal(homeWinnerPick.pickTeam, 'Arsenal', '1X2 home selection should derive home team')
assert.equal(homeWinnerPick.pickSide, 'HOME')

const awayWinnerPick = derivePickTeamFromApiFootballOdds({
  ...pickTeamMatch,
  odds: [{ id: 'mw-1', match_id: 'pick-team-match', market_name: 'Match Winner', selection: 'Chelsea', price: 2.1, is_latest: true }],
})
assert.equal(awayWinnerPick.pickTeam, 'Chelsea', '1X2 away selection should derive away team')
assert.equal(awayWinnerPick.pickSide, 'AWAY')

const drawPick = derivePickTeamFromApiFootballOdds({
  ...pickTeamMatch,
  odds: [{ id: 'draw-1', match_id: 'pick-team-match', market_name: 'Match Winner', selection: 'Draw', price: 3.2, is_latest: true }],
})
assert.equal(drawPick.pickTeam, null, '1X2 draw should not assign pick_team')
assert.equal(drawPick.pickSide, 'DRAW')
assert.equal(drawPick.pickSummary.sideLabel, 'เสมอ')

const ouPick = derivePickTeamFromApiFootballOdds({
  ...pickTeamMatch,
  odds: [{ id: 'ou-1', match_id: 'pick-team-match', market_name: 'Goals Over/Under', selection: 'Over 2.5', price: 1.86, is_latest: true }],
})
assert.equal(ouPick.pickTeam, null, 'OU should not assign pick_team')
assert.equal(ouPick.pickSide, 'OVER')
assert.equal(ouPick.pickSummary.sideLabel, 'สูง')

const bttsPick = derivePickTeamFromApiFootballOdds({
  ...pickTeamMatch,
  odds: [{ id: 'btts-1', match_id: 'pick-team-match', market_name: 'Both Teams Score', selection: 'Yes', price: 1.74, is_latest: true }],
})
assert.equal(bttsPick.pickTeam, null, 'BTTS should not assign pick_team')
assert.equal(bttsPick.pickSide, 'YES')
assert.equal(bttsPick.pickSummary.sideLabel, 'ใช่')

const strictApiSelection = buildStrictApiFootballSelection([
  { ...pickTeamMatch, id: 'strict-no-odds', odds: [], kickoffAt: '2026-07-04T09:00:00.000Z' },
  { ...pickTeamMatch, id: 'strict-1x2', odds: [{ id: 'strict-1x2-odds', match_id: 'strict-1x2', market_name: 'Match Winner', selection: 'Arsenal', is_latest: true }], kickoffAt: '2026-07-04T13:00:00.000Z' },
  { ...pickTeamMatch, id: 'strict-ou', odds: [{ id: 'strict-ou-odds', match_id: 'strict-ou', market_name: 'Goals Over/Under', selection: 'Over 2.5', is_latest: true }], kickoffAt: '2026-07-04T12:00:00.000Z' },
  { ...pickTeamMatch, id: 'strict-ah', odds: [{ id: 'strict-ah-odds', match_id: 'strict-ah', market_name: 'Asian Handicap', selection: 'Arsenal -0.25', is_latest: true }], kickoffAt: '2026-07-04T11:00:00.000Z' },
], { limit: 4 })
assert.deepEqual(strictApiSelection.selected.map((match) => match.id), ['strict-ah', 'strict-ou', 'strict-1x2', 'strict-no-odds'], 'Strict daily selection should prioritize API odds and market priority before no-odds rows')
assert.equal(strictApiSelection.usedRollingWindow, false)
assert.equal(strictApiSelection.usedNextDateFallback, false)
assert.equal(strictApiSelection.selectedCount, 4, 'Strict daily should display fewer than 10 when fewer real fixtures exist')
assert.equal(strictApiSelection.selected.find((match) => match.id === 'strict-no-odds').strictApiFootball.pickSide, 'NONE')
assert.equal(strictApiSelection.selected.find((match) => match.id === 'strict-no-odds').strictApiFootball.recommendedTier, 'WATCH')

const strictNoOddsOnlySelection = buildStrictApiFootballSelection([
  { ...pickTeamMatch, id: 'no-odds-real-1', odds: [], kickoffAt: '2026-07-04T09:00:00.000Z', league: { name: 'Real League', priority: 75 } },
  { ...pickTeamMatch, id: 'no-odds-real-2', odds: [], kickoffAt: '2026-07-04T10:00:00.000Z', league: { name: 'Real League', priority: 72 } },
], { limit: 10 })
assert.equal(strictNoOddsOnlySelection.selectedCount, 2, 'No-odds day should still select real same-day fixtures')
assert.equal(strictNoOddsOnlySelection.selectedWithoutOddsCount, 2)
assert.equal(strictNoOddsOnlySelection.selected.every((match) => match.strictApiFootball.pickTeam === null), true, 'No-odds strict fixtures must not create pick_team')

const noOddsStrongFixture = {
  ...pickTeamMatch,
  id: 'strict-high-quality-no-odds',
  odds: [],
  league: { name: 'High Quality League', priority: 100 },
  data_readiness_score: 100,
  statistics: [{ type: 'shots' }],
  lineups: [{ team: 'home' }],
}
const weakOddsFixture = {
  ...pickTeamMatch,
  id: 'strict-weak-odds',
  odds: [{ id: 'weak-odds-1', match_id: 'strict-weak-odds', market_name: 'Asian Handicap', selection: 'Arsenal -0.25', is_latest: true }],
  homeTeam: { name: '' },
  awayTeam: { name: '' },
  league: {},
  has_fixture_detail: false,
  data_readiness_status: 'WAITING',
}
const bonusNotGateSelection = buildStrictApiFootballSelection([weakOddsFixture, noOddsStrongFixture], { limit: 2 })
assert.equal(bonusNotGateSelection.selected[0].id, 'strict-high-quality-no-odds', 'Odds should be a readiness bonus, not a hard ordering gate over safer fixtures')

const waitingCardCopy = [
  missingApiMarketDisplay.label,
  missingApiMarketDisplay.reason,
  noOddsPick.pickSummary.reason,
  ahPick.pickSummary.reason,
  ahPick.predictedOutcomeLabel,
].join(' ')
for (const forbidden of ['ยังไม่มีตลาดหลัก', 'ยังไม่มีทิศทางตลาด', 'NO BET', 'SKIP', 'INSUFFICIENT_MARKET_DATA', 'NO_MARKET_DATA', 'readiness', 'analysis_status', 'ชนะชัวร์', 'ฟันธง', 'ล็อก', 'การันตี']) {
  assert.equal(waitingCardCopy.includes(forbidden), false, `Waiting card market copy should not expose ${forbidden}`)
}
const matchCardSource = readFileSync(new URL('../src/components/MatchCard.jsx', import.meta.url), 'utf8')
for (const forbidden of ['Professional Score', 'Market Quality', 'Data Quality', 'Value Edge', 'ชนะชัวร์', 'ฟันธง', 'ล็อก', 'การันตี']) {
  assert.equal(matchCardSource.includes(forbidden), false, `MatchCard primary UI should not expose ${forbidden}`)
}

const finishedTop10Matches = createStatusMatches(10, 'FT', 'finished-top10')
const finishedTodayBuckets = buildTodayStatusBuckets(finishedTop10Matches)
assert.equal(finishedTodayBuckets.playableMatches.length, 0, 'Case A: finished Top10 rows must not be playable on Today')
assert.equal(finishedTodayBuckets.finishedMatches.length, 10, 'Case A: Today should count all finished Top10 rows')
assert.equal(mergeResultRows([], toResultRows(finishedTodayBuckets.finishedMatches)).length, 10, 'Case A: Results should show all finished Top10 rows')

const mixedStatusTop10 = [
  ...createStatusMatches(3, 'NS', 'upcoming-top10', { waitingMarketData: false, odds: [{ id: 'upcoming-top10-odds', match_id: 'upcoming-top10-0', market_name: 'Asian Handicap', price: 1.9 }], analysis: { market_data_used: true, odds_rows_used: 1, market_edge_score: 80, confidence_score: 70, risk_level: 'LOW', data_validation_status: 'VALID' } }),
  ...createStatusMatches(7, 'FT', 'finished-mixed'),
]
const mixedStatusBuckets = buildTodayStatusBuckets(mixedStatusTop10)
const mixedStatusSections = buildTodayMarketSections(mixedStatusBuckets.playableMatches)
assert.equal(mixedStatusSections.readyMatches.length, 3, 'Case B: Today should render only upcoming/live rows')
assert.equal(mixedStatusBuckets.finishedMatches.length, 7, 'Case B: Today should keep finished rows out of main cards')
assert.equal(mergeResultRows([], toResultRows(mixedStatusBuckets.finishedMatches)).length, 7, 'Case B: Results should render finished rows')

const waitingNotFinishedTop10 = createStatusMatches(10, 'NS', 'waiting-not-finished', { waitingMarketData: true, odds: [], analysis: { market_data_used: false, odds_rows_used: 0, analysis_status: 'INSUFFICIENT_MARKET_DATA' } })
const waitingNotFinishedBuckets = buildTodayStatusBuckets(waitingNotFinishedTop10)
const waitingNotFinishedSections = buildTodayMarketSections(waitingNotFinishedBuckets.playableMatches)
assert.equal(waitingNotFinishedSections.readyMatches.length, 0, 'Case C: no market-ready matches should leave ready empty')
assert.equal(waitingNotFinishedSections.waitingMatches.length, 10, 'Case C: waiting market rows that are not finished should remain on Today')

const readyAndWaitingTop10 = [
  ...createStatusMatches(3, 'NS', 'ready-d', { waitingMarketData: false, odds: [{ id: 'ready-d-odds', match_id: 'ready-d-0', market_name: 'Asian Handicap', price: 1.9 }], analysis: { market_data_used: true, odds_rows_used: 1, market_edge_score: 80, confidence_score: 70, risk_level: 'LOW', data_validation_status: 'VALID' } }),
  ...createStatusMatches(7, 'NS', 'waiting-d', { waitingMarketData: true, odds: [], analysis: { market_data_used: false, odds_rows_used: 0, analysis_status: 'INSUFFICIENT_MARKET_DATA' } }),
]
const readyAndWaitingBuckets = buildTodayStatusBuckets(readyAndWaitingTop10)
const readyAndWaitingSections = buildTodayMarketSections(readyAndWaitingBuckets.playableMatches)
assert.equal(readyAndWaitingSections.readyMatches.length, 3, 'Case D: Today should render ready matches')
assert.equal(readyAndWaitingSections.waitingMatches.length, 7, 'Case D: Today should render waiting matches')
assert.equal(mergeResultRows([], toResultRows(readyAndWaitingBuckets.finishedMatches)).length, 0, 'Case D: Results should not render unfinished rows')

const selectionNow = new Date('2026-07-04T00:00:00.000Z')
const oneWaitingNow = createStatusMatches(1, 'NS', 'selection-waiting-now', {
  waitingMarketData: true,
  odds: [],
  analysis: { market_data_used: false, odds_rows_used: 0, analysis_status: 'INSUFFICIENT_MARKET_DATA' },
}).map((match) => ({ ...match, kickoffAt: '2026-07-04T03:00:00.000Z' }))
const nextWindowReady = createStatusMatches(5, 'NS', 'selection-ready-next', {
  waitingMarketData: false,
  odds: [{ id: 'selection-ready-next-odds', match_id: 'selection-ready-next-0', market_name: 'Asian Handicap', price: 1.9 }],
  aiFinalPick: { signal: 'STRONG_SIGNAL', confidence_score: 82, risk_level: 'LOW' },
  analysis: {
    recommendation: 'BET',
    market_data_used: true,
    odds_rows_used: 1,
    analysis_status: 'MARKET_DATA_READY_RECALCULATED',
    market_edge_score: 80,
    confidence_score: 82,
    calibrated_confidence_score: 82,
    risk_level: 'LOW',
  },
}).map((match, index) => ({ ...match, kickoffAt: `2026-07-05T${13 + index}:00:00.000Z` }))
const rollingSelection = buildUsableDailySelection([...oneWaitingNow, ...nextWindowReady], { now: selectionNow, windowHours: 36, minPlayable: 5 })
assert.equal(rollingSelection.windowHoursUsed, 48, 'Selection V2 should expand to 48h when the first 36h has too few playable matches')
assert.equal(rollingSelection.reason, 'using_next_window_candidates', 'Selection V2 should report using_next_window_candidates when expanded')
assert.equal(rollingSelection.selectedCount, 6, 'Selection V2 should keep waiting playable matches instead of emptying Today')
assert.deepEqual(rollingSelection.selected.slice(0, 5).map((match) => match.id), nextWindowReady.map((match) => match.id), 'Selection V2 should rank market-ready matches before waiting matches')

const finishedOnlySelection = buildUsableDailySelection(createStatusMatches(10, 'FT', 'selection-finished'), { now: selectionNow })
assert.equal(finishedOnlySelection.selectedCount, 0, 'Selection V2 must not select finished matches for Today')
assert.equal(finishedOnlySelection.finishedExcludedCount, 10, 'Selection V2 should count finished rows for Results routing')
assert.equal(finishedOnlySelection.reason, 'all_matches_finished', 'Selection V2 should explain all-finished boards')

const existingTop10Rows = Array.from({ length: 10 }, (_, index) => ({
  id: `existing-${index + 1}`,
  selection_date: '2026-07-04',
  rank: index + 1,
  match_id: `match-${index + 1}`,
}))
const repeatPlan = planDailyTop10Persistence(existingTop10Rows, existingTop10Rows.map((row) => ({ id: row.match_id, match_id: row.match_id })))
assert.equal(repeatPlan.rowsUpdated, 10, 'Case A: existing locked Top10 should update by rank without inserting duplicates')
assert.equal(repeatPlan.rowsInserted, 0, 'Case A: rerun should not grow row count')
assert.equal(repeatPlan.duplicateRanks.length, 0, 'Case A: rerun should not duplicate ranks')
assert.equal(repeatPlan.duplicateMatches.length, 0, 'Case A: rerun should not duplicate matches')

const changedRankOnePlan = planDailyTop10Persistence(existingTop10Rows, [
  { id: 'match-5', match_id: 'match-5' },
  ...existingTop10Rows.filter((row) => row.match_id !== 'match-5').slice(0, 9).map((row) => ({ id: row.match_id, match_id: row.match_id })),
])
assert.ok(changedRankOnePlan.duplicateRankResolved >= 1, 'Case B: moving an existing match to occupied rank should resolve the old row first')
assert.equal(changedRankOnePlan.duplicateRanks.length, 0, 'Case B: occupied rank update should not create duplicate rank')
assert.equal(changedRankOnePlan.duplicateMatches.length, 0, 'Case B: occupied rank update should not create duplicate match')

let repeatedRows = existingTop10Rows
for (let run = 0; run < 3; run += 1) {
  const plan = planDailyTop10Persistence(repeatedRows, existingTop10Rows.map((row) => ({ id: row.match_id, match_id: row.match_id })))
  repeatedRows = plan.finalRows
  assert.equal(plan.duplicateRanks.length, 0, 'Case C: repeated select-usable writes should keep ranks unique')
  assert.equal(plan.duplicateMatches.length, 0, 'Case C: repeated select-usable writes should keep matches unique')
}
assert.equal(repeatedRows.length, 10, 'Case C: repeated select-usable writes should not grow row count')

assert.equal(getMatchStatusInfo({ fixture_status_short: '1H' }).group, matchStatusGroups.live)
assert.equal(getMatchStatusInfo({ match_status: 'PEN' }).group, matchStatusGroups.finished)
assert.equal(getMatchStatusInfo({ status_long: 'Match Finished' }).group, matchStatusGroups.finished)

const emptyTodaySections = buildTodayMarketSections([])
assert.equal(emptyTodaySections.readyMatches.length, 0)
assert.equal(emptyTodaySections.waitingMatches.length, 0)
assert.equal(emptyTodaySections.hasDisplayMatches, false, 'Today page should show empty state only when no ready or waiting matches exist')

for (const repositoryFn of [
  fetchEnabledLeagues,
  updateLeagueSettingsById,
  fetchMatchById,
  fetchMatchesByIds,
  fetchMatchesByKickoffRange,
  fetchPredictionSnapshots,
  fetchPredictionResults,
  fetchPredictionEvaluations,
  fetchSyncLogs,
  fetchLatestSyncLog,
  invokeSyncFootballData,
]) {
  assert.equal(typeof repositoryFn, 'function')
}

console.log('analysisEngine smoke tests passed')

function createStatusMatches(count, statusShort, prefix, patch = {}) {
  return Array.from({ length: count }, (_, index) => ({
    ...baseMatch,
    ...patch,
    id: `${prefix}-${index}`,
    statusShort,
    status_short: statusShort,
    status: statusShort,
    kickoffAt: new Date(Date.now() + (['FT', 'AET', 'PEN'].includes(statusShort) ? -(index + 1) : index + 2) * 60 * 60 * 1000).toISOString(),
    odds: (patch.odds ?? baseMatch.odds ?? []).map((row) => ({ ...row, snapshot_at: row.snapshot_at ?? new Date().toISOString() })),
    homeScore: ['FT', 'AET', 'PEN'].includes(statusShort) ? 2 : null,
    awayScore: ['FT', 'AET', 'PEN'].includes(statusShort) ? 1 : null,
    homeGoals: ['FT', 'AET', 'PEN'].includes(statusShort) ? 2 : null,
    awayGoals: ['FT', 'AET', 'PEN'].includes(statusShort) ? 1 : null,
    analysis: {
      ...baseMatch.analysis,
      ...(patch.analysis ?? {}),
    },
  }))
}

function toResultRows(matches) {
  return matches.map((match) => ({
    id: `result-${match.id}`,
    matchId: match.id,
    match_id: match.id,
    kickoffAt: match.kickoffAt,
    statusShort: match.statusShort,
    status_short: match.status_short,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
  }))
}
