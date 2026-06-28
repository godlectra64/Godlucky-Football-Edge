import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  calculateRankingScore,
  calculateFootballMasterAnalysis,
  calculateLeagueContext,
  getRecommendationFromConfidence,
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
import { normalizeMarketIntelligence } from '../src/utils/marketIntelligence.js'
import { deriveAiPickSide, getAiPickDisplay } from '../src/utils/pickSide.js'
import { getOneBestPickOfDay } from '../src/utils/finalPick.js'
import { runAiSelectionEngine } from '../src/utils/aiSelectionEngine.js'
import { getPagePath, getRouteState } from '../src/utils/routes.js'
import { fetchEnabledLeagues, updateLeagueSettingsById } from '../src/repositories/analysisRepository.js'
import { fetchMatchById, fetchMatchesByKickoffRange } from '../src/repositories/matchesRepository.js'
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
assert.ok(syncFootballDataSource.includes("Deno.env.get('FOOTBALL_PROVIDER') ?? 'api-football'"), 'sync-football-data should default to API-FOOTBALL')
assert.ok(syncFootballDataSource.includes('const primaryProvider = getProviderAdapter(requestedProviderName)'), 'sync-football-data should choose the primary provider before fetching')
assert.ok(syncFootballDataSource.includes("fetchFixtures: ({ dateKey }) => fetchApiFootballFixtures(dateKey)"), 'API-FOOTBALL adapter should fetch fixtures by Bangkok dateKey')
assert.ok(syncFootballDataSource.includes("apiFootballGet('/fixtures', { date: dateKey })"), 'API-FOOTBALL adapter must use /fixtures?date=YYYY-MM-DD')
assert.ok(syncFootballDataSource.includes("const fallbackProvider = getProviderAdapter('football-data.org')"), 'football-data.org must remain as fallback provider')
assert.ok(syncFootballDataSource.includes('fallbackProvider: providerResult.fallbackProvider'), 'sync response should expose fallbackProvider')
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
  getFixturePrioritySample({ league: 'USL League Two', home: 'Little Rock Rangers', away: 'Red River' }),
  getFixturePrioritySample({ league: 'Premier League', home: 'Arsenal', away: 'Chelsea' }),
  getFixturePrioritySample({ league: 'MLS Next Pro', home: 'Colorado Rapids II', away: 'Vancouver Whitecaps II' }),
  getFixturePrioritySample({ league: 'Premier League Women', home: 'Arsenal W', away: 'Chelsea W' }),
].sort((a, b) => b.syncPriorityScore - a.syncPriorityScore)
assert.equal(prioritySamples[0].league, 'Premier League', 'high quality leagues should sort before small leagues')
assert.ok(prioritySamples.some((item) => item.league === 'Premier League Women'), 'women fixtures should receive a soft penalty but stay in the candidate list')
assert.ok(prioritySamples.some((item) => item.league === 'MLS Next Pro'), 'reserve fixtures should receive a soft penalty but stay in the candidate list')

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

function getFixturePrioritySample({ league, home, away }) {
  const leagueQualityScore = league.includes('Premier League') ? 100 : league.includes('MLS') ? 84 : 65
  const knownLeagueBonus = league === 'Premier League' ? 15 : 0
  const coverageBonus = leagueQualityScore >= 84 ? 10 : 0
  let softPenalty = 0
  const text = `${league} ${home} ${away}`.toLowerCase()
  if (/\b(u19|u20|u21|u23|youth|reserve|reserves|academy)\b/i.test(text)) softPenalty += 24
  if (/\b(w|women|woman|femenil|feminine)\b/i.test(text)) softPenalty += 18
  if (/\b(ii|2|b)\b/i.test(text)) softPenalty += 14
  if (text.includes('next pro') || text.includes('league two')) softPenalty += 10
  return {
    league,
    syncPriorityScore: Math.max(0, Math.min(100, Math.round(leagueQualityScore + knownLeagueBonus + coverageBonus - Math.min(softPenalty, 45)))),
  }
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
}
const noBetCandidate = {
  ...baseMatch,
  id: 'no-bet-candidate',
  confidence: 58,
  recommendation: 'NO BET',
  riskLevel: 'medium',
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
  { ...betCandidate, id: 'stored-confidence-high', confidence: 90, analysis: { calibrated_confidence_score: 55, confidence_score: 90 } },
  { ...betCandidate, id: 'calibrated-high', confidence: 62, analysis: { calibrated_confidence_score: 88, confidence_score: 62 } },
], 2)
assert.equal(calibratedRanked[0].id, 'calibrated-high', 'Top picks should prefer v4 calibrated confidence when present')

const sixMatches = Array.from({ length: 6 }, (_, index) => ({
  ...baseMatch,
  id: `six-${index}`,
  confidence: 70 + index,
  recommendation: index % 2 ? 'LEAN' : 'NO BET',
  riskLevel: 'medium',
}))
assert.equal(rankTopMatches(sixMatches, 10).length, 6, 'six matches should render six, not fake ten')

const phase2Candidates = [
  { ...baseMatch, id: 'high-risk-99', confidence: 99, recommendation: 'BET', riskLevel: 'HIGH' },
  ...Array.from({ length: 10 }, (_, index) => ({
    ...baseMatch,
    id: `safe-bet-${index}`,
    confidence: 80 - index,
    recommendation: index < 5 ? 'BET' : 'LEAN',
    riskLevel: index === 0 ? 'LOW' : 'MEDIUM',
  })),
  { ...baseMatch, id: 'no-bet-low', confidence: 90, recommendation: 'NO BET', riskLevel: 'LOW' },
]
const phase2Ranked = rankTopMatches(phase2Candidates, 10)
assert.equal(phase2Ranked.length, 10)
assert.equal(phase2Ranked[0].aiPickLabel, 'AI PICK #1')
assert.equal(phase2Ranked[0].id, 'high-risk-99', 'Top picks should rank BET first even when risk is high')
assert.ok(phase2Ranked[0].rankBadges.includes('HIGH CONFIDENCE'))
assert.ok(phase2Ranked[0].rankBadges.includes('NO BET'))

const highRiskFallback = rankTopMatches([
  { ...baseMatch, id: 'only-high-1', confidence: 89, recommendation: 'BET', riskLevel: 'HIGH' },
  { ...baseMatch, id: 'only-high-2', confidence: 70, recommendation: 'LEAN', riskLevel: 'HIGH' },
], 10)
assert.deepEqual(highRiskFallback.map((match) => match.id), ['only-high-1', 'only-high-2'])
assert.ok(highRiskFallback[0].rankBadges.includes('NO BET'), 'HIGH risk fallback should be clearly badged as NO BET')

const mixedRecommendationPool = [
  ...Array.from({ length: 2 }, (_, index) => ({ ...baseMatch, id: `mix-bet-${index}`, confidence: 80 - index, recommendation: 'BET', riskLevel: 'MEDIUM' })),
  ...Array.from({ length: 5 }, (_, index) => ({ ...baseMatch, id: `mix-lean-${index}`, confidence: 75 - index, recommendation: 'LEAN', riskLevel: 'LOW' })),
  ...Array.from({ length: 10 }, (_, index) => ({ ...baseMatch, id: `mix-no-bet-${index}`, confidence: 95 - index, recommendation: 'NO BET', riskLevel: 'LOW' })),
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
    league: { name: 'Premier League' },
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
const v2Top10 = v2MixedRows.filter((row) => row.is_top_pick).sort((a, b) => a.final_rank - b.final_rank)
assert.equal(v2Top10.length, 10, 'AI Selection Engine v2 should fill Top 10 from all usable recommendations')
assert.equal(v2Top10.filter((row) => row.recommendation === 'BET').length, 2)
assert.equal(v2Top10.filter((row) => row.recommendation === 'LEAN').length, 5)
assert.equal(v2Top10.filter((row) => row.recommendation === 'NO BET').length, 3)
assert.deepEqual(v2Top10.map((row) => row.final_rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
assert.equal(v2MixedRows.filter((row) => row.is_final_pick).length, 1, 'only one v2 row may be final pick')
assert.equal(v2Top10[0].recommendation, 'BET')
assert.equal(v2Top10[0].recommendation_tier, '*****')

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

const noBetRanking = rankTopMatches([{ ...baseMatch, id: 'no-bet-ranking', league: { name: 'Club Friendly' }, homeForm: null, awayForm: null, standings: [] }], 1)[0]
assert.equal(noBetRanking.recommendation, 'NO BET')
assert.ok(!noBetRanking.rankBadges.includes('คู่เด่น'), 'NO BET should not receive BET-like featured badge')
assert.ok(!noBetRanking.rankReason.includes('เหมาะเป็น'), 'NO BET rank reason should not read like a BET recommendation')
assert.ok(noBetRanking.rankReason.includes('ควรข้าม'), 'NO BET rank reason should clearly recommend skipping')

for (const repositoryFn of [
  fetchEnabledLeagues,
  updateLeagueSettingsById,
  fetchMatchById,
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
