import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getBangkokDayRange } from '../_shared/bangkokDateRange.ts'
import { buildOddsNaturalKey, evaluateMarketFreshness, isActionableMarketType, normalizeMarketRow, normalizeMarketSelection, normalizeMarketType } from '../_shared/marketContract.js'
import { classifyDecisionState } from '../_shared/decisionContract.js'
import {
  buildCachedFinalDailySummary,
  buildDailyRunSummaryCached,
  buildDailySyncStartPayload,
  buildDailySyncStatusPayload,
  buildDailySyncStepResponseCached,
  buildFinalDailySummary,
  calculateRunProgress,
  emptyAnalysisDailySummary,
  emptyFixtureEnrichmentSummary,
  emptyRankingReadinessSummary,
  findWaitingRetryStep,
  getRetryAfterSeconds,
} from '../_shared/dailySyncResponse.js'
import {
  advanceContinuation as advancePipelineContinuation,
  buildBatchSignature,
  canRunRequiredPhase,
  claimDailyStepOnce,
  createContinuationState as createPipelineContinuationState,
  findNextRequiredStep,
  getDailySyncCacheDecision,
  getRequiredRunStatus,
  requiredDailyPhases,
  shouldProcessBatch,
} from '../_shared/pipelinePolicy.js'
import {
  API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE,
  advanceDailyFixtureCursor,
  buildApiFootballDailyFixturesParams,
  buildSinglePageFixtureDiscovery,
  selectDailyFixtureBatch,
} from '../_shared/dailyFixturesPolicy.js'
import {
  advanceCoreAuxiliaryContinuation,
  buildDailyContinuationRetryPlan,
  classifyDailyStepContinuation,
  getCoreAuxiliaryContinuation,
  getStepFailureAttemptCount,
  getStepStuckContinuationCount,
  selectCoreAuxiliaryBatch,
} from '../_shared/dailyContinuationPolicy.js'
import {
  MAX_DAILY_SYNC_STEPS_PER_REQUEST,
  MIN_PHASE_START_REMAINING_MS,
  UpstreamResponseError,
  buildDeadlinePendingSummary,
  buildFinishLogFailureLog,
  buildPhaseLog,
  buildSyncFailureLog,
  createExecutionBudget,
  finishLogBestEffort,
  getRemainingExecutionMs,
  parseUpstreamJsonResponse,
  sanitizeDiagnosticValue as sanitizeReliabilityDiagnosticValue,
  sanitizeText as sanitizeReliabilityText,
  shouldDeferExecution,
} from '../_shared/syncReliability.js'
import { systemVersions } from '../_shared/versions.js'

function createContinuationState(value: Record<string, any> = {}) {
  return {
    ...createPipelineContinuationState(value),
    ...getCoreAuxiliaryContinuation(value),
  }
}

function advanceContinuation(current: Record<string, any> = {}, update: Record<string, any> = {}) {
  const previous = createContinuationState(current)
  const pipeline = advancePipelineContinuation(previous, update)
  return createContinuationState({ ...previous, ...pipeline, ...update })
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const priorityLeagues = new Map<string, number>([
  ['UEFA Champions League', 8],
  ['Champions League', 8],
  ['Premier League', 10],
  ['Primera Division', 12],
  ['La Liga', 12],
  ['Serie A', 14],
  ['Bundesliga', 16],
  ['Ligue 1', 18],
  ['UEFA Europa League', 20],
  ['Europa League', 20],
])

const leagueQualityScoringVersion = 'league-quality-v4.1'
const marketReadinessAnalysisVersion = systemVersions.market_quality_version

const apiFootballLeagueTierScores = new Map<number, number>([
  [2, 100], // UEFA Champions League
  [3, 96], // UEFA Europa League
  [848, 95], // UEFA Conference League
  [39, 100], // England Premier League
  [140, 98], // Spain La Liga
  [135, 97], // Italy Serie A
  [78, 97], // Germany Bundesliga
  [61, 95], // France Ligue 1
  [40, 92], // England Championship
  [88, 90], // Netherlands Eredivisie
  [94, 90], // Portugal Primeira Liga
  [144, 88], // Belgium Pro League
  [203, 88], // Turkey Super Lig
  [179, 86], // Scotland Premiership
  [207, 86], // Switzerland Super League
  [218, 86], // Austria Bundesliga
  [119, 86], // Denmark Superliga
  [71, 84], // Brazil Serie A
  [128, 83], // Argentina Primera Division
  [253, 82], // USA MLS
  [262, 82], // Mexico Liga MX
  [98, 80], // Japan J1 League
  [292, 80], // Korea K League 1
  [307, 80], // Saudi Pro League
  [188, 78], // Australia A-League
])

const requestedProviderName = normalizeProviderName(Deno.env.get('FOOTBALL_PROVIDER') ?? 'api-football')
const FOOTBALL_DATA_BASE_URL = sanitizeUrl(Deno.env.get('FOOTBALL_API_BASE_URL') ?? 'https://api.football-data.org/v4')
const FOOTBALL_DATA_TOKEN = sanitizeHeaderValue(Deno.env.get('FOOTBALL_API_KEY') ?? '')
const API_FOOTBALL_BASE_URL = sanitizeUrl(Deno.env.get('API_FOOTBALL_BASE_URL') ?? 'https://v3.football.api-sports.io')
const API_FOOTBALL_KEY = sanitizeHeaderValue(Deno.env.get('API_FOOTBALL_KEY') ?? '')
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const secretKeys = parseSupabaseSecretKeys([
  Deno.env.get('EDGE_ADMIN_SECRET_KEYS'),
  Deno.env.get('SUPABASE_SECRET_KEYS'),
])

const supabase = createClient(supabaseUrl, serviceRoleKey, { global: { fetch: guardedSupabaseFetch } })
const legacyAnalysisSelect = 'id, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, motivation_score, market_risk_score, confidence_score, recommendation, risk_level, analysis_summary, thai_reason, raw'
const pickAnalysisSelect = `${legacyAnalysisSelect}, pick_side, pick_team, pick_reason`
const finalPickAnalysisSelect = `${pickAnalysisSelect}, market_type, market_line, fair_line, model_probability, value_status, value_reason`
const analysisReadinessMetadataSelect = 'analysis_status, recommendation_reason, market_data_used, odds_rows_used, recalculated_at, analysis_version'
const selectionV2AnalysisSelect = `${finalPickAnalysisSelect}, data_validation_status, data_validation_notes, league_quality_score, match_quality_score, tactical_matchup_score, market_reading_score, home_away_score, risk_score, edge_score, ai_score, ranking_score, final_rank, recommendation_tier, final_pick_note, is_top_pick, is_final_pick, ${analysisReadinessMetadataSelect}`
const defaultManualLimit = 50
const maxManualLimit = 100
const defaultEnrichLimit = 10
const maxEnrichLimit = 30
const defaultFootballEnrichmentLimit = 10
const maxFootballEnrichmentLimit = 50
const syncChunkSize = 10
const enrichChunkSize = 5
const footballEnrichmentChunkSize = 2

const footballEnrichmentModes = [
  'coverage',
  'rounds',
  'fixture-enrichment',
  'fixture-enrich',
  'injuries',
  'squads',
  'coaches',
  'venues',
  'top-players',
  'enrich-all',
  'daily-full-sync',
  'auto-daily-enrichment',
  'daily-full-sync-safe',
  'daily-sync-start',
  'daily-sync-phase',
  'daily-sync-status',
  'daily-sync-next',
  'daily-sync-auto',
  'sync-bookmakers',
  'sync-odds',
  'sync-fixture-odds',
  'recompute-ai-final-picks',
  'recompute-ai-final-picks-date',
  'lock-daily-top10',
  'get-daily-top10-status',
  'refresh-locked-top10-signals',
  'refresh-market-ready-top10',
  'select-usable-daily-picks',
  'strict-api-football-daily-picks',
  'sync-completed-fixtures',
  'backfill-ai-pick-results',
  'settle-ai-pick-results',
  'settle-ai-pick-results-date',
  'recompute-performance-daily',
  'result-refresh',
  'diagnose-result-pipeline',
]

const dailySyncRunMode = 'daily-full-sync-safe'
const dailySyncPhases = [...requiredDailyPhases]

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startedMs = Date.now()
  const startedAt = new Date(startedMs).toISOString()
  let logId: string | null = null
  let responseProviderName = requestedProviderName
  let responseMode = 'manual'

  try {
    const body = await safeJson(request)
    const requestedMode = normalizeRequestedMode(body.mode)
    const mode = normalizeSyncMode(body.mode)
    if (!mode) {
      return json({
        ok: false,
        code: 'UNKNOWN_SYNC_MODE',
        mode: requestedMode,
        supportedModes: getSupportedSyncModes(),
      }, 400)
    }
    responseMode = mode
    responseProviderName = isFootballEnrichmentMode(mode) ? 'api-football' : requestedProviderName
    const authError = await getServiceAuthError(request, mode, body)
    if (authError) return authError
    assertRuntimeConfig(mode)

    const dayRange = getSyncDateRange(body)
    const { dateKey, dateFrom, dateTo, startUtc, endUtc } = dayRange
    const syncType = typeof body.mode === 'string' && body.mode ? body.mode : 'manual'
    const limit = getSyncLimit(body.limit, mode)
    const offset = getSyncOffset(body.offset)

    if (isFootballEnrichmentMode(mode)) {
      const modeResult = await runFootballEnrichmentMode(mode, body, dayRange, limit, startedMs)
      return json({
        ok: true,
        requestedMode,
        resolvedMode: mode,
        partial: modeResult.partial ?? false,
        provider: modeResult.provider ?? (isResultPipelineMode(mode) ? 'supabase' : 'api-football'),
        mode,
        runId: modeResult.runId ?? null,
        phase: modeResult.phase ?? null,
        status: modeResult.status ?? 'success',
        dateKey,
        dateFrom,
        dateTo,
        requestedSelectionDate: modeResult.requestedSelectionDate ?? (typeof body.selectionDate === 'string' ? body.selectionDate : null),
        resolvedDateKey: modeResult.resolvedDateKey ?? dateKey,
        resolvedDateFrom: modeResult.resolvedDateFrom ?? dateFrom,
        resolvedDateTo: modeResult.resolvedDateTo ?? dateTo,
        reusedRunId: modeResult.reusedRunId ?? null,
        runDateKey: modeResult.runDateKey ?? null,
        startUtc,
        endUtc,
        limit,
        processed: modeResult.processed,
        rowsSaved: modeResult.rowsSaved ?? 0,
        failed: modeResult.failed ?? 0,
        skipped: modeResult.skipped ?? 0,
        totalCandidates: modeResult.totalCandidates,
        totalFetched: modeResult.totalFetched,
        endpointCoverage: modeResult.endpointCoverage,
        endpointBreakdown: modeResult.endpointBreakdown,
        details: modeResult.details,
        steps: modeResult.steps ?? [],
        limits: modeResult.limits ?? { limit },
        skippedEndpoints: modeResult.skippedEndpoints,
        rateLimited: modeResult.rateLimited,
        durationMs: Date.now() - startedMs,
        progressPercent: modeResult.progressPercent ?? null,
        completedSteps: modeResult.completedSteps ?? null,
        totalSteps: modeResult.totalSteps ?? null,
        failedSteps: modeResult.failedSteps ?? null,
        pendingSteps: modeResult.pendingSteps ?? null,
        runningSteps: modeResult.runningSteps ?? null,
        nextPhase: modeResult.nextPhase ?? null,
        retryAfterSeconds: modeResult.retryAfterSeconds ?? null,
        rankingReadiness: modeResult.rankingReadiness ?? modeResult.finalSummary?.rankingReadiness ?? null,
        finalSummary: modeResult.finalSummary ?? null,
        nextAction: modeResult.nextAction ?? null,
        nextRequestExample: modeResult.nextRequestExample ?? null,
        processedFixtures: modeResult.processedFixtures,
        savedOdds: modeResult.savedOdds,
        failedFixtures: modeResult.failedFixtures,
        emptyFixtures: modeResult.emptyFixtures,
        processedFixtureIds: modeResult.processedFixtureIds,
        skippedFixtureIds: modeResult.skippedFixtureIds,
        failures: modeResult.failures ?? [],
        continuation: modeResult.continuation ?? null,
        nextOffset: modeResult.nextOffset,
        hasMore: modeResult.hasMore,
        locked: modeResult.locked,
        alreadyLocked: modeResult.alreadyLocked,
        lockedCount: modeResult.lockedCount,
        selectionDate: modeResult.selectionDate,
        top10Count: modeResult.top10Count,
        finalPickRowsBefore: modeResult.finalPickRowsBefore,
        finalPickRowsAfter: modeResult.finalPickRowsAfter,
        recomputedFinalPicks: modeResult.recomputedFinalPicks,
        strongSignals: modeResult.strongSignals,
        leanSignals: modeResult.leanSignals,
        skipSignals: modeResult.skipSignals,
        missingFinalPickRows: modeResult.missingFinalPickRows,
        top10Coverage: modeResult.top10Coverage,
        source: modeResult.source,
        lockedAt: modeResult.lockedAt,
        lastUpdated: modeResult.lastUpdated,
        matchesWithOdds: modeResult.matchesWithOdds,
        matchesWithoutOdds: modeResult.matchesWithoutOdds,
        rowsUpdated: modeResult.rowsUpdated,
        rowsInserted: modeResult.rowsInserted,
        rowsSkipped: modeResult.rowsSkipped,
        duplicateRankResolved: modeResult.duplicateRankResolved,
        refreshedBecause: modeResult.refreshedBecause,
        skippedBecause: modeResult.skippedBecause,
        windowStart: modeResult.windowStart,
        windowEnd: modeResult.windowEnd,
        windowHoursUsed: modeResult.windowHoursUsed,
        totalFixturesInWindow: modeResult.totalFixturesInWindow,
        playableCandidates: modeResult.playableCandidates,
        marketReadyCandidates: modeResult.marketReadyCandidates,
        waitingMarketCandidates: modeResult.waitingMarketCandidates,
        finishedExcludedCount: modeResult.finishedExcludedCount,
        selectedCount: modeResult.selectedCount,
        readySelectedCount: modeResult.readySelectedCount,
        waitingSelectedCount: modeResult.waitingSelectedCount,
        reason: modeResult.reason,
        nextSyncSuggestion: modeResult.nextSyncSuggestion,
        strongSignalCount: modeResult.strongSignalCount,
        watchCount: modeResult.watchCount,
        skipCount: modeResult.skipCount,
        updated: modeResult.updated,
        checks: modeResult.checks,
        ready: modeResult.ready,
        recommendedFix: modeResult.recommendedFix,
        normalizedFixtureId: modeResult.normalizedFixtureId,
        matchedBy: modeResult.matchedBy,
        sourceMatchApiFixtureId: modeResult.sourceMatchApiFixtureId,
        resultApiFixtureId: modeResult.resultApiFixtureId,
        scoreUpdatedRows: modeResult.scoreUpdatedRows,
        settledRows: modeResult.settledRows,
        fixtureDiagnostics: modeResult.fixtureDiagnostics,
      }, modeResult.responseStatus ?? 200)
    }

    const primaryProvider = getProviderAdapter(requestedProviderName)

    const log = await supabase
      .from('sync_logs')
      .insert({
        sync_type: syncType,
        status: 'running',
        message: `${primaryProvider.name} sync ${dateFrom} to ${dateTo}`,
        started_at: startedAt,
        raw: { provider: primaryProvider.name, fallbackUsed: false, fallbackProvider: null, dateKey, dateFrom, dateTo, startUtc, endUtc },
      })
      .select('id')
      .single()

    if (log.error) throw log.error
    logId = log.data.id

    if (body.resetToday) {
      await resetMatchesForRange(dayRange)
    }

    const modeResult = mode === 'enrich'
      ? await runEnrichMode(dayRange, limit)
      : mode === 'recompute'
        ? await runRecomputeMode(dayRange, limit)
        : mode === 'learning'
          ? await runLearningMode(dayRange, limit)
          : await runManualMode(primaryProvider, dayRange, limit, offset)
    const providerResult = modeResult.providerResult
    const processed = modeResult.processed
    const totalCandidates = modeResult.totalCandidates
    const totalFetched = modeResult.totalFetched ?? totalCandidates
    const skippedByLimit = modeResult.skippedByLimit
    const failures = modeResult.failures
    const recomputeResult = modeResult.recomputeResult ?? { updated: 0, failures: [] }
    const recomputedStoredRows = modeResult.recomputedStoredRows ?? 0
    const normalizedAnalysisRows = modeResult.normalizedAnalysisRows ?? { checked: 0, fixed: 0 }
    const recomputeReadiness = modeResult.recomputeReadiness ?? null
    const rankedSelectionRows = modeResult.rankedSelectionRows ?? await updateDailySelectionRanks(dayRange)
    const endpointCoverage = modeResult.endpointCoverage ?? null
    const enrichedMatches = modeResult.enrichedMatches ?? []
    const nextOffset = modeResult.nextOffset ?? null
    const hasMore = Boolean(modeResult.hasMore)
    const skippedBeforeOffset = modeResult.skippedBeforeOffset ?? 0
    const skippedAfterLimit = modeResult.skippedAfterLimit ?? skippedByLimit
    const processedMatches = modeResult.processedMatches ?? []
    const analyzedCandidateCount = modeResult.analyzedCandidateCount ?? null
    const rankingMayBePartial = Boolean(modeResult.rankingMayBePartial)
    const topPickCount = rankedSelectionRows
    const topSelections = modeResult.topSelections ?? await fetchTopSelectionsDebug(dayRange)
    const updatedAnalysisCount = recomputeResult.updated + recomputedStoredRows
    const invalidRowsFixed = normalizedAnalysisRows.fixed
    const allFailures = [...failures, ...recomputeResult.failures]
    const total = totalFetched
    const status = allFailures.length ? 'partial_success' : 'success'
    const message = total === 0
      ? 'ไม่พบคู่แข่งขันวันนี้และพรุ่งนี้'
      : allFailures.length
      ? `บันทึกข้อมูล ${processed} คู่ อัปเดตวิเคราะห์ ${updatedAnalysisCount} รายการ แก้ข้อมูลผิด ${invalidRowsFixed} รายการ และมีข้อผิดพลาด ${allFailures.length} รายการ`
      : `บันทึกข้อมูล ${processed} คู่ และอัปเดตวิเคราะห์ ${updatedAnalysisCount} รายการ`

    await finishLog(logId, status, message, {
      provider: primaryProvider.name,
      mode,
      fallbackUsed: providerResult.fallbackUsed,
      fallbackProvider: providerResult.fallbackProvider,
      fallbackError: providerResult.fallbackError,
      dateKey,
      dateFrom,
      dateTo,
      startUtc,
      endUtc,
      competitions: providerResult.competitions,
      total,
      totalCandidates,
      totalFetched,
      limit,
      offset,
      nextOffset,
      hasMore,
      skippedBeforeOffset,
      skippedAfterLimit,
      processed,
      skippedByLimit,
      topPickCount,
      analyzedCandidateCount,
      rankingMayBePartial,
      updatedAnalysisCount,
      invalidRowsFixed,
      recomputedStoredRows,
      normalizedAnalysisRows: normalizedAnalysisRows.checked,
      recomputeReadiness,
      rankedSelectionRows,
      endpointCoverage,
      enrichedMatches,
      processedMatches,
      topSelections,
      durationMs: Date.now() - startedMs,
      failures: allFailures,
    })

    return json({
      ok: true,
      requestedMode,
      resolvedMode: mode,
      provider: primaryProvider.name,
      mode,
      fallbackUsed: providerResult.fallbackUsed,
      fallbackProvider: providerResult.fallbackProvider,
      dateKey,
      dateFrom,
      dateTo,
      startUtc,
      endUtc,
      totalCandidates,
      totalFetched,
      limit,
      offset,
      nextOffset,
      hasMore,
      skippedBeforeOffset,
      skippedAfterLimit,
      processed,
      total,
      skippedByLimit,
      topPickCount,
      analyzedCandidateCount,
      rankingMayBePartial,
      updatedAnalysisCount,
      invalidRowsFixed,
      recomputedStoredRows,
      normalizedAnalysisRows: normalizedAnalysisRows.checked,
      recomputeReadiness,
      rankedSelectionRows,
      endpointCoverage,
      enrichedMatches,
      processedMatches,
      topSelections,
      durationMs: Date.now() - startedMs,
      failures: allFailures,
    })
  } catch (error) {
    const errorResponse = buildSyncErrorResponse(error, responseMode, responseProviderName)
    const durationMs = Date.now() - startedMs
    console.error('sync-football-data-failed', buildSyncFailureLog({ mode: responseMode, errorResponse, error, durationMs }, { secrets: getSensitiveValues() }))
    await finishLogBestEffort(
      () => finishLog(logId, 'failed', errorResponse.errorMessage, { provider: errorResponse.provider, fallbackUsed: false, fallbackProvider: null, error: errorResponse.errorDetails }),
      (finishError) => console.error('sync-football-data-finish-log-failed', buildFinishLogFailureLog({ mode: responseMode, error: finishError, durationMs: Date.now() - startedMs }, { secrets: getSensitiveValues() })),
    )
    return json(errorResponse, 500)
  }
})

type ProviderAdapter = {
  name: 'api-football' | 'football-data.org'
  supportsFixtureEnrichment: boolean
  fetchFixtures: (range: ReturnType<typeof getBangkokDayRange>) => Promise<Array<any>>
  syncCompetitions?: () => Promise<number>
}

async function fetchProviderFixtures(provider: ProviderAdapter, range: ReturnType<typeof getBangkokDayRange>) {
  try {
    const competitions = provider.syncCompetitions ? await provider.syncCompetitions() : 0
    const matches = await provider.fetchFixtures(range)
    if (provider.name === 'api-football' && matches.length === 0) throw new Error(`api-football returned no fixtures for ${range.dateKey}`)
    return { provider, fallbackUsed: false, fallbackProvider: null, fallbackError: null, competitions, matches }
  } catch (error) {
    if (provider.name === 'football-data.org') throw error

    console.warn('football-provider-fallback', {
      provider: provider.name,
      errorMessage: sanitizeText(error instanceof Error ? error.message : error),
      stack: sanitizeText(error instanceof Error ? error.stack : null) || null,
    })
    const fallbackProvider = getProviderAdapter('football-data.org')
    const competitions = fallbackProvider.syncCompetitions ? await fallbackProvider.syncCompetitions() : 0
    const matches = await fallbackProvider.fetchFixtures(range)
    return {
      provider: fallbackProvider,
      fallbackUsed: true,
      fallbackProvider: fallbackProvider.name,
      fallbackError: serializeError(error),
      competitions,
      matches,
    }
  }
}

function getProviderAdapter(name: string): ProviderAdapter {
  if (name === 'api-football') {
    return {
      name: 'api-football',
      supportsFixtureEnrichment: false,
      fetchFixtures: ({ dateKey }) => fetchApiFootballFixtures(dateKey),
    }
  }

  return {
    name: 'football-data.org',
    supportsFixtureEnrichment: true,
    syncCompetitions: syncFootballDataCompetitions,
    fetchFixtures: ({ dateFrom, dateTo }) => fetchFootballDataFixturesByRange(dateFrom, dateTo),
  }
}

async function syncFootballDataCompetitions() {
  const competitions = await fetchFootballDataCompetitions()
  await upsertCompetitions(competitions)
  return competitions.length
}

async function runManualMode(provider: ProviderAdapter, dayRange: ReturnType<typeof getBangkokDayRange>, limit: number, offset = 0) {
  const providerResult = await fetchProviderFixtures(provider, dayRange)
  const matches = [...providerResult.matches].sort(compareFixtureSyncPriority)
  const totalFetched = matches.length
  const safeOffset = Math.min(Math.max(0, offset), totalFetched)
  const batch = matches.slice(safeOffset, safeOffset + limit)
  const nextOffset = safeOffset + batch.length
  const hasMore = nextOffset < totalFetched
  const result = await processInChunks(batch, syncChunkSize, async (footballDataMatch: any) => {
    return syncMatch(footballDataMatch, { enrichFixtureData: false })
  }, { provider: providerResult.provider.name, dateKey: dayRange.dateKey, totalBatch: batch.length, totalFetched, offset: safeOffset })

  const rankedSelectionRows = await updateDailySelectionRanks(dayRange)
  const analyzedCandidateCount = await countAnalyzedCandidates(dayRange)
  const skippedBeforeOffset = safeOffset
  const skippedAfterLimit = Math.max(0, totalFetched - nextOffset)
  return {
    providerResult,
    totalCandidates: totalFetched,
    totalFetched,
    offset: safeOffset,
    nextOffset: hasMore ? nextOffset : null,
    hasMore,
    skippedBeforeOffset,
    skippedAfterLimit,
    skippedByLimit: skippedBeforeOffset + skippedAfterLimit,
    processed: result.processed,
    processedMatchIds: result.processedMatchIds,
    failures: result.failures,
    processedMatches: result.results.map((item: any) => item.processedMatch).filter(Boolean).slice(0, 20),
    analyzedCandidateCount,
    rankingMayBePartial: hasMore,
    rankedSelectionRows,
  }
}

async function runEnrichMode(dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
  const provider = getProviderAdapter('api-football')
  const providerResult = { provider, fallbackUsed: false, fallbackProvider: null, fallbackError: null, competitions: 0, matches: [] }
  const candidates = await fetchEnrichCandidates(dayRange)
  const batch = candidates.rows.slice(0, Math.min(limit, maxEnrichLimit))
  const result = await processInChunks(batch, enrichChunkSize, enrichMatchData, { provider: provider.name, dateKey: dayRange.dateKey, totalBatch: batch.length, totalFetched: candidates.totalCandidates })
  const rankedSelectionRows = await updateDailySelectionRanks(dayRange)
  const endpointCoverage = summarizeEndpointCoverage(result.results)
  return {
    providerResult,
    totalCandidates: candidates.totalCandidates,
    totalFetched: candidates.totalCandidates,
    skippedByLimit: Math.max(0, candidates.totalCandidates - batch.length),
    processed: result.processed,
    processedMatchIds: result.processedMatchIds,
    failures: result.failures,
    endpointCoverage,
    enrichedMatches: result.results.map((item: any) => item.enrichedMatch).filter(Boolean).slice(0, 30),
    rankedSelectionRows,
  }
}

type FootballEnrichmentContext = {
  mode: string
  limit: number
  dateKey: string
  rateLimited: boolean
  deadlineReached: boolean
  executionBudget: ReturnType<typeof createExecutionBudget>
  endpoints: Record<string, FootballEnrichmentEndpointCounter>
  skippedEndpoints: Array<{ endpoint: string; reason: string; apiFixtureId?: number; apiLeagueId?: number; apiTeamId?: number; season?: number }>
  runId?: string
  stepId?: string
  stepAttemptCount?: number
  phase?: string
  continuationState?: Record<string, any>
}

type FootballEnrichmentEndpointCounter = {
  called: number
  withData: number
  empty: number
  skipped: number
  failed: number
  rowsSaved: number
}

type FootballEnrichmentEndpointCounterKey = keyof FootballEnrichmentEndpointCounter

type DailyFullSyncStepSummary = {
  step: number
  mode: string
  status: 'success' | 'empty' | 'partial_success' | 'error' | 'skipped_not_due' | 'pending_retry'
  processed: number
  totalCandidates: number
  rowsSaved: number
  failed: number
  skipped: number
  rateLimited: boolean
  durationMs: number
  message?: string
  partial?: boolean
  endpointBreakdown?: Record<string, FootballEnrichmentEndpointCounter>
  details?: Record<string, unknown>
  rankingReadiness?: Record<string, number>
  continuationState?: Record<string, any>
}

async function runFootballEnrichmentMode(mode: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, limit: number, requestStartedMs = Date.now()) {
  const provider = getProviderAdapter('api-football')
  const providerResult = { provider, fallbackUsed: false, fallbackProvider: null, fallbackError: null, competitions: 0, matches: [] }
  const context = createFootballEnrichmentContext(mode, limit, dayRange.dateKey, requestStartedMs, body.executionBudgetMs)
  const started = Date.now()

  if (isDailySyncOrchestratorMode(mode)) {
    return runDailySyncOrchestratorMode(mode, body, dayRange, context, providerResult, started)
  }

  if (mode === 'fixture-enrichment') {
    const before = cloneEndpointCounters(context.endpoints)
    const summary = await executeDailySyncPhase(2, 'fixture-enrichment', body, dayRange, context, before)
    return {
      providerResult,
      phase: 'fixture-enrichment',
      status: summary.status,
      partial: Boolean(summary.partial),
      totalCandidates: summary.totalCandidates,
      totalFetched: summary.totalCandidates,
      processed: summary.processed,
      rowsSaved: summary.rowsSaved,
      failed: summary.failed,
      skipped: summary.skipped,
      skippedByLimit: 0,
      failures: summary.failed ? [{ message: summary.message ?? 'fixture-enrichment partial' }] : [],
      rankedSelectionRows: 0,
      topSelections: [],
      endpointCoverage: context.endpoints,
      endpointBreakdown: summary.endpointBreakdown,
      details: summary.details,
      enrichedMatches: [],
      processedMatches: [],
      skippedEndpoints: context.skippedEndpoints,
      rateLimited: summary.rateLimited,
      durationMs: Date.now() - started,
      steps: [summary],
      continuation: summary.continuationState ?? null,
    }
  }

  let processed = 0
  let totalCandidates = 0
  if (mode === 'enrich-all') {
    for (const childMode of ['coverage', 'rounds', 'squads', 'coaches', 'venues', 'injuries', 'top-players', 'fixture-enrich']) {
      if (context.rateLimited || shouldStopForExecutionBudget(context)) break
      const child = await executeFootballEnrichmentMode(childMode, body, dayRange, context)
      processed += child.processed
      totalCandidates += child.totalCandidates
    }
  } else {
    const result = await executeFootballEnrichmentMode(mode, body, dayRange, context)
    processed = result.processed
    totalCandidates = result.totalCandidates
    return {
      providerResult,
      totalCandidates,
      totalFetched: result.totalFetched ?? totalCandidates,
      processed,
      rowsSaved: result.rowsSaved ?? 0,
      failed: result.failed ?? 0,
      skipped: result.skipped ?? 0,
      skippedByLimit: 0,
      failures: result.failures ?? [],
      rankedSelectionRows: 0,
      topSelections: [],
      endpointCoverage: context.endpoints,
      endpointBreakdown: result.endpointBreakdown,
      details: result.details,
      enrichedMatches: [],
      processedMatches: [],
      skippedEndpoints: context.skippedEndpoints,
      rateLimited: context.rateLimited,
      durationMs: Date.now() - started,
      steps: [],
      partial: result.partial ?? false,
      responseStatus: result.responseStatus,
      processedFixtures: result.processedFixtures,
      savedOdds: result.savedOdds,
      failedFixtures: result.failedFixtures,
      emptyFixtures: result.emptyFixtures,
      processedFixtureIds: result.processedFixtureIds,
      skippedFixtureIds: result.skippedFixtureIds,
      nextOffset: result.nextOffset,
      hasMore: result.hasMore,
      locked: result.locked,
      alreadyLocked: result.alreadyLocked,
      lockedCount: result.lockedCount,
      selectionDate: result.selectionDate,
      lockedAt: result.lockedAt,
      lastUpdated: result.lastUpdated,
      matchesWithOdds: result.matchesWithOdds,
      matchesWithoutOdds: result.matchesWithoutOdds,
      strongSignalCount: result.strongSignalCount,
      watchCount: result.watchCount,
      skipCount: result.skipCount,
      updated: result.updated,
    }
  }

  return {
    providerResult,
    totalCandidates,
    totalFetched: totalCandidates,
    processed,
    skippedByLimit: 0,
    failures: [],
    rankedSelectionRows: 0,
    topSelections: [],
    endpointCoverage: context.endpoints,
    enrichedMatches: [],
    processedMatches: [],
    skippedEndpoints: context.skippedEndpoints,
    rateLimited: context.rateLimited,
    durationMs: Date.now() - started,
    steps: [],
  }
}

async function runDailySyncOrchestratorMode(mode: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext, providerResult: any, started: number) {
  const dateDiagnostics = buildDailySyncDateDiagnostics(body, dayRange)
  if (mode === 'daily-sync-status') {
    const state = await getDailySyncState(String(body.runId ?? ''))
    assertDailySyncRunDateMatchesRequest(state, dayRange, body)
    return withDailySyncDateDiagnostics(await buildDailySyncStatusResponse(mode, state, Date.now() - started), dateDiagnostics, state)
  }

  if (mode === 'daily-sync-start') {
    const state = await startDailySyncRun(body, dayRange)
    return withDailySyncDateDiagnostics(await buildDailySyncStartResponse(mode, state, Date.now() - started), dateDiagnostics, state)
  }

  if (mode === 'daily-sync-next') {
    const state = await getDailySyncState(String(body.runId ?? ''))
    assertDailySyncRunDateMatchesRequest(state, dayRange, body)
    const result = await runDailySyncStepBatch(state, body, getBangkokDayRange(state.run.run_date), context, body.autoAdvance === true ? getMaxStepsPerRequest(body) : 1)
    result.reusedRunId = Boolean(state.reusedRunId)
    return withDailySyncDateDiagnostics(await buildDailySyncStepResponse(mode, result, providerResult, Date.now() - started), dateDiagnostics, result)
  }

  if (mode === 'daily-sync-phase') {
    const state = await getDailySyncState(String(body.runId ?? ''))
    assertDailySyncRunDateMatchesRequest(state, dayRange, body)
    const result = await runRequestedDailySyncPhase(state, String(body.phase ?? ''), body, getBangkokDayRange(state.run.run_date), context)
    result.reusedRunId = Boolean(state.reusedRunId)
    return withDailySyncDateDiagnostics(await buildDailySyncStepResponse(mode, result, providerResult, Date.now() - started), dateDiagnostics, result)
  }

  if (mode === 'daily-sync-auto') {
    let state = await startDailySyncRun({ ...body, resume: body.resume ?? true }, dayRange)
    const cacheDecision = getDailySyncCacheDecision(state.run, state.steps)
    logDailySyncCacheDecision(cacheDecision)
    if (cacheDecision.canUseCachedSummary) {
      return withDailySyncDateDiagnostics(await buildDailySyncStatusResponse(mode, state, Date.now() - started, 'daily sync already completed'), dateDiagnostics, state)
    }
    if (cacheDecision.shouldWait) {
      return withDailySyncDateDiagnostics(await buildDailySyncStatusResponse(mode, state, Date.now() - started, cacheDecision.continuationAction), dateDiagnostics, state)
    }
    if (cacheDecision.needsSelfHeal) {
      state = await selfHealDailySyncContinuation(state, cacheDecision)
    }
    const result = await runDailySyncStepBatch(state, body, getBangkokDayRange(state.run.run_date), context, getMaxStepsPerRequest(body))
    result.reusedRunId = Boolean(state.reusedRunId)
    return withDailySyncDateDiagnostics(await buildDailySyncStepResponse(mode, result, providerResult, Date.now() - started), dateDiagnostics, result)
  }

  if (['daily-full-sync', 'daily-full-sync-safe', 'auto-daily-enrichment'].includes(mode)) {
    const state = await startDailySyncRun(body, dayRange)
    const cacheDecision = getDailySyncCacheDecision(state.run, state.steps)
    if (cacheDecision.canUseCachedSummary) return withDailySyncDateDiagnostics(await buildDailySyncStatusResponse(mode, state, Date.now() - started, 'daily sync already completed'), dateDiagnostics, state)

    const autoAdvance = body.autoAdvance === true
    const result = await runDailySyncStepBatch(state, body, getBangkokDayRange(state.run.run_date), context, autoAdvance ? getMaxStepsPerRequest(body) : 1)
    result.reusedRunId = Boolean(state.reusedRunId)
    return withDailySyncDateDiagnostics(await buildDailySyncStepResponse(mode, result, providerResult, Date.now() - started), dateDiagnostics, result)
  }

  return buildDailySyncSafeResponse({
    mode,
    runId: null,
    phase: null,
    status: 'failed',
    processed: 0,
    totalCandidates: 0,
    rowsSaved: 0,
    failed: 1,
    skipped: 0,
    rateLimited: false,
    durationMs: Date.now() - started,
    nextAction: 'use daily-full-sync-safe',
    nextRequestExample: { mode: 'daily-full-sync-safe', phaseLimits: { core: 50, 'fixture-enrichment': 10 } },
  })
}

async function startDailySyncRun(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>) {
  const runDate = dayRange.dateKey
  const limits = getDailyPhaseLimits(body)
  const limitValue = getPositiveLimit(body.limit, defaultFootballEnrichmentLimit, maxFootballEnrichmentLimit)
  const enrichmentLimit = getPositiveLimit(body.enrichmentLimit, 20, maxFootballEnrichmentLimit)
  const force = body.force === true
  if (force) throw new Error('Force-reset is disabled for canonical daily runs; use the audited recovery command')
  const requestedRunId = typeof body.runId === 'string' ? body.runId.trim() : ''
  if (requestedRunId) {
    const requestedState = await getDailySyncState(requestedRunId)
    if (String(requestedState.run.run_date ?? '') !== runDate) throw new Error(`Daily sync run ${requestedRunId} belongs to ${requestedState.run.run_date}, not ${runDate}`)
    if (requestedState.run.mode !== dailySyncRunMode) throw new Error(`Daily sync run ${requestedRunId} is not the canonical ${dailySyncRunMode} run`)
    await recoverStaleDailySyncSteps(requestedRunId)
    return withDailySyncReuseMeta(await getDailySyncState(requestedRunId), true)
  }
  const existing = await supabase
    .from('api_football_daily_sync_runs')
    .select('*')
    .eq('run_date', runDate)
    .eq('mode', dailySyncRunMode)
    .maybeSingle()

  if (existing.error) throw existing.error

  let run = existing.data
  if (!run) {
    const inserted = await supabase
      .from('api_football_daily_sync_runs')
      .insert({
        run_date: runDate,
        mode: dailySyncRunMode,
        status: 'started',
        current_phase: null,
        current_step: 0,
        total_steps: dailySyncPhases.length,
        limit_value: limitValue,
        enrichment_limit: enrichmentLimit,
        summary: { phaseLimits: limits, versions: systemVersions },
        ...systemVersions,
      })
      .select('*')
      .single()
    if (inserted.error?.code === '23505') {
      const raced = await supabase
        .from('api_football_daily_sync_runs')
        .select('*')
        .eq('run_date', runDate)
        .eq('mode', dailySyncRunMode)
        .single()
      if (raced.error) throw raced.error
      await createDailySyncSteps(raced.data.id, getDailyPhaseLimits(raced.data.summary ?? body))
      await recoverStaleDailySyncSteps(raced.data.id)
      return withDailySyncReuseMeta(await getDailySyncState(raced.data.id), true)
    }
    if (inserted.error) throw inserted.error
    run = inserted.data
    await createDailySyncSteps(run.id, limits)
    return withDailySyncReuseMeta(await getDailySyncState(run.id), false)
  }

  if (run.status === 'success' && !force) {
    return withDailySyncReuseMeta(await getDailySyncState(run.id), true)
  }

  if (run.status !== 'success' && !force) {
    await recoverStaleDailySyncSteps(run.id)
    return withDailySyncReuseMeta(await getDailySyncState(run.id), true)
  }

  return withDailySyncReuseMeta(await getDailySyncState(run.id), true)
}

function withDailySyncReuseMeta(state: any, reusedRunId: boolean) {
  return { ...state, reusedRunId }
}

function logDailySyncCacheDecision(decision: ReturnType<typeof getDailySyncCacheDecision>) {
  console.info('daily-sync-cache-decision', {
    cacheDecision: decision.cacheDecision,
    cacheBypassReason: decision.cacheBypassReason,
    runId: decision.runId,
    runStatus: decision.runStatus,
    currentPhase: decision.currentPhase,
    retryStep: decision.retryStep,
    nextRetryAt: decision.nextRetryAt,
    continuationAction: decision.continuationAction,
  })
}

async function selfHealDailySyncContinuation(state: any, decision: ReturnType<typeof getDailySyncCacheDecision>) {
  const step = state.steps.find((item: any) => item.phase === decision.retryStep)
  if (!step || !decision.needsSelfHeal) return state
  const nextRetryAt = new Date().toISOString()
  let query = supabase
    .from('api_football_daily_sync_steps')
    .update({
      status: 'pending_retry',
      next_retry_at: nextRetryAt,
      error_message: 'CONTINUATION_SCHEDULE_SELF_HEALED',
    })
  query = matchDailySyncStepVersion(query, step)
  const result = await query.select('id').maybeSingle()
  if (result.error) throw new DailySyncPhaseError(step.phase, result.error)

  const freshState = withDailySyncReuseMeta(await getDailySyncState(state.run.id), true)
  console.info('daily-sync-continuation-self-heal', {
    cacheDecision: 'bypass',
    cacheBypassReason: decision.cacheBypassReason,
    runId: freshState.run.id,
    runStatus: freshState.run.status,
    currentPhase: freshState.run.current_phase,
    retryStep: step.phase,
    nextRetryAt: result.data ? nextRetryAt : freshState.steps.find((item: any) => item.id === step.id)?.next_retry_at ?? null,
    continuationAction: result.data ? 'self_healed_resume_due' : 'self_heal_claim_contended',
  })
  return freshState
}

function matchDailySyncStepVersion(query: any, step: any) {
  let matched = query
    .eq('id', step.id)
    .eq('status', step.status)
    .eq('attempt_count', Number(step.attempt_count ?? 0))
  matched = step.next_retry_at == null
    ? matched.is('next_retry_at', null)
    : matched.eq('next_retry_at', step.next_retry_at)
  return matched
}

function buildDailySyncDateDiagnostics(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>) {
  return {
    requestedSelectionDate: typeof body.selectionDate === 'string' && body.selectionDate ? body.selectionDate : null,
    resolvedDateKey: dayRange.dateKey,
    resolvedDateFrom: dayRange.dateFrom,
    resolvedDateTo: dayRange.dateTo,
  }
}

function withDailySyncDateDiagnostics(response: any, diagnostics: ReturnType<typeof buildDailySyncDateDiagnostics>, stateOrResult: any) {
  const run = stateOrResult?.run ?? null
  return {
    ...response,
    ...diagnostics,
    reusedRunId: Boolean(stateOrResult?.reusedRunId),
    runDateKey: run?.run_date ?? null,
  }
}

function assertDailySyncRunDateMatchesRequest(state: any, dayRange: ReturnType<typeof getBangkokDayRange>, body: Record<string, unknown>) {
  const hasExplicitDate = Boolean(body.selectionDate || body.dateKey || body.date || body.dateFrom)
  if (!hasExplicitDate) return
  const runDate = String(state?.run?.run_date ?? '')
  if (runDate && runDate !== dayRange.dateKey) {
    throw new Error(`Daily sync run date mismatch: requested ${dayRange.dateKey} but run ${state.run.id} is for ${runDate}`)
  }
}

async function createDailySyncSteps(runId: string, limits: Record<string, number>) {
  const rows = dailySyncPhases.map((phase, index) => ({
    run_id: runId,
    step_order: index + 1,
    phase,
    status: 'pending',
    attempt_count: 0,
    max_attempts: ['core', 'fixture-enrichment'].includes(phase) ? 20 : 3,
    next_retry_at: null,
    last_attempt_at: null,
    summary: { phaseLimit: limits[phase] ?? maxFootballEnrichmentLimit, versions: systemVersions },
    continuation_state: createContinuationState(),
    ...systemVersions,
  }))
  const result = await supabase
    .from('api_football_daily_sync_steps')
    .upsert(rows, { onConflict: 'run_id,step_order', ignoreDuplicates: true })
  if (result.error) throw result.error
}

async function recoverStaleDailySyncSteps(runId: string, staleAfterMs = 15 * 60 * 1000) {
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString()
  const result = await supabase
    .from('api_football_daily_sync_steps')
    .select('*')
    .eq('run_id', runId)
    .eq('status', 'running')
    .lt('updated_at', cutoff)
  if (result.error) throw result.error
  for (const step of result.data ?? []) {
    const continuationState = getStepContinuation(step)
    const continuationPolicy = classifyDailyStepContinuation({ status: 'error', failed: 1, details: { errorCode: 'STALE_RUNNING_STEP' } }, {
      previousContinuation: continuationState,
      nextContinuation: continuationState,
      previousFailureAttemptCount: getStepFailureAttemptCount(step),
      previousStuckContinuationCount: getStepStuckContinuationCount(step),
    })
    const exhausted = continuationPolicy.failureAttemptCount >= Number(step.max_attempts ?? 3)
    const errorMessage = exhausted ? 'STALE_RUNNING_MAX_FAILURE_ATTEMPTS' : 'STALE_RUNNING_RECOVERED'
    const summary = {
      ...(step.summary && typeof step.summary === 'object' ? step.summary : {}),
      status: 'error',
      failed: Math.max(1, Number(step.summary?.failed ?? 0)),
      message: errorMessage,
      continuationState,
      details: {
        ...(step.summary?.details && typeof step.summary.details === 'object' ? step.summary.details : {}),
        errorCode: 'STALE_RUNNING_STEP',
        continuationPolicy,
      },
    }
    const update = await supabase
      .from('api_football_daily_sync_steps')
      .update({
        status: exhausted ? 'failed' : 'pending_retry',
        next_retry_at: exhausted ? null : new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error_message: errorMessage,
        summary,
      })
      .eq('id', step.id)
      .eq('status', 'running')
      .eq('attempt_count', Number(step.attempt_count ?? 0))
      .eq('updated_at', step.updated_at)
    if (update.error) throw update.error
  }
}

async function getDailySyncState(runId: string) {
  if (!runId) throw new Error('Missing daily sync runId')
  const runResult = await supabase
    .from('api_football_daily_sync_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()
  if (runResult.error) throw runResult.error
  if (!runResult.data) throw new Error('Daily sync run not found')

  const stepsResult = await supabase
    .from('api_football_daily_sync_steps')
    .select('*')
    .eq('run_id', runId)
    .order('step_order', { ascending: true })
  if (stepsResult.error) throw stepsResult.error

  return { run: runResult.data, steps: stepsResult.data ?? [] }
}

async function runNextDailySyncStep(state: any, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const step = findNextDailySyncStep(state.steps)
  if (!step) {
    const waitingRetry = findWaitingRetryStep(state.steps)
    if (waitingRetry) {
      return {
        run: state.run,
        step: waitingRetry,
        nextStep: waitingRetry,
        summary: emptyDailyStepSummary(waitingRetry.phase, 'pending_retry', `Retry after ${waitingRetry.next_retry_at}`),
        steps: state.steps,
      }
    }
    const activeStep = findActiveDailySyncStep(state.steps)
    if (activeStep) return buildDailySyncClaimWaitResult(state, activeStep)
    const run = await markDailySyncRunFinished(state.run.id, state.steps, state.run.summary)
    return { run, step: null, nextStep: null, summary: emptyDailyStepSummary('complete', 'success'), steps: state.steps }
  }
  return runDailySyncStep(state.run, step, body, dayRange, context)
}

async function runDailySyncStepBatch(state: any, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext, maxSteps: number) {
  let currentState = state
  let lastResult: any = null
  const summaries: Array<DailyFullSyncStepSummary> = []
  const safeMaxSteps = Math.min(Math.max(1, Math.floor(maxSteps || 1)), MAX_DAILY_SYNC_STEPS_PER_REQUEST)

  for (let index = 0; index < safeMaxSteps; index += 1) {
    const nextStep = findNextDailySyncStep(currentState.steps)
    if (nextStep && shouldStopForExecutionBudget(context, MIN_PHASE_START_REMAINING_MS)) {
      lastResult = await deferDailySyncStepForDeadline(currentState.run, nextStep, context)
      summaries.push(lastResult.summary)
      break
    }
    lastResult = await runNextDailySyncStep(currentState, body, dayRange, context)
    if (lastResult?.summary) summaries.push(lastResult.summary)
    if (lastResult?.summary?.status === 'pending_retry') break
    if (!lastResult?.nextStep || lastResult?.run?.status === 'success') break
    currentState = await getDailySyncState(currentState.run.id)
  }

  if (!lastResult) {
    const waitingRetry = findWaitingRetryStep(currentState.steps)
    lastResult = {
      run: currentState.run,
      step: waitingRetry,
      nextStep: waitingRetry,
      summary: waitingRetry ? emptyDailyStepSummary(waitingRetry.phase, 'pending_retry', `Retry after ${waitingRetry.next_retry_at}`) : emptyDailyStepSummary('complete', 'success'),
      steps: currentState.steps,
    }
  }

  return { ...lastResult, summaries }
}

async function deferDailySyncStepForDeadline(run: any, step: any, context: FootballEnrichmentContext) {
  const now = new Date()
  const nextRetryAt = new Date(now.getTime() + 15_000).toISOString()
  const continuationState = getStepContinuation(step)
  const summary = buildDeadlinePendingSummary({
    stepOrder: step.step_order,
    phase: step.phase,
    durationMs: context.executionBudget.budgetMs - getRemainingExecutionMs(context.executionBudget),
    continuation: continuationState,
  }) as DailyFullSyncStepSummary
  const continuationPolicy = classifyDailyStepContinuation(summary, {
    previousContinuation: continuationState,
    nextContinuation: continuationState,
    previousFailureAttemptCount: getStepFailureAttemptCount(step),
    previousStuckContinuationCount: getStepStuckContinuationCount(step),
    executionBudgetDeferred: true,
  })
  summary.details = {
    ...(summary.details ?? {}),
    remainingMs: getRemainingExecutionMs(context.executionBudget),
    continuationSignals: { executionBudgetDeferred: true, hasMore: true, resultFailureCount: 0 },
    continuationPolicy,
  }

  let stepUpdateQuery = supabase
    .from('api_football_daily_sync_steps')
    .update({
      status: 'pending_retry',
      finished_at: now.toISOString(),
      next_retry_at: nextRetryAt,
      error_message: null,
      summary,
      continuation_state: continuationState,
      provider_page: continuationState.providerPage,
      fixture_offset: continuationState.fixtureOffset,
      odds_offset: continuationState.oddsOffset,
      processed_fixture_count: continuationState.processedFixtureCount,
      last_processed_fixture_id: continuationState.lastProcessedFixtureId,
      batch_signature: continuationState.batchSignature,
      ...systemVersions,
    })
  stepUpdateQuery = matchDailySyncStepVersion(stepUpdateQuery, step)
  const stepUpdate = await stepUpdateQuery.select('*').maybeSingle()
  if (stepUpdate.error) throw new DailySyncPhaseError(step.phase, stepUpdate.error)
  if (!stepUpdate.data) {
    const contendedState = await getDailySyncState(run.id)
    const contendedStep = contendedState.steps.find((item: any) => item.id === step.id) ?? step
    return contendedStep.status === 'running'
      ? buildDailySyncClaimWaitResult(contendedState, contendedStep)
      : buildDailySyncPendingResult(contendedState, contendedStep, 'CONTINUATION_DEFER_ALREADY_APPLIED')
  }

  const freshState = await getDailySyncState(run.id)
  const runUpdate = await supabase
    .from('api_football_daily_sync_runs')
    .update({
      status: getDailyRunStatus(freshState.steps),
      current_phase: step.phase,
      current_step: step.step_order,
      finished_at: null,
      last_error: null,
      summary: buildDailyRunSummaryCachedWithTiming(freshState.steps, freshState.run.summary ?? run.summary, summary, run.id),
    })
    .eq('id', run.id)
    .select('*')
    .single()
  if (runUpdate.error) throw new DailySyncPhaseError(step.phase, runUpdate.error)

  const updatedStep = freshState.steps.find((item: any) => item.id === step.id) ?? { ...step, status: 'pending_retry', next_retry_at: nextRetryAt, summary }
  return { run: runUpdate.data, step: updatedStep, nextStep: null, summary, steps: freshState.steps }
}

async function runRequestedDailySyncPhase(state: any, phase: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  if (!dailySyncPhases.includes(phase)) throw new Error(`Unsupported daily sync phase: ${phase}`)
  const step = state.steps.find((item: any) => item.phase === phase)
  if (!step) throw new Error(`Daily sync phase not found: ${phase}`)
  if (step.status === 'success') throw new Error(`Daily sync phase ${phase} already completed for run ${state.run.id}`)
  if (getStepFailureAttemptCount(step) >= Number(step.max_attempts ?? 3)) throw new Error(`Daily sync phase ${phase} exhausted its real-failure retry attempts`)
  if (!canRunRequiredPhase(state.steps, phase)) throw new Error(`Daily sync phase ${phase} is blocked by an incomplete required predecessor`)
  return runDailySyncStep(state.run, step, body, dayRange, context)
}

async function claimDailySyncStepAtomically(step: any) {
  return claimDailyStepOnce(step, async (claim: any) => {
    let query = supabase
      .from('api_football_daily_sync_steps')
      .update({ ...claim.update, ...systemVersions })
    query = matchDailySyncStepVersion(query, step)
    const result = await query.select('*').maybeSingle()
    if (result.error) throw new DailySyncPhaseError(step.phase, result.error)
    return result.data
  })
}

function findActiveDailySyncStep(steps: Array<any>) {
  return [...(steps ?? [])]
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0))
    .find((step) => step.status === 'running') ?? null
}

function buildDailySyncClaimWaitResult(state: any, step: any) {
  return buildDailySyncPendingResult(state, step, 'CONTINUATION_ALREADY_CLAIMED', { claimContended: true })
}

function buildDailySyncPendingResult(state: any, step: any, message: string, extra: Record<string, unknown> = {}) {
  return {
    run: state.run,
    step,
    nextStep: step,
    summary: emptyDailyStepSummary(step.phase, 'pending_retry', message),
    steps: state.steps,
    ...extra,
  }
}

async function runDailySyncStep(run: any, step: any, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const claim = await claimDailySyncStepAtomically(step)
  if (!claim.claimed) {
    const freshState = await getDailySyncState(run.id)
    const activeStep = freshState.steps.find((item: any) => item.id === step.id) ?? findActiveDailySyncStep(freshState.steps) ?? step
    console.info('daily-sync-continuation-claim', {
      cacheDecision: 'bypass',
      cacheBypassReason: 'CONTINUATION_ALREADY_CLAIMED',
      runId: run.id,
      runStatus: freshState.run.status,
      currentPhase: freshState.run.current_phase,
      retryStep: activeStep.phase,
      nextRetryAt: activeStep.next_retry_at ?? null,
      continuationAction: 'wait_for_active_claim',
    })
    return buildDailySyncClaimWaitResult(freshState, activeStep)
  }

  const claimedStep = claim.step
  const startedAt = Date.now()
  const limits = getDailyPhaseLimits({ ...run.summary, ...body, phaseLimits: body.phaseLimits ?? run.summary?.phaseLimits })
  const phaseLimit = limits[claimedStep.phase] ?? 10
  const attemptCount = Number(claimedStep.attempt_count ?? 0)
  const maxAttempts = Number(claimedStep.max_attempts ?? step.max_attempts ?? 3)
  const previousContinuationState = getStepContinuation(claimedStep)
  context.limit = phaseLimit
  context.runId = run.id
  context.stepId = claimedStep.id
  context.stepAttemptCount = attemptCount
  context.phase = claimedStep.phase
  context.continuationState = previousContinuationState

  const runStarted = await supabase
    .from('api_football_daily_sync_runs')
    .update({ status: 'running', current_phase: claimedStep.phase, current_step: claimedStep.step_order, last_error: null })
    .eq('id', run.id)
  if (runStarted.error) throw runStarted.error

  let summary: DailyFullSyncStepSummary
  try {
    const before = cloneEndpointCounters(context.endpoints)
    summary = await executeDailySyncPhase(claimedStep.step_order, claimedStep.phase, body, dayRange, context, before)
  } catch (error) {
    const phaseError = error instanceof ResultPipelineError ? error : new DailySyncPhaseError(claimedStep.phase, error)
    const message = phaseError.message || `${claimedStep.phase} failed`
    summary = {
      step: claimedStep.step_order,
      mode: claimedStep.phase,
      status: 'error',
      processed: 0,
      totalCandidates: 0,
      rowsSaved: 0,
      failed: 1,
      skipped: 0,
      rateLimited: context.rateLimited,
      durationMs: Date.now() - startedAt,
      message,
      details: {
        errorCode: phaseError.errorCode,
        errorStage: phaseError.errorStage,
        provider: phaseError.provider,
        errorDetails: phaseError.errorDetails,
      },
      continuationState: createContinuationState(context.continuationState),
    }
  }

  const retry = getDailyStepRetryPlan(summary, claimedStep, previousContinuationState, attemptCount, maxAttempts)
  summary.details = {
    ...(summary.details ?? {}),
    continuationPolicy: retry.continuationPolicy,
  }
  if (retry.continuationPolicy.kind === 'planned_continuation' && !summary.message) {
    summary.message = `PLANNED_CONTINUATION:${retry.continuationPolicy.reason}`
  }
  if (retry.continuationPolicy.kind === 'real_failure' && !summary.message) {
    summary.message = retry.continuationPolicy.reason
  }
  const stepStatus = retry.status
  const finishedAt = new Date().toISOString()
  const continuationState = createContinuationState(summary.continuationState ?? context.continuationState)
  const stepUpdate = await supabase
    .from('api_football_daily_sync_steps')
    .update({
      status: stepStatus,
      finished_at: finishedAt,
      duration_ms: summary.durationMs,
      processed: summary.processed,
      total_candidates: summary.totalCandidates,
      rows_saved: summary.rowsSaved,
      failed: summary.failed,
      skipped: summary.skipped,
      rate_limited: summary.rateLimited,
      attempt_count: retry.persistedAttemptCount,
      max_attempts: maxAttempts,
      last_attempt_at: finishedAt,
      next_retry_at: retry.nextRetryAt,
      summary,
      error_message: retry.continuationPolicy.kind === 'real_failure' ? summary.message ?? retry.continuationPolicy.reason : null,
      provider_page: continuationState.providerPage,
      fixture_offset: continuationState.fixtureOffset,
      odds_offset: continuationState.oddsOffset,
      processed_fixture_count: continuationState.processedFixtureCount,
      last_processed_fixture_id: continuationState.lastProcessedFixtureId,
      batch_signature: continuationState.batchSignature,
      continuation_state: continuationState,
      ...systemVersions,
    })
    .eq('id', claimedStep.id)
    .eq('status', 'running')
    .eq('attempt_count', attemptCount)
    .select('id')
    .maybeSingle()
  if (stepUpdate.error) throw stepUpdate.error
  if (!stepUpdate.data) throw new DailySyncPhaseError(claimedStep.phase, new Error('DAILY_SYNC_STEP_CLAIM_LOST'))

  const freshState = await getDailySyncState(run.id)
  const runStatus = getDailyRunStatus(freshState.steps)
  const runUpdate = await supabase
    .from('api_football_daily_sync_runs')
    .update({
      status: runStatus,
      current_phase: claimedStep.phase,
      current_step: claimedStep.step_order,
      finished_at: runStatus === 'success' || runStatus === 'failed' ? finishedAt : null,
      last_error: retry.continuationPolicy.kind === 'real_failure' ? summary.message ?? retry.continuationPolicy.reason : null,
      summary: buildDailyRunSummaryCachedWithTiming(freshState.steps, freshState.run.summary ?? run.summary, summary, run.id),
    })
    .eq('id', run.id)
    .select('*')
    .single()
  if (runUpdate.error) throw runUpdate.error

  const updatedStep = freshState.steps.find((item: any) => item.id === claimedStep.id) ?? { ...claimedStep, status: stepStatus }
  const nextStep = findNextDailySyncStep(freshState.steps)
  return { run: runUpdate.data, step: updatedStep, nextStep, summary, steps: freshState.steps }
}

async function executeDailySyncPhase(stepOrder: number, phase: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext, before: Record<string, FootballEnrichmentEndpointCounter>) {
  const startedAt = Date.now()
  const phaseLogBase = { runId: context.runId ?? null, dateKey: dayRange.dateKey, stepOrder, phase }
  console.info('daily-sync-phase-start', buildPhaseLog({ ...phaseLogBase, durationMs: 0, continuation: context.continuationState }, { secrets: getSensitiveValues() }))

  try {
    await logEnrichmentSync({ mode: context.mode, endpoint: `phase:${phase}`, status: 'started', started_at: new Date().toISOString(), finished_at: new Date().toISOString() })
    const results: Array<any> = []
    const runBatch = async (worker: () => Promise<any>) => {
      if (shouldStopForExecutionBudget(context)) return null
      const result = await worker()
      results.push(result)
      return result
    }

    if (phase === 'core') {
      if (context.continuationState?.coreStage === 'fixtures') {
        const fixtureResult = await runBatch(async () => ({
          ...await syncApiFootballDailyFixtures(dayRange, context.limit, context),
          coreOperation: 'fixtures',
        }))
        if (fixtureResult?.providerComplete === true && Number(fixtureResult?.failed ?? 0) === 0 && !context.deadlineReached) {
          await persistStepContinuation(context, { coreStage: 'coverage' })
        }
      }
      if (context.continuationState?.coreStage === 'coverage' && !context.deadlineReached) {
        await runBatch(async () => ({
          ...await executeFootballEnrichmentMode('coverage', body, dayRange, context),
          coreOperation: 'coverage',
        }))
      }
      if (context.continuationState?.coreStage === 'rounds' && !context.deadlineReached) {
        await runBatch(async () => ({
          ...await executeFootballEnrichmentMode('rounds', body, dayRange, context),
          coreOperation: 'rounds',
        }))
      }
    } else if (phase === 'fixture-enrichment') {
      await runBatch(() => executeFootballEnrichmentMode('fixture-enrich', body, dayRange, context))
      if (!context.rateLimited && !context.deadlineReached) await runBatch(() => executeFootballEnrichmentMode('sync-odds', body, dayRange, context))
    } else if (phase === 'team-enrichment') {
      await runBatch(() => executeFootballEnrichmentMode('injuries', body, dayRange, context))
      if (!context.rateLimited && !context.deadlineReached) await runBatch(() => executeFootballEnrichmentMode('squads', body, dayRange, context))
      if (!context.rateLimited && !context.deadlineReached) await runBatch(() => executeFootballEnrichmentMode('coaches', body, dayRange, context))
      if (!context.rateLimited && !context.deadlineReached) await runBatch(() => executeFootballEnrichmentMode('venues', body, dayRange, context))
    } else if (phase === 'league-enrichment') {
      await runBatch(() => executeFootballEnrichmentMode('top-players', body, dayRange, context))
    } else if (phase === 'ranking') {
      await runBatch(() => runDailyRankingStep(dayRange, context))
    } else {
      throw new Error(`Unsupported daily sync phase: ${phase}`)
    }

    const endpointDelta = diffEndpointCounters(before, context.endpoints)
    const endpointBreakdown = diffEndpointCounterMap(before, context.endpoints)
    const processed = sumResultField(results, 'processed')
    const totalCandidates = sumResultField(results, 'totalCandidates')
    const rowsSaved = sumResultField(results, 'rowsSaved') || endpointDelta.rowsSaved || processed
    const failed = sumResultField(results, 'failed') + endpointDelta.failed
    const resultFailureCount = results.reduce((total, result) => total + (Array.isArray(result?.failures) ? result.failures.length : 0), 0)
    const skipped = sumResultField(results, 'skipped') + endpointDelta.skipped
    const partial = context.deadlineReached || results.some((result) => Boolean(result?.partial)) || (phase === 'fixture-enrichment' && isFixtureEnrichmentPartial(results, endpointBreakdown))
    const status = failed > 0 || partial ? 'partial_success' : rowsSaved > 0 || processed > 0 || skipped > 0 ? 'success' : 'empty'
    await logEnrichmentSync({ mode: context.mode, endpoint: `phase:${phase}`, status: status === 'partial_success' ? 'success' : status, results_count: rowsSaved, finished_at: new Date().toISOString() })
    await logEnrichmentSync({ mode: context.mode, endpoint: `phase:${phase}`, status: 'finished', results_count: rowsSaved, finished_at: new Date().toISOString() })

    const summary = {
      step: stepOrder,
      mode: phase,
      status,
      processed,
      totalCandidates,
      rowsSaved,
      failed,
      skipped,
      rateLimited: context.rateLimited,
      durationMs: Date.now() - startedAt,
      partial,
      endpointBreakdown,
      details: {
        ...buildDailyPhaseDetails(phase, results, context.continuationState),
        ...(context.deadlineReached ? { reason: 'SOFT_DEADLINE_REACHED', remainingMs: getRemainingExecutionMs(context.executionBudget) } : {}),
        continuationSignals: {
          executionBudgetDeferred: context.deadlineReached,
          hasMore: results.some((result) => result?.hasMore === true),
          resultFailureCount,
        },
      },
      rankingReadiness: phase === 'ranking' ? results[0]?.rankingReadiness : undefined,
      continuationState: createContinuationState(context.continuationState),
    } as DailyFullSyncStepSummary
    console.info('daily-sync-phase-complete', buildPhaseLog({ ...phaseLogBase, durationMs: summary.durationMs, continuation: summary.continuationState }, { secrets: getSensitiveValues() }))
    return summary
  } catch (error) {
    const phaseError = error instanceof DailySyncPhaseError ? error : new DailySyncPhaseError(phase, error)
    console.error('daily-sync-phase-failed', buildPhaseLog({ ...phaseLogBase, durationMs: Date.now() - startedAt, continuation: context.continuationState, error: phaseError }, { secrets: getSensitiveValues() }))
    throw phaseError
  }
}

async function markDailySyncRunFinished(runId: string, steps: Array<any>, storedRunSummary: any = null) {
  const status = getDailyRunStatus(steps)
  const result = await supabase
    .from('api_football_daily_sync_runs')
    .update({
      status,
      finished_at: status === 'success' || status === 'failed' ? new Date().toISOString() : null,
      summary: buildDailyRunSummaryCachedWithTiming(steps, storedRunSummary, null, runId),
      ...systemVersions,
    })
    .eq('id', runId)
    .select('*')
    .single()
  if (result.error) throw result.error
  return result.data
}

function buildDailySyncStartResponse(mode: string, state: any, durationMs: number) {
  const finalSummary = buildCachedFinalDailySummaryWithTiming(state.steps, state.run.summary?.finalSummary, state.run.id)
  return buildDailySyncSafeResponse(buildDailySyncStartPayload(mode, state, durationMs, { finalSummary }))
}

function buildDailySyncStatusResponse(mode: string, state: any, durationMs: number, message = '') {
  const responseStarted = Date.now()
  const finalSummary = buildCachedFinalDailySummaryWithTiming(state.steps, state.run.summary?.finalSummary, state.run.id)
  const response = buildDailySyncSafeResponse(buildDailySyncStatusPayload(mode, state, durationMs, message, { finalSummary }))
  console.info('daily-sync-status response build', { runId: state.run.id, durationMs: Date.now() - responseStarted })
  return response
}

function buildDailySyncStepResponse(mode: string, result: any, providerResult: any, durationMs: number) {
  const steps = result?.steps ?? []
  const finalSummary = buildCachedFinalDailySummaryWithTiming(steps, result?.run?.summary?.finalSummary, result?.run?.id ?? null)
  return buildDailySyncStepResponseCached(mode, result, providerResult, durationMs, { finalSummary })
}

function buildCachedFinalDailySummaryWithTiming(steps: Array<any>, storedSummary: any, runId: string | null) {
  const started = Date.now()
  const summary = buildCachedFinalDailySummary(steps, storedSummary)
  console.info('daily-sync cached summary build', { runId, durationMs: Date.now() - started })
  return summary
}

function buildDailyRunSummaryCachedWithTiming(steps: Array<any>, storedRunSummary: any, latest: any, runId: string) {
  const started = Date.now()
  const summary = buildDailyRunSummaryCached(steps, storedRunSummary, latest)
  console.info('daily-sync cached summary build', { runId, durationMs: Date.now() - started })
  return summary
}

function buildDailySyncSafeResponse(payload: any) {
  const progress = calculateRunProgress(payload.steps ?? [])
  const waitingRetry = findWaitingRetryStep(payload.steps ?? [])
  const nextPhase = payload.phase ?? progress.nextPhase ?? waitingRetry?.phase ?? null
  return {
    providerResult: { provider: getProviderAdapter('api-football'), fallbackUsed: false, fallbackProvider: null, fallbackError: null, competitions: 0, matches: [] },
    runId: payload.runId,
    phase: payload.phase,
    status: payload.status,
    partial: Boolean(payload.partial),
    continuation: payload.continuation ?? null,
    totalCandidates: payload.totalCandidates ?? 0,
    totalFetched: payload.totalCandidates ?? 0,
    processed: payload.processed ?? 0,
    rowsSaved: payload.rowsSaved ?? 0,
    failed: payload.failed ?? 0,
    skipped: payload.skipped ?? 0,
    skippedByLimit: 0,
    failures: payload.failed ? [{ message: payload.status }] : [],
    rankedSelectionRows: 0,
    topSelections: [],
    endpointCoverage: {},
    enrichedMatches: [],
    processedMatches: [],
    skippedEndpoints: [],
    rankingReadiness: payload.rankingReadiness ?? payload.summary?.rankingReadiness ?? null,
    rateLimited: Boolean(payload.rateLimited),
    durationMs: payload.durationMs ?? 0,
    steps: payload.steps ?? [],
    limits: payload.limits ?? {},
    ...progress,
    nextPhase,
    retryAfterSeconds: getRetryAfterSeconds(waitingRetry),
    finalSummary: payload.finalSummary ?? null,
    nextAction: payload.nextAction,
    nextRequestExample: payload.nextRequestExample,
  }
}

function findNextDailySyncStep(steps: Array<any>) {
  return findNextRequiredStep(steps, Date.now())
}

function mapDailyStepStatus(summary: DailyFullSyncStepSummary) {
  if (summary.status === 'error') return 'failed'
  if (summary.status === 'partial_success') return 'partial'
  if (summary.status === 'skipped_not_due') return 'skipped'
  return 'success'
}

function getDailyStepRetryPlan(summary: DailyFullSyncStepSummary, step: any, previousContinuation: Record<string, any>, claimedAttemptCount: number, maxAttempts: number) {
  const persistedAttemptCount = Math.max(0, claimedAttemptCount - 1)
  const previousFailureAttemptCount = getStepFailureAttemptCount({ ...step, attempt_count: persistedAttemptCount })
  const continuationPolicy = classifyDailyStepContinuation(summary, {
    previousContinuation,
    nextContinuation: summary.continuationState ?? previousContinuation,
    previousFailureAttemptCount,
    previousStuckContinuationCount: getStepStuckContinuationCount(step),
  })
  const retryPlan = buildDailyContinuationRetryPlan(continuationPolicy, { claimedAttemptCount, maxAttempts })
  return {
    status: continuationPolicy.kind === 'success' ? mapDailyStepStatus(summary) : retryPlan.exhausted ? 'failed' : 'pending_retry',
    nextRetryAt: retryPlan.nextRetryAt,
    persistedAttemptCount: retryPlan.persistedAttemptCount,
    continuationPolicy,
  }
}

function getDailyRunStatus(steps: Array<any>) {
  return getRequiredRunStatus(steps)
}

function emptyDailyStepSummary(mode: string | null, status: DailyFullSyncStepSummary['status'], message = '') {
  return {
    step: 0,
    mode: mode ?? 'daily-sync',
    status,
    processed: 0,
    totalCandidates: 0,
    rowsSaved: 0,
    failed: 0,
    skipped: 0,
    rateLimited: false,
    durationMs: 0,
    message,
  }
}

async function buildFinalDailySummaryWithDb(steps: Array<any>, dayRange: ReturnType<typeof getBangkokDayRange>, storedSummary: any = null) {
  const base = {
    ...buildFinalDailySummary(steps),
    ...(storedSummary && typeof storedSummary === 'object' ? storedSummary : {}),
  }
  const dbSummary = await getDailySyncReadinessDebugSummary(dayRange).catch((error) => {
    console.warn('daily sync DB readiness summary failed', { message: sanitizeText(error instanceof Error ? error.message : 'summary failed') })
    return null
  })
  return mergeDailySyncDbSummary(base, dbSummary)
}

function mergeDailySyncDbSummary(summary: any, dbSummary: any) {
  if (!dbSummary) {
    return {
      ...summary,
      rankingReadiness: summary?.rankingReadiness ?? emptyRankingReadinessSummary(),
      fixtureEnrichment: summary?.fixtureEnrichment && Object.keys(summary.fixtureEnrichment).length ? summary.fixtureEnrichment : emptyFixtureEnrichmentSummary(),
      analysisSummary: summary?.analysisSummary ?? emptyAnalysisDailySummary(),
    }
  }
  return {
    ...summary,
    rankingReadiness: dbSummary.rankingReadiness,
    fixtureEnrichment: {
      ...(summary?.fixtureEnrichment && typeof summary.fixtureEnrichment === 'object' ? summary.fixtureEnrichment : {}),
      ...dbSummary.fixtureEnrichment,
    },
    analysisSummary: dbSummary.analysisSummary,
  }
}

async function getDailySyncReadinessDebugSummary(dayRange: ReturnType<typeof getBangkokDayRange>) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      kickoff_at,
      odds_updated_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      analysis:match_analysis(recommendation, confidence_score, ranking_score, analysis_status, market_data_used, odds_rows_used, raw)
    `)
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)

  if (result.error) {
    if (isMissingColumnError(result.error)) return getDailySyncReadinessDebugSummaryLegacy(dayRange)
    throw result.error
  }
  return summarizeDailySyncReadinessRows(result.data ?? [])
}

async function getDailySyncReadinessDebugSummaryLegacy(dayRange: ReturnType<typeof getBangkokDayRange>) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      kickoff_at,
      odds_updated_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      analysis:match_analysis(recommendation, confidence_score, ranking_score, raw)
    `)
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)

  if (result.error) {
    if (isMissingColumnError(result.error)) return {
      rankingReadiness: emptyRankingReadinessSummary(),
      fixtureEnrichment: emptyFixtureEnrichmentSummary(),
      analysisSummary: emptyAnalysisDailySummary(),
    }
    throw result.error
  }
  return summarizeDailySyncReadinessRows(result.data ?? [])
}

async function summarizeDailySyncReadinessRows(matches: Array<any>) {
  const matchIds = (matches ?? []).map((row) => row.id).filter(Boolean)
  const oddsRows = matchIds.length
    ? await supabase.from('football_match_odds').select('match_id').in('match_id', matchIds)
    : { data: [], error: null }
  if (oddsRows.error) {
    if (isMissingColumnError(oddsRows.error)) return summarizeDailySyncReadinessRowsWithOdds(matches, [])
    throw oddsRows.error
  }
  return summarizeDailySyncReadinessRowsWithOdds(matches, oddsRows.data ?? [])
}

function summarizeDailySyncReadinessRowsWithOdds(matches: Array<any>, oddsRows: Array<any>) {
  const oddsMatchIds = new Set((oddsRows ?? []).map((row) => row.match_id).filter(Boolean))
  const rankingReadiness = emptyRankingReadinessSummary()
  const analysisSummary = emptyAnalysisDailySummary()

  rankingReadiness.totalFixtures = matches.length
  for (const match of matches ?? []) {
    const readiness = classifyRankingReadiness(match, oddsMatchIds)
    if (readiness === 'READY') rankingReadiness.ready += 1
    else if (readiness === 'PARTIAL') rankingReadiness.partial += 1
    else if (readiness === 'FAILED') rankingReadiness.failed += 1
    else if (readiness === 'PENDING') rankingReadiness.pending += 1
    else rankingReadiness.noMarketData += 1

    if (oddsMatchIds.has(match.id)) rankingReadiness.hasMarketDataCount += 1
    if (match.has_fixture_detail) rankingReadiness.hasFixtureDetailCount += 1

    const analysis = getAnalysis(match)
    const recommendation = String(analysis?.recommendation ?? '').toUpperCase()
    if (recommendation === 'BET') analysisSummary.bet += 1
    else if (recommendation === 'LEAN') analysisSummary.lean += 1
    else if (recommendation === 'NO BET') analysisSummary.noBet += 1

    const marketDataUsed = Boolean(analysis?.market_data_used ?? analysis?.raw?.market_data_used)
    if (marketDataUsed) analysisSummary.marketDataUsed += 1
    if (!marketDataUsed && readiness === 'NO_MARKET_DATA') analysisSummary.insufficientMarketData += 1
    if (oddsMatchIds.has(match.id) && analysisLooksDefaultStale(analysis)) analysisSummary.defaultAnalysisRemaining += 1
  }

  const fixtureEnrichment = {
    oddsRowsCount: oddsRows.length,
    fixturesWithMarketData: rankingReadiness.hasMarketDataCount,
    fixturesWithoutMarketData: rankingReadiness.noMarketData,
    readyFixtures: rankingReadiness.ready,
    partialFixtures: rankingReadiness.partial,
    noMarketDataFixtures: rankingReadiness.noMarketData,
    pendingFixtures: rankingReadiness.pending,
  }

  return { rankingReadiness, fixtureEnrichment, analysisSummary }
}

function getDailyPhaseLimits(body: any) {
  const phaseLimits = body?.phaseLimits && typeof body.phaseLimits === 'object' ? body.phaseLimits : {}
  return {
    core: getPositiveLimit(phaseLimits.core, maxFootballEnrichmentLimit, maxFootballEnrichmentLimit),
    'fixture-enrichment': getPositiveLimit(phaseLimits['fixture-enrichment'], 10, maxFootballEnrichmentLimit),
    'team-enrichment': getPositiveLimit(phaseLimits['team-enrichment'], 10, maxFootballEnrichmentLimit),
    'league-enrichment': getPositiveLimit(phaseLimits['league-enrichment'], 10, maxFootballEnrichmentLimit),
    ranking: getPositiveLimit(phaseLimits.ranking, maxFootballEnrichmentLimit, maxFootballEnrichmentLimit),
  }
}

function getStepContinuation(step: any) {
  return createContinuationState({
    ...(step?.continuation_state && typeof step.continuation_state === 'object' ? step.continuation_state : {}),
    providerPage: step?.provider_page,
    fixtureOffset: step?.fixture_offset,
    oddsOffset: step?.odds_offset,
    processedFixtureCount: step?.processed_fixture_count,
    lastProcessedFixtureId: step?.last_processed_fixture_id,
    batchSignature: step?.batch_signature,
  })
}

async function persistStepContinuation(context: FootballEnrichmentContext, update: Record<string, unknown>) {
  const next = advanceContinuation(context.continuationState, update)
  context.continuationState = next
  if (!context.stepId) return next
  const result = await supabase
    .from('api_football_daily_sync_steps')
    .update({
      provider_page: next.providerPage,
      fixture_offset: next.fixtureOffset,
      odds_offset: next.oddsOffset,
      processed_fixture_count: next.processedFixtureCount,
      last_processed_fixture_id: next.lastProcessedFixtureId,
      batch_signature: next.batchSignature,
      continuation_state: next,
      ...systemVersions,
    })
    .eq('id', context.stepId)
    .eq('status', 'running')
    .eq('attempt_count', Number(context.stepAttemptCount ?? 0))
    .select('id')
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new Error('DAILY_SYNC_STEP_CLAIM_LOST')
  return next
}

function getMaxStepsPerRequest(body: Record<string, unknown>) {
  return getPositiveLimit(body.maxStepsPerRequest ?? body.autoAdvanceSteps, 1, 2)
}

function sumResultField(results: Array<any>, field: string) {
  return results.reduce((total, item) => total + Number(item?.[field] ?? 0), 0)
}

async function runDailyFullSyncMode(mode: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext, providerResult: any, started: number) {
  const fixtureLimit = getPositiveLimit(body.limit, defaultFootballEnrichmentLimit, maxFootballEnrichmentLimit)
  const enrichmentLimit = getPositiveLimit(body.enrichmentLimit, 20, maxFootballEnrichmentLimit)
  const matchLimit = getPositiveLimit(body.matchLimit, defaultManualLimit, maxManualLimit)
  const steps: Array<DailyFullSyncStepSummary> = []
  let processed = 0
  let totalCandidates = 0

  const dailySteps = [
    { step: 1, mode: 'daily-fixtures', limit: matchLimit, worker: () => syncApiFootballDailyFixtures(dayRange, matchLimit, context) },
    { step: 2, mode: 'coverage', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('coverage', body, dayRange, context) },
    { step: 3, mode: 'rounds', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('rounds', body, dayRange, context) },
    { step: 4, mode: 'fixture-enrich', limit: fixtureLimit, worker: () => executeFootballEnrichmentMode('fixture-enrich', body, dayRange, context) },
    { step: 5, mode: 'injuries', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('injuries', body, dayRange, context) },
    { step: 6, mode: 'squads', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('squads', body, dayRange, context) },
    { step: 7, mode: 'coaches', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('coaches', body, dayRange, context) },
    { step: 8, mode: 'venues', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('venues', body, dayRange, context) },
    { step: 9, mode: 'top-players', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('top-players', body, dayRange, context) },
    { step: 10, mode: 'market-ready-ranking', limit: maxFootballEnrichmentLimit, worker: () => runDailyRankingStep(dayRange, context) },
  ]

  for (const item of dailySteps) {
    if (shouldStopForExecutionBudget(context)) break
    if (context.rateLimited && item.mode !== 'market-ready-ranking') {
      const skipped = await logDailyStepSkipped(context, item.step, item.mode)
      steps.push(skipped)
      continue
    }

    context.limit = item.limit
    const before = cloneEndpointCounters(context.endpoints)
    const summary = await runDailyStep(context, item.step, item.mode, item.worker, before)
    steps.push(summary)
    processed += summary.processed
    totalCandidates += summary.totalCandidates
  }

  const failed = steps.reduce((total, step) => total + step.failed, 0)
  return {
    providerResult,
    totalCandidates,
    totalFetched: totalCandidates,
    processed,
    skippedByLimit: 0,
    failures: failed ? steps.filter((step) => step.failed > 0).map((step) => ({ message: `${step.mode}: ${step.message ?? 'failed'}` })) : [],
    rankedSelectionRows: steps.find((step) => step.mode === 'market-ready-ranking')?.processed ?? 0,
    topSelections: await fetchTopSelectionsDebug(dayRange).catch(() => []),
    endpointCoverage: context.endpoints,
    enrichedMatches: [],
    processedMatches: [],
    skippedEndpoints: context.skippedEndpoints,
    rateLimited: context.rateLimited,
    durationMs: Date.now() - started,
    steps,
    limits: { fixtureLimit, enrichmentLimit, matchLimit },
  }
}

async function runDailyStep(context: FootballEnrichmentContext, step: number, mode: string, worker: () => Promise<any>, before: Record<string, FootballEnrichmentEndpointCounter>) {
  const startedAt = Date.now()
  await logEnrichmentSync({ mode: context.mode, endpoint: `daily:${mode}`, status: 'started', started_at: new Date().toISOString(), finished_at: new Date().toISOString() })
  try {
    const result = await worker()
    const endpointDelta = diffEndpointCounters(before, context.endpoints)
    const processed = Number(result?.processed ?? 0)
    const totalCandidates = Number(result?.totalCandidates ?? 0)
    const rowsSaved = Number(result?.rowsSaved ?? endpointDelta.rowsSaved ?? processed)
    const failed = Number(result?.failed ?? endpointDelta.failed ?? 0)
    const skipped = Number(result?.skipped ?? endpointDelta.skipped ?? 0)
    const status = failed > 0 ? 'partial_success' : rowsSaved > 0 || processed > 0 ? 'success' : 'empty'
    await logEnrichmentSync({ mode: context.mode, endpoint: `daily:${mode}`, status: status === 'partial_success' ? 'success' : status, results_count: rowsSaved, finished_at: new Date().toISOString() })
    await logEnrichmentSync({ mode: context.mode, endpoint: `daily:${mode}`, status: 'finished', results_count: rowsSaved, finished_at: new Date().toISOString() })
    return { step, mode, status, processed, totalCandidates, rowsSaved, failed, skipped, rateLimited: context.rateLimited, durationMs: Date.now() - startedAt }
  } catch (error) {
    const message = error instanceof Error ? error.message : `${mode} failed`
    await logEnrichmentSync({ mode: context.mode, endpoint: `daily:${mode}`, status: 'error', error_message: message, finished_at: new Date().toISOString() }).catch(() => {})
    await logEnrichmentSync({ mode: context.mode, endpoint: `daily:${mode}`, status: 'finished', error_message: message, finished_at: new Date().toISOString() }).catch(() => {})
    return { step, mode, status: 'error' as const, processed: 0, totalCandidates: 0, rowsSaved: 0, failed: 1, skipped: 0, rateLimited: context.rateLimited, durationMs: Date.now() - startedAt, message }
  }
}

async function logDailyStepSkipped(context: FootballEnrichmentContext, step: number, mode: string) {
  await logEnrichmentSync({ mode: context.mode, endpoint: `daily:${mode}`, status: 'skipped_not_due', error_message: 'Skipped because API-Football rate limit protection stopped earlier steps', finished_at: new Date().toISOString() })
  await logEnrichmentSync({ mode: context.mode, endpoint: `daily:${mode}`, status: 'finished', error_message: 'Skipped because API-Football rate limit protection stopped earlier steps', finished_at: new Date().toISOString() })
  return { step, mode, status: 'skipped_not_due' as const, processed: 0, totalCandidates: 0, rowsSaved: 0, failed: 0, skipped: 1, rateLimited: context.rateLimited, durationMs: 0, message: 'rate limit protection' }
}

async function syncApiFootballDailyFixtures(dayRange: ReturnType<typeof getBangkokDayRange>, batchSize: number, context: FootballEnrichmentContext) {
  const providerPage = API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE
  const discovery = await fetchApiFootballFixturesWithPaging(dayRange.dateKey, context)
  const matches = [...discovery.matches].sort(compareFixtureSyncPriority)
  const selected = selectDailyFixtureBatch(matches, context.continuationState?.fixtureOffset, batchSize)
  const offset = selected.fixtureOffset
  const batch = selected.batch
  const batchSignature = buildBatchSignature(batch.map((match: any) => match?.raw_fixture_id ?? match?.id))
  if (!shouldProcessBatch(context.continuationState, batchSignature)) {
    const cursor = advanceDailyFixtureCursor({ totalFixtures: selected.totalFixtures, fixtureOffset: offset, advancedBy: batch.length, batchComplete: true })
    await persistStepContinuation(context, { providerPage: cursor.providerPage, fixtureOffset: cursor.fixtureOffset })
    return { processed: 0, totalCandidates: matches.length, rowsSaved: 0, failed: 0, skipped: batch.length, partial: !cursor.providerComplete, nextOffset: cursor.fixtureOffset, hasMore: !cursor.providerComplete, providerComplete: cursor.providerComplete, batchSignature, duplicateBatchSkipped: true }
  }

  const startedAt = Date.now()
  let processed = 0
  const failures: Array<{ matchId?: number; message: string }> = []
  for (const footballDataMatch of batch) {
    if (Date.now() - startedAt > 18_000 || shouldStopForExecutionBudget(context)) break
    try {
      await syncMatch(footballDataMatch, { enrichFixtureData: false })
      processed += 1
      await persistStepContinuation(context, {
        providerPage,
        fixtureOffset: offset + processed,
        processedFixtureCount: Number(context.continuationState?.processedFixtureCount ?? 0) + 1,
        lastProcessedFixtureId: nullableNumber(footballDataMatch?.raw_fixture_id),
        batchSignature,
        batchComplete: false,
      })
    } catch (error) {
      failures.push({
        matchId: nullableNumber(footballDataMatch?.raw_fixture_id) ?? undefined,
        message: formatErrorMessage(error, 'fixture sync failed'),
      })
      break
    }
  }
  const batchComplete = processed === batch.length && failures.length === 0
  const cursor = advanceDailyFixtureCursor({ totalFixtures: selected.totalFixtures, fixtureOffset: offset, advancedBy: processed, batchComplete })
  await persistStepContinuation(context, {
    providerPage: cursor.providerPage,
    fixtureOffset: cursor.fixtureOffset,
    lastProcessedFixtureId: processed > 0 ? nullableNumber(batch[processed - 1]?.raw_fixture_id) : context.continuationState?.lastProcessedFixtureId,
    batchSignature,
    batchComplete,
  })
  return {
    processed,
    totalCandidates: matches.length,
    rowsSaved: processed,
    failed: failures.length,
    partial: !cursor.providerComplete,
    nextOffset: cursor.fixtureOffset,
    hasMore: !cursor.providerComplete,
    providerComplete: cursor.providerComplete,
    batchSignature,
    providerPageCount: discovery.pageCount,
    failures,
  }
}

async function runDailyRankingStep(dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const readinessBeforeRanking = await getRankingReadinessSummary(dayRange)
  if (shouldStopForExecutionBudget(context)) {
    return { processed: 0, totalCandidates: Number(readinessBeforeRanking.totalFixtures ?? 0), rowsSaved: 0, failed: 0, partial: true, rankingReadiness: readinessBeforeRanking, aiFinalPickRows: 0 }
  }
  const rankedSelectionRows = await updateDailySelectionRanks(dayRange, context)
  const rankingReadiness = await getRankingReadinessSummary(dayRange)
  const finalPickRows = shouldStopForExecutionBudget(context)
    ? { rowsSaved: 0, failed: 0 }
    : await recomputeAiFinalPicks(dayRange, { ...context, mode: 'recompute-ai-final-picks' })
  const totalFixtures = Number(rankingReadiness.totalFixtures ?? readinessBeforeRanking.totalFixtures ?? rankedSelectionRows)
  const readyFixtures = Number(rankingReadiness.ready ?? 0)
  const partial = totalFixtures > 0 && readyFixtures === 0
  return {
    processed: rankedSelectionRows,
    totalCandidates: rankedSelectionRows,
    rowsSaved: rankedSelectionRows + Number(finalPickRows.rowsSaved ?? 0),
    failed: Number(finalPickRows.failed ?? 0),
    partial,
    rankingReadiness,
    aiFinalPickRows: finalPickRows.rowsSaved ?? 0,
  }
}

async function executeFootballEnrichmentMode(mode: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  if (mode === 'coverage') return syncApiFootballCoverage(context)
  if (mode === 'rounds') return syncApiFootballRounds(context)
  if (mode === 'fixture-enrich') return syncApiFootballFixtureEnrichment(dayRange, context, body)
  if (mode === 'injuries') return syncApiFootballInjuries(String(body.date ?? context.dateKey), context)
  if (mode === 'squads') return syncApiFootballSquads(context)
  if (mode === 'coaches') return syncApiFootballCoaches(context)
  if (mode === 'venues') return syncApiFootballVenues(context)
  if (mode === 'top-players') return syncApiFootballTopPlayers(context)
  if (mode === 'sync-bookmakers') return syncApiFootballBookmakers(context)
  if (mode === 'sync-odds') return syncApiFootballOdds(body, dayRange, context)
  if (mode === 'sync-fixture-odds') return syncApiFootballFixtureOdds(body, dayRange, context)
  if (mode === 'recompute-ai-final-picks') return recomputeAiFinalPicks(dayRange, context)
  if (mode === 'recompute-ai-final-picks-date') return recomputeAiFinalPicksForSelectionDate(dayRange, context)
  if (mode === 'lock-daily-top10') return runLegacySelectionAlias(mode, dayRange, context)
  if (mode === 'get-daily-top10-status') return getDailyTop10Status(dayRange)
  if (mode === 'refresh-locked-top10-signals') return runLegacySelectionAlias(mode, dayRange, context)
  if (mode === 'refresh-market-ready-top10') return runLegacySelectionAlias(mode, dayRange, context)
  if (mode === 'select-usable-daily-picks') return runLegacySelectionAlias(mode, dayRange, context)
  if (mode === 'strict-api-football-daily-picks') return runLegacySelectionAlias(mode, dayRange, context)
  if (mode === 'sync-completed-fixtures') return syncCompletedFixtures(body, dayRange, context)
  if (mode === 'backfill-ai-pick-results') return backfillAiPickResults(body, dayRange)
  if (mode === 'settle-ai-pick-results') return settleAiPickResults(body, dayRange)
  if (mode === 'settle-ai-pick-results-date') return settleAiPickResults({ ...body, selectionDate: body.selectionDate ?? dayRange.dateKey }, dayRange)
  if (mode === 'recompute-performance-daily') return recomputePerformanceDaily(body, dayRange)
  if (mode === 'result-refresh') return resultRefresh(body, dayRange, context)
  if (mode === 'diagnose-result-pipeline') return diagnoseResultPipeline(body, dayRange, context)
  return { processed: 0, totalCandidates: 0 }
}

async function runLegacySelectionAlias(mode: string, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const result = await runDailyRankingStep(dayRange, { ...context, mode: 'market-ready-ranking' })
  return { ...result, compatibilityAlias: mode, canonicalMode: 'market-ready-ranking' }
}

async function resultRefresh(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const backfill = await withResultStage('result-refresh backfill-ai-pick-results', 'RESULT_REFRESH_BACKFILL_FAILED', () => backfillAiPickResults(body, dayRange))
  const sync = await withResultStage('result-refresh sync-completed-fixtures', 'RESULT_REFRESH_SYNC_FAILED', () => syncCompletedFixtures(body, dayRange, context), 'api-football')
  const settle = await withResultStage('result-refresh settle-ai-pick-results', 'RESULT_REFRESH_SETTLE_FAILED', () => settleAiPickResults(body, dayRange))
  const performance = await withResultStage('result-refresh recompute-performance-daily', 'RESULT_REFRESH_PERFORMANCE_FAILED', () => recomputePerformanceDaily(body, dayRange))
  return {
    processed: Number(backfill.processed ?? 0) + Number(sync.processed ?? 0) + Number(settle.processed ?? 0),
    provider: 'supabase',
    totalCandidates: Number(sync.totalCandidates ?? 0),
    rowsSaved: Number(backfill.rowsSaved ?? 0) + Number(sync.rowsSaved ?? 0) + Number(settle.rowsSaved ?? 0),
    failed: Number(sync.failed ?? 0) + Number(settle.failed ?? 0),
    candidates: sync.candidates ?? 0,
    syncedFixtures: sync.syncedFixtures ?? 0,
    finishedMatches: sync.finishedMatches ?? 0,
    voidMatches: sync.voidMatches ?? 0,
    pendingMatches: sync.pendingMatches ?? 0,
    scoreUpdatedRows: sync.scoreUpdatedRows ?? 0,
    resultRowsInserted: backfill.inserted ?? 0,
    resultRowsUpdated: backfill.updated ?? 0,
    resultRowsSettled: settle.settled ?? 0,
    resultRowsVoid: settle.voided ?? 0,
    settledRows: settle.settledRows ?? 0,
    fixtureDiagnostics: sync.fixtureDiagnostics ?? [],
    backfill,
    sync,
    settle,
    performance,
  }
}

async function syncCompletedFixtures(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const candidates = await withResultStage('load result candidates', 'RESULT_SYNC_CANDIDATES_FAILED', () => fetchCompletedFixtureCandidates(body, dayRange, context.limit))
  let syncedFixtures = 0
  let finishedMatches = 0
  let voidMatches = 0
  let pendingMatches = 0
  let failed = 0
  let scoreUpdatedRows = 0
  const fixtureDiagnostics: Array<Record<string, unknown>> = []
  const failures: Array<Record<string, unknown>> = []

  for (const candidate of candidates.rows) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    const sourceMatchApiFixtureId = candidate.api_fixture_id ?? candidate.api_sports_fixture_id ?? null
    const fixtureId = normalizeResultFixtureId(sourceMatchApiFixtureId)
    if (!fixtureId) continue
    const diagnostic = {
      matchId: candidate.id,
      normalizedFixtureId: fixtureId,
      matchedBy: candidate.matchedBy ?? 'football_matches',
      sourceMatchApiFixtureId,
      resultApiFixtureId: candidate.result_api_fixture_id ?? null,
    }
    fixtureDiagnostics.push(diagnostic)
    const response = await withResultStage('fetch api-football fixture', 'RESULT_SYNC_API_FETCH_FAILED', () => trackedApiFootballGet(context, '/fixtures', { id: fixtureId }, { apiFixtureId: fixtureId }), 'api-football')
    if (!response.ok) {
      failed += 1
      failures.push({ fixtureId, error: response.error ?? 'api-football request failed' })
      continue
    }
    const rawFixture = Array.isArray(response.data) ? response.data[0] : null
    if (!rawFixture) {
      pendingMatches += 1
      await withResultStage('update football_matches score', 'RESULT_SYNC_UPDATE_MATCH_FAILED', () => markFixtureChecked(candidate.id, fixtureId, null))
      scoreUpdatedRows += 1
      continue
    }
    const patch = normalizeResultFixturePatch(rawFixture)
    await withResultStage('update football_matches score', 'RESULT_SYNC_UPDATE_MATCH_FAILED', async () => {
      const update = await supabase.from('football_matches').update(patch).eq('id', candidate.id)
      if (update.error) throw update.error
      return update
    })
    scoreUpdatedRows += 1
    syncedFixtures += 1
    if (isResultFinishedStatus(patch.status_short)) finishedMatches += 1
    else if (isResultVoidStatus(patch.status_short)) voidMatches += 1
    else pendingMatches += 1
  }

  return {
    processed: syncedFixtures,
    provider: 'api-football',
    totalCandidates: candidates.totalCandidates,
    candidates: candidates.totalCandidates,
    rowsSaved: syncedFixtures,
    failed,
    failures,
    syncedFixtures,
    finishedMatches,
    voidMatches,
    pendingMatches,
    scoreUpdatedRows,
    fixtureDiagnostics,
    normalizedFixtureId: fixtureDiagnostics[0]?.normalizedFixtureId ?? null,
    matchedBy: fixtureDiagnostics[0]?.matchedBy ?? null,
    sourceMatchApiFixtureId: fixtureDiagnostics[0]?.sourceMatchApiFixtureId ?? null,
    resultApiFixtureId: fixtureDiagnostics[0]?.resultApiFixtureId ?? null,
    processedFixtureIds: candidates.rows.map((row: any) => normalizeResultFixtureId(row.api_fixture_id ?? row.api_sports_fixture_id)).filter(Boolean),
  }
}

async function fetchCompletedFixtureCandidates(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
  const selectionDate = typeof body.selectionDate === 'string' ? body.selectionDate : null
  const nowIso = new Date().toISOString()
  const matchIds = new Set<string>()
  const fixtureIds = new Set<number>()
  const resultFixtureByMatch = new Map<string, number>()

  const addRows = (rows: Array<any>) => {
    for (const row of rows) {
      const matchId = row.match_id ?? row.match?.id ?? row.id
      const fixtureId = normalizeResultFixtureId(row.api_fixture_id ?? row.match?.api_fixture_id ?? row.match?.api_sports_fixture_id ?? row.api_sports_fixture_id)
      if (matchId) matchIds.add(String(matchId))
      if (matchId && fixtureId) resultFixtureByMatch.set(String(matchId), fixtureId)
      if (fixtureId) fixtureIds.add(fixtureId)
    }
  }

  const top10 = await withResultStage('query daily_top10_selections', 'RESULT_CANDIDATES_TOP10_FAILED', () => supabase
    .from('daily_top10_selections')
    .select('match_id, api_fixture_id, selection_date')
    .gte('selection_date', selectionDate ?? dayRange.dateFrom)
    .lte('selection_date', selectionDate ?? dayRange.dateTo)
    .limit(50))
  if (!top10.error) addRows(top10.data ?? [])

  const results = await withResultStage('query football_ai_pick_results', 'RESULT_CANDIDATES_RESULTS_FAILED', () => supabase
    .from('football_ai_pick_results')
    .select('match_id, api_fixture_id, selection_date')
    .gte('selection_date', selectionDate ?? dayRange.dateFrom)
    .lte('selection_date', selectionDate ?? dayRange.dateTo)
    .limit(50))
  if (!results.error) addRows(results.data ?? [])

  const finalPicks = await withResultStage('query football_ai_final_picks', 'RESULT_CANDIDATES_FINAL_PICKS_FAILED', () => supabase
    .from('football_ai_final_picks')
    .select('match_id, api_fixture_id, match:football_matches(id, api_fixture_id, api_sports_fixture_id, kickoff_at)')
    .limit(50))
  if (!finalPicks.error) addRows((finalPicks.data ?? []).filter((row: any) => {
    const kickoffAt = row.match?.kickoff_at
    return kickoffAt ? kickoffAt <= nowIso : true
  }))

  let query = supabase
    .from('football_matches')
    .select('id, api_fixture_id, api_sports_fixture_id, kickoff_at, status, status_short, api_fixture_last_checked_at', { count: 'exact' })
    .lte('kickoff_at', nowIso)
    .order('kickoff_at', { ascending: false })
    .limit(Math.max(1, limit))

  if (matchIds.size) query = query.in('id', [...matchIds])
  else if (fixtureIds.size) query = query.or([...fixtureIds].flatMap((id) => [
    `api_fixture_id.eq.${id}`,
    `api_fixture_id.eq.${-id}`,
    `api_sports_fixture_id.eq.${id}`,
    `api_sports_fixture_id.eq.${-id}`,
  ]).join(','))
  else query = query.gte('kickoff_at', dayRange.startUtc).lt('kickoff_at', dayRange.endUtc)

  const matches = await withResultStage('query football_matches', 'RESULT_CANDIDATES_MATCHES_FAILED', async () => {
    const result = await query
    if (result.error) throw result.error
    return result
  })
  const rows = (matches.data ?? [])
    .filter((row: any) => normalizeResultFixtureId(row.api_fixture_id ?? row.api_sports_fixture_id))
    .map((row: any) => {
      const normalizedFixtureId = normalizeResultFixtureId(row.api_fixture_id ?? row.api_sports_fixture_id)
      return {
        ...row,
        normalized_fixture_id: normalizedFixtureId,
        result_api_fixture_id: resultFixtureByMatch.get(String(row.id)) ?? null,
        matchedBy: resultFixtureByMatch.has(String(row.id))
          ? 'match_id'
          : normalizedFixtureId && fixtureIds.has(normalizedFixtureId)
          ? 'api_fixture_id_or_negative'
          : 'date_range',
      }
    })
    .slice(0, Math.max(1, limit))
  return { rows, totalCandidates: matches.count ?? rows.length }
}

async function backfillAiPickResults(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>) {
  const selectionDate = String(body.selectionDate ?? dayRange.dateKey)
  const top10 = await withResultStage('query daily_top10_selections', 'RESULT_BACKFILL_TOP10_FAILED', () => supabase
    .from('daily_top10_selections')
    .select('selection_date, match_id, api_fixture_id, ai_final_pick_id, signal, market_focus, confidence_score, risk_level')
    .eq('selection_date', selectionDate))
  if (top10.error) throw top10.error

  const matchIds = [...new Set((top10.data ?? []).map((row: any) => row.match_id).filter(Boolean))]
  const finalPicks = matchIds.length
    ? await withResultStage('query football_ai_final_picks', 'RESULT_BACKFILL_FINAL_PICKS_FAILED', () => supabase
      .from('football_ai_final_picks')
      .select('id, match_id, api_fixture_id, signal, market_focus, direction, confidence_score, risk_level')
      .in('match_id', matchIds))
    : { data: [], error: null }
  if (finalPicks.error) throw finalPicks.error
  const pickByMatch = new Map((finalPicks.data ?? []).map((pick: any) => [pick.match_id, pick]))

  const candidateRows = (top10.data ?? []).map((row: any) => {
    const pick = pickByMatch.get(row.match_id) ?? {}
    return {
      selection_date: row.selection_date ?? selectionDate,
      match_id: row.match_id,
      api_fixture_id: normalizeResultFixtureId(row.api_fixture_id ?? pick.api_fixture_id),
      ai_final_pick_id: row.ai_final_pick_id ?? pick.id ?? null,
      signal: pick.signal ?? row.signal ?? null,
      market_focus: pick.market_focus ?? row.market_focus ?? null,
      direction: pick.direction ?? null,
      confidence_score: pick.confidence_score ?? row.confidence_score ?? null,
      risk_level: pick.risk_level ?? row.risk_level ?? null,
    }
  })
  const rows = uniqueRowsByAiFinalPickId(candidateRows)
  const skippedMissingFinalPick = candidateRows.length - rows.length

  if (!rows.length) return { processed: 0, provider: 'supabase', totalCandidates: candidateRows.length, rowsSaved: 0, inserted: 0, updated: 0, skippedMissingFinalPick, selectionDate }
  const existingResultPickIds = await fetchExistingResultPickIds(rows.map((row: any) => row.ai_final_pick_id).filter(Boolean))
  const upsert = await withResultStage('upsert football_ai_pick_results', 'RESULT_BACKFILL_UPSERT_FAILED', () => supabase
    .from('football_ai_pick_results')
    .upsert(rows, { onConflict: 'ai_final_pick_id' })
    .select('id, ai_final_pick_id'))
  if (upsert.error) throw upsert.error
  const updated = rows.filter((row: any) => existingResultPickIds.has(row.ai_final_pick_id)).length
  const inserted = rows.length - updated
  return { processed: rows.length, provider: 'supabase', totalCandidates: candidateRows.length, rowsSaved: rows.length, inserted, updated, skippedMissingFinalPick, selectionDate }
}

function uniqueRowsByAiFinalPickId(rows: Array<Record<string, unknown>>) {
  const byPickId = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const pickId = typeof row.ai_final_pick_id === 'string' ? row.ai_final_pick_id : ''
    if (!pickId) continue
    byPickId.set(pickId, row)
  }
  return [...byPickId.values()]
}

async function fetchExistingResultPickIds(pickIds: Array<string>) {
  const ids = [...new Set(pickIds.filter(Boolean))]
  if (!ids.length) return new Set<string>()
  const existing = await withResultStage('query existing football_ai_pick_results', 'RESULT_BACKFILL_EXISTING_RESULTS_FAILED', () => supabase
    .from('football_ai_pick_results')
    .select('ai_final_pick_id')
    .in('ai_final_pick_id', ids))
  if (existing.error) throw existing.error
  return new Set((existing.data ?? []).map((row: any) => row.ai_final_pick_id).filter(Boolean))
}

async function settleAiPickResults(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>) {
  const selectionDate = typeof body.selectionDate === 'string' ? body.selectionDate : null
  let query = supabase
    .from('football_ai_pick_results')
    .select(`
      id,
      selection_date,
      match_id,
      api_fixture_id,
      market_focus,
      direction,
      settlement_status,
      match:football_matches(id, api_fixture_id, api_sports_fixture_id, status_short, status_long, status, home_score, away_score, home_goals, away_goals)
    `)
    .or('settlement_status.eq.PENDING,home_score.is.null,away_score.is.null')
    .limit(Math.max(1, Math.min(Number(body.limit ?? 100), 100)))

  if (selectionDate) query = query.eq('selection_date', selectionDate)

  const result = await withResultStage('query football_ai_pick_results', 'RESULT_SETTLE_QUERY_FAILED', async () => {
    const rows = await query
    if (rows.error) throw rows.error
    return rows
  })

  let settledRows = 0
  let settled = 0
  let voided = 0
  let pending = 0
  let failed = 0
  const failures: Array<Record<string, unknown>> = []

  for (const row of result.data ?? []) {
    const match = Array.isArray(row.match) ? row.match[0] : row.match
    if (!match) {
      failed += 1
      failures.push({ id: row.id, reason: 'match join not found' })
      continue
    }
    const matchHomeScore = nullableNumber(match.home_score ?? match.home_goals)
    const matchAwayScore = nullableNumber(match.away_score ?? match.away_goals)
    const matchStatusShort = normalizeResultStatusShort(match.status_short ?? match.status)
    const outcome = settleResultRow({
      market_focus: row.market_focus,
      direction: row.direction,
      status_short: matchStatusShort,
      home_score: matchHomeScore,
      away_score: matchAwayScore,
    })
    if (outcome.settlement_status === 'PENDING') {
      if (matchHomeScore !== null && matchAwayScore !== null) {
        const scoreUpdate = await withResultStage('refresh pending result score', 'RESULT_SETTLE_SCORE_UPDATE_FAILED', () => supabase
          .from('football_ai_pick_results')
          .update({
            api_fixture_id: normalizeResultFixtureId(row.api_fixture_id ?? match.api_fixture_id ?? match.api_sports_fixture_id),
            home_score: matchHomeScore,
            away_score: matchAwayScore,
            status_short: matchStatusShort,
            status_long: match.status_long ?? null,
          })
          .eq('id', row.id))
        if (scoreUpdate.error) throw scoreUpdate.error
        settledRows += 1
      }
      pending += 1
      continue
    }
    const update = await withResultStage('settle result rows', 'RESULT_SETTLE_UPDATE_FAILED', () => supabase
      .from('football_ai_pick_results')
      .update({
        api_fixture_id: normalizeResultFixtureId(row.api_fixture_id ?? match.api_fixture_id ?? match.api_sports_fixture_id),
        home_score: matchHomeScore,
        away_score: matchAwayScore,
        status_short: matchStatusShort,
        status_long: match.status_long ?? null,
        settlement_status: outcome.settlement_status,
        simulation_outcome: outcome.simulation_outcome,
        settlement_reason: outcome.settlement_reason,
        settled_at: new Date().toISOString(),
      })
      .eq('id', row.id))
    if (update.error) throw update.error
    settledRows += 1
    if (outcome.settlement_status === 'VOID') voided += 1
    else settled += 1
  }

  return { processed: settled + voided, provider: 'supabase', totalCandidates: (result.data ?? []).length, rowsSaved: settled + voided, settled, voided, pending, failed, failures, settledRows }
}

async function recomputePerformanceDaily(_body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>) {
  const count = await withResultStage('recompute performance daily', 'RESULT_PERFORMANCE_DAILY_FAILED', () => supabase
    .from('football_ai_pick_results')
    .select('id', { count: 'exact', head: true })
    .gte('selection_date', dayRange.dateFrom)
    .lte('selection_date', dayRange.dateTo))
  if (count.error) return { processed: 0, provider: 'supabase', totalCandidates: 0, rowsSaved: 0, skipped: 1, reason: sanitizeText(count.error.message) }
  return { processed: 0, provider: 'supabase', totalCandidates: count.count ?? 0, rowsSaved: 0, skipped: 1, reason: 'no performance daily table configured' }
}

async function diagnoseResultPipeline(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const selectionDate = typeof body.selectionDate === 'string' ? body.selectionDate : null
  const limit = Math.max(1, Math.min(Number(body.limit ?? context.limit ?? 10), 20))
  const checks: Record<string, unknown> = {}

  checks.football_matches = await runDiagnosticCheck('football_matches', async () => {
    const query = supabase
      .from('football_matches')
      .select('id, api_fixture_id, kickoff_at, status_short, home_score, away_score', { count: 'exact' })
      .gte('kickoff_at', dayRange.startUtc)
      .lt('kickoff_at', dayRange.endUtc)
      .limit(limit)
    return query
  })

  checks.daily_top10_selections = await runDiagnosticCheck('daily_top10_selections', async () => {
    let query = supabase
      .from('daily_top10_selections')
      .select('id, selection_date, match_id, api_fixture_id, ai_final_pick_id', { count: 'exact' })
      .gte('selection_date', selectionDate ?? dayRange.dateFrom)
      .lte('selection_date', selectionDate ?? dayRange.dateTo)
      .limit(limit)
    return query
  })

  checks.football_ai_final_picks = await runDiagnosticCheck('football_ai_final_picks', async () => {
    const query = supabase
      .from('football_ai_final_picks')
      .select('id, match_id, api_fixture_id, signal, market_focus', { count: 'exact' })
      .limit(limit)
    return query
  })

  checks.football_ai_pick_results = await runDiagnosticCheck('football_ai_pick_results', async () => {
    let query = supabase
      .from('football_ai_pick_results')
      .select('id, match_id, api_fixture_id, selection_date, settlement_status, simulation_outcome', { count: 'exact' })
      .limit(limit)
    if (selectionDate) query = query.eq('selection_date', selectionDate)
    else query = query.gte('selection_date', dayRange.dateFrom).lte('selection_date', dayRange.dateTo)
    return query
  })

  const ready = Object.values(checks).every((check: any) => check?.ok === true)
  const resultRowsCheck = checks.football_ai_pick_results as any
  const recommendedFix = ready
    ? null
    : resultRowsCheck?.schemaCacheError || resultRowsCheck?.missingTable
    ? 'apply migration or reload schema cache'
    : 'inspect failed checks and rerun result-refresh after fixing schema/data readiness'

  return {
    processed: 0,
    totalCandidates: Number((checks.daily_top10_selections as any)?.rows ?? 0),
    rowsSaved: 0,
    provider: 'supabase',
    checks,
    ready,
    recommendedFix,
    selectionDate,
    dateFrom: dayRange.dateFrom,
    dateTo: dayRange.dateTo,
  }
}

async function runDiagnosticCheck(name: string, queryFn: () => PromiseLike<any>) {
  try {
    const result = await queryFn()
    if (result.error) throw result.error
    return {
      ok: true,
      rows: Array.isArray(result.data) ? result.data.length : 0,
      count: result.count ?? null,
      sample: Array.isArray(result.data) ? result.data.slice(0, 3) : [],
    }
  } catch (error) {
    const details = sanitizeErrorDetails(error)
    return {
      ok: false,
      errorCode: details.code ?? 'DIAGNOSTIC_CHECK_FAILED',
      errorMessage: details.message,
      errorDetails: details,
      missingTable: isMissingRelationError(error),
      schemaCacheError: isSchemaCacheError(error),
      check: name,
    }
  }
}

async function markFixtureChecked(matchId: string, fixtureId: number, rawFixture: unknown) {
  const update = await supabase.from('football_matches').update({
    api_fixture_last_checked_at: new Date().toISOString(),
    api_fixture_payload: rawFixture ? compactFixturePayload(rawFixture) : null,
  }).eq('id', matchId)
  if (update.error) throw update.error
}

function normalizeResultFixturePatch(row: any) {
  const fixture = row?.fixture ?? {}
  const goals = row?.goals ?? {}
  const score = row?.score ?? {}
  const statusShort = normalizeResultStatusShort(fixture.status?.short)
  const homeScore = nullableNumber(score?.fulltime?.home ?? goals?.home)
  const awayScore = nullableNumber(score?.fulltime?.away ?? goals?.away)
  const now = new Date().toISOString()
  return {
    status: statusShort,
    status_short: statusShort,
    status_long: fixture.status?.long ?? null,
    match_status: statusShort,
    elapsed: nullableNumber(fixture.status?.elapsed),
    home_goals: homeScore,
    away_goals: awayScore,
    home_score: homeScore,
    away_score: awayScore,
    halftime_home_score: nullableNumber(score?.halftime?.home),
    halftime_away_score: nullableNumber(score?.halftime?.away),
    fulltime_home_score: homeScore,
    fulltime_away_score: awayScore,
    extra_home_score: nullableNumber(score?.extratime?.home),
    extra_away_score: nullableNumber(score?.extratime?.away),
    penalty_home_score: nullableNumber(score?.penalty?.home),
    penalty_away_score: nullableNumber(score?.penalty?.away),
    finished_at: isResultFinishedStatus(statusShort) ? now : null,
    score_synced_at: now,
    api_fixture_last_checked_at: now,
    api_fixture_payload: compactFixturePayload(row),
  }
}

function compactFixturePayload(row: any) {
  return {
    fixture: {
      id: row?.fixture?.id ?? null,
      date: row?.fixture?.date ?? null,
      status: row?.fixture?.status ?? null,
    },
    goals: row?.goals ?? null,
    score: row?.score ?? null,
    teams: row?.teams ? {
      home: { id: row.teams.home?.id ?? null, name: row.teams.home?.name ?? null },
      away: { id: row.teams.away?.id ?? null, name: row.teams.away?.name ?? null },
    } : null,
  }
}

function settleResultRow(input: any) {
  const statusShort = normalizeResultStatusShort(input.status_short ?? input.status)
  const homeScore = nullableNumber(input.home_score)
  const awayScore = nullableNumber(input.away_score)
  if (isResultVoidStatus(statusShort)) return { settlement_status: 'VOID', simulation_outcome: 'VOID', settlement_reason: `void match status ${statusShort}` }
  if (!isResultFinishedStatus(statusShort)) return { settlement_status: 'PENDING', simulation_outcome: 'PENDING', settlement_reason: `match status ${statusShort} is not finished` }
  if (homeScore === null || awayScore === null) return { settlement_status: 'PENDING', simulation_outcome: 'PENDING', settlement_reason: 'finished match is missing score' }
  const market = String(input.market_focus ?? '').toUpperCase()
  const direction = normalizeResultDirection(input.direction)
  const line = extractResultLine(input.direction)
  if (market === 'MATCH_WINNER') {
    const result = homeScore > awayScore ? 'HOME' : homeScore < awayScore ? 'AWAY' : 'DRAW'
    if (!['HOME', 'AWAY', 'DRAW'].includes(direction)) return resultVoid('match winner pick is missing direction')
    return resultSettled(direction === result ? 'HIT' : 'MISS', `MATCH_WINNER ${direction} vs result ${result}`)
  }
  if (market === 'OU') {
    if (line === null) return resultVoid('finished OU pick is missing line')
    const total = homeScore + awayScore
    if (total === line) return resultSettled('PUSH', `OU ${direction} ${line} total ${total}`)
    const hit = direction === 'OVER' ? total > line : total < line
    return ['OVER', 'UNDER'].includes(direction) ? resultSettled(hit ? 'HIT' : 'MISS', `OU ${direction} ${line} total ${total}`) : resultVoid('OU pick is missing OVER/UNDER direction')
  }
  if (market === 'AH') {
    if (line === null) return resultVoid('finished AH pick is missing line')
    if (!['HOME', 'AWAY'].includes(direction)) return resultVoid('AH pick is missing HOME/AWAY direction')
    const margin = direction === 'HOME' ? homeScore - awayScore : awayScore - homeScore
    const adjusted = margin + line
    if (adjusted === 0) return resultSettled('PUSH', `AH ${direction} ${line} margin ${margin}`)
    return resultSettled(adjusted > 0 ? 'HIT' : 'MISS', `AH ${direction} ${line} margin ${margin}`)
  }
  return resultVoid(`unsupported market ${market || 'UNKNOWN'}`)
}

function resultSettled(simulation_outcome: string, settlement_reason: string) {
  return { settlement_status: 'SETTLED', simulation_outcome, settlement_reason }
}

function resultVoid(settlement_reason: string) {
  return { settlement_status: 'VOID', simulation_outcome: 'VOID', settlement_reason }
}

function normalizeResultDirection(value: unknown) {
  const text = String(value ?? '').toUpperCase()
  if (text.includes('OVER')) return 'OVER'
  if (text.includes('UNDER')) return 'UNDER'
  if (text.includes('HOME')) return 'HOME'
  if (text.includes('AWAY')) return 'AWAY'
  if (text.includes('DRAW')) return 'DRAW'
  return text.trim()
}

function extractResultLine(value: unknown) {
  const match = String(value ?? '').match(/[+-]?\d+(?:\.\d+)?/)
  return match ? nullableNumber(match[0]) : null
}

function normalizeResultStatusShort(value: unknown) {
  const status = String(value ?? '').toUpperCase()
  if (status === 'FINISHED') return 'FT'
  if (status === 'POSTPONED') return 'PST'
  if (status === 'CANCELLED') return 'CANC'
  if (status === 'ABANDONED') return 'ABD'
  return status || 'NS'
}

function normalizeResultFixtureId(value: unknown) {
  const numeric = nullableNumber(value)
  if (numeric === null || numeric === 0) return null
  return Math.abs(Math.trunc(numeric))
}

function isResultFinishedStatus(value: unknown) {
  return ['FT', 'AET', 'PEN'].includes(normalizeResultStatusShort(value))
}

function isResultVoidStatus(value: unknown) {
  return ['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(normalizeResultStatusShort(value))
}

class ResultPipelineError extends Error {
  errorCode: string
  errorStage: string
  provider: string
  errorDetails: Record<string, unknown>
  failures: Array<unknown>

  constructor(errorCode: string, errorStage: string, error: unknown, provider = 'supabase') {
    const details = sanitizeErrorDetails(error)
    super(details.message, { cause: error })
    this.name = 'ResultPipelineError'
    this.errorCode = errorCode
    this.errorStage = errorStage
    this.provider = provider
    const upstreamDetails = error && typeof error === 'object' && (error as any).errorDetails && typeof (error as any).errorDetails === 'object'
      ? sanitizeDiagnosticValue((error as any).errorDetails) as Record<string, unknown>
      : null
    this.errorDetails = upstreamDetails ? { ...details, ...upstreamDetails } : details
    this.failures = Array.isArray((error as any)?.failures) ? (error as any).failures.map(sanitizeDiagnosticValue) : []
  }
}

class DailySyncPhaseError extends ResultPipelineError {
  constructor(phase: string, error: unknown) {
    const raw = error as any
    const inferred = inferStructuredError(error)
    super(
      sanitizeText(raw?.errorCode ?? inferred.errorCode ?? 'DAILY_SYNC_PHASE_FAILED'),
      sanitizeText(phase || raw?.errorStage || 'daily-sync'),
      error,
      sanitizeProviderName(String(raw?.provider ?? inferred.provider ?? 'api-football')),
    )
    this.name = 'DailySyncPhaseError'
  }
}

async function withResultStage<T>(errorStage: string, errorCode: string, worker: () => PromiseLike<T>, provider = 'supabase'): Promise<T> {
  try {
    const result = await worker()
    if ((result as any)?.error) throw (result as any).error
    return result
  } catch (error) {
    if (error instanceof ResultPipelineError) throw error
    const raw = error as any
    const inferred = inferStructuredError(error)
    throw new ResultPipelineError(
      sanitizeText(raw?.errorCode ?? inferred.errorCode ?? errorCode),
      errorStage,
      error,
      sanitizeProviderName(String(raw?.provider ?? inferred.provider ?? provider)),
    )
  }
}

function buildSyncErrorResponse(error: unknown, mode: string, fallbackProvider: string) {
  const raw = error as any
  const inferred = inferStructuredError(error)
  const resultError = error instanceof ResultPipelineError
    ? error
    : new ResultPipelineError(
      sanitizeText(raw?.errorCode ?? inferred.errorCode ?? getDefaultErrorCode(mode)),
      sanitizeText(raw?.errorStage ?? getDefaultErrorStage(mode)),
      error,
      sanitizeProviderName(String(raw?.provider ?? inferred.provider ?? (isResultPipelineMode(mode) ? 'supabase' : fallbackProvider))),
    )
  const provider = sanitizeProviderName(resultError.provider || fallbackProvider)
  return {
    ok: false,
    provider,
    fallbackUsed: false,
    fallbackProvider: null,
    mode,
    message: 'sync failed',
    errorCode: resultError.errorCode,
    errorStage: resultError.errorStage,
    errorMessage: sanitizeText(resultError.message || 'sync failed'),
    errorDetails: resultError.errorDetails,
    failures: resultError.failures,
  }
}

function inferStructuredError(error: unknown) {
  const raw = error as any
  const text = `${raw?.message ?? ''} ${raw?.details ?? ''} ${raw?.bodyPreview ?? ''}`.toLowerCase()
  const status = Number(raw?.status ?? raw?.statusCode ?? text.match(/(?:http\s*)?(\d{3})/)?.[1] ?? 0)
  if (raw instanceof UpstreamResponseError) return { errorCode: raw.errorCode, provider: raw.provider }
  if (text.includes('supabase_upstream_timeout') || text.includes('supabase upstream timed out') || ([408, 504, 522, 524].includes(status) && (text.includes('supabase') || text.includes('cloudflare')))) {
    return { errorCode: 'SUPABASE_UPSTREAM_TIMEOUT', provider: 'supabase' }
  }
  if (text.includes('upstream_html_error') || text.includes('<!doctype html') || text.includes('<html')) {
    return { errorCode: 'UPSTREAM_HTML_ERROR', provider: raw?.provider ?? 'supabase' }
  }
  return { errorCode: null, provider: null }
}

function getDefaultErrorCode(mode: string) {
  if (mode === 'backfill-ai-pick-results') return 'RESULT_BACKFILL_FAILED'
  if (mode === 'sync-completed-fixtures') return 'RESULT_SYNC_FAILED'
  if (mode === 'settle-ai-pick-results' || mode === 'settle-ai-pick-results-date') return 'RESULT_SETTLE_FAILED'
  if (mode === 'recompute-performance-daily') return 'RESULT_PERFORMANCE_DAILY_FAILED'
  if (mode === 'result-refresh') return 'RESULT_REFRESH_FAILED'
  if (mode === 'diagnose-result-pipeline') return 'RESULT_DIAGNOSE_FAILED'
  return 'SYNC_FAILED'
}

function getDefaultErrorStage(mode: string) {
  if (isResultPipelineMode(mode)) return mode
  return 'sync'
}

function sanitizeErrorDetails(error: unknown): Record<string, unknown> {
  const raw = error as any
  return {
    message: sanitizeText(raw?.message ?? String(error ?? 'sync failed')),
    details: raw?.details ? sanitizeText(raw.details) : null,
    hint: raw?.hint ? sanitizeText(raw.hint) : null,
    code: raw?.code ? sanitizeText(raw.code) : null,
    status: raw?.status ?? raw?.statusCode ?? null,
    contentType: raw?.contentType ? sanitizeText(raw.contentType) : null,
    bodyPreview: raw?.bodyPreview ? sanitizeText(raw.bodyPreview) : null,
    name: raw?.name ? sanitizeText(raw.name) : null,
  }
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  return sanitizeReliabilityDiagnosticValue(value, { secrets: getSensitiveValues() })
}

function sanitizeText(value: unknown) {
  return sanitizeReliabilityText(value, { secrets: getSensitiveValues() })
}

function getSensitiveValues() {
  return [serviceRoleKey, API_FOOTBALL_KEY, FOOTBALL_DATA_TOKEN, ...secretKeys].filter(Boolean)
}

function sanitizeProviderName(value: string) {
  if (value === 'supabase') return 'supabase'
  if (value === 'api-football') return 'api-football'
  if (value === 'football-data.org') return 'football-data.org'
  return isResultPipelineMode(value) ? 'supabase' : requestedProviderName
}

function isMissingRelationError(error: unknown) {
  const details = sanitizeErrorDetails(error)
  const text = `${details.message ?? ''} ${details.details ?? ''}`.toLowerCase()
  return details.code === '42P01' || text.includes('does not exist') || text.includes('could not find the table')
}

function isSchemaCacheError(error: unknown) {
  const details = sanitizeErrorDetails(error)
  const text = `${details.message ?? ''} ${details.details ?? ''}`.toLowerCase()
  return details.code === 'PGRST205' || text.includes('schema cache')
}

function createFootballEnrichmentContext(mode: string, limit: number, dateKey: string, requestStartedMs = Date.now(), requestedBudgetMs?: unknown): FootballEnrichmentContext {
  return {
    mode,
    limit,
    dateKey,
    rateLimited: false,
    deadlineReached: false,
    executionBudget: createExecutionBudget(requestStartedMs, requestedBudgetMs),
    endpoints: {},
    skippedEndpoints: [],
  }
}

function shouldStopForExecutionBudget(context: FootballEnrichmentContext, minimumRemainingMs?: number) {
  if (context.deadlineReached) return true
  if (!shouldDeferExecution(context.executionBudget, Date.now(), minimumRemainingMs)) return false
  context.deadlineReached = true
  return true
}

async function syncApiFootballCoverage(context: FootballEnrichmentContext) {
  const candidates = await fetchDistinctApiFootballLeagues()
  const selected = selectCoreAuxiliaryBatch(candidates, context.continuationState?.coverageOffset, context.limit)
  const leagues = selected.batch
  let processed = 0
  let processedCandidates = 0
  if (selected.complete) {
    const completed = advanceCoreAuxiliaryContinuation(context.continuationState, 'coverage', {
      advancedBy: 0,
      totalCandidates: selected.totalCandidates,
      complete: true,
    })
    await persistStepContinuation(context, completed)
  }
  for (const item of leagues) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    const response = await trackedApiFootballGet(context, '/leagues', { id: item.api_league_id, season: item.season }, { apiLeagueId: item.api_league_id, season: item.season })
    if (!response.ok) break
    const rows = (response.data ?? []).map((row: any) => normalizeLeagueCoverage(row, item))
    await upsertApiFootballData('api_football_league_coverage', 'api_league_id,season', rows)
    addEndpointRowsSaved(context, '/leagues', rows.length)
    processed += rows.length
    processedCandidates += 1
    const completed = selected.offset + processedCandidates >= selected.totalCandidates
    const next = advanceCoreAuxiliaryContinuation(context.continuationState, 'coverage', {
      advancedBy: 1,
      totalCandidates: selected.totalCandidates,
      complete: completed,
    })
    await persistStepContinuation(context, next)
  }
  const continuation = getCoreAuxiliaryContinuation(context.continuationState)
  return {
    processed,
    processedCandidates,
    totalCandidates: selected.totalCandidates,
    partial: !continuation.coverageComplete,
    hasMore: !continuation.coverageComplete,
    nextOffset: continuation.coverageOffset,
    coverageComplete: continuation.coverageComplete,
  }
}

async function syncApiFootballRounds(context: FootballEnrichmentContext) {
  const candidates = await fetchDistinctApiFootballLeagues()
  const selected = selectCoreAuxiliaryBatch(candidates, context.continuationState?.roundsOffset, context.limit)
  const leagues = selected.batch
  let processed = 0
  let processedCandidates = 0
  if (selected.complete) {
    const completed = advanceCoreAuxiliaryContinuation(context.continuationState, 'rounds', {
      advancedBy: 0,
      totalCandidates: selected.totalCandidates,
      complete: true,
    })
    await persistStepContinuation(context, completed)
  }
  for (const item of leagues) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    const allRounds = await trackedApiFootballGet(context, '/fixtures/rounds', { league: item.api_league_id, season: item.season }, { apiLeagueId: item.api_league_id, season: item.season })
    if (!allRounds.ok || context.rateLimited) break
    const current = await trackedApiFootballGet(context, '/fixtures/rounds', { league: item.api_league_id, season: item.season, current: 'true' }, { apiLeagueId: item.api_league_id, season: item.season })
    if (!current.ok) break
    const currentRound = Array.isArray(current.data) ? current.data[0] : null
    const rows = (allRounds.data ?? []).map((roundName: string, index: number) => ({
      api_league_id: item.api_league_id,
      season: item.season,
      round_name: String(roundName),
      is_current: currentRound ? String(roundName) === String(currentRound) : false,
      round_order: index + 1,
      raw_payload: { round: roundName, current: currentRound },
      synced_at: new Date().toISOString(),
    }))
    await upsertApiFootballData('api_football_rounds', 'api_league_id,season,round_name', rows)
    addEndpointRowsSaved(context, '/fixtures/rounds', rows.length)
    processed += rows.length
    processedCandidates += 1
    const completed = selected.offset + processedCandidates >= selected.totalCandidates
    const next = advanceCoreAuxiliaryContinuation(context.continuationState, 'rounds', {
      advancedBy: 1,
      totalCandidates: selected.totalCandidates,
      complete: completed,
    })
    await persistStepContinuation(context, next)
  }
  const continuation = getCoreAuxiliaryContinuation(context.continuationState)
  return {
    processed,
    processedCandidates,
    totalCandidates: selected.totalCandidates,
    partial: !continuation.roundsComplete,
    hasMore: !continuation.roundsComplete,
    nextOffset: continuation.roundsOffset,
    roundsComplete: continuation.roundsComplete,
  }
}

async function syncApiFootballFixtureEnrichment(dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext, body: Record<string, unknown> = {}) {
  const offset = Number(context.continuationState?.fixtureOffset ?? getSyncOffset(body.offset))
  const candidates = await fetchApiFootballFixtureCandidates(dayRange, context.limit, offset)
  const fixtures = candidates.rows
  const batchSignature = buildBatchSignature(fixtures.map((match: any) => match.api_sports_fixture_id))
  if (!shouldProcessBatch(context.continuationState, batchSignature)) {
    const nextOffset = offset + fixtures.length
    await persistStepContinuation(context, { fixtureOffset: nextOffset })
    return {
      processed: 0,
      totalCandidates: candidates.totalCandidates,
      rowsSaved: 0,
      failed: 0,
      skipped: fixtures.length,
      partial: nextOffset < candidates.totalCandidates,
      nextOffset,
      hasMore: nextOffset < candidates.totalCandidates,
      batchSignature,
      duplicateBatchSkipped: true,
    }
  }
  let processed = 0
  let rowsSaved = 0
  let emptyFixtures = 0
  let failedFixtures = 0
  const initialProcessedFixtureCount = Number(context.continuationState?.processedFixtureCount ?? 0)
  for (const group of chunk(fixtures, footballEnrichmentChunkSize)) {
    for (const match of group) {
      if (context.rateLimited || shouldStopForExecutionBudget(context)) break
      const result = await enrichOneApiFootballFixture(match, context)
      processed += result.processed
      rowsSaved += result.rowsSaved
      emptyFixtures += result.empty
      failedFixtures += result.failed
      const attempted = processed + emptyFixtures + failedFixtures
      await persistStepContinuation(context, {
        fixtureOffset: offset + attempted,
        processedFixtureCount: initialProcessedFixtureCount + attempted,
        lastProcessedFixtureId: nullableNumber(match.api_sports_fixture_id),
        batchSignature,
        batchComplete: false,
      })
    }
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
  }
  const attempted = processed + emptyFixtures + failedFixtures
  const nextOffset = offset + attempted
  const attemptedRows = fixtures.slice(0, attempted)
  const batchComplete = attempted === fixtures.length && failedFixtures === 0 && !context.deadlineReached
  await persistStepContinuation(context, {
    fixtureOffset: nextOffset,
    processedFixtureCount: initialProcessedFixtureCount + attempted,
    lastProcessedFixtureId: nullableNumber(attemptedRows.at(-1)?.api_sports_fixture_id),
    batchSignature,
    batchComplete,
  })
  return {
    processed,
    totalCandidates: candidates.totalCandidates,
    rowsSaved,
    failed: failedFixtures,
    skipped: emptyFixtures,
    partial: context.deadlineReached || nextOffset < candidates.totalCandidates || failedFixtures > 0 || (fixtures.length > 0 && rowsSaved === 0),
    nextOffset,
    hasMore: nextOffset < candidates.totalCandidates,
    batchSignature,
    fixtureDetail: {
      attempted: processed + emptyFixtures + failedFixtures,
      success: processed,
      rowsSaved,
      empty: emptyFixtures,
      error: failedFixtures,
    },
  }
}

async function enrichOneApiFootballFixture(match: any, context: FootballEnrichmentContext) {
  const fixtureId = getMatchFixtureId(match)
  if (!fixtureId) return { processed: 0, rowsSaved: 0, empty: 0, failed: 0 }
  const coverage = await fetchCoverageForMatch(match)
  let saved = 0
  let attempted = 0
  let success = 0
  let empty = 0
  let error = 0
  let skippedNoCoverage = 0
  const calls = [
    { endpoint: '/fixtures/statistics', coverageKey: 'has_fixture_statistics', normalizer: normalizeFixtureStatisticsRows, table: 'api_football_fixture_statistics', conflict: 'api_fixture_id,api_team_id' },
    { endpoint: '/fixtures/events', coverageKey: 'has_events', normalizer: normalizeFixtureEventRows, table: 'api_football_fixture_events', conflict: '' },
    { endpoint: '/fixtures/lineups', coverageKey: 'has_lineups', normalizer: normalizeFixtureLineupRows, table: 'api_football_fixture_lineups', conflict: 'api_fixture_id,api_team_id' },
    { endpoint: '/fixtures/players', coverageKey: 'has_player_statistics', normalizer: normalizeFixturePlayerRows, table: 'api_football_fixture_players', conflict: 'api_fixture_id,api_team_id,api_player_id' },
  ]

  for (const call of calls) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    if (!shouldFetchFixtureEnrichment(match, call.endpoint)) {
      await logEnrichmentSync({ mode: context.mode, api_fixture_id: fixtureId, api_league_id: getMatchLeagueId(match), season: getMatchSeason(match), endpoint: call.endpoint, status: 'skipped_not_due' })
      rememberSkippedEndpoint(context, call.endpoint, 'skipped_not_due', { apiFixtureId: fixtureId, apiLeagueId: getMatchLeagueId(match), season: getMatchSeason(match) })
      continue
    }
    if (coverage && !hasCoverage(coverage, call.coverageKey)) {
      await logEnrichmentSync({ mode: context.mode, api_fixture_id: fixtureId, api_league_id: getMatchLeagueId(match), season: getMatchSeason(match), endpoint: call.endpoint, status: 'skipped_no_coverage' })
      rememberSkippedEndpoint(context, call.endpoint, 'skipped_no_coverage', { apiFixtureId: fixtureId, apiLeagueId: getMatchLeagueId(match), season: getMatchSeason(match) })
      addEndpointSkipped(context, call.endpoint)
      skippedNoCoverage += 1
      continue
    }
    attempted += 1
    const response = await trackedApiFootballGet(context, call.endpoint, { fixture: fixtureId }, { apiFixtureId: fixtureId, apiLeagueId: getMatchLeagueId(match), season: getMatchSeason(match) })
    if (!response.ok) {
      error += 1
      continue
    }
    const rows = call.normalizer(response.data ?? [], fixtureId)
    if (call.table === 'api_football_fixture_events') {
      await replaceApiFootballRows(call.table, { api_fixture_id: fixtureId }, rows)
    } else {
      await upsertApiFootballData(call.table, call.conflict, rows)
    }
    addEndpointRowsSaved(context, call.endpoint, rows.length)
    success += 1
    if (!rows.length) empty += 1
    saved += rows.length
  }
  const hasFixtureDetail = saved > 0
  const status = error > 0 && !hasFixtureDetail ? 'FAILED' : skippedNoCoverage > 0 && attempted === 0 ? 'SKIPPED_NO_COVERAGE' : hasFixtureDetail ? 'PARTIAL' : 'PENDING'
  await updateMatchReadinessMetadata(match.id, {
    fixtureId,
    fixtureDetail: endpointAttemptSummary({ attempted, success, rowsSaved: saved, empty, error }),
    hasFixtureDetail,
    status,
    error: error > 0 ? 'fixture detail enrichment failed' : null,
  })
  return { processed: hasFixtureDetail ? 1 : 0, rowsSaved: saved, empty: hasFixtureDetail ? 0 : 1, failed: error > 0 && !hasFixtureDetail ? 1 : 0 }
}

async function syncApiFootballInjuries(dateKey: string, context: FootballEnrichmentContext) {
  const fixtures = await fetchApiFootballFixtureCandidates(getBangkokDayRange(dateKey), context.limit)
  const leagues = (await fetchDistinctApiFootballLeagues()).slice(0, context.limit)
  let processed = 0

  for (const match of fixtures) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    const fixtureId = getMatchFixtureId(match)
    if (!fixtureId) continue
    const coverage = await fetchCoverageForMatch(match)
    if (coverage && !hasCoverage(coverage, 'has_injuries')) {
      await logEnrichmentSync({ mode: context.mode, api_fixture_id: fixtureId, api_league_id: getMatchLeagueId(match), season: getMatchSeason(match), endpoint: '/injuries', status: 'skipped_no_coverage' })
      rememberSkippedEndpoint(context, '/injuries', 'skipped_no_coverage', { apiFixtureId: fixtureId, apiLeagueId: getMatchLeagueId(match), season: getMatchSeason(match) })
      addEndpointSkipped(context, '/injuries')
      continue
    }
    const response = await trackedApiFootballGet(context, '/injuries', { fixture: fixtureId }, { apiFixtureId: fixtureId, apiLeagueId: getMatchLeagueId(match), season: getMatchSeason(match) })
    if (!response.ok) continue
    const rows = normalizeInjuryRows(response.data ?? [])
    await replaceApiFootballRows('api_football_injuries', { api_fixture_id: fixtureId }, rows)
    addEndpointRowsSaved(context, '/injuries', rows.length)
    processed += rows.length
  }

  for (const item of leagues) {
    if (context.rateLimited || processed >= context.limit || shouldStopForExecutionBudget(context)) break
    const coverage = await fetchCoverageForLeague(item.api_league_id, item.season)
    if (coverage && !hasCoverage(coverage, 'has_injuries')) {
      await logEnrichmentSync({ mode: context.mode, api_league_id: item.api_league_id, season: item.season, endpoint: '/injuries', status: 'skipped_no_coverage' })
      rememberSkippedEndpoint(context, '/injuries', 'skipped_no_coverage', { apiLeagueId: item.api_league_id, season: item.season })
      addEndpointSkipped(context, '/injuries')
      continue
    }
    const response = await trackedApiFootballGet(context, '/injuries', { league: item.api_league_id, season: item.season, date: dateKey }, { apiLeagueId: item.api_league_id, season: item.season })
    if (!response.ok) continue
    const rows = normalizeInjuryRows(response.data ?? [])
    await replaceApiFootballRows('api_football_injuries', { api_league_id: item.api_league_id, season: item.season }, rows)
    addEndpointRowsSaved(context, '/injuries', rows.length)
    processed += rows.length
  }
  return { processed, totalCandidates: fixtures.length + leagues.length }
}

async function syncApiFootballSquads(context: FootballEnrichmentContext) {
  const teams = (await fetchDistinctApiFootballTeams()).slice(0, context.limit)
  let processed = 0
  for (const team of teams) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    const response = await trackedApiFootballGet(context, '/players/squads', { team: team.api_team_id }, { apiTeamId: team.api_team_id })
    if (!response.ok) continue
    const rows = normalizeSquadRows(response.data ?? [], team)
    await upsertApiFootballData('api_football_squads', 'api_team_id,api_player_id', rows)
    addEndpointRowsSaved(context, '/players/squads', rows.length)
    processed += rows.length
  }
  return { processed, totalCandidates: teams.length }
}

async function syncApiFootballCoaches(context: FootballEnrichmentContext) {
  const teams = (await fetchDistinctApiFootballTeams()).slice(0, context.limit)
  let processed = 0
  for (const team of teams) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    const response = await trackedApiFootballGet(context, '/coachs', { team: team.api_team_id }, { apiTeamId: team.api_team_id })
    if (!response.ok) continue
    const rows = normalizeCoachRows(response.data ?? [], team)
    await upsertApiFootballData('api_football_coaches', 'api_coach_id,api_team_id', rows)
    addEndpointRowsSaved(context, '/coachs', rows.length)
    processed += rows.length
  }
  return { processed, totalCandidates: teams.length }
}

async function syncApiFootballVenues(context: FootballEnrichmentContext) {
  const venues = (await fetchDistinctApiFootballVenues()).slice(0, context.limit)
  let processed = 0
  for (const venue of venues) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    if (!venue.api_venue_id) {
      const fallback = normalizeVenueFallbackRow(venue)
      await upsertApiFootballData('api_football_venues', 'api_venue_id', fallback ? [fallback] : [])
      if (fallback) processed += 1
      continue
    }
    const response = await trackedApiFootballGet(context, '/venues', { id: venue.api_venue_id }, {})
    if (!response.ok) continue
    const rows = normalizeVenueRows(response.data ?? [], venue)
    await upsertApiFootballData('api_football_venues', 'api_venue_id', rows)
    addEndpointRowsSaved(context, '/venues', rows.length)
    processed += rows.length
  }
  return { processed, totalCandidates: venues.length }
}

async function syncApiFootballTopPlayers(context: FootballEnrichmentContext) {
  const leagues = (await fetchDistinctApiFootballLeagues()).slice(0, context.limit)
  const endpoints = [
    { endpoint: '/players/topscorers', category: 'top_scorers', coverageKey: 'has_top_scorers' },
    { endpoint: '/players/topassists', category: 'top_assists', coverageKey: 'has_top_assists' },
    { endpoint: '/players/topyellowcards', category: 'top_yellow_cards', coverageKey: 'has_top_cards' },
    { endpoint: '/players/topredcards', category: 'top_red_cards', coverageKey: 'has_top_cards' },
  ]
  let processed = 0
  for (const league of leagues) {
    if (context.rateLimited || shouldStopForExecutionBudget(context)) break
    const coverage = await fetchCoverageForLeague(league.api_league_id, league.season)
    for (const item of endpoints) {
      if (context.rateLimited || shouldStopForExecutionBudget(context)) break
      if (coverage && !hasCoverage(coverage, item.coverageKey)) {
        await logEnrichmentSync({ mode: context.mode, api_league_id: league.api_league_id, season: league.season, endpoint: item.endpoint, status: 'skipped_no_coverage' })
        rememberSkippedEndpoint(context, item.endpoint, 'skipped_no_coverage', { apiLeagueId: league.api_league_id, season: league.season })
        addEndpointSkipped(context, item.endpoint)
        continue
      }
      const response = await trackedApiFootballGet(context, item.endpoint, { league: league.api_league_id, season: league.season }, { apiLeagueId: league.api_league_id, season: league.season })
      if (!response.ok) continue
      const rows = normalizeTopPlayerRows(response.data ?? [], item.category, league)
      await upsertApiFootballData('api_football_top_players', 'category,api_league_id,season,api_player_id', rows)
      addEndpointRowsSaved(context, item.endpoint, rows.length)
      processed += rows.length
    }
  }
  return { processed, totalCandidates: leagues.length }
}

async function syncApiFootballBookmakers(context: FootballEnrichmentContext) {
  const response = await trackedApiFootballGet(context, '/odds/bookmakers', {}, {})
  if (!response.ok) return { processed: 0, totalCandidates: 1, rowsSaved: 0, failed: 1 }
  const rows = (response.data ?? []).map((item: any) => ({
    api_bookmaker_id: nullableNumber(item.id),
    name: String(item.name ?? '').trim(),
    raw: item,
    updated_at: new Date().toISOString(),
  })).filter((item: any) => item.api_bookmaker_id && item.name)
  await upsertApiFootballData('football_bookmakers', 'api_bookmaker_id', rows)
  addEndpointRowsSaved(context, '/odds/bookmakers', rows.length)
  return { processed: rows.length, totalCandidates: rows.length, rowsSaved: rows.length, failed: 0 }
}

async function syncApiFootballOdds(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const offset = context.stepId ? Number(context.continuationState?.oddsOffset ?? 0) : getSyncOffset(body.offset)
  const maxFixturesPerRun = getPositiveLimit(body.maxFixturesPerRun ?? body.limit ?? context.limit, 10, maxFootballEnrichmentLimit)
  const fixtureIds = normalizeFixtureIds(body.fixtureIds)
  const retryFailedOnly = body.retryFailedOnly === true
  const candidates = await fetchDbMatchCandidates(dayRange, Math.max(1, maxFixturesPerRun), true, { offset, fixtureIds, retryFailedOnly })
  return runOddsBatch(candidates.rows, candidates.totalCandidates, context, {
    offset,
    batchSize: maxFixturesPerRun,
    hardStopMs: 18000,
    onProgress: async ({ nextOffset, lastProcessedFixtureId, batchSignature, batchComplete }) => {
      await persistStepContinuation(context, {
        oddsOffset: nextOffset,
        processedFixtureCount: Math.max(Number(context.continuationState?.processedFixtureCount ?? 0), nextOffset),
        lastProcessedFixtureId,
        batchSignature,
        batchComplete,
      })
    },
  })
}

async function syncApiFootballFixtureOdds(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const fixtureId = nullableNumber(body.fixtureId ?? body.apiFixtureId ?? body.api_fixture_id)
  const fixtureIds = normalizeFixtureIds(body.fixtureIds)
  const matchId = typeof body.matchId === 'string' ? body.matchId : typeof body.match_id === 'string' ? body.match_id : ''
  const fixtureLimit = getPositiveLimit(body.maxFixturesPerRun ?? body.limit, 1, 3)
  let query = supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      api_sports_home_team_id,
      api_sports_away_team_id,
      kickoff_at,
      raw,
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, risk_level, ranking_score, final_rank, is_top_pick, raw)
    `)
    .limit(fixtureLimit)
  if (fixtureId) query = query.eq('api_sports_fixture_id', fixtureId)
  else if (fixtureIds.length) query = query.in('api_sports_fixture_id', fixtureIds)
  else if (matchId) query = query.eq('id', matchId)
  else query = query.gte('kickoff_at', dayRange.startUtc).lt('kickoff_at', dayRange.endUtc).not('api_sports_fixture_id', 'is', null)

  const result = await query
  if (result.error) throw result.error
  return runOddsBatch(result.data ?? [], result.data?.length ?? 0, context, {
    offset: 0,
    batchSize: fixtureLimit,
    hardStopMs: 18000,
  })
}

async function runOddsBatch(rows: Array<any>, totalCandidates: number, context: FootballEnrichmentContext, options: { offset: number; batchSize: number; hardStopMs: number; onProgress?: (state: { nextOffset: number; lastProcessedFixtureId: number | null; batchSignature: string; batchComplete: boolean }) => Promise<void> }) {
  const startedAt = Date.now()
  const batchSignature = buildBatchSignature(rows.map((match: any) => match.api_sports_fixture_id ?? match.id))
  if (!shouldProcessBatch(context.continuationState, batchSignature)) {
    const nextOffset = options.offset + rows.length
    if (options.onProgress) await options.onProgress({
      nextOffset,
      lastProcessedFixtureId: nullableNumber(rows.at(-1)?.api_sports_fixture_id),
      batchSignature,
      batchComplete: true,
    })
    return {
      processed: 0,
      totalCandidates,
      totalFetched: totalCandidates,
      rowsSaved: 0,
      failed: 0,
      skipped: rows.length,
      partial: nextOffset < totalCandidates,
      oddsAttempted: 0,
      oddsRowsSaved: 0,
      oddsEmptyFixtures: 0,
      oddsFailedFixtures: 0,
      responseStatus: 200,
      processedFixtures: 0,
      savedOdds: 0,
      failedFixtures: 0,
      emptyFixtures: 0,
      processedFixtureIds: [],
      skippedFixtureIds: rows.map((match: any) => Number(match.api_sports_fixture_id)).filter(Boolean),
      failures: [],
      nextOffset,
      hasMore: nextOffset < totalCandidates,
      batchSignature,
      duplicateBatchSkipped: true,
    }
  }
  const processedFixtureIds: Array<number> = []
  const skippedFixtureIds: Array<number> = []
  const failures: Array<any> = []
  let processedFixtures = 0
  let savedOdds = 0
  let failedFixtures = 0
  let emptyFixtures = 0
  let unchangedFixtures = 0
  let stoppedEarly = false

  for (const match of rows) {
    if (context.rateLimited || Date.now() - startedAt > options.hardStopMs || shouldStopForExecutionBudget(context)) {
      stoppedEarly = true
      break
    }

    try {
      const result = await syncOddsForMatch(match, context)
      if (result.fixtureId) {
        if (result.rowsSaved > 0) processedFixtureIds.push(result.fixtureId)
        if (result.skipped || result.empty > 0) skippedFixtureIds.push(result.fixtureId)
      }
      processedFixtures += result.processed
      savedOdds += result.rowsSaved
      failedFixtures += result.failed
      emptyFixtures += result.empty
      unchangedFixtures += Number(result.unchanged ?? 0)
      if (result.failure) failures.push(result.failure)
      const nextOffset = options.offset + processedFixtures
      if (options.onProgress) await options.onProgress({ nextOffset, lastProcessedFixtureId: result.fixtureId ?? null, batchSignature, batchComplete: false })
      if (result.failed > 0) break
    } catch (error) {
      const fixtureId = Number(match?.api_sports_fixture_id ?? match?.raw?.raw_fixture_id ?? 0) || null
      failedFixtures += 1
      if (fixtureId) skippedFixtureIds.push(fixtureId)
      const message = formatErrorMessage(error, 'odds fixture sync failed')
      failures.push({ fixtureId, message })
      await updateMatchReadinessMetadata(match.id, {
        fixtureId,
        odds: endpointAttemptSummary({ attempted: 1, success: 0, rowsSaved: 0, empty: 0, error: 1, message }),
        hasMarketData: false,
        status: 'FAILED',
        error: message,
      }).catch(() => {})
      await logEnrichmentSync({ mode: context.mode, api_fixture_id: fixtureId, endpoint: '/odds', status: 'partial_success', error_message: message }).catch(() => {})
      const nextOffset = options.offset + processedFixtures
      if (options.onProgress) await options.onProgress({ nextOffset, lastProcessedFixtureId: fixtureId, batchSignature, batchComplete: false })
      break
    }
  }

  const attempted = processedFixtures + failedFixtures
  const nextOffset = options.offset + processedFixtures
  const hasMore = failedFixtures > 0 || stoppedEarly || context.rateLimited || nextOffset < totalCandidates
  const anySuccess = processedFixtures > 0 || savedOdds > 0 || emptyFixtures > 0
  const allRateLimited = failures.some((failure) => String(failure?.message ?? '').includes('429') || failure?.rateLimited === true) && !anySuccess
  const responseStatus = allRateLimited ? 429 : 200
  const oddsAttempted = attempted
  const oddsRowsSaved = savedOdds
  const oddsEmptyFixtures = emptyFixtures
  const oddsFailedFixtures = failedFixtures
  const partial = failedFixtures > 0 || hasMore || stoppedEarly || context.rateLimited || (oddsAttempted > 0 && oddsRowsSaved === 0 && unchangedFixtures === 0)
  const batchComplete = failedFixtures === 0 && processedFixtures === rows.length
  if (options.onProgress && batchComplete) {
    await options.onProgress({
      nextOffset,
      lastProcessedFixtureId: nullableNumber(rows.at(-1)?.api_sports_fixture_id),
      batchSignature,
      batchComplete,
    })
  }

  return {
    processed: processedFixtures,
    totalCandidates,
    totalFetched: totalCandidates,
    rowsSaved: savedOdds,
    failed: failedFixtures,
    skipped: emptyFixtures,
    partial,
    oddsAttempted,
    oddsRowsSaved,
    oddsEmptyFixtures,
    oddsFailedFixtures,
    responseStatus,
    processedFixtures,
    savedOdds,
    failedFixtures,
    emptyFixtures,
    unchangedFixtures,
    processedFixtureIds,
    skippedFixtureIds: [...new Set(skippedFixtureIds)],
    failures,
    nextOffset,
    hasMore,
    batchSignature,
  }
}

async function syncOddsForMatch(match: any, context: FootballEnrichmentContext) {
  const fixtureId = Number(match.api_sports_fixture_id ?? match.raw?.raw_fixture_id ?? 0)
  if (!fixtureId) return { processed: 0, rowsSaved: 0, failed: 0, empty: 0, fixtureId: null, skipped: true, failure: null }

  let response: any = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    response = await trackedApiFootballGet(context, '/odds', { fixture: fixtureId }, { apiFixtureId: fixtureId })
    if (response.ok) break
    const message = String(response.error ?? '')
    const retryable = response.rateLimited || message.includes('api-football 429') || /api-football 5\d\d/i.test(message) || /network|fetch|timeout/i.test(message)
    if (!retryable || message.includes('api-football 403') || attempt >= 2) break
    await sleep(300 + Math.floor(Math.random() * 501))
  }

  if (!response?.ok) {
    await updateMatchReadinessMetadata(match.id, {
      fixtureId,
      odds: endpointAttemptSummary({ attempted: 1, success: 0, rowsSaved: 0, empty: 0, error: 1, message: response?.error ?? 'odds sync failed' }),
      hasMarketData: false,
      status: 'FAILED',
      error: response?.error ?? 'odds sync failed',
    })
    return {
      processed: 0,
      rowsSaved: 0,
      failed: 1,
      empty: 0,
      fixtureId,
      skipped: false,
      failure: {
        fixtureId,
        message: response?.error ?? 'odds sync failed',
        rateLimited: Boolean(response?.rateLimited),
      },
    }
  }

  const normalized = normalizeMatchOddsRows(match, fixtureId, response.data ?? [])
  if (!normalized.rows.length) {
    await updateMatchReadinessMetadata(match.id, {
      fixtureId,
      odds: endpointAttemptSummary({ attempted: 1, success: 1, rowsSaved: 0, empty: 1, error: 0 }),
      hasMarketData: false,
      status: 'NO_MARKET_DATA',
    })
    return { processed: 1, rowsSaved: 0, failed: 0, empty: 1, fixtureId, skipped: true, failure: null }
  }

  await storeFootballBookmakers(normalized.bookmakers)
  const stored = await storeFootballMatchOdds(match.id, normalized.rows)
  addEndpointRowsSaved(context, '/odds', stored.count)
  await updateMatchReadinessMetadata(match.id, {
    fixtureId,
    odds: endpointAttemptSummary({ attempted: 1, success: 1, rowsSaved: stored.count, empty: 0, error: 0 }),
    hasMarketData: true,
    status: 'READY',
  })
  return { processed: 1, rowsSaved: stored.count, failed: 0, empty: 0, unchanged: stored.unchanged ? 1 : 0, fixtureId, skipped: false, failure: null }
}

async function recomputeAiFinalPicks(dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      api_sports_home_team_id,
      api_sports_away_team_id,
      kickoff_at,
      odds_updated_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      raw,
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, ranking_score, final_rank, is_top_pick, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, market_reading_score, market_edge_score, odds_confidence_score, odds_movement_score, data_depth_score, value_market, value_side, value_line, latest_line, latest_odds, raw, ${analysisReadinessMetadataSelect})
    `)
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)
    .limit(200)

  if (result.error) throw result.error
  const rows = (result.data ?? [])
    .filter((match: any) => {
      const analysis = getAnalysis(match)
      return Boolean(analysis?.is_top_pick || analysis?.final_rank)
    })
    .sort((a: any, b: any) => Number(getAnalysis(a)?.final_rank ?? 999) - Number(getAnalysis(b)?.final_rank ?? 999))

  let processed = 0
  let rowsSaved = 0
  let failed = 0
  for (const match of rows) {
    if (shouldStopForExecutionBudget(context)) break
    try {
      await upsertAiFinalPickForMatch(match)
      processed += 1
      rowsSaved += 1
    } catch (error) {
      failed += 1
      await logEnrichmentSync({ mode: context.mode, api_fixture_id: match.api_sports_fixture_id, endpoint: 'recompute-ai-final-picks', status: 'error', error_message: error instanceof Error ? error.message : 'ai final pick failed' }).catch(() => {})
    }
  }
  return { processed, totalCandidates: rows.length, rowsSaved, failed }
}

async function recomputeAiFinalPicksForSelectionDate(dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const result = await recomputeAiFinalPicks(dayRange, context)
  return { ...result, selectionDate: dayRange.dateKey, source: 'canonical_market_ready_window' }
}

async function upsertAiFinalPickForMatch(match: any) {
  const odds = await fetchStoredMatchOdds(match.id)
  const pick = buildEdgeAiFinalPick({ ...match, odds })
  const payload = {
    match_id: match.id,
    api_fixture_id: nullableNumber(match.api_sports_fixture_id),
    signal: pick.signal,
    market_focus: pick.marketFocus,
    direction: pick.direction,
    confidence_score: pick.confidenceScore,
    risk_level: pick.riskLevel,
    key_reasons: pick.keyReasons,
    warning_signs: pick.warningSigns,
    market_signal: pick.marketSignal,
    final_summary: pick.finalSummary,
    ah_analysis: pick.ahAnalysis,
    ou_analysis: pick.ouAnalysis,
    pick_team: pick.pickTeam,
    pick_team_id: pick.pickTeamId,
    pick_side: pick.pickSide,
    pick_source: pick.pickSource,
    pick_market: pick.pickMarket,
    pick_market_id: pick.pickMarketId,
    pick_selection: pick.pickSelection,
    pick_price: pick.pickPrice,
    pick_confidence: pick.pickConfidence,
    primary_bookmaker: pick.primaryBookmaker,
    latest_odds: pick.latestOdds,
    analysis_status: pick.analysisStatus,
    recommendation_reason: pick.recommendationReason,
    market_data_used: pick.marketDataUsed,
    odds_rows_used: pick.oddsRowsUsed,
    recalculated_at: pick.recalculatedAt,
    analysis_version: pick.analysisVersion,
    selection_status: pick.selectionStatus,
    market_ready: pick.marketReady,
    primary_reason_code: pick.primaryReasonCode,
    reason_codes: pick.reasonCodes,
    decision_reason_th: pick.decisionReasonTh,
    decision_readiness_score: pick.decisionReadinessScore,
    last_market_refresh_at: pick.lastMarketRefreshAt,
    last_analysis_at: pick.lastAnalysisAt,
    ...systemVersions,
    raw: pick,
    updated_at: new Date().toISOString(),
  }
  const upsert = await upsertAiFinalPickPayload(payload)
  if (upsert.error) throw upsert.error
  return upsert.data
}

async function upsertAiFinalPickPayload(payload: Record<string, unknown>) {
  const selectColumns = [
    'id',
    'match_id',
    'signal',
    'market_focus',
    'confidence_score',
    'risk_level',
    'pick_team',
    'pick_team_id',
    'pick_side',
    'pick_source',
    'pick_market',
    'pick_selection',
    'pick_price',
    'selection_status',
    'market_ready',
    'primary_reason_code',
  ].join(', ')
  const result = await supabase.from('football_ai_final_picks').upsert(payload, { onConflict: 'match_id' }).select(selectColumns).single()
  if (!isMissingColumnError(result.error)) return result
  return supabase
    .from('football_ai_final_picks')
    .upsert(stripApiFootballPickPayload(payload), { onConflict: 'match_id' })
    .select('id, match_id, signal, market_focus, confidence_score, risk_level')
    .single()
}

async function lockDailyTop10(dayRange: ReturnType<typeof getBangkokDayRange>) {
  const selectionDate = dayRange.dateKey
  const existing = await supabase
    .from('daily_top10_selections')
    .select('*')
    .eq('selection_date', selectionDate)
    .order('rank', { ascending: true })
  if (existing.error) throw existing.error
  if ((existing.data ?? []).length) {
    const refreshed = await refreshMarketReadyTop10(dayRange)
    return { ...refreshed, locked: true, alreadyLocked: true }
  }

  const matches = await fetchDailyTop10LockCandidates(dayRange)
  const matchIds = matches.map((match: any) => match.id).filter(Boolean)
  const [picks, oddsByMatchId] = await Promise.all([
    fetchAiFinalPicksForMatches(matchIds),
    fetchStoredOddsByMatchIds(matchIds),
  ])
  const pickByMatch = new Map(picks.map((pick: any) => [pick.match_id, pick]))
  const selected = matches
    .map((match: any) => ({
      match,
      analysis: getAnalysis(match),
      pick: pickByMatch.get(match.id) ?? null,
      odds: oddsByMatchId.get(match.id) ?? [],
    }))
    .sort(compareDailyTop10LockCandidate)

  for (const item of selected) {
    try {
      item.pick = await upsertAiFinalPickForMatch(item.match)
    } catch (error) {
      console.warn('lock-daily-top10 ai final pick refresh failed', { matchId: item.match?.id, error: formatErrorMessage(error, 'ai final pick failed') })
    }
  }

  const rows = selected.map((item: any, index: number) => ({
    selection_date: selectionDate,
    match_id: item.match.id,
    api_fixture_id: nullableNumber(item.match.api_sports_fixture_id),
    rank: index + 1,
    selection_score: nullableNumber(item.analysis?.ranking_score ?? item.analysis?.calibrated_confidence_score ?? item.analysis?.confidence_score),
    ai_final_pick_id: item.pick?.id ?? null,
    signal: item.pick?.signal ?? 'SKIP',
    market_focus: item.pick?.market_focus ?? 'NONE',
    confidence_score: nullableNumber(item.pick?.confidence_score ?? item.analysis?.confidence_score),
    risk_level: normalizeRiskLevelText(item.pick?.risk_level ?? item.analysis?.risk_level ?? 'MEDIUM'),
    updated_at: new Date().toISOString(),
  }))

  if (rows.length) {
    const insert = await supabase.from('daily_top10_selections').insert(rows)
    if (insert.error) throw insert.error
  }
  const status = summarizeDailyTop10(selectionDate, rows)
  return { processed: rows.length, totalCandidates: matches.length, rowsSaved: rows.length, failed: 0, partial: false, locked: rows.length > 0, alreadyLocked: false, ...status }
}

async function getDailyTop10Status(dayRange: ReturnType<typeof getBangkokDayRange>) {
  const selectionDate = dayRange.dateKey
  const result = await supabase
    .from('daily_top10_selections')
    .select('*')
    .eq('selection_date', selectionDate)
    .order('rank', { ascending: true })
  if (result.error) throw result.error
  const rows = result.data ?? []
  const status = summarizeDailyTop10(selectionDate, rows)
  const matchIds = rows.map((row: any) => row.match_id).filter(Boolean)
  const oddsMatchIds = await fetchMatchIdsWithOdds(matchIds)
  return {
    processed: rows.length,
    totalCandidates: rows.length,
    rowsSaved: 0,
    failed: 0,
    locked: rows.length > 0,
    ...status,
    matchesWithOdds: oddsMatchIds.size,
    matchesWithoutOdds: Math.max(0, rows.length - oddsMatchIds.size),
  }
}

async function refreshLockedTop10Signals(dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const selectionDate = dayRange.dateKey
  const locked = await supabase
    .from('daily_top10_selections')
    .select('*')
    .eq('selection_date', selectionDate)
    .order('rank', { ascending: true })
  if (locked.error) throw locked.error

  let processed = 0
  let updated = 0
  let failed = 0
  const failures: Array<any> = []
  for (const row of locked.data ?? []) {
    try {
      const match = await fetchMatchForAiFinalPick(row.match_id)
      if (!match) throw new Error('locked match not found')
      try {
        await syncOddsForMatch(match, context)
      } catch (error) {
        failures.push({ matchId: row.match_id, rank: row.rank, stage: 'odds', message: formatErrorMessage(error, 'odds refresh failed') })
      }
      const pick = await upsertAiFinalPickForMatch(match)
      const patch = await supabase
        .from('daily_top10_selections')
        .update({
          ai_final_pick_id: pick.id,
          signal: pick.signal,
          market_focus: pick.market_focus,
          confidence_score: pick.confidence_score,
          risk_level: pick.risk_level,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (patch.error) throw patch.error
      processed += 1
      updated += 1
    } catch (error) {
      failed += 1
      failures.push({ matchId: row.match_id, rank: row.rank, message: formatErrorMessage(error, 'refresh failed') })
    }
  }
  return { processed, totalCandidates: locked.data?.length ?? 0, rowsSaved: updated, failed, updated, failures, selectionDate }
}

async function refreshMarketReadyTop10(dayRange: ReturnType<typeof getBangkokDayRange>) {
  const selectionDate = dayRange.dateKey
  const requestedSelectionDate = selectionDate
  const [locked, matches] = await Promise.all([
    supabase
      .from('daily_top10_selections')
      .select('*')
      .eq('selection_date', selectionDate)
      .order('rank', { ascending: true }),
    fetchDailyTop10LockCandidates(dayRange),
  ])
  if (locked.error) throw locked.error

  const existingRows = locked.data ?? []
  const matchIds = matches.map((match: any) => match.id).filter(Boolean)
  const [picks, oddsByMatchId] = await Promise.all([
    fetchAiFinalPicksForMatches(matchIds),
    fetchStoredOddsByMatchIds(matchIds),
  ])
  const pickByMatch = new Map(picks.map((pick: any) => [pick.match_id, pick]))
  const candidates = matches
    .map((match: any) => ({
      match,
      analysis: getAnalysis(match),
      pick: pickByMatch.get(match.id) ?? null,
      odds: oddsByMatchId.get(match.id) ?? [],
    }))
    .filter((item: any) => item.analysis)
    .sort(compareDailyTop10LockCandidate)

  const readyCandidates = candidates.filter((item: any) => isMarketReadyCandidate(item))
  const waitingCandidates = candidates.filter((item: any) => isWaitingMarketCandidate(item))
  const selected = candidates
  const selectedReady = selected.filter((item: any) => isMarketReadyCandidate(item))
  const selectedWaiting = selected.filter((item: any) => isWaitingMarketCandidate(item))
  const existingSummary = summarizeExistingMarketLock(existingRows, oddsByMatchId)
  const refreshedBecause = readyCandidates.length ? 'market_ready_candidates_available' : 'no_market_ready_candidates'
  const shouldPersist = Boolean(
    existingRows.length &&
      readyCandidates.length &&
      (existingSummary.staleNoMarketLockCount > existingRows.length / 2 ||
        readyCandidates.some((item: any) => !existingRows.some((row: any) => row.match_id === item.match.id))),
  )

  let rowsSaved = 0
  let failed = 0
  const failures: Array<any> = []

  if (shouldPersist || !existingRows.length) {
    const persistResult = await persistMarketReadyTop10(selectionDate, selected, existingRows)
    rowsSaved = persistResult.rowsSaved
    failed = persistResult.failed
    failures.push(...persistResult.failures)
  }

  return {
    processed: selected.length,
    totalCandidates: candidates.length,
    rowsSaved,
    failed,
    failures,
    selectionDate,
    requestedSelectionDate,
    resolvedDateKey: selectionDate,
    marketReadyCount: readyCandidates.length,
    signalReadyCount: readyCandidates.filter((item: any) => String(item.pick?.signal ?? '').toUpperCase() === 'STRONG_SIGNAL').length,
    waitingMarketCount: waitingCandidates.length,
    top10MarketReadyCount: selectedReady.length,
    displayedSignalCount: selectedReady.filter((item: any) => ['STRONG_SIGNAL', 'WATCH'].includes(String(item.pick?.signal ?? '').toUpperCase())).length,
    waitingMarketDataCount: selectedWaiting.length,
    noBetBecauseMarketMissingCount: selectedWaiting.filter((item: any) => normalizeRecommendationText(item.analysis?.recommendation) === 'NO BET').length,
    staleNoMarketLockCount: existingSummary.staleNoMarketLockCount,
    readyMatches: selectedReady.map(formatTop10RefreshMatch),
    waitingMatches: selectedWaiting.map(formatTop10RefreshMatch),
    refreshedBecause,
    refreshed: shouldPersist || !existingRows.length,
  }
}

async function selectUsableDailyPicks(dayRange: ReturnType<typeof getBangkokDayRange>, body: Record<string, unknown>) {
  const requestedSelectionDate = typeof body.selectionDate === 'string' && body.selectionDate ? body.selectionDate : dayRange.dateKey
  const resolvedDateKey = dayRange.dateKey
  const windowHours = getPositiveNumber(body.windowHours, 36, 72)
  const minPlayable = getPositiveNumber(body.minPlayable, 5, 20)
  const now = new Date()
  const firstWindowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000)
  const maxWindowHours = Math.max(windowHours, 48)
  const maxWindowEnd = new Date(now.getTime() + maxWindowHours * 60 * 60 * 1000)
  const allMatches = await fetchUsableDailyPickCandidates(now.toISOString(), maxWindowEnd.toISOString())
  const firstWindowMatches = allMatches.filter((match: any) => isKickoffInRange(match, now, firstWindowEnd))
  const firstWindowPlayable = firstWindowMatches.filter((match: any) => isPlayableStatusText(match.status_short ?? match.match_status ?? match.status))
  const useExpandedWindow = firstWindowPlayable.length < minPlayable
  const windowEnd = useExpandedWindow ? maxWindowEnd : firstWindowEnd
  const windowMatches = allMatches.filter((match: any) => isKickoffInRange(match, now, windowEnd))
  const playableMatches = windowMatches.filter((match: any) => isPlayableStatusText(match.status_short ?? match.match_status ?? match.status))
  const finishedMatches = windowMatches.filter((match: any) => isFinishedStatusText(match.status_short ?? match.match_status ?? match.status))
  const matchIds = playableMatches.map((match: any) => match.id).filter(Boolean)
  const [picks, oddsByMatchId, existing] = await Promise.all([
    fetchAiFinalPicksForMatches(matchIds),
    fetchStoredOddsByMatchIds(matchIds),
    supabase
      .from('daily_top10_selections')
      .select('*')
      .eq('selection_date', resolvedDateKey)
      .order('rank', { ascending: true }),
  ])
  if (existing.error) throw existing.error

  const pickByMatch = new Map(picks.map((pick: any) => [pick.match_id, pick]))
  const candidates = playableMatches
    .map((match: any) => ({
      match,
      analysis: getAnalysis(match),
      pick: pickByMatch.get(match.id) ?? null,
      odds: oddsByMatchId.get(match.id) ?? [],
    }))
  const candidatePool = buildDynamicDailyCandidatePool(candidates)

  const selected = candidatePool.sort(compareDailyTop10LockCandidate)
  const persistResult = await persistMarketReadyTop10(resolvedDateKey, selected, existing.data ?? [])
  const selectedReady = selected.filter((item: any) => dailyMarketReadinessPriority(item) <= 2)
  const selectedWaiting = selected.filter((item: any) => isWaitingMarketCandidate(item))
  const marketReadyCandidates = candidates.filter((item: any) => dailyMarketReadinessPriority(item) === 1)
  const waitingMarketCandidates = candidates.filter((item: any) => isWaitingMarketCandidate(item))
  const reason = getUsableSelectionReason({
    playableCount: playableMatches.length,
    selectedCount: selected.length,
    marketReadyCount: marketReadyCandidates.length,
    waitingCount: waitingMarketCandidates.length,
    finishedCount: finishedMatches.length,
    expanded: useExpandedWindow,
  })

  return {
    processed: selected.length,
    totalCandidates: candidates.length,
    candidatePoolSize: candidatePool.length,
    rowsSaved: persistResult.rowsSaved,
    rowsUpdated: persistResult.rowsUpdated,
    rowsInserted: persistResult.rowsInserted,
    rowsSkipped: persistResult.rowsSkipped,
    duplicateRankResolved: persistResult.duplicateRankResolved,
    failed: persistResult.failed,
    failures: persistResult.failures,
    status: persistResult.failed > 0 ? (persistResult.rowsSaved > 0 ? 'partial_success' : 'failed') : 'success',
    requestedSelectionDate,
    resolvedDateKey,
    selectionDate: resolvedDateKey,
    locked: selected.length > 0,
    lockedCount: selected.length,
    windowStart: now.toISOString(),
    windowEnd: windowEnd.toISOString(),
    windowHoursUsed: useExpandedWindow ? maxWindowHours : windowHours,
    totalFixturesInWindow: windowMatches.length,
    playableCandidates: playableMatches.length,
    marketReadyCandidates: marketReadyCandidates.length,
    waitingMarketCandidates: waitingMarketCandidates.length,
    finishedExcludedCount: finishedMatches.length,
    selectedCount: selected.length,
    readySelectedCount: selectedReady.length,
    waitingSelectedCount: selectedWaiting.length,
    reason,
    nextSyncSuggestion: marketReadyCandidates.length ? 'refresh_display_order' : 'sync_odds_then_reselect',
    refreshedBecause: reason,
    pipelineVersion: systemVersions.pipeline_version,
    versions: systemVersions,
    decisionDiagnostics: {
      fixtures_discovered: windowMatches.length,
      fixtures_eligible: playableMatches.length,
      candidates_initial: candidates.length,
      candidates_expanded: 0,
      market_any_ready: marketReadyCandidates.length,
      wait_count: waitingMarketCandidates.length,
    },
    skippedBecause: null,
    readyMatches: selectedReady.map(formatTop10RefreshMatch),
    waitingMatches: selectedWaiting.map(formatTop10RefreshMatch),
    refreshed: true,
  }
}

async function strictApiFootballDailyPicks(dayRange: ReturnType<typeof getBangkokDayRange>, body: Record<string, unknown>) {
  const selectionDate = typeof body.selectionDate === 'string' && body.selectionDate ? body.selectionDate : dayRange.dateKey
  const strictRange = getBangkokDayRange(selectionDate)
  const [matches, existing] = await Promise.all([
    fetchDailyTop10LockCandidates(strictRange),
    supabase
      .from('daily_top10_selections')
      .select('*')
      .eq('selection_date', selectionDate)
      .order('rank', { ascending: true }),
  ])
  if (existing.error) throw existing.error

  const playableMatches = matches.filter((match: any) =>
    isPlayableStatusText(match.status_short ?? match.match_status ?? match.status) &&
    hasStrictDailyFixtureCompleteness(match)
  )
  const matchIds = playableMatches.map((match: any) => match.id).filter(Boolean)
  const [picks, oddsByMatchId] = await Promise.all([
    fetchAiFinalPicksForMatches(matchIds),
    fetchStoredOddsByMatchIds(matchIds),
  ])
  const pickByMatch = new Map(picks.map((pick: any) => [pick.match_id, pick]))
  const candidates = playableMatches
    .map((match: any) => {
      const odds = oddsByMatchId.get(match.id) ?? []
      const pickTeam = deriveEdgePickTeamFromApiFootballOdds(match, odds)
      return {
        match,
        analysis: getAnalysis(match),
        pick: pickByMatch.get(match.id) ?? null,
        odds,
        pickTeam,
        strict: buildStrictApiFootballCandidate(match, odds, pickTeam),
      }
    })
    .sort(compareStrictApiFootballCandidateItems)

  const selected = candidates
  const persistResult = await persistMarketReadyTop10(selectionDate, selected, existing.data ?? [], { cleanupUnselected: true })
  const selectedStrict = selected.map((item: any) => item.strict)
  const matchesWithOddsCount = candidates.filter((item: any) => item.strict.hasApiFootballOdds).length
  const selectedWithOddsCount = selectedStrict.filter((item: any) => item.hasApiFootballOdds).length
  const selectedWithoutOddsCount = selectedStrict.filter((item: any) => !item.hasApiFootballOdds).length
  const selectedWithPickTeamCount = selectedStrict.filter((item: any) => Boolean(item.pickTeam)).length
  const selectedWithoutPickTeamCount = selectedStrict.filter((item: any) => !item.pickTeam).length
  const primaryMarketCount = selectedStrict.filter((item: any) => item.hasPrimaryMarket).length

  return {
    processed: selected.length,
    selectedCount: selected.length,
    totalCandidates: candidates.length,
    totalFixturesInDate: matches.length,
    rowsSaved: persistResult.rowsSaved,
    rowsUpdated: persistResult.rowsUpdated,
    rowsInserted: persistResult.rowsInserted,
    rowsSkipped: persistResult.rowsSkipped,
    rowsDeleted: persistResult.rowsDeleted,
    duplicateRankResolved: persistResult.duplicateRankResolved,
    failed: persistResult.failed,
    failures: persistResult.failures,
    status: persistResult.failed > 0 ? (persistResult.rowsSaved > 0 ? 'partial_success' : 'failed') : 'success',
    selectionDate,
    requestedSelectionDate: selectionDate,
    resolvedDateKey: selectionDate,
    matchesWithOddsCount,
    selectedWithOddsCount,
    selectedWithoutOddsCount,
    selectedWithPickTeamCount,
    selectedWithoutPickTeamCount,
    primaryMarketCount,
    marketPrioritySummary: summarizeStrictMarketPriority(selectedStrict),
    pickTeamCoverage: {
      withPickTeam: selectedWithPickTeamCount,
      withoutPickTeam: selectedWithoutPickTeamCount,
    },
    usedRollingWindow: false,
    usedNextDateFallback: false,
    selectedMatches: selected.map((item: any, index: number) => formatStrictSelectedMatch({ ...item, rank: index + 1 })),
  }
}

async function persistMarketReadyTop10(selectionDate: string, selected: Array<any>, existingRows: Array<any>, options: { cleanupUnselected?: boolean } = {}) {
  const exactRows = new Map(existingRows.map((row: any) => [row.match_id, row]))
  const rankRows = new Map(existingRows.map((row: any) => [Number(row.rank), row]))
  const assignedRowIds = new Set<string>()
  const deletedRowIds = new Set<string>()
  let rowsSaved = 0
  let rowsUpdated = 0
  let rowsInserted = 0
  let rowsSkipped = 0
  let rowsDeleted = 0
  let duplicateRankResolved = 0
  let failed = 0
  const failures: Array<any> = []

  for (const [index, item] of selected.entries()) {
    const desiredRank = index + 1
    const exactRow = exactRows.get(item.match.id)
    if (exactRow?.id && Number(exactRow.rank) !== desiredRank) {
      const cleanup = await supabase
        .from('daily_top10_selections')
        .delete()
        .eq('id', exactRow.id)
        .eq('selection_date', selectionDate)
      if (cleanup.error) {
        failed += 1
        failures.push({ matchId: item.match?.id, rank: desiredRank, message: formatErrorMessage(cleanup.error, 'resolve daily top10 rank conflict failed') })
      } else {
        assignedRowIds.add(exactRow.id)
        deletedRowIds.add(exactRow.id)
        duplicateRankResolved += 1
      }
    }
  }

  for (const [index, item] of selected.entries()) {
    try {
      item.pick = await upsertAiFinalPickForMatch(item.match)
      const payload = buildDailyTop10RowPayload(selectionDate, item, index)
      const desiredRank = index + 1
      const rawRankRow = rankRows.get(desiredRank)
      const rawExactRow = exactRows.get(item.match.id)
      const rankRow = rawRankRow?.id && !deletedRowIds.has(rawRankRow.id) ? rawRankRow : null
      const exactRow = rawExactRow?.id && !deletedRowIds.has(rawExactRow.id) ? rawExactRow : null
      let targetRow = rankRow ?? exactRow ?? null

      if (targetRow?.id) {
        if (assignedRowIds.has(targetRow.id)) targetRow = null
      }

      if (targetRow?.id) {
        assignedRowIds.add(targetRow.id)
        const update = await updateDailyTop10Row(targetRow.id, selectionDate, payload)
        if (update.error) throw update.error
        rowsUpdated += 1
      } else {
        const insert = await insertDailyTop10Row(payload)
        if (insert.error) throw insert.error
        rowsInserted += 1
      }
      rowsSaved += 1
    } catch (error) {
      failed += 1
      failures.push({ matchId: item.match?.id, rank: index + 1, message: formatErrorMessage(error, 'refresh market-ready top10 failed') })
    }
  }

  if (options.cleanupUnselected && selected.length) {
    for (const row of existingRows) {
      if (!row?.id || assignedRowIds.has(row.id) || deletedRowIds.has(row.id)) continue
      const cleanup = await supabase
        .from('daily_top10_selections')
        .delete()
        .eq('id', row.id)
        .eq('selection_date', selectionDate)
      if (cleanup.error) {
        failed += 1
        failures.push({ matchId: row.match_id, rank: row.rank, message: formatErrorMessage(cleanup.error, 'cleanup unselected strict daily row failed') })
      } else {
        rowsDeleted += 1
        deletedRowIds.add(row.id)
      }
    }
  }

  if (!selected.length) rowsSkipped = existingRows.length
  return { rowsSaved, rowsUpdated, rowsInserted, rowsSkipped, rowsDeleted, duplicateRankResolved, failed, failures }
}

function buildDailyTop10RowPayload(selectionDate: string, item: any, index: number) {
  return {
    selection_date: selectionDate,
    match_id: item.match.id,
    api_fixture_id: nullableNumber(item.match.api_sports_fixture_id),
    rank: index + 1,
    selection_score: nullableNumber(item.analysis?.ranking_score ?? item.analysis?.calibrated_confidence_score ?? item.analysis?.confidence_score),
    ai_final_pick_id: item.pick?.id ?? null,
    signal: item.pick?.signal ?? 'SKIP',
    market_focus: item.pick?.market_focus ?? 'NONE',
    pick_team: item.strict?.pickTeam ?? item.pickTeam?.pickTeam ?? null,
    pick_team_id: item.strict?.pickTeamId ?? item.pickTeam?.pickTeamId ?? null,
    pick_side: item.strict?.pickSide ?? item.pickTeam?.pickSide ?? null,
    pick_source: item.strict?.pickSource ?? item.pickTeam?.pickSource ?? null,
    pick_market: item.strict?.pickMarket ?? item.pickTeam?.pickMarket ?? null,
    pick_market_id: item.strict?.pickMarketId ?? item.pickTeam?.pickMarketId ?? null,
    pick_selection: item.strict?.pickSelection ?? item.pickTeam?.pickSelection ?? null,
    pick_price: nullableNumber(item.strict?.pickPrice ?? item.pickTeam?.pickPrice),
    pick_confidence: nullableNumber(item.pick?.pick_confidence ?? item.pickTeam?.pickConfidence),
    market_data_used: Boolean(item.pick?.market_data_used ?? item.strict?.hasApiFootballOdds ?? item.pickTeam?.hasApiFootballOdds ?? false),
    analysis_status: item.pick?.analysis_status ?? (item.strict?.hasApiFootballOdds ? 'API_FOOTBALL_ODDS_READY' : 'INSUFFICIENT_MARKET_DATA'),
    confidence_score: nullableNumber(item.pick?.confidence_score ?? item.analysis?.confidence_score),
    risk_level: normalizeRiskLevelText(item.pick?.risk_level ?? item.analysis?.risk_level ?? 'MEDIUM'),
    updated_at: new Date().toISOString(),
  }
}

async function updateDailyTop10Row(rowId: string, selectionDate: string, payload: Record<string, unknown>) {
  const result = await supabase
    .from('daily_top10_selections')
    .update(payload)
    .eq('id', rowId)
    .eq('selection_date', selectionDate)
  if (!isMissingColumnError(result.error)) return result
  return supabase
    .from('daily_top10_selections')
    .update(stripApiFootballPickPayload(payload))
    .eq('id', rowId)
    .eq('selection_date', selectionDate)
}

async function insertDailyTop10Row(payload: Record<string, unknown>) {
  const result = await supabase.from('daily_top10_selections').insert(payload)
  if (!isMissingColumnError(result.error)) return result
  return supabase.from('daily_top10_selections').insert(stripApiFootballPickPayload(payload))
}

function stripApiFootballPickPayload(payload: Record<string, unknown>) {
  const stripped = { ...payload }
  for (const key of [
    'pick_team',
    'pick_team_id',
    'pick_side',
    'pick_source',
    'pick_market',
    'pick_market_id',
    'pick_selection',
    'pick_price',
    'pick_confidence',
    'market_data_used',
    'analysis_status',
    'professional_score',
    'data_quality_score',
    'market_quality_score',
    'statistical_edge_score',
    'tactical_edge_score',
    'risk_control_score',
    'value_edge_score',
    'pipeline_stage',
    'pipeline_reasons',
    'pipeline_warnings',
    'selection_status',
    'market_ready',
    'primary_reason_code',
    'reason_codes',
    'decision_reason_th',
    'decision_readiness_score',
    'last_market_refresh_at',
    'last_analysis_at',
    'pipeline_version',
    'selection_algorithm_version',
    'decision_gate_version',
    'decision_model_version',
    'market_quality_version',
    'analysis_engine_version',
    'normalized_market_type',
    'normalized_selection',
    'provider_source_at',
    'fetched_at',
    'normalized_at',
  ]) {
    delete stripped[key]
  }
  return stripped
}

async function fetchDailyTop10LockCandidates(dayRange: ReturnType<typeof getBangkokDayRange>) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      kickoff_at,
      status,
      status_short,
      status_long,
      match_status,
      odds_updated_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      raw,
      league:football_leagues(id, api_league_id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, ranking_score, final_rank, is_top_pick, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, market_reading_score, market_edge_score, odds_confidence_score, odds_movement_score, data_depth_score, value_market, value_side, value_line, latest_line, latest_odds, raw, ${analysisReadinessMetadataSelect})
    `)
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)
    .limit(200)
  if (result.error) throw result.error
  return result.data ?? []
}

async function fetchUsableDailyPickCandidates(startUtc: string, endUtc: string) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      kickoff_at,
      status,
      status_short,
      status_long,
      match_status,
      odds_updated_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      raw,
      league:football_leagues(id, api_league_id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, ranking_score, final_rank, is_top_pick, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, market_reading_score, market_edge_score, odds_confidence_score, odds_movement_score, data_depth_score, value_market, value_side, value_line, latest_line, latest_odds, raw, ${analysisReadinessMetadataSelect})
    `)
    .gte('kickoff_at', startUtc)
    .lt('kickoff_at', endUtc)
    .order('kickoff_at', { ascending: true })
    .limit(300)
  if (result.error) throw result.error
  return result.data ?? []
}

async function fetchMatchForAiFinalPick(matchId: string) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      kickoff_at,
      odds_updated_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      raw,
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, ranking_score, final_rank, is_top_pick, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, market_reading_score, market_edge_score, odds_confidence_score, odds_movement_score, data_depth_score, value_market, value_side, value_line, latest_line, latest_odds, raw, ${analysisReadinessMetadataSelect})
    `)
    .eq('id', matchId)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data
}

async function fetchAiFinalPicksForMatches(matchIds: Array<string>) {
  if (!matchIds.length) return []
  const result = await supabase
    .from('football_ai_final_picks')
    .select('id, match_id, signal, market_focus, confidence_score, risk_level, pick_team, pick_team_id, pick_side, pick_source, pick_market, pick_selection, pick_price')
    .in('match_id', matchIds)
  if (result.error) {
    if (isMissingColumnError(result.error)) {
      const legacy = await supabase
        .from('football_ai_final_picks')
        .select('id, match_id, signal, market_focus, confidence_score, risk_level')
        .in('match_id', matchIds)
      if (legacy.error) return []
      return legacy.data ?? []
    }
    throw result.error
  }
  return result.data ?? []
}

async function fetchMatchIdsWithOdds(matchIds: Array<string>) {
  if (!matchIds.length) return new Set<string>()
  const result = await supabase
    .from('football_match_odds')
    .select('match_id')
    .in('match_id', matchIds)
  if (result.error) {
    if (isMissingColumnError(result.error)) return new Set<string>()
    throw result.error
  }
  return new Set((result.data ?? []).map((row: any) => row.match_id).filter(Boolean))
}

async function fetchStoredOddsByMatchIds(matchIds: Array<string>) {
  const oddsByMatchId = new Map<string, Array<any>>()
  const ids = [...new Set(matchIds.filter(Boolean))]
  if (!ids.length) return oddsByMatchId

  let result = await supabase
    .from('football_match_odds')
    .select('id, match_id, api_fixture_id, api_bookmaker_id, bookmaker_name, market_focus, normalized_market_type, market_name, selection, normalized_selection, line, price, odd_text, is_opening, is_latest, snapshot_at, provider_source_at, fetched_at, normalized_at, raw')
    .in('match_id', ids)
    .order('is_latest', { ascending: false })
    .order('snapshot_at', { ascending: false })

  if (isMissingColumnError(result.error)) {
    result = await supabase
      .from('football_match_odds')
      .select('id, match_id, api_fixture_id, api_bookmaker_id, bookmaker_name, market_focus, market_name, selection, line, price, odd_text, is_opening, is_latest, snapshot_at, raw')
      .in('match_id', ids)
      .order('is_latest', { ascending: false })
      .order('snapshot_at', { ascending: false })
  }
  if (result.error) {
    throw result.error
  }

  for (const row of result.data ?? []) {
    if (!row.match_id) continue
    const rows = oddsByMatchId.get(row.match_id) ?? []
    rows.push(row)
    oddsByMatchId.set(row.match_id, rows)
  }
  return oddsByMatchId
}

function deriveEdgePickTeamFromApiFootballOdds(match: any, oddsRows: Array<any>) {
  const rows = Array.isArray(oddsRows) ? oddsRows : []
  const primary = choosePrimaryEdgeOddsMarket(rows)
  const empty = {
    pickTeam: null,
    pickTeamId: null,
    pickSide: 'NONE',
    pickMarket: null,
    pickMarketId: null,
    pickSelection: null,
    pickPrice: null,
    pickSource: 'NONE',
    reason: 'ยังไม่มีข้อมูลราคา',
    marketPriority: 0,
    hasApiFootballOdds: false,
    hasPrimaryMarket: false,
  }
  if (!primary) return withEdgePickSummary(empty, match, rows)

  const normalizedMarket = normalizeMarketFocus(primary.market_focus ?? primary.market_name)
  const market = normalizedMarket === 'NONE' && firstText(primary.market_focus, primary.market_name) ? 'OTHER' : normalizedMarket
  const selection = firstText(primary.selection, primary.raw?.selection, primary.raw?.value)
  const homeName = firstText(match.homeTeam?.name, match.home_team?.name)
  const awayName = firstText(match.awayTeam?.name, match.away_team?.name)
  const homeId = nullableNumber(match.homeTeam?.api_team_id ?? match.homeTeam?.id)
  const awayId = nullableNumber(match.awayTeam?.api_team_id ?? match.awayTeam?.id)
  const base = {
    pickTeam: null,
    pickTeamId: null,
    pickSide: 'NONE',
    pickMarket: market,
    pickMarketId: primary.market_id ?? primary.raw?.market_id ?? null,
    pickSelection: selection,
    pickPrice: nullableNumber(primary.price),
    pickSource: 'API_FOOTBALL_ODDS',
    reason: '',
    marketPriority: getEdgeMarketPriority(market),
    hasApiFootballOdds: rows.length > 0,
    hasPrimaryMarket: market !== 'NONE',
  }

  if (market === 'AH') {
    const side = inferEdgeTeamSide(selection, homeName, awayName)
    if (side === 'HOME') return withEdgePickSummary({ ...base, pickTeam: homeName, pickTeamId: homeId, pickSide: 'HOME', reason: 'เลือกทีมจากตลาดแฮนดิแคปของ API-Football' }, match, rows)
    if (side === 'AWAY') return withEdgePickSummary({ ...base, pickTeam: awayName, pickTeamId: awayId, pickSide: 'AWAY', reason: 'เลือกทีมจากตลาดแฮนดิแคปของ API-Football' }, match, rows)
    return withEdgePickSummary({ ...base, pickSource: 'NONE', reason: 'ไม่สามารถระบุทีมจากตลาดแฮนดิแคปได้' }, match, rows)
  }

  if (market === 'MATCH_WINNER') {
    const side = inferEdgeTeamSide(selection, homeName, awayName)
    if (side === 'HOME') return withEdgePickSummary({ ...base, pickTeam: homeName, pickTeamId: homeId, pickSide: 'HOME', reason: 'เลือกทีมจากตลาด 1X2 ของ API-Football' }, match, rows)
    if (side === 'AWAY') return withEdgePickSummary({ ...base, pickTeam: awayName, pickTeamId: awayId, pickSide: 'AWAY', reason: 'เลือกทีมจากตลาด 1X2 ของ API-Football' }, match, rows)
    if (isEdgeDrawSelection(selection)) return withEdgePickSummary({ ...base, pickSide: 'DRAW', reason: 'ตลาดนี้เป็นผลเสมอ ไม่มีทีมที่เลือก' }, match, rows)
    return withEdgePickSummary({ ...base, pickSource: 'NONE', reason: 'ไม่สามารถระบุทีมจากตลาด 1X2 ได้' }, match, rows)
  }

  if (market === 'OU') return withEdgePickSummary({ ...base, pickSide: inferEdgeOverUnderSide(selection), reason: 'ตลาดสูงต่ำไม่มีทีมที่เลือก' }, match, rows)
  if (market === 'BTTS') return withEdgePickSummary({ ...base, pickSide: inferEdgeYesNoSide(selection), reason: 'ตลาดทั้งสองทีมยิงได้ไม่มีทีมที่เลือก' }, match, rows)
  return withEdgePickSummary({ ...base, reason: 'ตลาดจาก API-Football ไม่ใช่ตลาดเลือกทีม' }, match, rows)
}

function choosePrimaryEdgeOddsMarket(rows: Array<any>) {
  return [...rows]
    .filter((row) => normalizeMarketFocus(row.market_focus ?? row.market_name) !== 'NONE' || row.market_name)
    .sort((a, b) => {
      const marketDiff = getEdgeMarketPriority(b.market_focus ?? b.market_name) - getEdgeMarketPriority(a.market_focus ?? a.market_name)
      const latestDiff = Number(Boolean(b.is_latest)) - Number(Boolean(a.is_latest))
      const timeDiff = new Date(b.snapshot_at ?? 0).getTime() - new Date(a.snapshot_at ?? 0).getTime()
      return marketDiff || latestDiff || timeDiff
    })[0] ?? null
}

function withEdgePickSummary(pick: any, match: any, oddsRows: Array<any>) {
  const summary = createEdgePickSummary(match, pick, oddsRows)
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

function createEdgePickSummary(match: any, pick: any, oddsRows: Array<any>) {
  const hasOdds = Array.isArray(oddsRows) && oddsRows.length > 0
  const analysis = getAnalysis(match) ?? {}
  const confidence = Math.round(Number(pick.pickConfidence ?? analysis.calibrated_confidence_score ?? analysis.confidence_score ?? match.confidence_score ?? 0))
  const market = hasOdds ? firstText(oddsRows[0]?.market_name, pick.pickMarket, 'API-Football') : 'ยังไม่มีข้อมูลราคา'
  return {
    title: 'สรุปมุมมองระบบ',
    side: pick.pickSide ?? 'NONE',
    sideLabel: getEdgePickSideLabel(pick),
    team: pick.pickTeam ?? null,
    market,
    reason: hasOdds ? getEdgePickSummaryReason(pick) : 'ระบบยังไม่พบข้อมูลราคาจาก API-Football สำหรับคู่นี้',
    predictedOutcomeLabel: getEdgePredictedOutcomeLabel(pick),
    confidenceLabel: confidence ? `${confidence}%` : 'รอข้อมูลเพิ่ม',
    hasApiFootballOdds: hasOdds,
  }
}

function getEdgePickSideLabel(pick: any) {
  if (pick.pickTeam) return pick.pickTeam
  const labels: Record<string, string> = {
    HOME: 'เจ้าบ้าน',
    AWAY: 'ทีมเยือน',
    DRAW: 'เสมอ',
    OVER: 'สูง',
    UNDER: 'ต่ำ',
    YES: 'ใช่',
    NO: 'ไม่ใช่',
    NONE: 'ยังไม่เลือกฝั่ง',
  }
  return labels[String(pick.pickSide ?? 'NONE').toUpperCase()] ?? labels.NONE
}

function getEdgePredictedOutcomeLabel(pick: any) {
  const side = String(pick.pickSide ?? 'NONE').toUpperCase()
  const market = String(pick.pickMarket ?? '').toUpperCase()
  if (!pick.hasApiFootballOdds) return 'ยังไม่มีข้อมูลราคา'
  if (pick.pickTeam && market === 'AH') return `${pick.pickTeam} เป็นฝั่งที่ระบบให้ภาษีดีกว่า`
  if (pick.pickTeam && market === 'MATCH_WINNER') return `${pick.pickTeam} มีโอกาสเหนือกว่า`
  if (side === 'DRAW') return 'เกมมีโอกาสออกเสมอ'
  if (side === 'OVER') return 'เกมมีแนวโน้มประตูรวมสูง'
  if (side === 'UNDER') return 'เกมมีแนวโน้มประตูรวมต่ำ'
  if (side === 'YES') return 'มีแนวโน้มที่ทั้งสองทีมทำประตูได้'
  if (side === 'NO') return 'มีแนวโน้มที่อย่างน้อยหนึ่งทีมทำประตูไม่ได้'
  return 'รอข้อมูลเพิ่มก่อนเลือกฝั่ง'
}

function getEdgePickSummaryReason(pick: any) {
  const market = String(pick.pickMarket ?? '').toUpperCase()
  if (market === 'AH') return 'อ้างอิงตลาดแฮนดิแคปจริงจาก API-Football'
  if (market === 'MATCH_WINNER') return 'อ้างอิงตลาดผลแพ้ชนะจริงจาก API-Football'
  if (market === 'OU') return 'อ้างอิงตลาดประตูรวมจริงจาก API-Football'
  if (market === 'BTTS') return 'อ้างอิงตลาดทั้งสองทีมทำประตูจริงจาก API-Football'
  return 'อ้างอิงข้อมูลราคาจริงจาก API-Football'
}

function getStrictDailyScoreParts(match: any, oddsRows: Array<any>, pickTeam: any) {
  const analysis = getAnalysis(match) ?? {}
  const baseFixtureQualityScore = clampStrictScore(
    (hasStrictDailyTeamNames(match) ? 30 : 0) +
    (hasStrictDailyLeagueName(match) ? 20 : 0) +
    (hasStrictDailyKickoff(match) ? 20 : 0) +
    Math.min(30, Number(analysis.league_quality_score ?? match.league?.priority ?? 0) * 0.3)
  )
  const dataReadinessScore = clampStrictScore(
    (match.has_fixture_detail ? 25 : 0) +
    (Array.isArray(match.raw?.statistics) && match.raw.statistics.length ? 20 : 0) +
    (Array.isArray(match.raw?.lineups) && match.raw.lineups.length ? 15 : 0) +
    Math.min(30, Number(match.data_readiness_score ?? analysis.data_readiness_score ?? 0)) +
    (['READY', 'PARTIAL'].includes(String(match.data_readiness_status ?? '').toUpperCase()) ? 10 : 0)
  )
  const marketReadinessScore = clampStrictScore(
    (oddsRows.length ? 45 : 0) +
    (pickTeam.hasPrimaryMarket ? 25 : 0) +
    Math.min(30, Number(pickTeam.marketPriority ?? 0) * 0.3)
  )
  const safetyPenalty = getStrictDailySafetyPenalty(match, oddsRows)
  const strictRankingScore = clampStrictScore((baseFixtureQualityScore * 0.44) + (dataReadinessScore * 0.32) + (marketReadinessScore * 0.24) - safetyPenalty)
  const recommendedTier = getStrictDailyTier({ strictRankingScore, dataReadinessScore, marketReadinessScore, safetyPenalty, hasOdds: oddsRows.length > 0 })
  return { baseFixtureQualityScore, dataReadinessScore, marketReadinessScore, safetyPenalty, strictRankingScore, recommendedTier }
}

function getStrictDailySafetyPenalty(match: any, oddsRows: Array<any>) {
  const analysis = getAnalysis(match) ?? {}
  let penalty = 0
  if (!hasStrictDailyTeamNames(match)) penalty += 30
  if (!hasStrictDailyLeagueName(match)) penalty += 15
  if (!hasStrictDailyKickoff(match)) penalty += 25
  if (!oddsRows.length) penalty += 8
  if (Number(analysis.league_quality_score ?? match.league?.priority ?? 0) < 20) penalty += 5
  return Math.min(60, penalty)
}

function getStrictDailyTier(input: { strictRankingScore: number; dataReadinessScore: number; marketReadinessScore: number; safetyPenalty: number; hasOdds: boolean }) {
  if (input.hasOdds && input.marketReadinessScore >= 45 && input.dataReadinessScore >= 25 && input.strictRankingScore >= 45 && input.safetyPenalty < 35) return 'READY'
  if (input.strictRankingScore >= 35 && input.safetyPenalty < 45) return 'WATCH'
  return 'NO_DATA'
}

function strictTierPriority(tier: unknown) {
  if (tier === 'READY') return 3
  if (tier === 'WATCH') return 2
  return 1
}

function hasStrictDailyFixtureCompleteness(match: any) {
  return hasStrictDailyTeamNames(match) && hasStrictDailyLeagueName(match) && hasStrictDailyKickoff(match)
}

function hasStrictDailyTeamNames(match: any) {
  return Boolean(firstText(match.homeTeam?.name, match.home_team?.name)) && Boolean(firstText(match.awayTeam?.name, match.away_team?.name))
}

function hasStrictDailyLeagueName(match: any) {
  return Boolean(firstText(match.league?.name, match.league_name))
}

function hasStrictDailyKickoff(match: any) {
  const kickoff = new Date(match?.kickoff_at ?? 0).getTime()
  return Number.isFinite(kickoff) && kickoff > 0
}

function clampStrictScore(value: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100))
}

function buildStrictApiFootballCandidate(match: any, oddsRows: Array<any>, pickTeam = deriveEdgePickTeamFromApiFootballOdds(match, oddsRows)) {
  const completenessBreakdown = {
    odds: oddsRows.length ? 45 : 0,
    fixture: match.has_fixture_detail ? 15 : 0,
    stats: Array.isArray(match.raw?.statistics) && match.raw.statistics.length ? 15 : 0,
    lineups: Array.isArray(match.raw?.lineups) && match.raw.lineups.length ? 10 : 0,
    readiness: ['READY', 'PARTIAL'].includes(String(match.data_readiness_status ?? '').toUpperCase()) ? 15 : 0,
  }
  const scoreParts = getStrictDailyScoreParts(match, oddsRows, pickTeam)
  return {
    matchId: match.id,
    hasApiFootballOdds: oddsRows.length > 0,
    hasRealMarketData: oddsRows.length > 0,
    hasPrimaryMarket: pickTeam.hasPrimaryMarket,
    primaryMarket: pickTeam.pickMarket,
    marketPriority: pickTeam.marketPriority,
    pickTeam: pickTeam.pickTeam,
    pickTeamId: pickTeam.pickTeamId,
    pickSide: pickTeam.pickSide,
    pickSource: pickTeam.pickSource,
    pickPrice: pickTeam.pickPrice,
    pickMarket: pickTeam.pickMarket,
    pickMarketId: pickTeam.pickMarketId,
    pickSelection: pickTeam.pickSelection,
    pickSummary: pickTeam.pickSummary,
    pickSummaryTitle: pickTeam.pickSummaryTitle,
    pickSummarySide: pickTeam.pickSummarySide,
    pickSummaryTeam: pickTeam.pickSummaryTeam,
    pickSummaryMarket: pickTeam.pickSummaryMarket,
    pickSummaryReason: pickTeam.pickSummaryReason,
    predictedOutcomeLabel: pickTeam.predictedOutcomeLabel,
    completenessScore: Object.values(completenessBreakdown).reduce((total: number, value: any) => total + Number(value ?? 0), 0),
    completenessBreakdown,
    hasFixtureStatistics: completenessBreakdown.stats > 0,
    hasLineups: completenessBreakdown.lineups > 0,
    leagueQualityScore: Number(getAnalysis(match)?.league_quality_score ?? match.league?.priority ?? 0),
    kickoffTime: new Date(match.kickoff_at ?? 0).getTime() || 0,
    stableId: String(match.id ?? ''),
    baseFixtureQualityScore: scoreParts.baseFixtureQualityScore,
    dataReadinessScore: scoreParts.dataReadinessScore,
    marketReadinessScore: scoreParts.marketReadinessScore,
    safetyPenalty: scoreParts.safetyPenalty,
    strictRankingScore: scoreParts.strictRankingScore,
    recommendedTier: scoreParts.recommendedTier,
  }
}

function compareStrictApiFootballCandidateItems(a: any, b: any) {
  const left = a.strict ?? buildStrictApiFootballCandidate(a.match, a.odds ?? [], a.pickTeam)
  const right = b.strict ?? buildStrictApiFootballCandidate(b.match, b.odds ?? [], b.pickTeam)
  return compareStrictApiFootballCandidateValues(left, right)
}

function compareStrictApiFootballCandidateValues(a: any, b: any) {
  return (
    strictTierPriority(b.recommendedTier) - strictTierPriority(a.recommendedTier) ||
    Number(b.strictRankingScore ?? 0) - Number(a.strictRankingScore ?? 0) ||
    Number(b.dataReadinessScore ?? 0) - Number(a.dataReadinessScore ?? 0) ||
    Number(b.baseFixtureQualityScore ?? 0) - Number(a.baseFixtureQualityScore ?? 0) ||
    Number(b.marketReadinessScore ?? 0) - Number(a.marketReadinessScore ?? 0) ||
    Number(b.marketPriority ?? 0) - Number(a.marketPriority ?? 0) ||
    Number(b.completenessScore ?? 0) - Number(a.completenessScore ?? 0) ||
    Number(b.hasApiFootballOdds) - Number(a.hasApiFootballOdds) ||
    Number(b.hasPrimaryMarket) - Number(a.hasPrimaryMarket) ||
    Number(Boolean(b.pickTeam)) - Number(Boolean(a.pickTeam)) ||
    Number(Boolean(b.hasFixtureStatistics)) - Number(Boolean(a.hasFixtureStatistics)) ||
    Number(Boolean(b.hasLineups)) - Number(Boolean(a.hasLineups)) ||
    Number(b.leagueQualityScore ?? 0) - Number(a.leagueQualityScore ?? 0) ||
    Number(a.kickoffTime ?? 0) - Number(b.kickoffTime ?? 0) ||
    String(a.stableId ?? '').localeCompare(String(b.stableId ?? ''))
  )
}

function getEdgeMarketPriority(value: unknown) {
  const market = normalizeMarketFocus(value)
  if (market === 'AH') return 100
  if (market === 'OU') return 90
  if (market === 'MATCH_WINNER') return 80
  if (market === 'BTTS') return 70
  return market === 'NONE' ? (String(value ?? '').trim() && String(value).toUpperCase() !== 'NONE' ? 50 : 0) : 50
}

function normalizeEdgeName(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function inferEdgeTeamSide(selection: unknown, homeName: unknown, awayName: unknown) {
  const text = normalizeEdgeName(selection)
  const home = normalizeEdgeName(homeName)
  const away = normalizeEdgeName(awayName)
  if (!text) return null
  if (['home', '1'].includes(text) || (home && (text === home || text.includes(home) || home.includes(text)))) return 'HOME'
  if (['away', '2'].includes(text) || (away && (text === away || text.includes(away) || away.includes(text)))) return 'AWAY'
  return null
}

function isEdgeDrawSelection(selection: unknown) {
  const text = normalizeEdgeName(selection)
  return ['draw', 'x', 'tie'].includes(text)
}

function inferEdgeOverUnderSide(selection: unknown) {
  const text = normalizeEdgeName(selection)
  if (text.includes('under')) return 'UNDER'
  if (text.includes('over')) return 'OVER'
  return 'NONE'
}

function inferEdgeYesNoSide(selection: unknown) {
  const text = normalizeEdgeName(selection)
  if (['yes', 'y'].includes(text) || text.includes('yes')) return 'YES'
  if (['no', 'n'].includes(text) || text.includes('no')) return 'NO'
  return 'NONE'
}

function summarizeStrictMarketPriority(items: Array<any>) {
  return items.reduce((summary: Record<string, number>, item: any) => {
    const key = String(item?.primaryMarket ?? item?.pickMarket ?? 'NONE')
    summary[key] = (summary[key] ?? 0) + 1
    return summary
  }, {})
}

function formatStrictSelectedMatch(item: any) {
  const strict = item.strict ?? buildStrictApiFootballCandidate(item.match, item.odds ?? [], item.pickTeam)
  return {
    matchId: item.match?.id,
    apiFixtureId: item.match?.api_sports_fixture_id ?? null,
    rank: item.rank ?? null,
    kickoffAt: item.match?.kickoff_at ?? null,
    league: item.match?.league?.name ?? null,
    homeTeam: item.match?.homeTeam?.name ?? null,
    awayTeam: item.match?.awayTeam?.name ?? null,
    hasApiFootballOdds: strict.hasApiFootballOdds,
    hasPrimaryMarket: strict.hasPrimaryMarket,
    primaryMarket: strict.primaryMarket,
    marketPriority: strict.marketPriority,
    pickTeam: strict.pickTeam,
    pickTeamId: strict.pickTeamId,
    pickSide: strict.pickSide,
    pickSource: strict.pickSource,
    pickMarket: strict.pickMarket,
    pickSelection: strict.pickSelection,
    pickPrice: strict.pickPrice,
    pickSummary: strict.pickSummary,
    pickSummaryTitle: strict.pickSummaryTitle,
    pickSummarySide: strict.pickSummarySide,
    pickSummaryTeam: strict.pickSummaryTeam,
    pickSummaryMarket: strict.pickSummaryMarket,
    pickSummaryReason: strict.pickSummaryReason,
    predictedOutcomeLabel: strict.predictedOutcomeLabel,
    completenessScore: strict.completenessScore,
    completenessBreakdown: strict.completenessBreakdown,
    baseFixtureQualityScore: strict.baseFixtureQualityScore,
    dataReadinessScore: strict.dataReadinessScore,
    marketReadinessScore: strict.marketReadinessScore,
    safetyPenalty: strict.safetyPenalty,
    strictRankingScore: strict.strictRankingScore,
    recommendedTier: strict.recommendedTier,
  }
}

function compareDailyTop10LockCandidate(a: any, b: any) {
  const strictDiff = compareStrictApiFootballCandidateItems(a, b)
  if (strictDiff) return strictDiff
  const marketPriorityDiff = dailyMarketReadinessPriority(a) - dailyMarketReadinessPriority(b)
  const leagueCoverageDiff = getLeagueMarketCoverageScore(b) - getLeagueMarketCoverageScore(a)
  const signalDiff = dailySignalPriority(a) - dailySignalPriority(b)
  const marketEdgeDiff = dailyMarketEdgeScore(b) - dailyMarketEdgeScore(a)
  const hasPickDiff = Number(Boolean(b.pick)) - Number(Boolean(a.pick))
  const scoreDiff = dailySelectionScore(b) - dailySelectionScore(a)
  const confidenceDiff = dailyConfidenceScore(b) - dailyConfidenceScore(a)
  const riskDiff = riskSortValue(a.pick?.risk_level ?? a.analysis?.risk_level) - riskSortValue(b.pick?.risk_level ?? b.analysis?.risk_level)
  const kickoffDiff = new Date(a.match?.kickoff_at ?? 0).getTime() - new Date(b.match?.kickoff_at ?? 0).getTime()
  return marketPriorityDiff || leagueCoverageDiff || signalDiff || marketEdgeDiff || hasPickDiff || scoreDiff || confidenceDiff || riskDiff || kickoffDiff
}

function buildDynamicDailyCandidatePool(candidates: Array<any>) {
  return [...candidates].sort(compareDailyPreRankingCandidate)
}

function compareDailyPreRankingCandidate(a: any, b: any) {
  const leagueCoverageDiff = getLeagueMarketCoverageScore(b) - getLeagueMarketCoverageScore(a)
  const scoreDiff = dailySelectionScore(b) - dailySelectionScore(a)
  const confidenceDiff = dailyConfidenceScore(b) - dailyConfidenceScore(a)
  const riskDiff = riskSortValue(a.pick?.risk_level ?? a.analysis?.risk_level) - riskSortValue(b.pick?.risk_level ?? b.analysis?.risk_level)
  const kickoffDiff = new Date(a.match?.kickoff_at ?? 0).getTime() - new Date(b.match?.kickoff_at ?? 0).getTime()
  const stableDiff = String(a.match?.id ?? '').localeCompare(String(b.match?.id ?? ''))
  return leagueCoverageDiff || scoreDiff || confidenceDiff || riskDiff || kickoffDiff || stableDiff
}

function getUsableSelectionReason(summary: { playableCount: number; selectedCount: number; marketReadyCount: number; waitingCount: number; finishedCount: number; expanded: boolean }) {
  if (summary.playableCount === 0 && summary.finishedCount > 0) return 'all_matches_finished'
  if (summary.playableCount === 0) return 'no_playable_candidates'
  if (summary.expanded && summary.playableCount > 0) return 'using_next_window_candidates'
  if (summary.marketReadyCount > 0) return 'market_ready_candidates_available'
  if (summary.waitingCount > 0) return 'waiting_market_data'
  return 'no_market_ready_candidates'
}

function isKickoffInRange(match: any, start: Date, end: Date) {
  const kickoff = new Date(match?.kickoff_at ?? 0).getTime()
  return Number.isFinite(kickoff) && kickoff >= start.getTime() && kickoff < end.getTime()
}

function isPlayableStatusText(value: unknown) {
  const status = normalizeStatusText(value)
  return ['NS', 'TBD', 'SCHEDULED', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'].includes(status)
}

function isFinishedStatusText(value: unknown) {
  return ['FT', 'AET', 'PEN', 'FINISHED'].includes(normalizeStatusText(value))
}

function normalizeStatusText(value: unknown) {
  const status = String(value ?? '').trim().toUpperCase()
  if (!status) return 'UNKNOWN'
  if (status === 'NOT STARTED') return 'NS'
  if (status === 'TIME TO BE DEFINED') return 'TBD'
  if (status === 'MATCH FINISHED') return 'FT'
  return status
}

function getPositiveNumber(value: unknown, fallback: number, max: number) {
  const numeric = Number(value ?? fallback)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.max(1, Math.min(Math.floor(numeric), max))
}

function dailyMarketReadinessGroup(item: any) {
  const analysis = item.analysis ?? getAnalysis(item.match)
  const odds = item.odds ?? []
  const hasOdds = odds.length > 0
  const readiness = String(item.match?.data_readiness_status ?? analysis?.raw?.data_readiness_status ?? '').toUpperCase()
  const analysisStatus = String(analysis?.analysis_status ?? analysis?.raw?.analysis_status ?? item.pick?.analysis_status ?? '').toUpperCase()
  const validationStatus = String(analysis?.data_validation_status ?? 'VALID').toUpperCase()
  const marketDataUsed = Boolean(analysis?.market_data_used ?? analysis?.raw?.market_data_used ?? item.pick?.market_data_used)
  const marketEdgeScore = dailyMarketEdgeScore(item)
  const confidenceScore = dailyConfidenceScore(item)
  const riskLevel = normalizeRiskLevelText(item.pick?.risk_level ?? analysis?.risk_level)

  if (!hasOdds) return 'WAITING_MARKET_DATA'
  if (
    ['VALID', 'PARTIAL'].includes(validationStatus) &&
    (marketDataUsed || analysisStatus === 'MARKET_DATA_READY_RECALCULATED' || ['READY', 'PARTIAL'].includes(readiness)) &&
    marketEdgeScore > 0 &&
    confidenceScore >= 58 &&
    riskLevel !== 'HIGH'
  ) return 'MARKET_READY_SIGNAL'
  return 'MARKET_SEEN_INCOMPLETE'
}

function dailyMarketReadinessPriority(item: any) {
  const group = dailyMarketReadinessGroup(item)
  if (group === 'MARKET_READY_SIGNAL') return 1
  if (group === 'MARKET_SEEN_INCOMPLETE') return 2
  return 3
}

function isMarketReadyCandidate(item: any) {
  return dailyMarketReadinessGroup(item) !== 'WAITING_MARKET_DATA'
}

function isWaitingMarketCandidate(item: any) {
  return dailyMarketReadinessGroup(item) === 'WAITING_MARKET_DATA'
}

function dailySignalPriority(item: any) {
  const signal = String(item.pick?.signal ?? '').toUpperCase()
  const recommendation = normalizeRecommendationText(item.analysis?.recommendation)
  if (signal === 'STRONG_SIGNAL' && recommendation === 'BET') return 1
  if (signal === 'STRONG_SIGNAL') return 2
  if (signal === 'WATCH' || recommendation === 'LEAN' || recommendation === 'WATCH') return 3
  return 4
}

function dailyMarketEdgeScore(item: any) {
  return normalizeScore(item.analysis?.market_edge_score ?? item.analysis?.raw?.market_edge_score ?? 0)
}

function normalizeRecommendationText(value: unknown) {
  const recommendation = String(value ?? 'NO BET').toUpperCase().replace('_', ' ')
  if (['BET', 'LEAN', 'WATCH', 'NO BET'].includes(recommendation)) return recommendation
  return 'NO BET'
}

function summarizeExistingMarketLock(rows: Array<any>, oddsByMatchId: Map<string, Array<any>>) {
  const staleNoMarketLockCount = rows.filter((row: any) => {
    const odds = oddsByMatchId.get(row.match_id) ?? []
    const signal = String(row.signal ?? '').toUpperCase()
    return !odds.length && (signal === 'SKIP' || !signal)
  }).length
  return { staleNoMarketLockCount }
}

function formatTop10RefreshMatch(item: any) {
  const coverage = getLeagueMarketCoverage(item)
  return {
    matchId: item.match?.id ?? null,
    apiFixtureId: item.match?.api_sports_fixture_id ?? null,
    homeTeam: item.match?.homeTeam?.name ?? null,
    awayTeam: item.match?.awayTeam?.name ?? null,
    kickoffAt: item.match?.kickoff_at ?? null,
    recommendation: normalizeRecommendationText(item.analysis?.recommendation),
    signal: item.pick?.signal ?? 'SKIP',
    oddsRows: (item.odds ?? []).length,
    readiness: dailyMarketReadinessGroup(item),
    leagueMarketCoverageScore: coverage.score,
    recentOddsCoverageRate: coverage.rate,
    marketAvailabilityTier: coverage.tier,
    confidenceScore: dailyConfidenceScore(item),
    marketEdgeScore: dailyMarketEdgeScore(item),
  }
}

function getLeagueMarketCoverageScore(item: any) {
  return getLeagueMarketCoverage(item).score
}

function getLeagueMarketCoverage(item: any) {
  const rawRate = Number(item.match?.league?.recent_odds_coverage_rate ?? item.match?.recent_odds_coverage_rate ?? 0)
  const oddsRows = Array.isArray(item.odds) ? item.odds.length : 0
  const rate = Number.isFinite(rawRate) && rawRate > 0 ? (rawRate > 1 ? rawRate / 100 : rawRate) : oddsRows > 0 ? 0.7 : 0
  const tier = rate >= 0.7 ? 'HIGH' : rate >= 0.35 ? 'MEDIUM' : rate > 0 ? 'LOW' : 'NONE'
  const leaguePriority = Number(item.match?.league?.priority ?? 999)
  const priorityBonus = Number.isFinite(leaguePriority) && leaguePriority <= 20 ? 10 : Number.isFinite(leaguePriority) && leaguePriority <= 50 ? 5 : 0
  const score = normalizeScore((rate || (oddsRows > 0 ? 0.55 : 0.05)) * 100 + priorityBonus)
  return { rate, tier, score }
}

function dailySelectionScore(item: any) {
  return Number(item.analysis?.ranking_score ?? item.analysis?.calibrated_confidence_score ?? item.analysis?.confidence_score ?? 0)
}

function dailyConfidenceScore(item: any) {
  return Number(item.pick?.confidence_score ?? item.analysis?.calibrated_confidence_score ?? item.analysis?.confidence_score ?? 0)
}

function riskSortValue(value: unknown) {
  const risk = normalizeRiskLevelText(value)
  if (risk === 'LOW') return 0
  if (risk === 'MEDIUM') return 1
  return 2
}

function summarizeDailyTop10(selectionDate: string, rows: Array<any>) {
  const lockedAtValues = rows.map((row) => row.locked_at).filter(Boolean).sort()
  const updatedAtValues = rows.map((row) => row.updated_at ?? row.created_at).filter(Boolean).sort()
  return {
    selectionDate,
    locked: rows.length > 0,
    lockedCount: rows.length,
    lockedAt: lockedAtValues[0] ?? null,
    lastUpdated: updatedAtValues.at(-1) ?? null,
    strongSignalCount: rows.filter((row) => row.signal === 'STRONG_SIGNAL').length,
    watchCount: rows.filter((row) => row.signal === 'WATCH').length,
    skipCount: rows.filter((row) => row.signal === 'SKIP').length,
  }
}

function compareFixtureSyncPriority(a: any, b: any) {
  const priorityA = getFixtureSyncPriority(a)
  const priorityB = getFixtureSyncPriority(b)
  const scoreDiff = priorityB.syncPriorityScore - priorityA.syncPriorityScore
  const qualityDiff = priorityB.leagueQualityScore - priorityA.leagueQualityScore
  const kickoffA = new Date(a?.utcDate ?? a?.kickoff_at ?? 0).getTime()
  const kickoffB = new Date(b?.utcDate ?? b?.kickoff_at ?? 0).getTime()
  return scoreDiff || qualityDiff || kickoffA - kickoffB
}

function getFixtureSyncPriority(fixture: any) {
  const leagueMeta = getLeagueMeta(fixture)
  const leagueName = leagueMeta.name
  const homeName = firstText(fixture?.homeTeam?.name, fixture?.home_team?.name, fixture?.raw?.apiFootball?.teams?.home?.name) ?? ''
  const awayName = firstText(fixture?.awayTeam?.name, fixture?.away_team?.name, fixture?.raw?.apiFootball?.teams?.away?.name) ?? ''
  const leagueQualityScore = getLeagueQualityScore(fixture)
  const knownLeagueBonus = getKnownLeagueBonus(leagueMeta)
  const coverageBonus = leagueQualityScore >= 85 ? 8 : leagueQualityScore >= 75 ? 5 : leagueQualityScore >= 60 ? 2 : 0
  const softPenalty = getFixtureSoftPenalty({ leagueName, homeName, awayName })
  const scoreCap = getFixtureScoreCap({ leagueName, country: leagueMeta.country, homeName, awayName })
  const syncPriorityScore = normalizeScore(Math.min(scoreCap, leagueQualityScore + knownLeagueBonus + coverageBonus - softPenalty))
  return {
    leagueId: leagueMeta.id,
    country: leagueMeta.country,
    leagueQualityScore,
    syncPriorityScore,
    knownLeagueBonus,
    coverageBonus,
    softPenalty,
    scoringVersion: leagueQualityScoringVersion,
  }
}

function getKnownLeagueBonus(league: { name: string; country: string }) {
  const tierScore = getLeagueTierScore(league)
  if (tierScore >= 95) return 8
  if (tierScore >= 85) return 5
  if (tierScore >= 75) return 3
  const normalized = league.name.toLowerCase()
  for (const key of priorityLeagues.keys()) {
    if (normalized.includes(key.toLowerCase())) return 12
  }
  return 0
}

function getLeagueMeta(source: any) {
  const apiFootballLeague = source?.raw?.apiFootball?.league ?? source?.raw?.raw?.apiFootball?.league
  const id = getApiFootballLeagueId(firstText(
    apiFootballLeague?.id,
    source?.api_sports_league_id,
    source?.competition?.api_league_id,
    source?.competition?.id,
    source?.league?.api_league_id,
    source?.league?.id,
  ))
  const rawName = firstText(source?.competition?.name, source?.league?.name, apiFootballLeague?.name)
  const country = normalizeCountry(firstText(source?.competition?.country, source?.competition?.area?.name, source?.league?.country, source?.area?.name, apiFootballLeague?.country))
  return {
    id,
    name: normalizeLeagueName(rawName),
    country,
    season: firstText(source?.season, apiFootballLeague?.season),
  }
}

function getApiFootballLeagueId(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric === 0) return null
  return Math.abs(Math.trunc(numeric))
}

function normalizeLeagueName(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeCountry(value: unknown) {
  return String(value ?? '').trim()
}

function getLeagueTierScore(source: any) {
  const league = typeof source === 'string'
    ? { name: source, country: '' }
    : source?.name !== undefined || source?.country !== undefined
      ? { id: getApiFootballLeagueId(source.id), name: normalizeLeagueName(source.name), country: normalizeCountry(source.country) }
      : getLeagueMeta(source)
  if (league.id && apiFootballLeagueTierScores.has(league.id)) return apiFootballLeagueTierScores.get(league.id) ?? 65
  const name = league.name.toLowerCase()
  const country = league.country.toLowerCase()
  const exactCountryLeague = `${country}:${name}`

  if (name.includes('champions league') && (country.includes('world') || country.includes('europe') || country.includes('uefa') || !country)) return 100
  if (name.includes('europa league') || name.includes('conference league')) return 96
  if (exactCountryLeague.includes('england:premier league')) return 100
  if ((country.includes('spain') || country.includes('espana')) && (name.includes('la liga') || name.includes('primera'))) return 98
  if (country.includes('italy') && name.includes('serie a')) return 97
  if (country.includes('germany') && name.includes('bundesliga')) return 97
  if (country.includes('france') && name.includes('ligue 1')) return 95

  if (country.includes('england') && name.includes('championship')) return 92
  if (country.includes('netherlands') && name.includes('eredivisie')) return 90
  if (country.includes('portugal') && (name.includes('primeira') || name.includes('liga portugal'))) return 90
  if (country.includes('belgium') && (name.includes('pro league') || name.includes('first division'))) return 88
  if (country.includes('turkey') && (name.includes('super lig') || name.includes('super liga'))) return 88
  if (country.includes('scotland') && name.includes('premiership')) return 86
  if (country.includes('switzerland') && name.includes('super league')) return 86
  if (country.includes('austria') && name.includes('bundesliga')) return 86
  if (country.includes('denmark') && name.includes('superliga')) return 86

  if ((country.includes('brazil') || country.includes('brasil')) && name.includes('serie a')) return 84
  if (country.includes('argentina') && name.includes('primera')) return 83
  if ((country.includes('usa') || country.includes('united states')) && (name === 'major league soccer' || name === 'mls')) return 82
  if (country.includes('mexico') && name.includes('liga mx')) return 82
  if (country.includes('japan') && (name.includes('j1') || name.includes('j. league'))) return 80
  if ((country.includes('korea') || country.includes('south-korea')) && name.includes('k league 1')) return 80
  if (country.includes('saudi') && name.includes('pro league')) return 80
  if (country.includes('australia') && name.includes('a-league')) return 78

  if (isLowerDevelopmentLeague({ leagueName: name, homeName: '', awayName: '' })) return 50
  if (name.includes('premier league')) return isHighTierPremierCountry(country) ? 85 : 72
  return 65
}

function isHighTierPremierCountry(country: string) {
  return ['england', 'scotland', 'wales', 'northern ireland'].some((item) => country.includes(item))
}

function getFixtureSoftPenalty({ leagueName, homeName, awayName }: { leagueName: string; homeName: string; awayName: string }) {
  const text = `${leagueName} ${homeName} ${awayName}`.toLowerCase()
  let penalty = 0
  if (/\b(u19|u20|u21|u23|youth)\b/i.test(text)) penalty += 35
  if (/\b(reserve|reserves|academy|development)\b/i.test(text)) penalty += 30
  if (/\b(w|women|woman|femenil|feminine)\b/i.test(text)) penalty += 15
  if (/\b(ii|b)\b/i.test(text)) penalty += 30
  if (text.includes('next pro') || text.includes('league two') || text.includes('lower division') || text.includes('amateur')) penalty += 25
  return Math.min(penalty, 45)
}

function getFixtureScoreCap({ leagueName, country, homeName, awayName }: { leagueName: string; country: string; homeName: string; awayName: string }) {
  const text = `${leagueName} ${homeName} ${awayName}`.toLowerCase()
  let cap = 100
  if (/\b(u19|u20|u21|u23|youth)\b/i.test(text)) cap = Math.min(cap, 50)
  if (/\b(reserve|reserves|academy|development|ii|b)\b/i.test(text)) cap = Math.min(cap, 55)
  if (text.includes('next pro') || text.includes('league two') || text.includes('lower division') || text.includes('amateur')) cap = Math.min(cap, 55)
  if (/\b(w|women|woman|femenil|feminine)\b/i.test(text)) cap = Math.min(cap, 70)
  if (leagueName.toLowerCase().includes('premier league') && !isHighTierPremierCountry(country.toLowerCase())) cap = Math.min(cap, 72)
  return cap
}

function isLowerDevelopmentLeague({ leagueName, homeName, awayName }: { leagueName: string; homeName: string; awayName: string }) {
  const text = `${leagueName} ${homeName} ${awayName}`.toLowerCase()
  return text.includes('next pro') ||
    text.includes('league two') ||
    text.includes('reserve') ||
    text.includes('academy') ||
    text.includes('development') ||
    /\b(u19|u20|u21|u23|youth)\b/i.test(text)
}

async function runRecomputeMode(dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
  const provider = getProviderAdapter('api-football')
  const providerResult = { provider, fallbackUsed: false, fallbackProvider: null, fallbackError: null, competitions: 0, matches: [] }
  const candidates = await fetchDbMatchCandidates(dayRange, limit, false)
  const ids = candidates.rows.map((row: any) => row.id).filter(Boolean)
  const recomputeResult = await recomputeProcessedAnalysisRows(ids)
  const v4Result = await recomputeV4AnalysisRows(ids)
  const rankedSelectionRows = await updateDailySelectionRanks(dayRange)
  return {
    providerResult,
    totalCandidates: candidates.totalCandidates,
    totalFetched: candidates.totalCandidates,
    skippedByLimit: Math.max(0, candidates.totalCandidates - ids.length),
    processed: recomputeResult.updated + v4Result.updated,
    processedMatchIds: ids,
    failures: [...recomputeResult.failures, ...v4Result.failures],
    recomputeResult: { updated: recomputeResult.updated + v4Result.updated, failures: [...recomputeResult.failures, ...v4Result.failures] },
    recomputeReadiness: v4Result.recomputeReadiness,
    recomputedStoredRows: 0,
    normalizedAnalysisRows: { checked: 0, fixed: 0 },
    rankedSelectionRows,
  }
}

async function runLearningMode(dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
  const provider = getProviderAdapter('api-football')
  const providerResult = { provider, fallbackUsed: false, fallbackProvider: null, fallbackError: null, competitions: 0, matches: [] }
  const candidates = await fetchFinishedLearningCandidates(dayRange, limit)
  const result = await processInChunks(candidates.rows, syncChunkSize, storePredictionResult, { provider: provider.name, dateKey: dayRange.dateKey, totalBatch: candidates.rows.length, totalFetched: candidates.totalCandidates })
  const rankedSelectionRows = await updateDailySelectionRanks(dayRange)
  return {
    providerResult,
    totalCandidates: candidates.totalCandidates,
    totalFetched: candidates.totalCandidates,
    skippedByLimit: Math.max(0, candidates.totalCandidates - candidates.rows.length),
    processed: result.processed,
    processedMatchIds: result.processedMatchIds,
    failures: result.failures,
    rankedSelectionRows,
  }
}

async function processInChunks(rows: Array<any>, chunkSize: number, worker: (row: any) => Promise<any>, context: any) {
  let processed = 0
  const processedMatchIds: Array<string> = []
  const failures: Array<{ matchId?: number; message: string }> = []
  const results: Array<any> = []

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    for (const row of chunk) {
      try {
        const result = await worker(row)
        if (result?.matchId) processedMatchIds.push(result.matchId)
        if (result) results.push(result)
        processed += 1
      } catch (error) {
        failures.push({
          matchId: Number(row?.id ?? row?.api_sports_fixture_id ?? row?.api_fixture_id ?? 0) || undefined,
          message: error instanceof Error ? error.message : 'row processing failed',
        })
      }
    }
    console.info('sync-football-data-progress', {
      ...context,
      processed,
      skippedByLimit: Math.max(0, Number(context.totalFetched ?? 0) - Number(context.totalBatch ?? 0)),
    })
  }

  return { processed, processedMatchIds, failures, results }
}

async function fetchEnrichCandidates(dayRange: ReturnType<typeof getBangkokDayRange>) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_fixture_id,
      api_provider,
      api_sports_fixture_id,
      api_sports_home_team_id,
      api_sports_away_team_id,
      kickoff_at,
      status,
      home_goals,
      away_goals,
      raw,
      league:football_leagues(id, api_league_id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, is_top_pick, final_rank, ranking_score, league_quality_score, confidence_score, risk_score, recommendation, value_market, value_side, value_line, calibrated_confidence_score, raw)
    `, { count: 'exact' })
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)
    .not('api_sports_fixture_id', 'is', null)
    .order('kickoff_at', { ascending: true })
    .limit(1000)

  if (result.error) throw result.error
  const rows = [...(result.data ?? [])].sort(compareEnrichCandidatePriority)
  return { rows, totalCandidates: result.count ?? rows.length }
}

function compareEnrichCandidatePriority(a: any, b: any) {
  const analysisA = getAnalysis(a)
  const analysisB = getAnalysis(b)
  const topPickDiff = Number(Boolean(analysisB?.is_top_pick)) - Number(Boolean(analysisA?.is_top_pick))
  const finalRankDiff = numericSortValue(analysisA?.final_rank, 999) - numericSortValue(analysisB?.final_rank, 999)
  const rankingDiff = numericSortValue(analysisB?.ranking_score, -1) - numericSortValue(analysisA?.ranking_score, -1)
  const leagueQualityDiff = numericSortValue(analysisB?.league_quality_score, -1) - numericSortValue(analysisA?.league_quality_score, -1)
  const confidenceDiff = numericSortValue(analysisB?.confidence_score, -1) - numericSortValue(analysisA?.confidence_score, -1)
  const kickoffA = new Date(a?.kickoff_at ?? 0).getTime()
  const kickoffB = new Date(b?.kickoff_at ?? 0).getTime()
  return topPickDiff || finalRankDiff || rankingDiff || leagueQualityDiff || confidenceDiff || kickoffA - kickoffB
}

async function fetchDbMatchCandidates(dayRange: ReturnType<typeof getBangkokDayRange>, limit: number, requireApiFootballFixture: boolean, options: { offset?: number; fixtureIds?: Array<number>; retryFailedOnly?: boolean } = {}) {
  const offset = Math.max(0, Number(options.offset ?? 0))
  let query = supabase
    .from('football_matches')
    .select(`
      id,
      api_fixture_id,
      api_provider,
      api_sports_fixture_id,
      api_sports_home_team_id,
      api_sports_away_team_id,
      kickoff_at,
      status,
      home_goals,
      away_goals,
      raw,
      league:football_leagues(id, api_league_id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, risk_score, ranking_score, value_market, value_side, value_line, calibrated_confidence_score, raw)
    `, { count: 'exact' })
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)
    .order('kickoff_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + Math.max(1, limit) - 1)

  if (requireApiFootballFixture) query = query.not('api_sports_fixture_id', 'is', null)
  if (options.fixtureIds?.length) query = query.in('api_sports_fixture_id', options.fixtureIds)
  if (options.retryFailedOnly) query = query.is('odds_updated_at', null)

  const result = await query
  if (result.error) throw result.error
  return { rows: result.data ?? [], totalCandidates: result.count ?? (result.data ?? []).length }
}

async function fetchFinishedLearningCandidates(dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      kickoff_at,
      status,
      home_goals,
      away_goals,
      raw,
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, value_market, value_side, value_line, model_version, raw)
    `, { count: 'exact' })
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)
    .in('status', ['FINISHED', 'FT', 'AET', 'PEN'])
    .not('home_goals', 'is', null)
    .not('away_goals', 'is', null)
    .order('kickoff_at', { ascending: true })
    .limit(limit)

  if (result.error) throw result.error
  return { rows: result.data ?? [], totalCandidates: result.count ?? (result.data ?? []).length }
}

async function enrichMatchData(row: any) {
  const fixtureId = Number(row.api_sports_fixture_id ?? row.raw?.raw_fixture_id ?? row.raw?.raw?.apiFootball?.fixture?.id ?? 0)
  if (!fixtureId) throw new Error('missing API-FOOTBALL fixture id')

  const odds = await fetchApiFootballOdds(fixtureId)
  const stats = await fetchApiFootballFixtureStatistics(fixtureId)
  const injuries = await fetchApiFootballInjuries(fixtureId)
  const lineups = await fetchApiFootballLineups(fixtureId)

  const oddsResult = await storeOddsSnapshots(row, fixtureId, odds)
  const statsResult = await storeTeamStatistics(row, fixtureId, stats)
  const injuriesResult = await storeInjuries(row, fixtureId, injuries)
  const lineupsResult = await storeLineups(row, fixtureId, lineups)
  const endpointCoverage = buildEndpointCoverage({
    odds: { response: odds, normalized: oddsResult },
    statistics: { response: stats, normalized: statsResult },
    injuries: { response: injuries, normalized: injuriesResult },
    lineups: { response: lineups, normalized: lineupsResult },
  })
  const v4 = buildV4EnrichmentAnalysis({
    match: row,
    odds: oddsResult,
    stats: statsResult,
    injuries: injuriesResult,
    lineups: lineupsResult,
  })

  await updateMatchAnalysisByMatchId(row.id, v4)
  const enrichmentStatus = getEnrichmentStatus(endpointCoverage)
  await supabase
    .from('football_matches')
    .update({
      enrichment_status: enrichmentStatus,
      enrichment_updated_at: new Date().toISOString(),
      odds_updated_at: oddsResult.available ? new Date().toISOString() : null,
      stats_updated_at: statsResult.available ? new Date().toISOString() : null,
      injuries_updated_at: injuriesResult.available ? new Date().toISOString() : null,
      lineups_updated_at: lineupsResult.available ? new Date().toISOString() : null,
    })
    .eq('id', row.id)
  await updateMatchReadinessMetadata(row.id, {
    fixtureId,
    odds: endpointAttemptSummary({ attempted: 1, success: odds?.ok ? 1 : 0, rowsSaved: oddsResult.rows.length, empty: odds?.ok && !oddsResult.rows.length ? 1 : 0, error: odds?.ok ? 0 : 1, message: odds?.error ?? null }),
    fixtureDetail: endpointAttemptSummary({
      attempted: 3,
      success: [statsResult, injuriesResult, lineupsResult].filter((item) => item.available).length,
      rowsSaved: statsResult.rows.length + injuriesResult.rows.length + lineupsResult.rows.length,
      empty: [statsResult, injuriesResult, lineupsResult].filter((item) => !item.available).length,
      error: [stats, injuries, lineups].filter((item) => !item?.ok).length,
    }),
    hasMarketData: oddsResult.available,
    hasFixtureDetail: statsResult.available || injuriesResult.available || lineupsResult.available,
    status: getDataReadinessStatus({
      hasMarketData: oddsResult.available,
      hasFixtureDetail: statsResult.available || injuriesResult.available || lineupsResult.available,
      failed: [odds, stats, injuries, lineups].some((item) => !item?.ok),
      skippedNoCoverage: false,
      attempted: true,
    }),
    error: [odds, stats, injuries, lineups].find((item) => !item?.ok)?.error ?? null,
  })

  return {
    matchId: row.id,
    endpointCoverage,
    enrichedMatch: {
      matchId: row.id,
      fixtureId,
      homeTeam: row.homeTeam?.name ?? null,
      awayTeam: row.awayTeam?.name ?? null,
      league: row.league?.name ?? null,
      finalRank: getAnalysis(row)?.final_rank ?? null,
      oddsRows: oddsResult.rows.length,
      statisticsRows: statsResult.rows.length,
      injuriesRows: injuriesResult.rows.length,
      lineupsRows: lineupsResult.rows.length,
    },
  }
}

function buildEndpointCoverage(results: Record<string, { response: any; normalized: any }>) {
  return Object.fromEntries(Object.entries(results).map(([name, result]) => {
    const dataCount = Array.isArray(result.response?.data) ? result.response.data.length : 0
    const rowsSaved = Array.isArray(result.normalized?.rows) ? result.normalized.rows.length : 0
    const failed = !result.response?.ok
    return [name, {
      called: 1,
      withData: !failed && dataCount > 0 ? 1 : 0,
      empty: !failed && dataCount === 0 ? 1 : 0,
      failed: failed ? 1 : 0,
      rowsSaved,
    }]
  }))
}

function summarizeEndpointCoverage(results: Array<any>) {
  const summary = createEmptyEndpointCoverage()
  for (const result of results) {
    mergeEndpointCoverage(summary, result?.endpointCoverage)
  }
  return summary
}

function createEmptyEndpointCoverage() {
  return {
    odds: createEmptyEndpointCounter(),
    statistics: createEmptyEndpointCounter(),
    injuries: createEmptyEndpointCounter(),
    lineups: createEmptyEndpointCounter(),
  }
}

function createEmptyEndpointCounter() {
  return { called: 0, withData: 0, empty: 0, failed: 0, rowsSaved: 0 }
}

function mergeEndpointCoverage(target: any, source: any) {
  for (const endpoint of ['odds', 'statistics', 'injuries', 'lineups']) {
    const current = source?.[endpoint]
    if (!current) continue
    target[endpoint].called += Number(current.called ?? 0)
    target[endpoint].withData += Number(current.withData ?? 0)
    target[endpoint].empty += Number(current.empty ?? 0)
    target[endpoint].failed += Number(current.failed ?? 0)
    target[endpoint].rowsSaved += Number(current.rowsSaved ?? 0)
  }
  return target
}

function getEnrichmentStatus(endpointCoverage: any) {
  const totalRowsSaved = ['odds', 'statistics', 'injuries', 'lineups'].reduce((total, endpoint) => total + Number(endpointCoverage?.[endpoint]?.rowsSaved ?? 0), 0)
  const oddsRows = Number(endpointCoverage?.odds?.rowsSaved ?? 0)
  const failed = ['odds', 'statistics', 'injuries', 'lineups'].some((endpoint) => Number(endpointCoverage?.[endpoint]?.failed ?? 0) > 0)
  if (failed && totalRowsSaved === 0) return 'ENRICH_FAILED'
  if (totalRowsSaved === 0) return 'ENRICHED_EMPTY'
  if (oddsRows > 0 && totalRowsSaved === oddsRows) return 'ENRICHED_ODDS_ONLY'
  if (['odds', 'statistics', 'injuries', 'lineups'].every((endpoint) => Number(endpointCoverage?.[endpoint]?.rowsSaved ?? 0) > 0)) return 'ENRICHED_FULL'
  return 'ENRICHED_PARTIAL'
}

function endpointAttemptSummary({ attempted = 0, success = 0, rowsSaved = 0, empty = 0, error = 0, message = null }: Record<string, unknown>) {
  return {
    attempted: Number(attempted ?? 0),
    success: Number(success ?? 0),
    rowsSaved: Number(rowsSaved ?? 0),
    empty: Number(empty ?? 0),
    error: Number(error ?? 0),
    message: message ? String(message) : null,
  }
}

async function updateMatchReadinessMetadata(matchId: string, patch: Record<string, unknown>) {
  if (!matchId) return

  const now = new Date().toISOString()
  const existing = await supabase
    .from('football_matches')
    .select('enrichment_breakdown, has_market_data, has_fixture_detail')
    .eq('id', matchId)
    .maybeSingle()
  if (existing.error) {
    if (isMissingColumnError(existing.error)) return
    throw existing.error
  }

  const currentBreakdown = existing.data?.enrichment_breakdown && typeof existing.data.enrichment_breakdown === 'object'
    ? existing.data.enrichment_breakdown
    : {}
  const attemptCount = Number(currentBreakdown.attemptCount ?? 0) + 1
  const hasStoredOdds = await matchHasStoredOdds(matchId)
  const hasMarketData = hasStoredOdds
  const hasFixtureDetail = Boolean(patch.hasFixtureDetail ?? existing.data?.has_fixture_detail)
  const failed = String(patch.status ?? '') === 'FAILED'
  const skippedNoCoverage = String(patch.status ?? '') === 'SKIPPED_NO_COVERAGE'
  const dataReadinessStatus = getDataReadinessStatus({
    hasMarketData,
    hasFixtureDetail,
    failed,
    skippedNoCoverage,
    attempted: true,
  })
  const nextBreakdown = {
    ...currentBreakdown,
    ...(patch.odds ? { odds: patch.odds } : {}),
    ...(patch.fixtureDetail ? { fixtureDetail: patch.fixtureDetail } : {}),
    ...(patch.standings ? { standings: patch.standings } : {}),
    ...(patch.form ? { form: patch.form } : {}),
    fixtureId: patch.fixtureId ?? currentBreakdown.fixtureId ?? null,
    attemptCount,
    updatedAt: now,
  }
  const updateResult = await supabase
    .from('football_matches')
    .update({
      enrichment_attempt_count: attemptCount,
      enrichment_last_attempt_at: now,
      enrichment_next_retry_at: dataReadinessStatus === 'READY' ? null : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      enrichment_error: patch.error ? String(patch.error) : null,
      enrichment_breakdown: nextBreakdown,
      enrichment_updated_at: now,
      odds_updated_at: hasMarketData ? now : null,
      has_market_data: hasMarketData,
      has_fixture_detail: hasFixtureDetail,
      data_readiness_score: calculateDataReadinessScore({ hasMarketData, hasFixtureDetail, failed, skippedNoCoverage }),
      data_readiness_status: dataReadinessStatus,
    })
    .eq('id', matchId)
  if (updateResult.error) {
    if (isMissingColumnError(updateResult.error)) return
    throw updateResult.error
  }
}

function getDataReadinessStatus({ hasMarketData, hasFixtureDetail, failed = false, skippedNoCoverage = false, attempted = false }: Record<string, unknown>) {
  if (failed) return 'FAILED'
  if (skippedNoCoverage) return 'SKIPPED_NO_COVERAGE'
  if (hasMarketData && hasFixtureDetail) return 'READY'
  if (hasMarketData) return 'PARTIAL'
  if (attempted) return 'NO_MARKET_DATA'
  return 'PENDING'
}

async function matchHasStoredOdds(matchId: string) {
  const result = await supabase
    .from('football_match_odds')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)
  if (result.error) {
    if (isMissingColumnError(result.error)) return false
    throw result.error
  }
  return Number(result.count ?? 0) > 0
}

function calculateDataReadinessScore({ hasMarketData, hasFixtureDetail, failed = false, skippedNoCoverage = false }: Record<string, unknown>) {
  if (failed) return 0
  if (skippedNoCoverage) return 15
  return (hasMarketData ? 70 : 0) + (hasFixtureDetail ? 30 : 0)
}

async function fetchApiFootballOdds(fixtureId: number) {
  return apiFootballSafeGet('/odds', { fixture: fixtureId })
}

async function fetchApiFootballFixtureStatistics(fixtureId: number) {
  return apiFootballSafeGet('/fixtures/statistics', { fixture: fixtureId })
}

async function fetchApiFootballInjuries(fixtureId: number) {
  return apiFootballSafeGet('/injuries', { fixture: fixtureId })
}

async function fetchApiFootballLineups(fixtureId: number) {
  return apiFootballSafeGet('/fixtures/lineups', { fixture: fixtureId })
}

async function apiFootballSafeGet(path: string, params: Record<string, string | number | undefined> = {}) {
  try {
    const data = await apiFootballGet(path, params)
    return { ok: true, data: data.response ?? [], error: null, raw: data }
  } catch (error) {
    return {
      ok: false,
      data: [],
      error: sanitizeText(error instanceof Error ? error.message : 'api-football request failed'),
      raw: null,
    }
  }
}

async function trackedApiFootballGet(context: FootballEnrichmentContext, endpoint: string, params: Record<string, string | number | undefined> = {}, meta: any = {}) {
  if (context.rateLimited || shouldStopForExecutionBudget(context)) {
    await logEnrichmentSync({ mode: context.mode, endpoint, status: 'skipped_not_due', ...toSyncMeta(meta) })
    return { ok: false, data: [], raw: null, rateLimited: context.rateLimited, pendingRetry: context.deadlineReached }
  }

  await sleep(700 + Math.floor(Math.random() * 501))
  if (shouldStopForExecutionBudget(context)) {
    await logEnrichmentSync({ mode: context.mode, endpoint, status: 'skipped_not_due', ...toSyncMeta(meta) })
    return { ok: false, data: [], raw: null, rateLimited: false, pendingRetry: true }
  }
  bumpEndpoint(context, endpoint, 'called')
  const startedAt = new Date().toISOString()
  try {
    const raw = await apiFootballGet(endpoint, params, context)
    const results = Number(raw?.results ?? (Array.isArray(raw?.response) ? raw.response.length : 0))
    const status = results === 0 ? 'empty' : 'success'
    bumpEndpoint(context, endpoint, results === 0 ? 'empty' : 'withData')
    await logEnrichmentSync({ mode: context.mode, endpoint, status, results_count: results, started_at: startedAt, finished_at: new Date().toISOString(), ...toSyncMeta(meta) })
    return { ok: true, data: raw?.response ?? [], raw, rateLimited: false }
  } catch (error) {
    const message = sanitizeText(error instanceof Error ? error.message : 'api-football request failed')
    if (message.includes('api-football 429')) context.rateLimited = true
    bumpEndpoint(context, endpoint, 'failed')
    await logEnrichmentSync({ mode: context.mode, endpoint, status: 'error', error_message: message, started_at: startedAt, finished_at: new Date().toISOString(), ...toSyncMeta(meta) })
    return { ok: false, data: [], raw: null, error: message, rateLimited: context.rateLimited }
  }
}

async function upsertApiFootballData(table: string, conflictTarget: string, rows: Array<any>) {
  if (!rows.length) return { count: 0 }
  const result = await supabase
    .from(table)
    .upsert(rows, { onConflict: conflictTarget })
  if (result.error) throw result.error
  return { count: rows.length }
}

async function replaceApiFootballRows(table: string, match: Record<string, string | number | null | undefined>, rows: Array<any>) {
  let query = supabase.from(table).delete()
  for (const [key, value] of Object.entries(match)) {
    if (value !== undefined && value !== null) query = query.eq(key, value)
  }
  const deleteResult = await query
  if (deleteResult.error) throw deleteResult.error
  if (!rows.length) return { count: 0 }
  const insertResult = await supabase.from(table).insert(rows)
  if (insertResult.error) throw insertResult.error
  return { count: rows.length }
}

function normalizeLeagueCoverage(row: any, fallback: any) {
  const league = row?.league ?? {}
  const country = row?.country ?? {}
  const coverage = row?.seasons?.find((season: any) => Number(season?.year) === Number(fallback.season))?.coverage ?? row?.coverage ?? {}
  return {
    api_league_id: safeNumber(league.id ?? fallback.api_league_id),
    season: safeNumber(fallback.season),
    league_name: league.name ?? fallback.league_name ?? null,
    country_name: country.name ?? fallback.country_name ?? null,
    coverage,
    has_events: Boolean(coverage?.fixtures?.events),
    has_lineups: Boolean(coverage?.fixtures?.lineups),
    has_fixture_statistics: Boolean(coverage?.fixtures?.statistics_fixtures),
    has_player_statistics: Boolean(coverage?.fixtures?.statistics_players),
    has_standings: Boolean(coverage?.standings),
    has_players: Boolean(coverage?.players),
    has_top_scorers: Boolean(coverage?.top_scorers),
    has_top_assists: Boolean(coverage?.top_assists),
    has_top_cards: Boolean(coverage?.top_cards),
    has_injuries: Boolean(coverage?.injuries),
    raw_payload: row,
    synced_at: new Date().toISOString(),
  }
}

function normalizeFixtureStatisticsRows(items: Array<any>, fixtureId: number) {
  return items.map((item: any) => {
    const stats = item.statistics ?? []
    return {
      api_fixture_id: fixtureId,
      api_team_id: safeNumber(item.team?.id),
      team_name: item.team?.name ?? null,
      shots_on_goal: getStatValue(stats, 'Shots on Goal'),
      shots_off_goal: getStatValue(stats, 'Shots off Goal'),
      total_shots: getStatValue(stats, 'Total Shots'),
      blocked_shots: getStatValue(stats, 'Blocked Shots'),
      shots_insidebox: getStatValue(stats, 'Shots insidebox') ?? getStatValue(stats, 'Shots inside box'),
      shots_outsidebox: getStatValue(stats, 'Shots outsidebox') ?? getStatValue(stats, 'Shots outside box'),
      fouls: getStatValue(stats, 'Fouls'),
      corner_kicks: getStatValue(stats, 'Corner Kicks'),
      offsides: getStatValue(stats, 'Offsides'),
      ball_possession: parsePercent(firstStatValue(stats, 'Ball Possession')),
      yellow_cards: getStatValue(stats, 'Yellow Cards'),
      red_cards: getStatValue(stats, 'Red Cards'),
      goalkeeper_saves: getStatValue(stats, 'Goalkeeper Saves'),
      total_passes: getStatValue(stats, 'Total passes') ?? getStatValue(stats, 'Total Passes'),
      passes_accurate: getStatValue(stats, 'Passes accurate') ?? getStatValue(stats, 'Passes Accurate'),
      passes_percentage: parsePercent(firstStatValue(stats, 'Passes %')),
      raw_statistics: stats,
      raw_payload: item,
      synced_at: new Date().toISOString(),
    }
  }).filter((row: any) => row.api_team_id)
}

function normalizeFixtureEventRows(items: Array<any>, fixtureId: number) {
  return items.map((item: any) => ({
    api_fixture_id: fixtureId,
    api_team_id: safeNumber(item.team?.id),
    team_name: item.team?.name ?? null,
    api_player_id: safeNumber(item.player?.id),
    player_name: item.player?.name ?? null,
    api_assist_player_id: safeNumber(item.assist?.id),
    assist_player_name: item.assist?.name ?? null,
    elapsed: safeNumber(item.time?.elapsed),
    extra: safeNumber(item.time?.extra),
    event_type: item.type ?? null,
    event_detail: item.detail ?? null,
    comments: item.comments ?? null,
    raw_payload: item,
    synced_at: new Date().toISOString(),
  }))
}

function normalizeFixtureLineupRows(items: Array<any>, fixtureId: number) {
  return items.map((item: any) => ({
    api_fixture_id: fixtureId,
    api_team_id: safeNumber(item.team?.id),
    team_name: item.team?.name ?? null,
    formation: item.formation ?? null,
    coach_id: safeNumber(item.coach?.id),
    coach_name: item.coach?.name ?? null,
    start_xi: item.startXI ?? [],
    substitutes: item.substitutes ?? [],
    raw_payload: item,
    synced_at: new Date().toISOString(),
  })).filter((row: any) => row.api_team_id)
}

function normalizeFixturePlayerRows(items: Array<any>, fixtureId: number) {
  const rows: Array<any> = []
  for (const team of items) {
    for (const item of team.players ?? []) {
      const stats = item.statistics?.[0] ?? {}
      rows.push({
        api_fixture_id: fixtureId,
        api_team_id: safeNumber(team.team?.id),
        team_name: team.team?.name ?? null,
        api_player_id: safeNumber(item.player?.id),
        player_name: item.player?.name ?? null,
        player_photo: item.player?.photo ?? null,
        minutes: safeNumber(stats.games?.minutes),
        number: safeNumber(stats.games?.number),
        position: stats.games?.position ?? null,
        rating: safeNumber(stats.games?.rating),
        captain: stats.games?.captain ?? null,
        substitute: stats.games?.substitute ?? null,
        shots_total: safeNumber(stats.shots?.total),
        shots_on: safeNumber(stats.shots?.on),
        goals_total: safeNumber(stats.goals?.total),
        goals_conceded: safeNumber(stats.goals?.conceded),
        assists: safeNumber(stats.goals?.assists),
        saves: safeNumber(stats.goals?.saves),
        passes_total: safeNumber(stats.passes?.total),
        passes_key: safeNumber(stats.passes?.key),
        passes_accuracy: parsePercent(stats.passes?.accuracy),
        tackles_total: safeNumber(stats.tackles?.total),
        tackles_blocks: safeNumber(stats.tackles?.blocks),
        tackles_interceptions: safeNumber(stats.tackles?.interceptions),
        duels_total: safeNumber(stats.duels?.total),
        duels_won: safeNumber(stats.duels?.won),
        dribbles_attempts: safeNumber(stats.dribbles?.attempts),
        dribbles_success: safeNumber(stats.dribbles?.success),
        fouls_drawn: safeNumber(stats.fouls?.drawn),
        fouls_committed: safeNumber(stats.fouls?.committed),
        yellow_cards: safeNumber(stats.cards?.yellow),
        red_cards: safeNumber(stats.cards?.red),
        penalty_won: safeNumber(stats.penalty?.won),
        penalty_committed: safeNumber(stats.penalty?.commited ?? stats.penalty?.committed),
        penalty_scored: safeNumber(stats.penalty?.scored),
        penalty_missed: safeNumber(stats.penalty?.missed),
        penalty_saved: safeNumber(stats.penalty?.saved),
        raw_statistics: stats,
        raw_payload: item,
        synced_at: new Date().toISOString(),
      })
    }
  }
  return rows.filter((row) => row.api_team_id && row.api_player_id)
}

function normalizeInjuryRows(items: Array<any>) {
  return items.map((item: any) => ({
    api_fixture_id: safeNumber(item.fixture?.id),
    api_league_id: safeNumber(item.league?.id),
    season: safeNumber(item.league?.season),
    api_team_id: safeNumber(item.team?.id),
    team_name: item.team?.name ?? null,
    api_player_id: safeNumber(item.player?.id),
    player_name: item.player?.name ?? null,
    player_photo: item.player?.photo ?? null,
    player_type: item.player?.type ?? null,
    reason: item.player?.reason ?? null,
    fixture_date: item.fixture?.date ?? null,
    timezone: item.fixture?.timezone ?? null,
    raw_payload: item,
    synced_at: new Date().toISOString(),
  }))
}

function normalizeSquadRows(items: Array<any>, fallback: any) {
  const rows: Array<any> = []
  for (const team of items) {
    for (const player of team.players ?? []) {
      rows.push({
        api_team_id: safeNumber(team.team?.id ?? fallback.api_team_id),
        team_name: team.team?.name ?? fallback.team_name ?? null,
        api_player_id: safeNumber(player.id),
        player_name: player.name ?? null,
        age: safeNumber(player.age),
        number: safeNumber(player.number),
        position: player.position ?? null,
        photo: player.photo ?? null,
        raw_payload: { team: team.team, player },
        synced_at: new Date().toISOString(),
      })
    }
  }
  return rows.filter((row) => row.api_team_id && row.api_player_id)
}

function normalizeCoachRows(items: Array<any>, fallback: any) {
  return items.map((item: any) => ({
    api_coach_id: safeNumber(item.id),
    api_team_id: safeNumber(fallback.api_team_id ?? item.team?.id),
    coach_name: item.name ?? null,
    firstname: item.firstname ?? null,
    lastname: item.lastname ?? null,
    age: safeNumber(item.age),
    birth_date: item.birth?.date ?? null,
    birth_place: item.birth?.place ?? null,
    birth_country: item.birth?.country ?? null,
    nationality: item.nationality ?? null,
    height: item.height ?? null,
    weight: item.weight ?? null,
    photo: item.photo ?? null,
    career: item.career ?? [],
    raw_payload: item,
    synced_at: new Date().toISOString(),
  })).filter((row: any) => row.api_coach_id)
}

function normalizeVenueRows(items: Array<any>, fallback: any) {
  return items.map((item: any) => ({
    api_venue_id: safeNumber(item.id ?? fallback.api_venue_id),
    venue_name: item.name ?? fallback.venue_name ?? null,
    address: item.address ?? null,
    city: item.city ?? fallback.city ?? null,
    country: item.country ?? null,
    capacity: safeNumber(item.capacity),
    surface: item.surface ?? null,
    image: item.image ?? null,
    raw_payload: item,
    synced_at: new Date().toISOString(),
  })).filter((row: any) => row.api_venue_id)
}

function normalizeVenueFallbackRow(venue: any) {
  const key = venue.venue_name || venue.city
  if (!key) return null
  const syntheticId = -Math.abs(hashText(`${venue.venue_name ?? ''}:${venue.city ?? ''}`))
  return {
    api_venue_id: syntheticId,
    venue_name: venue.venue_name ?? null,
    city: venue.city ?? null,
    country: venue.country ?? null,
    raw_payload: { fallback: true, source: venue },
    synced_at: new Date().toISOString(),
  }
}

function normalizeTopPlayerRows(items: Array<any>, category: string, league: any) {
  return items.map((item: any, index: number) => ({
    category,
    api_league_id: league.api_league_id,
    season: league.season,
    rank: index + 1,
    api_team_id: safeNumber(item.statistics?.[0]?.team?.id),
    team_name: item.statistics?.[0]?.team?.name ?? null,
    team_logo: item.statistics?.[0]?.team?.logo ?? null,
    api_player_id: safeNumber(item.player?.id),
    player_name: item.player?.name ?? null,
    player_photo: item.player?.photo ?? null,
    nationality: item.player?.nationality ?? null,
    age: safeNumber(item.player?.age),
    position: item.statistics?.[0]?.games?.position ?? null,
    goals_total: safeNumber(item.statistics?.[0]?.goals?.total),
    assists: safeNumber(item.statistics?.[0]?.goals?.assists),
    yellow_cards: safeNumber(item.statistics?.[0]?.cards?.yellow),
    red_cards: safeNumber(item.statistics?.[0]?.cards?.red),
    appearances: safeNumber(item.statistics?.[0]?.games?.appearences ?? item.statistics?.[0]?.games?.appearances),
    minutes: safeNumber(item.statistics?.[0]?.games?.minutes),
    rating: safeNumber(item.statistics?.[0]?.games?.rating),
    raw_payload: item,
    synced_at: new Date().toISOString(),
  })).filter((row: any) => row.api_player_id)
}

async function fetchDistinctApiFootballLeagues() {
  const result = await supabase
    .from('football_matches')
    .select('api_sports_league_id, kickoff_at, raw, league:football_leagues(api_league_id, name, country)')
    .not('api_sports_league_id', 'is', null)
    .order('kickoff_at', { ascending: false })
    .limit(1000)
  if (result.error) throw result.error

  const map = new Map<string, any>()
  for (const row of result.data ?? []) {
    const apiLeagueId = safeNumber(row.api_sports_league_id ?? row.raw?.apiFootball?.league?.id)
    const season = safeNumber(row.raw?.apiFootball?.league?.season ?? getSeasonFromKickoff(row.kickoff_at))
    if (!apiLeagueId || !season) continue
    const key = `${apiLeagueId}:${season}`
    if (!map.has(key)) {
      map.set(key, {
        api_league_id: apiLeagueId,
        season,
        league_name: row.league?.name ?? row.raw?.apiFootball?.league?.name ?? null,
        country_name: row.league?.country ?? row.raw?.apiFootball?.league?.country ?? null,
      })
    }
  }
  return [...map.values()].sort((left, right) => {
    const leagueOrder = Number(left.api_league_id ?? 0) - Number(right.api_league_id ?? 0)
    return leagueOrder || Number(left.season ?? 0) - Number(right.season ?? 0)
  })
}

async function fetchDistinctApiFootballTeams() {
  const result = await supabase
    .from('football_matches')
    .select(`
      api_sports_home_team_id,
      api_sports_away_team_id,
      homeTeam:football_teams!football_matches_home_team_id_fkey(api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(api_team_id, name)
    `)
    .limit(1000)
  if (result.error) throw result.error

  const map = new Map<number, any>()
  for (const row of result.data ?? []) {
    const teams = [
      { api_team_id: safeNumber(row.api_sports_home_team_id ?? row.homeTeam?.api_team_id), team_name: row.homeTeam?.name },
      { api_team_id: safeNumber(row.api_sports_away_team_id ?? row.awayTeam?.api_team_id), team_name: row.awayTeam?.name },
    ]
    for (const team of teams) {
      if (team.api_team_id && !map.has(team.api_team_id)) map.set(team.api_team_id, team)
    }
  }
  return [...map.values()]
}

async function fetchDistinctApiFootballVenues() {
  const result = await supabase
    .from('football_matches')
    .select('venue, raw')
    .order('kickoff_at', { ascending: false })
    .limit(1000)
  if (result.error) throw result.error

  const map = new Map<string, any>()
  for (const row of result.data ?? []) {
    const rawVenue = row.raw?.apiFootball?.fixture?.venue ?? row.raw?.raw?.apiFootball?.fixture?.venue ?? row.raw?.fixture?.venue ?? {}
    const venue = {
      api_venue_id: safeNumber(rawVenue.id),
      venue_name: rawVenue.name ?? (typeof row.venue === 'string' ? row.venue : row.venue?.name) ?? null,
      city: rawVenue.city ?? (typeof row.venue === 'object' ? row.venue?.city : null),
      country: rawVenue.country ?? null,
    }
    const key = venue.api_venue_id ? `id:${venue.api_venue_id}` : `text:${venue.venue_name ?? ''}:${venue.city ?? ''}`
    if ((venue.api_venue_id || venue.venue_name || venue.city) && !map.has(key)) map.set(key, venue)
  }
  return [...map.values()]
}

async function fetchApiFootballFixtureCandidates(dayRange: ReturnType<typeof getBangkokDayRange>, limit: number, offset = 0) {
  const safeOffset = Math.max(0, Number(offset ?? 0))
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      api_sports_league_id,
      api_sports_home_team_id,
      api_sports_away_team_id,
      kickoff_at,
      status,
      raw,
      league:football_leagues(id, api_league_id, name, country),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, final_rank, is_top_pick, ranking_score)
    `, { count: 'exact' })
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)
    .not('api_sports_fixture_id', 'is', null)
    .order('kickoff_at', { ascending: true })
    .order('id', { ascending: true })
    .range(safeOffset, safeOffset + Math.max(1, limit) - 1)

  if (result.error) throw result.error
  return { rows: result.data ?? [], totalCandidates: result.count ?? (result.data ?? []).length }
}

async function fetchCoverageForMatch(match: any) {
  return fetchCoverageForLeague(getMatchLeagueId(match), getMatchSeason(match))
}

async function fetchCoverageForLeague(apiLeagueId: number | null, season: number | null) {
  if (!apiLeagueId || !season) return null
  const result = await supabase
    .from('api_football_league_coverage')
    .select('*')
    .eq('api_league_id', apiLeagueId)
    .eq('season', season)
    .maybeSingle()
  if (result.error) {
    if (isMissingColumnError(result.error)) return null
    throw result.error
  }
  return result.data
}

function getMatchFixtureId(match: any) {
  return safeNumber(match?.api_sports_fixture_id ?? match?.raw?.raw_fixture_id ?? match?.raw?.apiFootball?.fixture?.id)
}

function getMatchLeagueId(match: any) {
  return safeNumber(match?.api_sports_league_id ?? match?.league?.api_league_id ?? match?.raw?.apiFootball?.league?.id)
}

function getMatchSeason(match: any) {
  return safeNumber(match?.raw?.apiFootball?.league?.season ?? getSeasonFromKickoff(match?.kickoff_at))
}

function getSeasonFromKickoff(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  return month >= 7 ? year : year - 1
}

function hasCoverage(coverage: any, key: string) {
  if (!coverage) return true
  if (coverage[key] === null || coverage[key] === undefined) return true
  return Boolean(coverage[key])
}

function shouldFetchFixtureEnrichment(match: any, endpoint: string) {
  const status = String(match?.status ?? match?.raw?.status ?? '').toUpperCase()
  const kickoffMs = new Date(match?.kickoff_at ?? Date.now()).getTime()
  const now = Date.now()
  const minutesToKickoff = (kickoffMs - now) / 60000
  if (endpoint === '/fixtures/lineups') return minutesToKickoff <= 90
  if (['FT', 'AET', 'PEN', 'LIVE', '1H', '2H', 'HT', 'ET', 'BT', 'P'].includes(status)) return true
  return kickoffMs <= now
}

function safeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(String(value).replace('%', '').replace(',', '.'))
  return Number.isFinite(numeric) ? numeric : null
}

function parsePercent(value: unknown) {
  return safeNumber(value)
}

function getStatValue(stats: Array<any>, type: string) {
  return safeNumber(firstStatValue(stats, type))
}

function firstStatValue(stats: Array<any>, type: string) {
  const target = String(type).toLowerCase()
  return stats.find((stat: any) => String(stat?.type ?? '').toLowerCase() === target)?.value ?? null
}

async function logEnrichmentSync(payload: any) {
  const result = await supabase.from('api_football_enrichment_sync_log').insert({
    mode: payload.mode,
    api_fixture_id: payload.api_fixture_id ?? null,
    api_league_id: payload.api_league_id ?? null,
    api_team_id: payload.api_team_id ?? null,
    season: payload.season ?? null,
    endpoint: payload.endpoint,
    status: payload.status,
    results_count: payload.results_count ?? 0,
    error_message: payload.error_message ?? null,
    started_at: payload.started_at ?? new Date().toISOString(),
    finished_at: payload.finished_at ?? new Date().toISOString(),
  })
  if (result.error) throw result.error
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunk<T>(array: Array<T>, size: number) {
  const chunks: Array<Array<T>> = []
  for (let index = 0; index < array.length; index += size) chunks.push(array.slice(index, index + size))
  return chunks
}

function addEndpointRowsSaved(context: FootballEnrichmentContext, endpoint: string, rowsSaved: number) {
  bumpEndpoint(context, endpoint, 'rowsSaved', rowsSaved)
}

function addEndpointSkipped(context: FootballEnrichmentContext, endpoint: string) {
  bumpEndpoint(context, endpoint, 'skipped')
}

function bumpEndpoint(context: FootballEnrichmentContext, endpoint: string, field: FootballEnrichmentEndpointCounterKey, amount = 1) {
  context.endpoints[endpoint] ??= { called: 0, withData: 0, empty: 0, skipped: 0, failed: 0, rowsSaved: 0 }
  context.endpoints[endpoint][field] += amount
}

function rememberSkippedEndpoint(context: FootballEnrichmentContext, endpoint: string, reason: string, meta: any = {}) {
  context.skippedEndpoints.push({ endpoint, reason, ...meta })
}

function cloneEndpointCounters(source: Record<string, FootballEnrichmentEndpointCounter>) {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, { ...value }]))
}

function diffEndpointCounters(before: Record<string, FootballEnrichmentEndpointCounter>, after: Record<string, FootballEnrichmentEndpointCounter>) {
  const delta = { called: 0, withData: 0, empty: 0, skipped: 0, failed: 0, rowsSaved: 0 }
  for (const [endpoint, current] of Object.entries(after)) {
    const previous = before[endpoint] ?? { called: 0, withData: 0, empty: 0, skipped: 0, failed: 0, rowsSaved: 0 }
    delta.called += current.called - previous.called
    delta.withData += current.withData - previous.withData
    delta.empty += current.empty - previous.empty
    delta.skipped += current.skipped - previous.skipped
    delta.failed += current.failed - previous.failed
    delta.rowsSaved += current.rowsSaved - previous.rowsSaved
  }
  return delta
}

function diffEndpointCounterMap(before: Record<string, FootballEnrichmentEndpointCounter>, after: Record<string, FootballEnrichmentEndpointCounter>) {
  const delta: Record<string, FootballEnrichmentEndpointCounter> = {}
  for (const [endpoint, current] of Object.entries(after)) {
    const previous = before[endpoint] ?? { called: 0, withData: 0, empty: 0, skipped: 0, failed: 0, rowsSaved: 0 }
    const item = {
      called: current.called - previous.called,
      withData: current.withData - previous.withData,
      empty: current.empty - previous.empty,
      skipped: current.skipped - previous.skipped,
      failed: current.failed - previous.failed,
      rowsSaved: current.rowsSaved - previous.rowsSaved,
    }
    if (Object.values(item).some((value) => value > 0)) delta[endpoint] = item
  }
  return delta
}

function buildDailyPhaseDetails(phase: string, results: Array<any>, continuationState: Record<string, any> = {}) {
  if (phase === 'core') {
    const fixtures = results.find((result) => result?.coreOperation === 'fixtures')
    const coverage = results.find((result) => result?.coreOperation === 'coverage')
    const rounds = results.find((result) => result?.coreOperation === 'rounds')
    const continuation = getCoreAuxiliaryContinuation(continuationState)
    return {
      coreStage: continuation.coreStage,
      fixturesProcessed: Number(fixtures?.processed ?? 0),
      coverageProcessed: Number(coverage?.processed ?? 0),
      coverageCandidatesProcessed: Number(coverage?.processedCandidates ?? 0),
      coverageTotalCandidates: Number(coverage?.totalCandidates ?? continuation.coverageTotalCandidates),
      coverageComplete: continuation.coverageComplete,
      roundsProcessed: Number(rounds?.processed ?? 0),
      roundsCandidatesProcessed: Number(rounds?.processedCandidates ?? 0),
      roundsTotalCandidates: Number(rounds?.totalCandidates ?? continuation.roundsTotalCandidates),
      roundsComplete: continuation.roundsComplete,
      coreAuxiliaryComplete: continuation.coreAuxiliaryComplete,
    }
  }
  if (phase === 'fixture-enrichment') {
    const fixtureDetail = results[0]?.fixtureDetail ?? {}
    const odds = results[1] ?? {}
    return {
      fixtureDetail: {
        attempted: Number(fixtureDetail.attempted ?? 0),
        success: Number(fixtureDetail.success ?? 0),
        rowsSaved: Number(fixtureDetail.rowsSaved ?? 0),
        empty: Number(fixtureDetail.empty ?? 0),
        error: Number(fixtureDetail.error ?? 0),
      },
      odds: {
        attempted: Number(odds.oddsAttempted ?? odds.processedFixtures ?? 0),
        success: Number(odds.processedFixtureIds?.length ?? 0),
        rowsSaved: Number(odds.oddsRowsSaved ?? odds.rowsSaved ?? 0),
        empty: Number(odds.oddsEmptyFixtures ?? odds.emptyFixtures ?? 0),
        error: Number(odds.oddsFailedFixtures ?? odds.failedFixtures ?? 0),
      },
      oddsAttempted: Number(odds.oddsAttempted ?? odds.processedFixtures ?? 0),
      oddsRowsSaved: Number(odds.oddsRowsSaved ?? odds.rowsSaved ?? 0),
      oddsEmptyFixtures: Number(odds.oddsEmptyFixtures ?? odds.emptyFixtures ?? 0),
      oddsFailedFixtures: Number(odds.oddsFailedFixtures ?? odds.failedFixtures ?? 0),
      fixtureDetailAttempted: Number(fixtureDetail.attempted ?? 0),
      fixtureDetailRowsSaved: Number(fixtureDetail.rowsSaved ?? 0),
      fixtureDetailEmptyFixtures: Number(fixtureDetail.empty ?? 0),
      fixtureDetailFailedFixtures: Number(fixtureDetail.error ?? 0),
      partial: isFixtureEnrichmentPartial(results, {}),
    }
  }
  if (phase === 'ranking') {
    return {
      rankingStatus: Number(results[0]?.failed ?? 0) > 0 ? 'failed' : results[0]?.partial ? 'partial' : 'success',
      rankingReadiness: results[0]?.rankingReadiness ?? null,
    }
  }
  return {}
}

function isFixtureEnrichmentPartial(results: Array<any>, endpointBreakdown: Record<string, FootballEnrichmentEndpointCounter>) {
  const oddsResult = results[1] ?? {}
  const oddsAttempted = Number(oddsResult.oddsAttempted ?? oddsResult.processedFixtures ?? endpointBreakdown?.['/odds']?.called ?? 0)
  const oddsRowsSaved = Number(oddsResult.oddsRowsSaved ?? oddsResult.rowsSaved ?? endpointBreakdown?.['/odds']?.rowsSaved ?? 0)
  const fixtureRowsSaved = Number(results[0]?.rowsSaved ?? 0)
  return (oddsAttempted > 0 && oddsRowsSaved === 0) || (Number(results[0]?.totalCandidates ?? 0) > 0 && fixtureRowsSaved === 0)
}

function toSyncMeta(meta: any) {
  return {
    api_fixture_id: meta.apiFixtureId ?? null,
    api_league_id: meta.apiLeagueId ?? null,
    api_team_id: meta.apiTeamId ?? null,
    season: meta.season ?? null,
  }
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return hash || 1
}

function getPositiveLimit(value: unknown, defaultLimit: number, maxLimit: number) {
  const numeric = Number(value ?? defaultLimit)
  if (!Number.isFinite(numeric) || numeric <= 0) return defaultLimit
  return Math.max(1, Math.min(Math.floor(numeric), maxLimit))
}

async function storeOddsSnapshots(match: any, fixtureId: number, response: any) {
  const normalized = normalizeOddsPayload(match, response)
  if (normalized.rows.length) {
    await supabase.from('football_odds_snapshots').insert(normalized.rows.map((row: any) => ({
      match_id: match.id,
      fixture_id: fixtureId,
      ...row,
    })))
  }
  if (response?.ok) {
    const marketRows = normalizeMatchOddsRows(match, fixtureId, response.data ?? [])
    await storeFootballBookmakers(marketRows.bookmakers)
    await storeFootballMatchOdds(match.id, marketRows.rows)
  }
  return normalized
}

function normalizeMatchOddsRows(match: any, fixtureId: number, rawRows: Array<any>) {
  const rows: Array<any> = []
  const bookmakers = new Map<number, any>()
  const fetchedAt = new Date().toISOString()
  for (const item of rawRows ?? []) {
    const providerSourceAt = parseProviderSourceTimestamp(item?.update ?? item?.updated_at ?? item?.last_update)
    for (const bookmaker of item.bookmakers ?? []) {
      const bookmakerId = nullableNumber(bookmaker.id)
      if (bookmakerId) bookmakers.set(bookmakerId, {
        api_bookmaker_id: bookmakerId,
        name: String(bookmaker.name ?? '').trim() || `Bookmaker ${bookmakerId}`,
        raw: bookmaker,
        updated_at: new Date().toISOString(),
      })
      for (const bet of bookmaker.bets ?? []) {
        const marketFocus = normalizeMarketFocus(bet.name)
        if (marketFocus === 'NONE') continue
        for (const value of bet.values ?? []) {
          const normalizedSelection = normalizeMarketSelection(marketFocus, value.value)
          rows.push({
            match_id: match.id,
            api_fixture_id: fixtureId,
            api_bookmaker_id: bookmakerId,
            bookmaker_name: bookmaker.name ?? null,
            market_focus: toLegacyMarketFocus(marketFocus),
            normalized_market_type: marketFocus,
            market_name: bet.name ?? null,
            selection: value.value ?? null,
            normalized_selection: normalizedSelection,
            line: parseBetLine(value.value),
            price: nullableNumber(value.odd),
            odd_text: value.odd ? String(value.odd) : null,
            is_opening: rows.length === 0,
            is_latest: true,
            snapshot_at: fetchedAt,
            provider_source_at: providerSourceAt,
            fetched_at: fetchedAt,
            normalized_at: fetchedAt,
            raw: { bookmaker, bet, value, provider_source_at: providerSourceAt },
            updated_at: fetchedAt,
          })
        }
      }
    }
  }
  return { rows, bookmakers: [...bookmakers.values()] }
}

async function storeFootballBookmakers(rows: Array<any>) {
  if (!rows.length) return { count: 0 }
  return upsertApiFootballData('football_bookmakers', 'api_bookmaker_id', rows)
}

async function storeFootballMatchOdds(matchId: string, rows: Array<any>) {
  if (!rows.length) return { count: 0, unchanged: false }
  let current = await supabase
    .from('football_match_odds')
    .select('match_id, api_fixture_id, api_bookmaker_id, bookmaker_name, market_focus, normalized_market_type, market_name, selection, normalized_selection, line, price')
    .eq('match_id', matchId)
    .eq('is_latest', true)
    .range(0, 4999)
  if (isMissingColumnError(current.error)) {
    current = await supabase
      .from('football_match_odds')
      .select('match_id, api_fixture_id, api_bookmaker_id, bookmaker_name, market_focus, market_name, selection, line, price')
      .eq('match_id', matchId)
      .eq('is_latest', true)
      .range(0, 4999)
  }
  if (current.error) throw current.error
  const currentSignature = buildBatchSignature((current.data ?? []).map(buildOddsNaturalKey).sort())
  const nextSignature = buildBatchSignature(rows.map(buildOddsNaturalKey).sort())
  if ((current.data ?? []).length && currentSignature === nextSignature) return { count: 0, unchanged: true }
  const retired = await supabase.from('football_match_odds').update({ is_latest: false }).eq('match_id', matchId)
  if (retired.error) throw retired.error
  let result = await supabase.from('football_match_odds').insert(rows)
  if (isMissingColumnError(result.error)) {
    result = await supabase.from('football_match_odds').insert(rows.map((row) => stripApiFootballPickPayload(row)))
  }
  if (result.error) throw result.error
  return { count: rows.length, unchanged: false }
}

function toLegacyMarketFocus(marketType: unknown) {
  const normalized = normalizeMarketType(marketType)
  return ['AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE'].includes(normalized) ? normalized : 'NONE'
}

function parseProviderSourceTimestamp(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function fetchStoredMatchOdds(matchId: string) {
  const rows: Array<any> = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const result = await supabase
      .from('football_match_odds')
      .select('*')
      .eq('match_id', matchId)
      .order('is_latest', { ascending: false })
      .order('snapshot_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (result.error) throw result.error
    rows.push(...(result.data ?? []))
    if (!result.data || result.data.length < pageSize) break
  }
  return rows
}

function normalizeOddsPayload(match: any, response: any) {
  const rawRows = response.ok ? response.data ?? [] : []
  const rows: Array<any> = []
  for (const item of rawRows) {
    for (const bookmaker of item.bookmakers ?? []) {
      for (const bet of bookmaker.bets ?? []) {
        const market = normalizeMarketName(bet.name)
        if (!market) continue
        for (const value of bet.values ?? []) {
          rows.push({
            bookmaker: bookmaker.name ?? null,
            market,
            selection: value.value ?? null,
            line: parseBetLine(value.value),
            price: nullableNumber(value.odd),
            odd_text: value.odd ? String(value.odd) : null,
            is_opening: rows.length === 0,
            is_latest: true,
            raw: { bookmaker, bet, value },
          })
        }
      }
    }
  }
  const latest = rows.at(-1)
  const opening = rows[0]
  const available = rows.length > 0
  const pickSide = getAnalysis(match)?.pick_side ?? null
  const movement = opening && latest && opening.line !== latest.line ? `${opening.line ?? '-'} -> ${latest.line ?? '-'}` : available ? 'ราคาล่าสุดพร้อมใช้งาน แต่ยังไม่เห็นการไหลชัดเจน' : 'ยังไม่มีข้อมูลราคา'
  return {
    available,
    rows,
    market_edge_score: available ? 62 : 50,
    odds_confidence_score: available ? 64 : 50,
    odds_movement_score: available && pickSide && String(latest?.selection ?? '').toUpperCase().includes(String(pickSide).toUpperCase()) ? 66 : available ? 58 : 50,
    value_market: latest?.market ?? null,
    value_side: latest?.selection ?? null,
    value_line: latest?.line ?? null,
    opening_line: opening?.line ?? null,
    latest_line: latest?.line ?? null,
    opening_odds: opening?.odd_text ?? null,
    latest_odds: latest?.odd_text ?? null,
    odds_movement_summary: movement,
  }
}

function normalizeMarketFocus(value: unknown) {
  return normalizeMarketType(value)
}

function buildEdgeAiFinalPick(match: any) {
  const analysis = getAnalysis(match)
  const ahAnalysis = edgeAnalyzeAh(match)
  const ouAnalysis = edgeAnalyzeOu(match)
  const selected = chooseEdgeMarket(ahAnalysis, ouAnalysis)
  const odds = match.odds ?? []
  const apiPick = deriveEdgePickTeamFromApiFootballOdds(match, odds)
  const hasOdds = odds.length > 0 && Boolean(selected.hasMarket)
  const totalAnalysisScore = normalizeScore(analysis.ranking_score ?? analysis.ai_score ?? analysis.confidence_score ?? 0)
  const selectionScore = normalizeScore(selected.confidenceScore)
  const confidenceScore = normalizeScore(Math.max(selectionScore, Number(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? selectionScore)))
  const riskLevel = normalizeRiskLevelText(analysis.risk_level ?? (selected.warnings.length >= 3 ? 'HIGH' : selected.warnings.length ? 'MEDIUM' : 'LOW'))
  const keyReasons = uniqueText([...(selected.reasons ?? [])]).slice(0, 5)
  const warningSigns = uniqueText([...(selected.warnings ?? [])]).slice(0, 5)
  const bookmakerCount = new Set(odds.map((row: any) => row.bookmaker_name).filter(Boolean)).size
  const movementAgainst = /against/i.test(String(selected.marketSignal ?? ''))
  const marketDataUsed = Boolean(analysis.market_data_used ?? analysis.raw?.market_data_used ?? hasOdds)
  const oddsRowsUsed = Number(analysis.odds_rows_used ?? analysis.raw?.odds_rows_used ?? odds.length)
  const marketEdgeScore = normalizeScore(analysis.market_edge_score ?? analysis.raw?.market_edge_score ?? 0)
  const recommendation = String(analysis.recommendation ?? '').toUpperCase().replace('_', ' ')
  let signal: 'STRONG_SIGNAL' | 'WATCH' | 'SKIP' = 'WATCH'
  if (totalAnalysisScore < 60 || confidenceScore < 55 || riskLevel === 'HIGH' || !hasOdds || movementAgainst || warningSigns.length > 3) signal = 'SKIP'
  else if (
    recommendation === 'BET' &&
    totalAnalysisScore >= 78 &&
    confidenceScore >= 78 &&
    marketDataUsed &&
    oddsRowsUsed > 0 &&
    marketEdgeScore >= 70
  ) signal = 'STRONG_SIGNAL'
  else if (totalAnalysisScore >= 75 && selectionScore >= 70 && confidenceScore >= 70 && bookmakerCount >= 1 && keyReasons.length >= 3) signal = 'STRONG_SIGNAL'

  const marketFocus = signal === 'SKIP' && !hasOdds ? 'NONE' : selected.marketFocus
  const direction = signal === 'SKIP' && !hasOdds ? 'No market direction' : selected.direction
  const selectedOdds = odds.filter((row: any) => normalizeMarketType(row.normalized_market_type ?? row.market_focus ?? row.market_name) === normalizeMarketType(apiPick.pickMarket ?? marketFocus))
  const normalizedSelectedOdds = selectedOdds.map((row: any) => normalizeMarketRow({
    ...row,
    market_type: row.normalized_market_type ?? row.market_focus ?? row.market_name,
    selection: row.normalized_selection ?? row.selection,
  }))
  const freshness = selectedOdds.map((row: any) => evaluateMarketFreshness(row))
  const hasValidSupportedMarket = normalizedSelectedOdds.some((row: any) => row.valid && row.actionable && isActionableMarketType(row.marketType))
  const hasFreshMarket = freshness.some((item: any) => item.fresh)
  const marketReasonCodes = !odds.length
    ? ['MARKET_MISSING']
    : !selectedOdds.length
      ? ['MARKET_PARTIAL']
      : !hasValidSupportedMarket
        ? ['MARKET_INVALID']
        : !hasFreshMarket
          ? [freshness.some((item: any) => item.stale) ? 'MARKET_STALE' : 'MARKET_REFRESH_PENDING']
          : []
  const lastMarketRefreshAt = freshness
    .map((item: any) => item.timestamp)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null
  const decisionReadinessScore = Math.min(totalAnalysisScore, confidenceScore, marketEdgeScore || confidenceScore)
  const gate = classifyDecisionState({
    analysisComplete: Boolean(analysis.id ?? analysis.analysis_status ?? analysis.recommendation),
    finalPickActionable: signal === 'STRONG_SIGNAL' && Boolean(apiPick.pickSelection) && isActionableMarketType(apiPick.pickMarket),
    hasAnalysisDirection: Boolean(selected.direction),
    hasAnyMarket: odds.length > 0,
    marketReady: hasValidSupportedMarket && hasFreshMarket,
    marketReasonCodes,
    riskLevel,
    readinessScore: decisionReadinessScore,
  })
  const actionable = gate.status === 'READY'
  return {
    signal: gate.status === 'READY' ? 'STRONG_SIGNAL' : gate.status === 'WATCH' ? 'WATCH' : 'SKIP',
    marketFocus,
    direction,
    confidenceScore: signal === 'SKIP' && !hasOdds ? Math.min(confidenceScore, 54) : confidenceScore,
    riskLevel,
    keyReasons,
    warningSigns,
    marketSignal: hasOdds ? selected.marketSignal : 'ยังไม่มีข้อมูลตลาดราคา',
    finalSummary: buildEdgeAiFinalSummary(signal, marketFocus, direction, confidenceScore, riskLevel, hasOdds),
    ahAnalysis,
    ouAnalysis,
    pickTeam: actionable ? apiPick.pickTeam : null,
    pickTeamId: actionable ? apiPick.pickTeamId : null,
    pickSide: actionable ? apiPick.pickSide : 'NONE',
    pickSource: actionable ? apiPick.pickSource : 'NONE',
    pickMarket: actionable ? apiPick.pickMarket : null,
    pickMarketId: actionable ? apiPick.pickMarketId : null,
    pickSelection: actionable ? apiPick.pickSelection : null,
    pickPrice: actionable ? apiPick.pickPrice : null,
    pickConfidence: actionable ? confidenceScore : null,
    primaryBookmaker: odds.find((row: any) => row.bookmaker_name)?.bookmaker_name ?? null,
    latestOdds: odds.find((row: any) => row.market_focus === selected.marketFocus)?.odd_text ?? null,
    analysisStatus: analysis.analysis_status ?? analysis.raw?.analysis_status ?? (marketDataUsed ? 'MARKET_DATA_READY_RECALCULATED' : 'INSUFFICIENT_MARKET_DATA'),
    recommendationReason: analysis.recommendation_reason ?? analysis.raw?.recommendation_reason ?? (marketDataUsed ? 'มีข้อมูลตลาดแล้ว แต่คะแนน edge/risk ยังไม่ผ่านเกณฑ์' : 'ข้อมูลตลาด/ราคา/odds ยังไม่พร้อม จึงไม่ยกระดับเป็นคู่แนะนำ'),
    marketDataUsed,
    oddsRowsUsed,
    recalculatedAt: analysis.recalculated_at ?? new Date().toISOString(),
    analysisVersion: analysis.analysis_version ?? analysis.raw?.analysis_version ?? marketReadinessAnalysisVersion,
    selectionStatus: gate.status,
    marketReady: gate.status === 'READY',
    primaryReasonCode: gate.primaryReasonCode,
    reasonCodes: gate.reasonCodes,
    decisionReasonTh: gate.reasonThai,
    decisionReadinessScore,
    lastMarketRefreshAt,
    lastAnalysisAt: analysis.recalculated_at ?? analysis.updated_at ?? null,
    versionFields: systemVersions,
  }
}

function edgeAnalyzeAh(match: any) {
  const analysis = getAnalysis(match)
  const rows = (match.odds ?? []).filter((row: any) => row.market_focus === 'AH')
  const homeScore = averageNumbers([analysis.home_advantage_score, analysis.home_away_score, analysis.team_strength_score, analysis.form_score], 58)
  const awayScore = averageNumbers([100 - Number(analysis.home_advantage_score ?? 58), analysis.away_weakness_score, analysis.form_score ? 100 - Number(analysis.form_score) : null], 52)
  const gap = homeScore - awayScore
  const direction = `${gap >= 0 ? 'Home' : 'Away'} ${Math.abs(gap) >= 16 ? '-0.75' : Math.abs(gap) >= 10 ? '-0.5' : Math.abs(gap) >= 5 ? '-0.25' : '+0.25'}`
  const reasons = [
    Math.abs(gap) >= 8 ? 'Team strength profile supports AH direction' : '',
    Number(analysis.home_advantage_score ?? 0) >= 62 ? 'Home/away profile is above baseline' : '',
    rows.length ? 'AH market data is available from API-FOOTBALL' : '',
  ].filter(Boolean)
  const warnings = [
    !rows.length ? 'ยังไม่มีข้อมูลตลาดราคา' : '',
    Math.abs(gap) < 5 ? 'Team edge is narrow' : '',
    normalizeRiskLevelText(analysis.risk_level) === 'HIGH' ? 'Risk level is high' : '',
  ].filter(Boolean)
  return {
    marketFocus: 'AH',
    direction,
    confidenceScore: normalizeScore(48 + Math.abs(gap) * 0.55 + (rows.length ? 8 : -10) - warnings.length * 3),
    reasons: reasons.length ? reasons : ['AH data direction is conservative'],
    warnings,
    marketSignal: rows.length ? 'Latest AH market data is available' : 'ยังไม่มีข้อมูลตลาดราคา',
    hasMarket: rows.length > 0,
    bookmakerCount: new Set(rows.map((row: any) => row.bookmaker_name).filter(Boolean)).size,
  }
}

function edgeAnalyzeOu(match: any) {
  const analysis = getAnalysis(match)
  const rows = (match.odds ?? []).filter((row: any) => row.market_focus === 'OU')
  const attacking = Number(analysis.goal_scoring_score ?? 58)
  const defending = Number(analysis.defensive_stability_score ?? 58)
  const tempo = averageNumbers([attacking, 100 - defending], 58)
  const line = rows.find((row: any) => row.line)?.line ?? (tempo >= 62 ? '2.75' : tempo >= 52 ? '2.5' : '3.0')
  const direction = tempo >= 52 ? `Over ${line}` : `Under ${line}`
  const reasons = [
    attacking >= 62 ? 'Attacking profile is above baseline' : '',
    defending <= 52 ? 'Defensive stability leaves room for goals' : '',
    rows.length ? 'OU market data is available from API-FOOTBALL' : '',
  ].filter(Boolean)
  const warnings = [
    !rows.length ? 'ยังไม่มีข้อมูลตลาดราคา' : '',
    tempo > 47 && tempo < 57 ? 'Goal tempo is close to neutral' : '',
    normalizeRiskLevelText(analysis.risk_level) === 'HIGH' ? 'Risk level is high' : '',
  ].filter(Boolean)
  return {
    marketFocus: 'OU',
    direction,
    confidenceScore: normalizeScore(46 + Math.abs(tempo - 52) * 0.58 + (rows.length ? 8 : -10) - warnings.length * 3),
    reasons: reasons.length ? reasons : ['OU data direction is conservative'],
    warnings,
    marketSignal: rows.length ? 'Latest OU market data is available' : 'ยังไม่มีข้อมูลตลาดราคา',
    hasMarket: rows.length > 0,
    bookmakerCount: new Set(rows.map((row: any) => row.bookmaker_name).filter(Boolean)).size,
  }
}

function chooseEdgeMarket(ahAnalysis: any, ouAnalysis: any) {
  const ahScore = Number(ahAnalysis.confidenceScore ?? 0)
  const ouScore = Number(ouAnalysis.confidenceScore ?? 0)
  if (ahScore > ouScore + 5) return ahAnalysis
  if (ouScore > ahScore + 5) return ouAnalysis
  return (ahAnalysis.warnings?.length ?? 0) <= (ouAnalysis.warnings?.length ?? 0) ? ahAnalysis : ouAnalysis
}

function buildEdgeAiFinalSummary(signal: string, marketFocus: string, direction: string, confidenceScore: number, riskLevel: string, hasOdds: boolean) {
  if (!hasOdds) return 'ยังไม่มีข้อมูลตลาดราคา AI Final Pick จึงจำกัดสัญญาณสูงสุดไม่ให้เป็น Strong Signal'
  if (signal === 'STRONG_SIGNAL') return `Strong Signal on ${marketFocus} ${direction} with ${confidenceScore}% confidence and ${riskLevel} risk.`
  if (signal === 'WATCH') return `Watch ${marketFocus} ${direction}. Data direction is useful but still needs confirmation.`
  return `Skip ${marketFocus} ${direction}. Risk or data conflict is too high for a final signal.`
}

function normalizeRiskLevelText(value: unknown) {
  const text = String(value ?? '').toUpperCase()
  return ['LOW', 'MEDIUM', 'HIGH'].includes(text) ? text : 'MEDIUM'
}

function averageNumbers(values: Array<unknown>, fallback: number) {
  const numbers = values.map(Number).filter(Number.isFinite)
  if (!numbers.length) return fallback
  return numbers.reduce((total, value) => total + value, 0) / numbers.length
}

function uniqueText(values: Array<unknown>) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

async function storeTeamStatistics(match: any, fixtureId: number, response: any) {
  const normalized = normalizeFixtureStatistics(match, response)
  if (normalized.rows.length) await supabase.from('football_team_statistics').insert(normalized.rows)
  return normalized
}

function normalizeFixtureStatistics(match: any, response: any) {
  const rawRows = response.ok ? response.data ?? [] : []
  const rows = rawRows.map((item: any) => {
    const stats = Object.fromEntries((item.statistics ?? []).map((stat: any) => [String(stat.type ?? '').toLowerCase(), stat.value]))
    const teamId = nullableNumber(item.team?.id)
    return {
      match_id: match.id,
      fixture_id: nullableNumber(match.api_sports_fixture_id),
      team_id: teamId,
      team_name: item.team?.name ?? null,
      is_home: Number(teamId) === Number(match.api_sports_home_team_id),
      shots_on_goal: statNumber(stats['shots on goal']),
      shots_off_goal: statNumber(stats['shots off goal']),
      total_shots: statNumber(stats['total shots']),
      blocked_shots: statNumber(stats['blocked shots']),
      shots_inside_box: statNumber(stats['shots insidebox'] ?? stats['shots inside box']),
      shots_outside_box: statNumber(stats['shots outsidebox'] ?? stats['shots outside box']),
      fouls: statNumber(stats.fouls),
      corner_kicks: statNumber(stats['corner kicks']),
      offsides: statNumber(stats.offsides),
      ball_possession: statNumber(stats['ball possession']),
      yellow_cards: statNumber(stats['yellow cards']),
      red_cards: statNumber(stats['red cards']),
      goalkeeper_saves: statNumber(stats['goalkeeper saves']),
      total_passes: statNumber(stats['total passes']),
      passes_accurate: statNumber(stats['passes accurate']),
      passes_percent: statNumber(stats['passes %']),
      expected_goals: statNumber(stats['expected goals']),
      raw: item,
    }
  })
  const available = rows.length > 0
  const attack = rows.reduce((total: number, row: any) => total + Number(row.shots_on_goal ?? 0) + Number(row.expected_goals ?? 0) * 8 + Number(row.corner_kicks ?? 0), 0)
  return {
    available,
    rows,
    team_stats_score: available ? normalizeScore(58 + attack / Math.max(rows.length, 1)) : 60,
  }
}

async function storeInjuries(match: any, fixtureId: number, response: any) {
  const normalized = normalizeInjuries(match, fixtureId, response)
  if (normalized.rows.length) await supabase.from('football_injuries').insert(normalized.rows)
  return normalized
}

function normalizeInjuries(match: any, fixtureId: number, response: any) {
  const rawRows = response.ok ? response.data ?? [] : []
  const rows = rawRows.map((item: any) => ({
    match_id: match.id,
    fixture_id: fixtureId,
    team_id: nullableNumber(item.team?.id),
    team_name: item.team?.name ?? null,
    player_id: nullableNumber(item.player?.id),
    player_name: item.player?.name ?? null,
    player_type: item.player?.type ?? null,
    reason: item.player?.reason ?? null,
    raw: item,
  }))
  return {
    available: rows.length > 0,
    rows,
    injuries_score: normalizeScore(60 - Math.min(rows.length * 3, 25)),
  }
}

async function storeLineups(match: any, fixtureId: number, response: any) {
  const normalized = normalizeLineups(match, fixtureId, response)
  if (normalized.rows.length) await supabase.from('football_lineups').insert(normalized.rows)
  return normalized
}

function normalizeLineups(match: any, fixtureId: number, response: any) {
  const rawRows = response.ok ? response.data ?? [] : []
  const rows = rawRows.map((item: any) => ({
    match_id: match.id,
    fixture_id: fixtureId,
    team_id: nullableNumber(item.team?.id),
    team_name: item.team?.name ?? null,
    formation: item.formation ?? null,
    coach_name: item.coach?.name ?? null,
    start_xi: item.startXI ?? [],
    substitutes: item.substitutes ?? [],
    raw: item,
  }))
  return {
    available: rows.length > 0,
    rows,
    lineups_score: rows.length ? 72 : 60,
  }
}

function buildV4EnrichmentAnalysis({ match, odds, stats, injuries, lineups }: any) {
  const analysis = getAnalysis(match)
  const baseConfidence = normalizeScore(analysis?.calibrated_confidence_score ?? analysis?.confidence_score ?? 58)
  const marketEdgeScore = normalizeScore(odds?.market_edge_score ?? 50)
  const oddsConfidenceScore = normalizeScore(odds?.odds_confidence_score ?? 50)
  const oddsMovementScore = normalizeScore(odds?.odds_movement_score ?? 50)
  const teamStatsScore = normalizeScore(stats?.team_stats_score ?? 60)
  const injuriesScore = normalizeScore(injuries?.injuries_score ?? 60)
  const lineupsScore = normalizeScore(lineups?.lineups_score ?? 60)
  const dataDepthScore = calculateV4DataDepth({ odds, stats, injuries, lineups })
  const historicalAccuracyScore = normalizeScore(analysis?.historical_accuracy_score ?? 50)
  const learningAdjustmentScore = normalizeScore(analysis?.learning_adjustment_score ?? 50) - 50
  const calibratedConfidenceScore = normalizeScore(
    baseConfidence * 0.42 +
      oddsConfidenceScore * 0.16 +
      oddsMovementScore * 0.1 +
      teamStatsScore * 0.12 +
      injuriesScore * 0.08 +
      lineupsScore * 0.06 +
      dataDepthScore * 0.06 +
      learningAdjustmentScore,
  )
  const riskScore = normalizeScore(analysis?.risk_score ?? 100 - calibratedConfidenceScore)
  const riskLevel = getRiskLevelFromRiskScore(riskScore)
  const recommendation = getRecommendationFromConfidence(calibratedConfidenceScore, riskLevel)
  const rankingScore = normalizeScore(
    calibratedConfidenceScore * 0.48 +
      marketEdgeScore * 0.14 +
      oddsMovementScore * 0.1 +
      teamStatsScore * 0.1 +
      dataDepthScore * 0.1 +
      historicalAccuracyScore * 0.08,
  )

  return {
    market_edge_score: marketEdgeScore,
    odds_confidence_score: oddsConfidenceScore,
    odds_movement_score: oddsMovementScore,
    team_stats_score: teamStatsScore,
    injuries_score: injuriesScore,
    lineups_score: lineupsScore,
    data_depth_score: dataDepthScore,
    learning_adjustment_score: learningAdjustmentScore,
    calibrated_confidence_score: calibratedConfidenceScore,
    historical_accuracy_score: historicalAccuracyScore,
    model_version: 'v4',
    value_side: odds?.value_side ?? analysis?.value_side ?? analysis?.pick_side ?? null,
    value_market: odds?.value_market ?? analysis?.value_market ?? analysis?.market_type ?? null,
    value_line: odds?.value_line ?? analysis?.value_line ?? analysis?.market_line ?? null,
    opening_line: odds?.opening_line ?? analysis?.opening_line ?? null,
    latest_line: odds?.latest_line ?? analysis?.latest_line ?? null,
    opening_odds: odds?.opening_odds ?? analysis?.opening_odds ?? null,
    latest_odds: odds?.latest_odds ?? analysis?.latest_odds ?? null,
    odds_movement_summary: odds?.odds_movement_summary ?? analysis?.odds_movement_summary ?? null,
    enriched_summary: buildV4Summary({ odds, stats, injuries, lineups, calibratedConfidenceScore, dataDepthScore }),
    recommendation,
    risk_level: riskLevel,
    confidence_score: Math.max(Number(analysis?.confidence_score ?? 0), calibratedConfidenceScore),
    ranking_score: rankingScore,
    ai_score: rankingScore,
  }
}

async function updateMatchAnalysisByMatchId(matchId: string, payload: Record<string, unknown>) {
  const result = await supabase
    .from('match_analysis')
    .update(payload)
    .eq('match_id', matchId)

  if (isMissingColumnError(result.error)) {
    const legacy = await supabase
      .from('match_analysis')
      .update(stripApiFootballPickPayload(payload))
      .eq('match_id', matchId)
    if (legacy.error) throw legacy.error
    return
  }
  if (result.error) throw result.error
}

async function recomputeV4AnalysisRows(matchIds: Array<string>) {
  if (!matchIds.length) return { updated: 0, failures: [], recomputeReadiness: emptyRecomputeReadinessSummary() }

  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      has_market_data,
      has_fixture_detail,
      data_readiness_score,
      data_readiness_status,
      odds_updated_at,
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, risk_score, ranking_score, market_edge_score, odds_confidence_score, odds_movement_score, team_stats_score, injuries_score, lineups_score, data_depth_score, learning_adjustment_score, historical_accuracy_score, value_market, value_side, value_line, raw, ${analysisReadinessMetadataSelect}),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name)
    `)
    .in('id', matchIds)

  if (result.error) throw result.error

  let updated = 0
  const failures: Array<{ matchId?: string; message: string }> = []
  const recomputeReadiness = emptyRecomputeReadinessSummary()
  const oddsByMatchId = await fetchStoredOddsByMatchIds(matchIds)
  for (const row of result.data ?? []) {
    try {
      const analysis = getAnalysis(row)
      const oddsRows = oddsByMatchId.get(row.id) ?? []
      const payload = buildMarketReadinessRecomputeAnalysis(row, analysis, oddsRows)
      await updateMatchAnalysisByMatchId(row.id, payload)
      trackRecomputeReadiness(recomputeReadiness, row, oddsRows, payload)
      updated += 1
    } catch (error) {
      failures.push({ matchId: row.id, message: error instanceof Error ? error.message : 'v4 recompute failed' })
    }
  }

  return { updated, failures, recomputeReadiness }
}

function buildV4RecomputeAnalysis(analysis: any) {
  const confidence = normalizeScore(analysis?.calibrated_confidence_score ?? analysis?.confidence_score ?? 58)
  const marketEdge = normalizeScore(analysis?.market_edge_score ?? 50)
  const oddsConfidence = normalizeScore(analysis?.odds_confidence_score ?? 50)
  const oddsMovement = normalizeScore(analysis?.odds_movement_score ?? 50)
  const teamStats = normalizeScore(analysis?.team_stats_score ?? 60)
  const injuries = normalizeScore(analysis?.injuries_score ?? 60)
  const lineups = normalizeScore(analysis?.lineups_score ?? 60)
  const depth = normalizeScore(analysis?.data_depth_score ?? 25)
  const learningAdjustment = Number(analysis?.learning_adjustment_score ?? 0)
  const calibrated = normalizeScore(confidence * 0.5 + oddsConfidence * 0.14 + oddsMovement * 0.1 + teamStats * 0.1 + injuries * 0.06 + lineups * 0.04 + depth * 0.06 + learningAdjustment)
  const rankingScore = normalizeScore(calibrated * 0.55 + marketEdge * 0.18 + oddsMovement * 0.12 + depth * 0.15)
  const riskScore = normalizeScore(analysis?.risk_score ?? 100 - calibrated)
  const riskLevel = getRiskLevelFromRiskScore(riskScore)

  return {
    market_edge_score: marketEdge,
    odds_confidence_score: oddsConfidence,
    odds_movement_score: oddsMovement,
    team_stats_score: teamStats,
    injuries_score: injuries,
    lineups_score: lineups,
    data_depth_score: depth,
    learning_adjustment_score: learningAdjustment,
    calibrated_confidence_score: calibrated,
    historical_accuracy_score: normalizeScore(analysis?.historical_accuracy_score ?? 50),
    model_version: 'v4',
    confidence_score: Math.max(Number(analysis?.confidence_score ?? 0), calibrated),
    recommendation: getRecommendationFromConfidence(calibrated, riskLevel),
    risk_level: riskLevel,
    ranking_score: rankingScore,
    ai_score: rankingScore,
    enriched_summary: `Data Intelligence v4 calibrated ${calibrated}/100 with data depth ${depth}/100.`,
  }
}

function buildMarketReadinessRecomputeAnalysis(match: any, analysis: any, oddsRows: Array<any>) {
  const marketReady = hasUsableMarketDataForRecompute(match, oddsRows)
  const recalculatedAt = new Date().toISOString()
  const raw = analysis?.raw && typeof analysis.raw === 'object' ? analysis.raw : {}
  const apiPick = deriveEdgePickTeamFromApiFootballOdds(match, oddsRows)

  if (!marketReady) {
    const base = buildV4RecomputeAnalysis(analysis)
    const confidenceScore = roundScore(Math.min(Number(base.confidence_score ?? 50), 54))
    const rankingScore = roundScore(Math.min(Number(base.ranking_score ?? 45), 49))
    const riskScore = normalizeScore(Math.max(Number(base.risk_score ?? 68), 68))
    return {
      ...base,
      market_edge_score: 0,
      odds_confidence_score: 0,
      odds_movement_score: 0,
      calibrated_confidence_score: confidenceScore,
      confidence_score: confidenceScore,
      ranking_score: rankingScore,
      ai_score: rankingScore,
      risk_score: riskScore,
      risk_level: getRiskLevelFromRiskScore(riskScore),
      recommendation: 'NO BET',
      analysis_status: 'INSUFFICIENT_MARKET_DATA',
      recommendation_reason: 'ข้อมูลตลาด/ราคา/odds ยังไม่พร้อม จึงไม่ยกระดับเป็นคู่แนะนำ',
      market_data_used: false,
      odds_rows_used: oddsRows.length,
      pick_team: null,
      pick_team_id: null,
      pick_source: 'NONE',
      pick_market: null,
      pick_market_id: null,
      pick_selection: null,
      pick_price: null,
      pick_confidence: null,
      recalculated_at: recalculatedAt,
      analysis_version: marketReadinessAnalysisVersion,
      enriched_summary: 'Market readiness recompute kept this match as NO BET because market odds/line data is not ready.',
      raw: {
        ...raw,
        analysis_status: 'INSUFFICIENT_MARKET_DATA',
        recommendation_reason: 'ข้อมูลตลาด/ราคา/odds ยังไม่พร้อม จึงไม่ยกระดับเป็นคู่แนะนำ',
        market_data_used: false,
        odds_rows_used: oddsRows.length,
        pick_team: null,
        pick_team_id: null,
        pick_source: 'NONE',
        pick_market: null,
        pick_market_id: null,
        pick_selection: null,
        pick_price: null,
        data_readiness_status: match?.data_readiness_status ?? null,
        analysis_version: marketReadinessAnalysisVersion,
      },
    }
  }

  const metrics = summarizeStoredOddsRows(oddsRows)
  const readinessScore = normalizeScore(match?.data_readiness_score ?? (String(match?.data_readiness_status ?? '').toUpperCase() === 'READY' ? 88 : 72))
  const baseConfidence = normalizeScore(analysis?.calibrated_confidence_score ?? analysis?.confidence_score ?? 58)
  const teamStats = normalizeScore(analysis?.team_stats_score ?? averageNumbers([analysis?.team_strength_score, analysis?.form_score], 60))
  const injuries = normalizeScore(analysis?.injuries_score ?? 60)
  const lineups = normalizeScore(analysis?.lineups_score ?? (match?.has_fixture_detail ? 62 : 55))
  const depth = normalizeScore(Math.max(Number(analysis?.data_depth_score ?? 0), readinessScore, metrics.dataDepthScore))
  const learningAdjustment = Number(analysis?.learning_adjustment_score ?? 0)
  const calibrated = roundScore(
    baseConfidence * 0.34 +
      metrics.oddsConfidenceScore * 0.22 +
      metrics.marketEdgeScore * 0.18 +
      metrics.oddsMovementScore * 0.1 +
      teamStats * 0.06 +
      depth * 0.1 +
      learningAdjustment,
  )
  const riskScore = normalizeScore(
    (100 - calibrated) * 0.45 +
      metrics.riskScore * 0.45 +
      (String(match?.data_readiness_status ?? '').toUpperCase() === 'PARTIAL' ? 8 : 0),
  )
  const riskLevel = getRiskLevelFromRiskScore(riskScore)
  const recommendation = getRecommendationFromConfidence(calibrated, riskLevel)
  const rankingScore = roundScore(calibrated * 0.5 + metrics.marketEdgeScore * 0.22 + metrics.oddsMovementScore * 0.13 + depth * 0.15 - (riskScore >= 70 ? 4 : 0))
  const analysisStatus = recommendation === 'NO BET' ? 'MODEL_NO_EDGE' : 'MARKET_DATA_READY_RECALCULATED'
  const recommendationReason = recommendation === 'NO BET'
    ? 'มีข้อมูลตลาดแล้ว แต่คะแนน edge/risk ยังไม่ผ่านเกณฑ์'
    : 'มีข้อมูลตลาดและคะแนน edge/risk ผ่านเกณฑ์ของโมเดล'

  return {
    market_edge_score: metrics.marketEdgeScore,
    odds_confidence_score: metrics.oddsConfidenceScore,
    odds_movement_score: metrics.oddsMovementScore,
    team_stats_score: teamStats,
    injuries_score: injuries,
    lineups_score: lineups,
    data_depth_score: depth,
    learning_adjustment_score: learningAdjustment,
    calibrated_confidence_score: calibrated,
    historical_accuracy_score: normalizeScore(analysis?.historical_accuracy_score ?? 50),
    model_version: 'v4',
    value_side: metrics.primarySelection ?? analysis?.value_side ?? analysis?.pick_side ?? null,
    value_market: metrics.primaryMarket ?? analysis?.value_market ?? analysis?.market_type ?? null,
    value_line: metrics.primaryLine ?? analysis?.value_line ?? null,
    opening_line: metrics.openingLine ?? analysis?.opening_line ?? null,
    latest_line: metrics.latestLine ?? analysis?.latest_line ?? null,
    opening_odds: metrics.openingOdds ?? analysis?.opening_odds ?? null,
    latest_odds: metrics.latestOdds ?? analysis?.latest_odds ?? null,
    odds_movement_summary: metrics.movementSummary,
    confidence_score: calibrated,
    recommendation,
    risk_score: riskScore,
    risk_level: riskLevel,
    ranking_score: rankingScore,
    ai_score: rankingScore,
    enriched_summary: `Market readiness recompute used ${oddsRows.length} odds rows (${metrics.marketFocusCount} markets, ${metrics.bookmakerCount} bookmakers).`,
    analysis_status: analysisStatus,
    recommendation_reason: recommendationReason,
    market_data_used: true,
    odds_rows_used: oddsRows.length,
    pick_team: apiPick.pickTeam,
    pick_team_id: apiPick.pickTeamId,
    pick_source: apiPick.pickSource,
    pick_market: apiPick.pickMarket,
    pick_market_id: apiPick.pickMarketId,
    pick_selection: apiPick.pickSelection,
    pick_price: apiPick.pickPrice,
    pick_confidence: apiPick.hasApiFootballOdds ? calibrated : null,
    recalculated_at: recalculatedAt,
    analysis_version: marketReadinessAnalysisVersion,
    raw: {
      ...raw,
      market_recompute: metrics,
      analysis_status: analysisStatus,
      recommendation_reason: recommendationReason,
      market_data_used: true,
      odds_rows_used: oddsRows.length,
      pick_team: apiPick.pickTeam,
      pick_team_id: apiPick.pickTeamId,
      pick_source: apiPick.pickSource,
      pick_market: apiPick.pickMarket,
      pick_market_id: apiPick.pickMarketId,
      pick_selection: apiPick.pickSelection,
      pick_price: apiPick.pickPrice,
      data_readiness_status: match?.data_readiness_status ?? null,
      analysis_version: marketReadinessAnalysisVersion,
    },
  }
}

function hasUsableMarketDataForRecompute(match: any, oddsRows: Array<any>) {
  return oddsRows.length > 0
}

function summarizeStoredOddsRows(oddsRows: Array<any>) {
  const rows = oddsRows.length ? oddsRows : []
  const latestRows = rows.filter((row) => row.is_latest !== false)
  const activeRows = latestRows.length ? latestRows : rows
  const marketFocuses = new Set(activeRows.map((row) => String(row.market_focus ?? 'NONE')).filter((value) => value && value !== 'NONE'))
  const bookmakerCount = new Set(activeRows.map((row) => row.bookmaker_name ?? row.api_bookmaker_id).filter(Boolean)).size
  const prices = activeRows.map((row) => nullableNumber(row.price)).filter((value): value is number => value !== null && value > 0)
  const avgPrice = averageNumbers(prices, 2)
  const priceSpread = prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : 0
  const primaryMarket = mostFrequentValue(activeRows.map((row) => row.market_focus).filter((value) => value && value !== 'NONE')) ?? 'MATCH_WINNER'
  const primaryRows = activeRows.filter((row) => row.market_focus === primaryMarket)
  const primaryRow = primaryRows.find((row) => row.line || row.selection || row.odd_text) ?? activeRows[0] ?? null
  const lineValues = activeRows.map((row) => parseLineNumber(row.line)).filter((value): value is number => value !== null)
  const lineSpread = lineValues.length > 1 ? Math.max(...lineValues) - Math.min(...lineValues) : 0
  const coverageScore = 46 + Math.min(24, marketFocuses.size * 8) + Math.min(18, bookmakerCount * 3) + Math.min(10, Math.log10(rows.length + 1) * 8)
  const priceSignal = prices.length ? Math.min(12, Math.abs(avgPrice - 2) * 10 + Math.min(priceSpread * 6, 8)) : -8
  const lineSignal = Math.min(8, lineSpread * 4)
  const marketEdgeScore = roundScore(coverageScore + priceSignal + lineSignal)
  const oddsConfidenceScore = roundScore(48 + Math.min(22, rows.length * 0.9) + Math.min(16, bookmakerCount * 3) + Math.min(10, marketFocuses.size * 4) - Math.min(12, priceSpread * 4))
  const oddsMovementScore = roundScore(52 + Math.min(16, lineSignal + priceSpread * 5) + Math.min(10, marketFocuses.size * 3) - (prices.length ? 0 : 10))
  const dataDepthScore = roundScore(40 + Math.min(30, rows.length * 1.2) + Math.min(18, bookmakerCount * 3) + Math.min(12, marketFocuses.size * 4))
  const riskScore = normalizeScore(76 - Math.min(18, bookmakerCount * 3) - Math.min(14, marketFocuses.size * 4) + Math.min(18, priceSpread * 5))

  return {
    rows: rows.length,
    marketFocusCount: marketFocuses.size,
    bookmakerCount,
    avgPrice: roundScore(avgPrice),
    priceSpread: roundScore(priceSpread),
    marketEdgeScore,
    oddsConfidenceScore,
    oddsMovementScore,
    dataDepthScore,
    riskScore,
    primaryMarket,
    primarySelection: primaryRow?.selection ?? null,
    primaryLine: primaryRow?.line ?? null,
    latestLine: primaryRow?.line ?? null,
    openingLine: rows.find((row) => row.is_opening)?.line ?? null,
    latestOdds: primaryRow?.odd_text ?? (primaryRow?.price ? String(primaryRow.price) : null),
    openingOdds: rows.find((row) => row.is_opening)?.odd_text ?? null,
    movementSummary: `Stored odds coverage: ${rows.length} rows, ${marketFocuses.size} markets, ${bookmakerCount} bookmakers.`,
  }
}

function mostFrequentValue(values: Array<unknown>) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = String(value ?? '').trim()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function emptyRecomputeReadinessSummary() {
  return {
    total: 0,
    marketDataReady: 0,
    recalculatedWithMarketData: 0,
    insufficientMarketData: 0,
    defaultAnalysisRemaining: 0,
  }
}

function trackRecomputeReadiness(summary: ReturnType<typeof emptyRecomputeReadinessSummary>, match: any, oddsRows: Array<any>, payload: Record<string, unknown>) {
  summary.total += 1
  const marketReady = hasUsableMarketDataForRecompute(match, oddsRows)
  if (marketReady) summary.marketDataReady += 1
  if (payload.market_data_used) summary.recalculatedWithMarketData += 1
  else summary.insufficientMarketData += 1
  if (marketReady && analysisLooksDefaultStale(payload)) summary.defaultAnalysisRemaining += 1
}

function analysisLooksDefaultStale(analysis: any) {
  const confidence = Number(analysis?.confidence_score ?? analysis?.calibrated_confidence_score)
  const ranking = Number(analysis?.ranking_score)
  return Number.isFinite(confidence) &&
    Number.isFinite(ranking) &&
    Math.abs(confidence - 59.1) <= 0.2 &&
    Math.abs(ranking - 54.8) <= 0.2
}

async function storePredictionResult(row: any) {
  const analysis = getAnalysis(row)
  const result = evaluatePredictionResult(row, analysis)
  const learningAdjustment = getLearningAdjustment(analysis?.recommendation, result.is_success)
  const payload = {
    match_id: row.id,
    fixture_id: nullableNumber(row.api_sports_fixture_id),
    match_date: row.kickoff_at ? String(row.kickoff_at).slice(0, 10) : null,
    recommendation: analysis?.recommendation ?? 'NO BET',
    value_market: analysis?.value_market ?? null,
    value_side: analysis?.value_side ?? analysis?.pick_side ?? null,
    value_line: analysis?.value_line ?? null,
    confidence_score: nullableNumber(analysis?.confidence_score),
    calibrated_confidence_score: nullableNumber(analysis?.calibrated_confidence_score),
    home_score: nullableNumber(row.home_goals),
    away_score: nullableNumber(row.away_goals),
    result_status: result.result_status,
    prediction_result: result.prediction_result,
    is_success: result.is_success,
    profit_unit: result.profit_unit,
    model_version: 'v4',
    raw: { analysis, result },
    updated_at: new Date().toISOString(),
  }

  const upsertResult = await supabase
    .from('football_prediction_results')
    .upsert(payload, { onConflict: 'match_id,model_version' })

  if (upsertResult.error) throw upsertResult.error

  await updateMatchAnalysisByMatchId(row.id, {
    learning_adjustment_score: learningAdjustment,
    learning_summary: result.is_success === null
      ? 'Learning v4 waiting for a settled prediction result.'
      : `Learning v4 recorded ${result.prediction_result}; adjustment ${learningAdjustment}.`,
  })

  return { matchId: row.id }
}

function evaluatePredictionResult(row: any, analysis: any) {
  const homeGoals = nullableNumber(row.home_goals)
  const awayGoals = nullableNumber(row.away_goals)
  if (homeGoals === null || awayGoals === null) {
    return { result_status: 'pending', prediction_result: 'PENDING', is_success: null, profit_unit: 0 }
  }

  const recommendation = String(analysis?.recommendation ?? 'NO BET').toUpperCase()
  if (!['BET', 'LEAN'].includes(recommendation)) {
    return { result_status: 'finished', prediction_result: 'NO_EVALUATION', is_success: null, profit_unit: 0 }
  }

  const market = String(analysis?.value_market ?? analysis?.market_type ?? 'ML').toUpperCase()
  const side = String(analysis?.value_side ?? analysis?.pick_side ?? '').toUpperCase()
  const line = parseLineNumber(analysis?.value_line ?? analysis?.market_line)
  let success: boolean | null = null

  if (market === 'OU') {
    if (line === null) success = null
    else if (side.includes('UNDER')) success = homeGoals + awayGoals < line
    else success = homeGoals + awayGoals > line
  } else if (market === 'AH') {
    if (line === null) success = null
    else if (side.includes('AWAY')) success = awayGoals + line > homeGoals
    else success = homeGoals + line > awayGoals
  } else if (side.includes('DRAW')) {
    success = homeGoals === awayGoals
  } else if (side.includes('AWAY')) {
    success = awayGoals > homeGoals
  } else if (side.includes('HOME') || side === '1') {
    success = homeGoals > awayGoals
  }

  if (success === null) return { result_status: 'finished', prediction_result: 'UNKNOWN', is_success: null, profit_unit: 0 }
  return { result_status: 'finished', prediction_result: success ? 'WIN' : 'LOSS', is_success: success, profit_unit: success ? 1 : -1 }
}

function getLearningAdjustment(recommendation: unknown, success: boolean | null) {
  if (success === null) return 0
  const rec = String(recommendation ?? '').toUpperCase()
  const base = rec === 'BET' ? 3 : rec === 'LEAN' ? 1 : 0
  return clamp(success ? base : -base, -8, 8)
}

function calculateV4DataDepth({ odds, stats, injuries, lineups }: any) {
  return normalizeScore(
    25 +
      (odds?.available ? 25 : 0) +
      (stats?.available ? 20 : 0) +
      (injuries?.available ? 15 : 0) +
      (lineups?.available ? 15 : 0),
  )
}

function buildV4Summary({ odds, stats, injuries, lineups, calibratedConfidenceScore, dataDepthScore }: any) {
  const pieces = [
    odds?.available ? 'odds ready' : 'odds pending',
    stats?.available ? 'stats ready' : 'stats pending',
    injuries?.available ? 'injuries checked' : 'injuries pending',
    lineups?.available ? 'lineups ready' : 'lineups pending',
  ]
  return `Data Intelligence v4 ${calibratedConfidenceScore}/100 (${pieces.join(', ')}; depth ${dataDepthScore}/100).`
}

function getAnalysis(match: any) {
  const analysis = Array.isArray(match?.analysis) ? match.analysis[0] : match?.analysis
  return analysis ?? match?.match_analysis ?? {}
}

function normalizeMarketName(value: unknown) {
  const text = String(value ?? '').toLowerCase()
  if (!text) return null
  if (text.includes('asian')) return 'AH'
  if (text.includes('goals') || text.includes('over') || text.includes('under')) return 'OU'
  if (text.includes('match winner') || text.includes('1x2') || text.includes('winner')) return 'ML'
  return null
}

function parseBetLine(value: unknown) {
  const text = String(value ?? '')
  if (/over|under/i.test(text)) return firstText(text.match(/-?\d+(?:\.\d+)?/)?.[0])
  return firstText(text.match(/-?\d+(?:\.\d+)?/)?.[0])
}

function statNumber(value: unknown) {
  if (value === null || value === undefined) return null
  const numeric = Number(String(value).replace('%', '').replace(',', '.'))
  return Number.isFinite(numeric) ? numeric : null
}

async function syncMatch(match: any, options: { enrichFixtureData?: boolean } = {}) {
  const league = await upsertLeague(match.competition, match.area)
  const homeTeam = await upsertTeam(match.homeTeam, match.area?.name)
  const awayTeam = await upsertTeam(match.awayTeam, match.area?.name)

  const matchResult = await supabase
    .from('football_matches')
    .upsert(
      {
        api_fixture_id: match.id,
        league_id: league.id,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff_at: match.utcDate,
        status: match.status,
        venue: null,
        round: formatRound(match),
        home_goals: match.score?.fullTime?.home ?? null,
        away_goals: match.score?.fullTime?.away ?? null,
        raw: match,
        api_provider: match.provider ?? match.raw?.provider ?? null,
        api_sports_fixture_id: match.raw_fixture_id ?? match.raw?.apiFootball?.fixture?.id ?? null,
        api_sports_league_id: match.raw?.apiFootball?.league?.id ?? null,
        api_sports_home_team_id: match.raw?.apiFootball?.teams?.home?.id ?? null,
        api_sports_away_team_id: match.raw?.apiFootball?.teams?.away?.id ?? null,
        enrichment_status: match.provider === 'api-football' ? 'PENDING' : null,
      },
      { onConflict: 'api_fixture_id' },
    )
    .select('id')
    .single()

  if (matchResult.error) throw matchResult.error

  const [standings, homeLast, awayLast] = options.enrichFixtureData === false
    ? [[], [], []]
    : await Promise.all([
      fetchStandings(match.competition?.id),
      fetchTeamLastMatches(match.homeTeam?.id, 5),
      fetchTeamLastMatches(match.awayTeam?.id, 5),
    ])

  const homeForm = summarizeRecentForm(homeLast, match.homeTeam?.id)
  const awayForm = summarizeRecentForm(awayLast, match.awayTeam?.id)

  await Promise.all([
    upsertRecentForm(homeTeam.id, homeForm, homeLast),
    upsertRecentForm(awayTeam.id, awayForm, awayLast),
  ])

  const analysis = analyzeMatch({
    match,
    homeForm,
    awayForm,
    standings,
    leaguePriority: league.priority,
    recentMatches: { home: homeLast, away: awayLast },
    recentOpponents: { home: homeLast, away: awayLast },
  })

  await upsertMatchAnalysis(matchResult.data.id, analysis)
  await recordAiPerformance(matchResult.data.id, {
    match,
    league,
    homeTeam,
    awayTeam,
    analysis,
  })

  const syncPriority = getFixtureSyncPriority(match)
  return {
    matchId: matchResult.data.id,
    processedMatch: {
      fixtureId: match.raw_fixture_id ?? match.id ?? null,
      leagueId: syncPriority.leagueId,
      league: match.competition?.name ?? null,
      country: syncPriority.country,
      homeTeam: match.homeTeam?.name ?? null,
      awayTeam: match.awayTeam?.name ?? null,
      kickoffAt: match.utcDate ?? null,
      leagueQualityScore: syncPriority.leagueQualityScore,
      syncPriorityScore: syncPriority.syncPriorityScore,
      scoringVersion: syncPriority.scoringVersion,
    },
  }
}

async function footballDataApiGet(path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(`${FOOTBALL_DATA_BASE_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const response = await fetch(url, {
    headers: {
      'X-Auth-Token': FOOTBALL_DATA_TOKEN ?? '',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  })

  const { data, text } = await parseUpstreamJsonResponse(response, { provider: 'football-data.org', errorStage: `football-data.org:${path}` })
  console.log('api-football response', {
    path,
    params,
    status: response.status,
    errors: sanitizeDiagnosticValue(data?.errors ?? null),
    results: data?.results ?? null,
    paging: data?.paging ?? null,
  })

  if (!response.ok) {
    const message = data?.message ?? data?.error ?? text ?? `football-data.org ${response.status}`
    throw new Error(`football-data.org ${response.status}: ${sanitizeText(message)}`)
  }

  return data
}

async function fetchFootballDataFixturesByRange(dateFrom: string, dateTo: string) {
  const data = await footballDataApiGet('/matches', { dateFrom, dateTo })
  return data.matches ?? []
}

async function fetchFootballDataCompetitions() {
  const data = await footballDataApiGet('/competitions')
  return data.competitions ?? []
}

async function apiFootballGet(path: string, params: Record<string, string | number | undefined> = {}, context?: FootballEnrichmentContext) {
  const url = new URL(`${API_FOOTBALL_BASE_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const response = await fetch(url, {
    headers: {
      'x-apisports-key': API_FOOTBALL_KEY ?? '',
      Accept: 'application/json',
    },
    signal: getProviderFetchSignal(context),
  })

  const { data, text } = await parseUpstreamJsonResponse(response, { provider: 'api-football', errorStage: `api-football:${path}` })

  if (!response.ok) {
    const message = data?.message ?? data?.error ?? text ?? `api-football ${response.status}`
    throw new Error(`api-football ${response.status}: ${sanitizeText(message)}`)
  }

  const apiErrors = data?.errors
  const hasApiErrors = Array.isArray(apiErrors) ? apiErrors.length > 0 : apiErrors && typeof apiErrors === 'object' ? Object.keys(apiErrors).length > 0 : Boolean(apiErrors)
  if (hasApiErrors) throw new Error(`api-football error: ${sanitizeText(JSON.stringify(apiErrors))}`)

  return data
}

async function fetchApiFootballFixtures(dateKey: string) {
  return (await fetchApiFootballFixturesWithPaging(dateKey)).matches
}

async function fetchApiFootballFixturesWithPaging(dateKey: string, context?: FootballEnrichmentContext) {
  const payload = await apiFootballGet('/fixtures', buildApiFootballDailyFixturesParams(dateKey), context)
  return buildSinglePageFixtureDiscovery(payload, normalizeApiFootballFixture)
}

function getProviderFetchSignal(context?: FootballEnrichmentContext) {
  const remainingMs = context ? getRemainingExecutionMs(context.executionBudget) - context.executionBudget.reserveMs : 12_000
  return AbortSignal.timeout(Math.max(1, Math.min(12_000, remainingMs)))
}

async function guardedSupabaseFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const timeoutSignal = init.signal ?? AbortSignal.timeout(10_000)
  let response: Response
  try {
    response = await fetch(input, { ...init, signal: timeoutSignal })
  } catch (cause) {
    const causeName = cause instanceof Error ? cause.name : ''
    throw new UpstreamResponseError({
      errorCode: /abort|timeout/i.test(causeName) ? 'SUPABASE_UPSTREAM_TIMEOUT' : 'SUPABASE_UPSTREAM_ERROR',
      errorStage: 'supabase-request',
      provider: 'supabase',
      cause,
    })
  }

  const contentType = response.headers.get('content-type') || ''
  if ([408, 504, 522, 524].includes(response.status) || contentType.toLowerCase().includes('text/html')) {
    const parsed = await parseUpstreamJsonResponse(response.clone(), { provider: 'supabase', errorStage: 'supabase-request' })
    throw new UpstreamResponseError({
      errorCode: 'SUPABASE_UPSTREAM_TIMEOUT',
      errorStage: 'supabase-request',
      provider: 'supabase',
      status: response.status,
      contentType,
      bodyPreview: parsed.text,
    })
  }
  return response
}

function normalizeApiFootballFixture(row: any) {
  const fixture = row?.fixture ?? {}
  const league = row?.league ?? {}
  const teams = row?.teams ?? {}
  const goals = row?.goals ?? {}
  const score = row?.score ?? {}
  const homeGoals = nullableNumber(score?.fulltime?.home ?? goals?.home)
  const awayGoals = nullableNumber(score?.fulltime?.away ?? goals?.away)

  return {
    id: namespaceApiFootballId(fixture.id),
    provider: 'api-football',
    utcDate: fixture.date ?? null,
    status: normalizeApiFootballStatus(fixture.status?.short ?? fixture.status?.long),
    stage: league.round ?? null,
    group: null,
    matchday: null,
    area: {
      id: null,
      name: league.country ?? null,
    },
    competition: {
      id: namespaceApiFootballId(league.id),
      name: league.name ?? 'Unknown Competition',
      code: league.id ? String(league.id) : null,
      emblem: league.logo ?? null,
      country: league.country ?? null,
      area: { name: league.country ?? null },
    },
    homeTeam: {
      id: namespaceApiFootballId(teams.home?.id),
      name: teams.home?.name ?? 'Unknown Home Team',
      shortName: teams.home?.name ?? 'Unknown Home Team',
      crest: teams.home?.logo ?? null,
    },
    awayTeam: {
      id: namespaceApiFootballId(teams.away?.id),
      name: teams.away?.name ?? 'Unknown Away Team',
      shortName: teams.away?.name ?? 'Unknown Away Team',
      crest: teams.away?.logo ?? null,
    },
    score: {
      fullTime: {
        home: homeGoals,
        away: awayGoals,
      },
    },
    raw_provider: 'api-football',
    raw_fixture_id: fixture.id ?? null,
    raw: {
      provider: 'api-football',
      apiFootball: row,
    },
  }
}

function namespaceApiFootballId(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return -Math.trunc(numeric)
}

function normalizeApiFootballStatus(value: unknown) {
  const status = String(value ?? '').toUpperCase()
  if (['FT', 'AET', 'PEN'].includes(status)) return 'FINISHED'
  if (['NS', 'TBD'].includes(status)) return 'SCHEDULED'
  if (status === 'PST') return 'POSTPONED'
  if (status === 'CANC') return 'CANCELLED'
  if (status === 'ABD') return 'ABANDONED'
  return status || 'SCHEDULED'
}

async function fetchStandings(competitionId: number) {
  if (!competitionId) return []

  try {
    const data = await footballDataApiGet(`/competitions/${competitionId}/standings`)
    return data.standings ?? []
  } catch (error) {
    console.warn('standings-unavailable', { competitionId, errorMessage: sanitizeText(error instanceof Error ? error.message : error) })
    return []
  }
}

async function fetchTeamLastMatches(teamId: number, limit: number) {
  if (!teamId) return []

  try {
    const data = await footballDataApiGet(`/teams/${teamId}/matches`, { limit, status: 'FINISHED' })
    return data.matches ?? []
  } catch (error) {
    console.warn('last-matches-unavailable', { teamId, errorMessage: sanitizeText(error instanceof Error ? error.message : error) })
    return []
  }
}

async function upsertCompetitions(competitions: Array<any>) {
  for (const competition of competitions) {
    await upsertLeague(competition, competition.area)
  }
}

async function upsertLeague(competition: any, area?: any) {
  const name = String(competition?.name ?? 'Unknown Competition')
  const result = await supabase
    .from('football_leagues')
    .upsert(
      {
        api_league_id: competition?.id,
        name,
        country: area?.name ?? competition?.area?.name ?? null,
        logo: competition?.emblem ?? null,
        enabled: true,
        priority: priorityLeagues.get(name) ?? priorityLeagues.get(competition?.code) ?? 50,
      },
      { onConflict: 'api_league_id' },
    )
    .select('id, priority')
    .single()

  if (result.error) throw result.error
  return result.data
}

async function upsertTeam(team: any, country?: string | null) {
  const result = await supabase
    .from('football_teams')
    .upsert(
      {
        api_team_id: team?.id,
        name: team?.name ?? team?.shortName ?? 'Unknown Team',
        logo: team?.crest ?? null,
        country: country ?? null,
      },
      { onConflict: 'api_team_id' },
    )
    .select('id')
    .single()

  if (result.error) throw result.error
  return result.data
}

async function upsertRecentForm(teamId: string, form: Record<string, number>, raw: unknown) {
  const result = await supabase.from('team_recent_form').upsert(
    {
      team_id: teamId,
      form_window: 5,
      wins: form.wins,
      draws: form.draws,
      losses: form.losses,
      goals_for: form.goals_for,
      goals_against: form.goals_against,
      clean_sheets: form.clean_sheets,
      failed_to_score: form.failed_to_score,
      raw,
    },
    { onConflict: 'team_id,form_window' },
  )

  if (result.error) throw result.error
}

async function upsertMatchAnalysis(matchId: string, analysis: any) {
  const safeAnalysis = normalizeAnalysisPayload(analysis)
  const nextPayload = {
    match_id: matchId,
    team_strength_score: safeAnalysis.team_strength_score,
    form_score: safeAnalysis.form_score,
    home_advantage_score: safeAnalysis.home_advantage_score,
    away_weakness_score: safeAnalysis.away_weakness_score,
    goal_scoring_score: safeAnalysis.goal_scoring_score,
    defensive_stability_score: safeAnalysis.defensive_stability_score,
    motivation_score: safeAnalysis.motivation_score,
    market_risk_score: safeAnalysis.market_risk_score,
    confidence_score: safeAnalysis.confidence_score,
    recommendation: safeAnalysis.recommendation,
    risk_level: safeAnalysis.risk_level,
    pick_side: safeAnalysis.pick_side,
    pick_team: safeAnalysis.pick_team,
    pick_team_id: safeAnalysis.pick_team_id,
    pick_source: safeAnalysis.pick_source,
    pick_market: safeAnalysis.pick_market,
    pick_market_id: safeAnalysis.pick_market_id,
    pick_selection: safeAnalysis.pick_selection,
    pick_price: safeAnalysis.pick_price,
    pick_confidence: safeAnalysis.pick_confidence,
    pick_reason: safeAnalysis.pick_reason,
    market_type: safeAnalysis.market_type,
    market_line: safeAnalysis.market_line,
    fair_line: safeAnalysis.fair_line,
    model_probability: safeAnalysis.model_probability,
    value_status: safeAnalysis.value_status,
    value_reason: safeAnalysis.value_reason,
    data_validation_status: safeAnalysis.data_validation_status,
    data_validation_notes: safeAnalysis.data_validation_notes,
    league_quality_score: safeAnalysis.league_quality_score,
    match_quality_score: safeAnalysis.match_quality_score,
    tactical_matchup_score: safeAnalysis.tactical_matchup_score,
    market_reading_score: safeAnalysis.market_reading_score,
    home_away_score: safeAnalysis.home_away_score,
    risk_score: safeAnalysis.risk_score,
    edge_score: safeAnalysis.edge_score,
    ai_score: safeAnalysis.ai_score,
    ranking_score: safeAnalysis.ranking_score,
    final_rank: safeAnalysis.final_rank,
    recommendation_tier: safeAnalysis.recommendation_tier,
    final_pick_note: safeAnalysis.final_pick_note,
    is_top_pick: safeAnalysis.is_top_pick,
    is_final_pick: safeAnalysis.is_final_pick,
    market_edge_score: safeAnalysis.market_edge_score,
    odds_confidence_score: safeAnalysis.odds_confidence_score,
    odds_movement_score: safeAnalysis.odds_movement_score,
    team_stats_score: safeAnalysis.team_stats_score,
    injuries_score: safeAnalysis.injuries_score,
    lineups_score: safeAnalysis.lineups_score,
    data_depth_score: safeAnalysis.data_depth_score,
    learning_adjustment_score: safeAnalysis.learning_adjustment_score,
    calibrated_confidence_score: safeAnalysis.calibrated_confidence_score,
    historical_accuracy_score: safeAnalysis.historical_accuracy_score,
    model_version: safeAnalysis.model_version,
    value_side: safeAnalysis.value_side,
    value_market: safeAnalysis.value_market,
    value_line: safeAnalysis.value_line,
    opening_line: safeAnalysis.opening_line,
    latest_line: safeAnalysis.latest_line,
    opening_odds: safeAnalysis.opening_odds,
    latest_odds: safeAnalysis.latest_odds,
    odds_movement_summary: safeAnalysis.odds_movement_summary,
    enriched_summary: safeAnalysis.enriched_summary,
    learning_summary: safeAnalysis.learning_summary,
    professional_score: safeAnalysis.professional_score,
    data_quality_score: safeAnalysis.data_quality_score,
    market_quality_score: safeAnalysis.market_quality_score,
    statistical_edge_score: safeAnalysis.statistical_edge_score,
    tactical_edge_score: safeAnalysis.tactical_edge_score,
    risk_control_score: safeAnalysis.risk_control_score,
    value_edge_score: safeAnalysis.value_edge_score,
    pipeline_stage: safeAnalysis.pipeline_stage,
    pipeline_reasons: safeAnalysis.pipeline_reasons,
    pipeline_warnings: safeAnalysis.pipeline_warnings,
    analysis_summary: safeAnalysis.analysis_summary,
    thai_reason: safeAnalysis.thai_reason,
    raw: safeAnalysis,
  }

  const nextResult = await supabase.from('match_analysis').upsert(nextPayload, { onConflict: 'match_id' })
  if (!nextResult.error) return
  if (isMissingColumnError(nextResult.error)) {
    const compatibleResult = await supabase.from('match_analysis').upsert(stripApiFootballPickPayload(nextPayload), { onConflict: 'match_id' })
    if (!compatibleResult.error) return
  }

  const legacyResult = await supabase.from('match_analysis').upsert(
    {
      match_id: matchId,
      team_strength_score: safeAnalysis.team_strength_score,
      form_score: safeAnalysis.form_score,
      goal_quality_score: safeAnalysis.goal_scoring_score,
      home_away_score: safeAnalysis.home_advantage_score,
      motivation_score: safeAnalysis.motivation_score,
      market_context_score: safeAnalysis.market_risk_score,
      risk_score: safeAnalysis.market_risk_score,
      confidence_score: safeAnalysis.confidence_score,
      recommendation: safeAnalysis.recommendation,
      risk_level: safeAnalysis.risk_level,
      thai_reason: safeAnalysis.thai_reason,
      raw: safeAnalysis,
    },
    { onConflict: 'match_id' },
  )

  if (legacyResult.error) throw nextResult.error
}

function normalizeAnalysisPayload(analysis: any) {
  let confidence = normalizeScore(analysis?.confidence_score ?? analysis?.final_confidence_score ?? 0)
  let riskLevel = normalizeRiskLevel(analysis?.risk_level)
  let recommendation = getRecommendationFromConfidence(confidence, riskLevel)
  const selectionV2 = buildSelectionV2Analysis(analysis?.raw_match ?? analysis?.raw ?? analysis ?? {}, {
    ...(analysis ?? {}),
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
  })
  confidence = normalizeScore(selectionV2.confidence_score)
  recommendation = selectionV2.recommendation
  riskLevel = getRiskLevelFromRiskScore(selectionV2.risk_score)
  const summary = String(
    selectionV2.analysis_summary ||
      analysis?.analysis_summary ||
      analysis?.thai_reason ||
      `แนะนำ ${recommendation} เพราะความมั่นใจ ${confidence}/100 และความเสี่ยงระดับ${riskLevel}. ข้อมูลบางส่วนยังจำกัด ควรตรวจราคาก่อนตัดสินใจ`,
  ).trim()
  const pick = derivePickSideFromAnalysis(analysis ?? {}, {
    home_advantage_score: analysis?.home_advantage_score ?? analysis?.modules?.homeAwayAdvantage,
    away_weakness_score: analysis?.away_weakness_score ?? analysis?.modules?.awayWeakness,
    goal_scoring_score: analysis?.goal_scoring_score ?? analysis?.modules?.attackQuality,
    defensive_stability_score: analysis?.defensive_stability_score ?? analysis?.modules?.defensiveStability,
    market_risk_score: analysis?.market_risk_score ?? analysis?.modules?.marketOddsRisk,
    recommendation,
    risk_level: riskLevel,
    confidence_score: confidence,
  })
  const finalPick = normalizeFinalPickFields(analysis ?? {}, {
    recommendation,
    risk_level: riskLevel,
    confidence_score: confidence,
    pick_side: pick.pick_side,
  })
  const professional = buildProfessionalSelectionScoreEdge(analysis?.raw_match ?? analysis?.raw ?? analysis ?? {}, {
    ...(analysis ?? {}),
    ...selectionV2,
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
  })

  return {
    ...(analysis ?? {}),
    team_strength_score: normalizeScore(analysis?.team_strength_score ?? analysis?.modules?.teamStrength ?? 56),
    form_score: normalizeScore(analysis?.form_score ?? analysis?.modules?.recentForm ?? 56),
    home_advantage_score: normalizeScore(analysis?.home_advantage_score ?? analysis?.modules?.homeAwayAdvantage ?? 56),
    away_weakness_score: normalizeScore(analysis?.away_weakness_score ?? analysis?.modules?.awayWeakness ?? 55),
    goal_scoring_score: normalizeScore(analysis?.goal_scoring_score ?? analysis?.modules?.attackQuality ?? 56),
    defensive_stability_score: normalizeScore(analysis?.defensive_stability_score ?? analysis?.modules?.defensiveStability ?? 56),
    motivation_score: normalizeScore(analysis?.motivation_score ?? analysis?.modules?.motivationContext ?? 56),
    market_risk_score: normalizeScore(analysis?.market_risk_score ?? analysis?.modules?.marketOddsRisk ?? 52),
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
    pick_side: pick.pick_side,
    pick_team: null,
    pick_team_id: null,
    pick_source: 'NONE',
    pick_market: null,
    pick_market_id: null,
    pick_selection: null,
    pick_price: null,
    pick_confidence: null,
    pick_reason: pick.pick_reason,
    market_type: finalPick.market_type,
    market_line: finalPick.market_line,
    fair_line: finalPick.fair_line,
    model_probability: finalPick.model_probability,
    value_status: finalPick.value_status,
    value_reason: finalPick.value_reason,
    ...selectionV2,
    market_edge_score: analysis?.market_edge_score ?? null,
    odds_confidence_score: analysis?.odds_confidence_score ?? null,
    odds_movement_score: analysis?.odds_movement_score ?? null,
    team_stats_score: analysis?.team_stats_score ?? null,
    injuries_score: analysis?.injuries_score ?? null,
    lineups_score: analysis?.lineups_score ?? null,
    data_depth_score: analysis?.data_depth_score ?? null,
    learning_adjustment_score: analysis?.learning_adjustment_score ?? 0,
    calibrated_confidence_score: analysis?.calibrated_confidence_score ?? null,
    historical_accuracy_score: analysis?.historical_accuracy_score ?? null,
    model_version: analysis?.model_version ?? 'v4',
    value_side: analysis?.value_side ?? null,
    value_market: analysis?.value_market ?? null,
    value_line: analysis?.value_line ?? null,
    opening_line: analysis?.opening_line ?? null,
    latest_line: analysis?.latest_line ?? null,
    opening_odds: analysis?.opening_odds ?? null,
    latest_odds: analysis?.latest_odds ?? null,
    odds_movement_summary: analysis?.odds_movement_summary ?? null,
    enriched_summary: analysis?.enriched_summary ?? null,
    learning_summary: analysis?.learning_summary ?? null,
    professional_score: professional.totalScore,
    data_quality_score: professional.scores.dataQuality,
    market_quality_score: professional.scores.marketQuality,
    statistical_edge_score: professional.scores.statisticalEdge,
    tactical_edge_score: professional.scores.tacticalEdge,
    risk_control_score: professional.scores.riskControl,
    value_edge_score: professional.scores.valueEdge,
    pipeline_stage: professional.pipelineStage,
    pipeline_reasons: professional.reasons,
    pipeline_warnings: professional.warnings,
    professional_pipeline: professional,
    leagueQualitySource: leagueQualityScoringVersion,
    analysis_summary: summary,
    thai_reason: summary,
  }
}

function buildProfessionalSelectionScoreEdge(match: any = {}, analysis: any = {}) {
  const leagueQuality = normalizeScore(analysis.league_quality_score ?? getLeagueQualityScore(match))
  const dataQuality = normalizeScore(analysis.data_quality_score ?? analysis.match_quality_score ?? analysis.data_depth_score ?? calculateProfessionalDataQualityEdge(match, analysis))
  const marketQuality = normalizeScore(analysis.market_quality_score ?? calculateProfessionalMarketQualityEdge(match, analysis))
  const statisticalEdge = normalizeScore(analysis.statistical_edge_score ?? weightedAverage([
    [analysis.team_strength_score, 0.2],
    [analysis.form_score, 0.2],
    [analysis.goal_scoring_score, 0.2],
    [analysis.defensive_stability_score, 0.16],
    [analysis.home_advantage_score ?? analysis.home_away_score, 0.14],
    [analysis.away_weakness_score, 0.1],
  ], 58))
  const tacticalEdge = normalizeScore(analysis.tactical_edge_score ?? analysis.tactical_matchup_score ?? ((statisticalEdge * 0.65) + (Number(analysis.home_away_score ?? 55) * 0.35)))
  const motivation = normalizeScore(analysis.motivation_score ?? 55)
  const riskControl = normalizeScore(analysis.risk_control_score ?? calculateProfessionalRiskControlEdge(match, analysis, { leagueQuality, dataQuality, marketQuality }))
  const valueEdge = normalizeScore(analysis.value_edge_score ?? calculateProfessionalValueEdgeEdge(analysis, marketQuality, riskControl))
  const aiConfidence = normalizeScore(calculateProfessionalAiConfidenceEdge({ dataQuality, marketQuality, statisticalEdge, tacticalEdge, motivation, riskControl, valueEdge }))
  const scores = {
    leagueQuality,
    dataQuality,
    marketQuality,
    statisticalEdge,
    tacticalEdge,
    motivation,
    riskControl,
    valueEdge,
    aiConfidence,
  }
  const totalScore = normalizeScore(
    (leagueQuality * 12 +
      dataQuality * 12 +
      marketQuality * 12 +
      statisticalEdge * 16 +
      tacticalEdge * 10 +
      motivation * 10 +
      riskControl * 10 +
      valueEdge * 18 +
      aiConfidence * 10) / 110,
  )
  const gates = {
    passedLeagueFilter: leagueQuality >= 55,
    passedDataQuality: dataQuality >= 50,
    passedMarketQuality: marketQuality >= 45,
    passedRiskFilter: riskControl >= 45,
    passedValueFilter: valueEdge >= 45,
    passedConfidenceFilter: aiConfidence >= 55,
  }
  const hardGatePassed = gates.passedLeagueFilter && gates.passedDataQuality && gates.passedMarketQuality && gates.passedRiskFilter && gates.passedValueFilter && gates.passedConfidenceFilter
  const recommendation = hardGatePassed && totalScore >= 82 && aiConfidence >= 80 && valueEdge >= 70 && riskControl >= 60
    ? 'BET'
    : gates.passedLeagueFilter && gates.passedDataQuality && gates.passedMarketQuality && gates.passedRiskFilter && totalScore >= 70 && aiConfidence >= 68
      ? 'LEAN'
      : 'NO BET'
  const reasons = [
    `Professional score ${Math.round(totalScore)}/100 จาก league/data/market/stat/value pipeline`,
    leagueQuality >= 55 ? 'ลีกผ่านเกณฑ์คุณภาพขั้นต่ำ' : 'ลีกต่ำกว่าเกณฑ์คุณภาพ',
    valueEdge >= 70 ? 'พบ value edge ชัดเจนจากราคา/โมเดล' : 'value edge ยังไม่ชัดพอ',
  ]
  const warnings = [
    ...(!gates.passedMarketQuality ? ['ข้อมูลตลาดยังไม่แข็งแรงพอสำหรับ BET'] : []),
    ...(!gates.passedDataQuality ? ['ข้อมูลบางส่วนไม่ครบ ระบบลดความมั่นใจ'] : []),
    ...(riskControl < 60 ? ['risk control ยังไม่ถึงระดับเสี่ยงต่ำ'] : []),
  ]
  return {
    totalScore,
    recommendation,
    confidenceScore: aiConfidence,
    pipelineStage: getProfessionalPipelineStageEdge(gates, recommendation, {
      dataQuality,
      hasOdds: Boolean(analysis.market_data_used || analysis.odds_rows_used || analysis.latest_odds || analysis.value_market),
    }),
    scores,
    gates,
    reasons,
    warnings,
    finalPick: {
      type: recommendation,
      side: analysis.value_side ?? analysis.pick_side ?? 'NONE',
      market: analysis.value_market ?? analysis.market_type ?? null,
      line: analysis.value_line ?? analysis.market_line ?? null,
      label: recommendation === 'BET' ? 'AI BET' : recommendation === 'LEAN' ? 'รอดูราคา' : 'ผ่านการวิเคราะห์แล้ว แต่ไม่คุ้มเสี่ยง',
      reason: recommendation === 'BET' ? 'Value, confidence และ risk ผ่านเกณฑ์' : 'ยังไม่ผ่านครบทุก gate สำคัญ',
    },
  }
}

function calculateProfessionalDataQualityEdge(match: any, analysis: any) {
  const raw = analysis.raw ?? match.raw ?? {}
  const checks = [
    Boolean(match.id || match.api_fixture_id),
    Boolean(match.homeTeam?.name || match.home_team?.name),
    Boolean(match.awayTeam?.name || match.away_team?.name),
    Boolean(match.league?.name || match.competition?.name),
    Boolean(analysis.form_score || raw.homeForm || raw.awayForm),
    Boolean(raw.standings || raw.homeStanding || raw.awayStanding),
    Boolean(raw.h2h || raw.h2hMatches),
    Boolean(analysis.market_data_used || raw.odds || raw.market || raw.bookmakers),
  ]
  return normalizeScore((checks.filter(Boolean).length / checks.length) * 100)
}

function calculateProfessionalMarketQualityEdge(match: any, analysis: any) {
  const raw = analysis.raw ?? match.raw ?? {}
  const hasOdds = Boolean(analysis.market_data_used || analysis.odds_rows_used || raw.odds || raw.market || raw.bookmakers)
  if (!hasOdds) return 30
  const marketEdge = Number(analysis.market_edge_score ?? 0)
  const oddsConfidence = Number(analysis.odds_confidence_score ?? 50)
  const movement = Number(analysis.odds_movement_score ?? 50)
  return normalizeScore(42 + Math.min(24, marketEdge * 0.24) + oddsConfidence * 0.24 + movement * 0.1)
}

function calculateProfessionalRiskControlEdge(match: any, analysis: any, scores: { leagueQuality: number; dataQuality: number; marketQuality: number }) {
  const leagueText = [
    match.league?.name,
    match.competition?.name,
    match.league?.country,
    match.competition?.country,
  ].filter(Boolean).join(' ').toLowerCase()
  let score = 100
  if (/friendly|test|youth|u17|u18|u19|u20|u21|u23|reserve|amateur/.test(leagueText)) score -= 24
  if (scores.leagueQuality < 55) score -= 16
  if (scores.dataQuality < 50) score -= 16
  if (scores.marketQuality < 45) score -= 15
  if (String(analysis.risk_level ?? '').toUpperCase() === 'HIGH') score -= 22
  if (Number(analysis.risk_score ?? 0) > 65) score -= 12
  return normalizeScore(score)
}

function calculateProfessionalValueEdgeEdge(analysis: any, marketQuality: number, riskControl: number) {
  const marketEdge = Number(analysis.market_edge_score ?? analysis.edge_score ?? 0)
  const hasOdds = Boolean(analysis.market_data_used || analysis.odds_rows_used || analysis.latest_odds || analysis.value_market)
  let score = hasOdds ? 48 + marketEdge * 0.42 : 45
  if (!hasOdds) score = Math.min(score, 55)
  if (marketQuality >= 70) score += 5
  if (riskControl < 55) score -= 8
  if (String(analysis.value_status ?? '').toUpperCase() === 'YES') score += 10
  return normalizeScore(score)
}

function calculateProfessionalAiConfidenceEdge(scores: Record<string, number>) {
  const values = Object.values(scores).map(Number).filter((value) => Number.isFinite(value))
  const average = values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1)
  const spread = Math.max(...values) - Math.min(...values)
  return normalizeScore(average - Math.max(0, spread - 24) * 0.35 + (values.length >= 7 ? 3 : 0))
}

function getProfessionalPipelineStageEdge(gates: Record<string, boolean>, recommendation: string, context: { dataQuality?: number; hasOdds?: boolean } = {}) {
  if (Number(context.dataQuality ?? 0) < 35) return 'NO_DATA'
  if (!context.hasOdds && recommendation !== 'BET') return 'WATCH'
  if (!gates.passedLeagueFilter) return 'league-filter'
  if (!gates.passedDataQuality) return 'data-quality-filter'
  if (!gates.passedMarketQuality) return 'market-quality-filter'
  if (!gates.passedRiskFilter) return 'risk-filter'
  if (!gates.passedValueFilter) return 'value-filter'
  if (!gates.passedConfidenceFilter) return 'confidence-filter'
  return recommendation === 'BET' ? 'bet-selected' : recommendation === 'LEAN' ? 'lean-selected' : 'no-bet'
}

function weightedAverage(items: Array<[unknown, number]>, fallback: number) {
  const valid = items.filter(([value]) => Number(value) > 0)
  if (!valid.length) return fallback
  const weight = valid.reduce((total, [, itemWeight]) => total + itemWeight, 0)
  return valid.reduce((total, [value, itemWeight]) => total + Number(value) * itemWeight, 0) / Math.max(weight, 1)
}

async function recordAiPerformance(matchId: string, payload: any) {
  const snapshot = buildPredictionSnapshot(matchId, payload)
  let snapshotRows = await findPerformanceSnapshots(matchId)
  const alreadyExists = snapshotRows.some((row: any) => row.analysis_version === snapshot.analysis_version)

  if (!alreadyExists) {
    const insertResult = await supabase
      .from('ai_prediction_snapshots')
      .insert(snapshot)
      .select('id, recommendation, predicted_outcome, analysis_version, raw')
      .single()

    if (insertResult.error) throw insertResult.error
    snapshotRows = [...snapshotRows, insertResult.data]
  }

  await updatePerformanceResults(matchId, snapshotRows, payload.match)
}

async function findPerformanceSnapshots(matchId: string) {
  const result = await supabase
    .from('ai_prediction_snapshots')
    .select('id, recommendation, predicted_outcome, analysis_version, raw')
    .eq('match_id', matchId)

  if (result.error) throw result.error
  return result.data ?? []
}

function buildPredictionSnapshot(matchId: string, { match, league, homeTeam, awayTeam, analysis }: any) {
  const analysisBreakdown = analysis.analysis_breakdown ?? {}
  const analysisVersion = analysis.framework ?? analysis.raw?.framework ?? 'unknown'

  return {
    match_id: matchId,
    fixture_id: String(match.id ?? ''),
    home_team: match.homeTeam?.name ?? homeTeam?.name ?? null,
    away_team: match.awayTeam?.name ?? awayTeam?.name ?? null,
    league: match.competition?.name ?? league?.name ?? null,
    kickoff: match.utcDate ?? null,
    recommendation: analysis.recommendation ?? 'NO BET',
    confidence_score: Number(analysis.confidence_score ?? 0),
    ranking_score: Number(analysis.ranking_score ?? analysis.confidence_score ?? 0),
    risk_level: normalizeRiskLevel(analysis.risk_level),
    analysis_version: analysisVersion,
    predicted_outcome: inferPerformancePredictedOutcome(analysisBreakdown),
    raw: {
      analysis_version: analysisVersion,
      analysis_breakdown: analysisBreakdown,
      confidence_score: analysis.confidence_score,
      recommendation: analysis.recommendation,
      risk_level: analysis.risk_level,
    },
  }
}

async function updatePerformanceResults(matchId: string, snapshots: Array<any>, match: any) {
  const resultTracking = getPerformanceResultTracking(match)

  for (const snapshot of snapshots) {
    const resultPayload = {
      snapshot_id: snapshot.id,
      match_id: matchId,
      status: resultTracking.status,
      home_goals: resultTracking.home_goals,
      away_goals: resultTracking.away_goals,
      result: resultTracking.result,
      finished_at: resultTracking.finished_at,
    }
    const result = await supabase.from('ai_prediction_results').upsert(resultPayload, { onConflict: 'snapshot_id' }).select('id').single()
    if (result.error) throw result.error

    const evaluation = evaluatePerformancePrediction(snapshot, resultTracking)
    const evaluationResult = await supabase.from('ai_prediction_evaluations').upsert(
      {
        snapshot_id: snapshot.id,
        match_id: matchId,
        evaluation_status: evaluation.evaluation_status,
        evaluation_reason: evaluation.evaluation_reason,
        evaluated_at: evaluation.evaluated_at,
        raw: {
          result: resultTracking,
          predicted_outcome: snapshot.predicted_outcome,
          analysis_version: snapshot.analysis_version,
        },
      },
      { onConflict: 'snapshot_id' },
    )
    if (evaluationResult.error) throw evaluationResult.error
  }
}

function getPerformanceResultTracking(match: any) {
  const homeGoals = nullableNumber(match.score?.fullTime?.home ?? match.home_goals)
  const awayGoals = nullableNumber(match.score?.fullTime?.away ?? match.away_goals)
  const finished = ['FINISHED', 'FT', 'AET', 'PEN'].includes(String(match.status ?? '').toUpperCase()) && homeGoals !== null && awayGoals !== null

  return {
    status: finished ? 'finished' : 'pending',
    home_goals: homeGoals,
    away_goals: awayGoals,
    result: finished ? getPerformanceResult(homeGoals, awayGoals) : null,
    finished_at: finished ? new Date().toISOString() : null,
  }
}

function evaluatePerformancePrediction(snapshot: any, resultTracking: any) {
  if (resultTracking.status !== 'finished' || !resultTracking.result) {
    return { evaluation_status: 'pending', evaluation_reason: 'Result is not finished yet', evaluated_at: null }
  }

  const recommendation = String(snapshot.recommendation ?? '').toUpperCase()
  if (!['BET', 'LEAN'].includes(recommendation)) {
    return { evaluation_status: 'no_evaluation', evaluation_reason: 'NO BET is tracked but not evaluated as a prediction', evaluated_at: new Date().toISOString() }
  }

  const predicted = snapshot.predicted_outcome ?? inferPerformancePredictedOutcome(snapshot.raw?.analysis_breakdown)
  if (!['home', 'draw', 'away'].includes(predicted)) {
    return { evaluation_status: 'no_evaluation', evaluation_reason: 'No explicit predicted outcome was available', evaluated_at: new Date().toISOString() }
  }

  return {
    evaluation_status: predicted === resultTracking.result ? 'correct' : 'incorrect',
    evaluation_reason: predicted === resultTracking.result ? 'Predicted outcome matched final result' : 'Predicted outcome did not match final result',
    evaluated_at: new Date().toISOString(),
  }
}

function inferPerformancePredictedOutcome(analysisBreakdown: any = {}) {
  const data = analysisBreakdown?.data_intelligence ?? {}
  const leagueEdge = data.league_position?.edge
  const venueEdge = data.home_away_form?.advantage
  const h2hScore = Number(data.head_to_head?.score ?? 0)
  const moduleHomeAdvantage = Number(analysisBreakdown?.home_away_advantage?.score ?? 0)

  if (leagueEdge === 'home' || venueEdge === 'home') return 'home'
  if (leagueEdge === 'away' || venueEdge === 'away') return 'away'
  if (h2hScore >= 64 || moduleHomeAdvantage >= 65) return 'home'
  if (h2hScore > 0 && h2hScore <= 50) return 'away'
  return 'unknown'
}

function getPerformanceResult(homeGoals: number, awayGoals: number) {
  if (homeGoals > awayGoals) return 'home'
  if (homeGoals < awayGoals) return 'away'
  return 'draw'
}

function nullableNumber(value: any) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

async function recomputeStoredAnalysisRows(limit: number) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      raw,
      league:football_leagues(id, api_league_id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(raw)
    `)
    .order('kickoff_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)))

  if (result.error) throw result.error

  let recomputed = 0

  for (const row of result.data ?? []) {
    const storedAnalysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
    const rawAnalysis = storedAnalysis?.raw ?? {}
    const rawMatch = row.raw ?? rawAnalysis.raw_match ?? {}
    const match = {
      ...rawMatch,
      id: rawMatch.id ?? row.raw?.id,
      utcDate: rawMatch.utcDate ?? row.raw?.utcDate,
      competition: {
        ...(rawMatch.competition ?? {}),
        id: rawMatch.competition?.id ?? row.league?.api_league_id,
        api_league_id: row.league?.api_league_id,
        name: rawMatch.competition?.name ?? row.league?.name,
        country: rawMatch.competition?.country ?? row.league?.country,
      },
      league: {
        ...(rawMatch.league ?? {}),
        id: rawMatch.league?.id ?? row.league?.api_league_id,
        api_league_id: row.league?.api_league_id,
        name: rawMatch.league?.name ?? row.league?.name,
        country: rawMatch.league?.country ?? row.league?.country,
      },
      homeTeam: rawMatch.homeTeam ?? { id: row.homeTeam?.api_team_id, name: row.homeTeam?.name },
      awayTeam: rawMatch.awayTeam ?? { id: row.awayTeam?.api_team_id, name: row.awayTeam?.name },
    }
    const homeForm = rawAnalysis.homeForm ?? { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 }
    const awayForm = rawAnalysis.awayForm ?? { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 }
    const standings = rawAnalysis.standings ?? []
    const analysis = analyzeMatch({
      match,
      homeForm,
      awayForm,
      standings,
      leaguePriority: Number(row.league?.priority ?? 50),
      recentMatches: rawAnalysis.recent_matches ?? null,
      recentOpponents: rawAnalysis.recent_matches ?? null,
    })

    await upsertMatchAnalysis(row.id, analysis)
    await recordAiPerformance(row.id, {
      match,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      analysis,
    })
    recomputed += 1
  }

  return recomputed
}

async function recomputeProcessedAnalysisRows(matchIds: Array<string>) {
  const failures: Array<{ matchId?: number; message: string }> = []
  const uniqueIds = [...new Set(matchIds.filter(Boolean))]
  if (!uniqueIds.length) return { updated: 0, failures }

  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      raw,
      league:football_leagues(id, api_league_id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(raw)
    `)
    .in('id', uniqueIds)

  if (result.error) throw result.error

  let updated = 0

  for (const row of result.data ?? []) {
    try {
      const storedAnalysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
      const rawAnalysis = storedAnalysis?.raw ?? {}
      const rawMatch = row.raw ?? rawAnalysis.raw_match ?? {}
      const match = {
        ...rawMatch,
        id: rawMatch.id ?? row.raw?.id,
        utcDate: rawMatch.utcDate ?? row.raw?.utcDate,
        competition: {
          ...(rawMatch.competition ?? {}),
          id: rawMatch.competition?.id ?? row.league?.api_league_id,
          api_league_id: row.league?.api_league_id,
          name: rawMatch.competition?.name ?? row.league?.name,
          country: rawMatch.competition?.country ?? row.league?.country,
        },
        league: {
          ...(rawMatch.league ?? {}),
          id: rawMatch.league?.id ?? row.league?.api_league_id,
          api_league_id: row.league?.api_league_id,
          name: rawMatch.league?.name ?? row.league?.name,
          country: rawMatch.league?.country ?? row.league?.country,
        },
        homeTeam: rawMatch.homeTeam ?? { id: row.homeTeam?.api_team_id, name: row.homeTeam?.name },
        awayTeam: rawMatch.awayTeam ?? { id: row.awayTeam?.api_team_id, name: row.awayTeam?.name },
      }
      const homeForm = rawAnalysis.homeForm ?? emptyForm()
      const awayForm = rawAnalysis.awayForm ?? emptyForm()
      const analysis = analyzeMatch({
        match,
        homeForm,
        awayForm,
        standings: rawAnalysis.standings ?? [],
        leaguePriority: Number(row.league?.priority ?? 50),
        recentMatches: rawAnalysis.recent_matches ?? null,
        recentOpponents: rawAnalysis.recent_matches ?? null,
      })

      await upsertMatchAnalysis(row.id, analysis)
      await recordAiPerformance(row.id, {
        match,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        analysis,
      })
      updated += 1
    } catch (error) {
      failures.push({
        matchId: Number(row.raw?.id ?? 0) || undefined,
        message: error instanceof Error ? error.message : 'analysis recompute failed',
      })
    }
  }

  return { updated, failures }
}

async function normalizeLegacyAnalysisRows() {
  const { rows, hasPickColumns, hasFinalPickColumns } = await fetchAnalysisRowsForNormalization()

  let fixed = 0

  for (const row of rows) {
    const confidence = Math.round(clamp(Number(row.confidence_score ?? row.raw?.confidence_score ?? 0), 0, 100))
    const riskLevel = normalizeRiskLevel(row.risk_level ?? row.raw?.risk_level)
    const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
    const analysisSummary = row.analysis_summary || row.raw?.analysis_summary || row.thai_reason || `แนะนำ ${recommendation} เพราะความมั่นใจ ${confidence}/100 และความเสี่ยงระดับ${riskLevel}. ข้อมูลบางส่วนยังจำกัด ควรตรวจราคาก่อนตัดสินใจ`
    const pick = derivePickSideFromAnalysis(row.raw?.raw_match ?? row.raw ?? {}, {
      home_advantage_score: row.home_advantage_score ?? row.raw?.home_advantage_score,
      away_weakness_score: row.away_weakness_score ?? row.raw?.away_weakness_score,
      goal_scoring_score: row.goal_scoring_score ?? row.raw?.goal_scoring_score,
      defensive_stability_score: row.defensive_stability_score ?? row.raw?.defensive_stability_score,
      market_risk_score: row.market_risk_score ?? row.raw?.market_risk_score,
      confidence_score: confidence,
      recommendation,
      risk_level: riskLevel,
    })
    const finalPick = normalizeFinalPickFields(row.raw?.raw_match ?? row.raw ?? {}, {
      ...row.raw,
      recommendation,
      risk_level: riskLevel,
      confidence_score: confidence,
      pick_side: pick.pick_side,
      market_type: row.market_type,
      market_line: row.market_line,
      fair_line: row.fair_line,
      model_probability: row.model_probability,
      value_status: row.value_status,
      value_reason: row.value_reason,
    })
    const basePayload = {
      team_strength_score: normalizeScore(row.team_strength_score ?? row.raw?.team_strength_score ?? row.raw?.modules?.teamStrength ?? 56),
      form_score: normalizeScore(row.form_score ?? row.raw?.form_score ?? row.raw?.modules?.recentForm ?? 56),
      home_advantage_score: normalizeScore(row.home_advantage_score ?? row.raw?.home_advantage_score ?? row.raw?.modules?.homeAwayAdvantage ?? 56),
      away_weakness_score: normalizeScore(row.away_weakness_score ?? row.raw?.away_weakness_score ?? row.raw?.modules?.awayWeakness ?? 55),
      goal_scoring_score: normalizeScore(row.goal_scoring_score ?? row.raw?.goal_scoring_score ?? row.raw?.modules?.attackQuality ?? 56),
      defensive_stability_score: normalizeScore(row.defensive_stability_score ?? row.raw?.defensive_stability_score ?? row.raw?.modules?.defensiveStability ?? 56),
      motivation_score: normalizeScore(row.motivation_score ?? row.raw?.motivation_score ?? row.raw?.modules?.motivationContext ?? 56),
      market_risk_score: normalizeScore(row.market_risk_score ?? row.raw?.market_risk_score ?? row.raw?.modules?.marketOddsRisk ?? 52),
      confidence_score: confidence,
      analysis_summary: analysisSummary,
      recommendation,
      risk_level: riskLevel,
    }
    const nextPayload = hasPickColumns
      ? {
          ...basePayload,
          pick_side: pick.pick_side,
          pick_team: pick.pick_team,
          pick_reason: pick.pick_reason,
          ...(hasFinalPickColumns
            ? {
                market_type: finalPick.market_type,
                market_line: finalPick.market_line,
                fair_line: finalPick.fair_line,
                model_probability: finalPick.model_probability,
                value_status: finalPick.value_status,
                value_reason: finalPick.value_reason,
              }
            : {}),
        }
      : basePayload

    const pickColumnsMatch = !hasPickColumns || (
      row.pick_side === pick.pick_side &&
      (row.pick_team ?? null) === (pick.pick_team ?? null) &&
      row.pick_reason === pick.pick_reason
    )
    const finalPickColumnsMatch = !hasFinalPickColumns || (
      (row.market_type ?? null) === (finalPick.market_type ?? null) &&
      (row.market_line ?? null) === (finalPick.market_line ?? null) &&
      (row.fair_line ?? null) === (finalPick.fair_line ?? null) &&
      Number(row.model_probability ?? 0) === Number(finalPick.model_probability ?? 0) &&
      row.value_status === finalPick.value_status &&
      row.value_reason === finalPick.value_reason
    )

    if (
      row.analysis_summary &&
      row.recommendation === recommendation &&
      row.risk_level === riskLevel &&
      pickColumnsMatch &&
      finalPickColumnsMatch &&
      ['team_strength_score', 'form_score', 'home_advantage_score', 'away_weakness_score', 'goal_scoring_score', 'defensive_stability_score', 'motivation_score', 'market_risk_score', 'confidence_score'].every((key) => row[key] !== null && row[key] !== undefined)
    ) {
      continue
    }

    const updateResult = await updateMatchAnalysisRow(row.id, nextPayload, hasPickColumns, hasFinalPickColumns)

    if (updateResult.error) throw updateResult.error
    fixed += 1
  }

  return { checked: rows.length, fixed }
}

async function fetchAnalysisRowsForNormalization() {
  const result = await supabase
    .from('match_analysis')
    .select(selectionV2AnalysisSelect)
    .limit(1000)

  if (!result.error) {
    return { rows: result.data ?? [], hasPickColumns: true, hasFinalPickColumns: true }
  }

  if (!isMissingColumnError(result.error)) throw result.error

  const pickResult = await supabase
    .from('match_analysis')
    .select(pickAnalysisSelect)
    .limit(1000)

  if (!pickResult.error) {
    return { rows: pickResult.data ?? [], hasPickColumns: true, hasFinalPickColumns: false }
  }

  if (!isMissingColumnError(pickResult.error)) throw pickResult.error

  const legacyResult = await supabase
    .from('match_analysis')
    .select(legacyAnalysisSelect)
    .limit(1000)

  if (legacyResult.error) throw legacyResult.error
  return { rows: legacyResult.data ?? [], hasPickColumns: false, hasFinalPickColumns: false }
}

async function updateMatchAnalysisRow(id: string, payload: Record<string, unknown>, hasPickColumns: boolean, hasFinalPickColumns: boolean) {
  const result = await supabase
    .from('match_analysis')
    .update(payload)
    .eq('id', id)

  if (!result.error || (!hasPickColumns && !hasFinalPickColumns) || !isMissingColumnError(result.error)) return result

  const {
    pick_side: _pickSide,
    pick_team: _pickTeam,
    pick_reason: _pickReason,
    market_type: _marketType,
    market_line: _marketLine,
    fair_line: _fairLine,
    model_probability: _modelProbability,
    value_status: _valueStatus,
    value_reason: _valueReason,
    ...legacyPayload
  } = payload
  return supabase
    .from('match_analysis')
    .update(legacyPayload)
    .eq('id', id)
}

async function updateDailySelectionRanks(range: { startUtc: string; endUtc: string }, context?: FootballEnrichmentContext) {
  if (context) await recalibrateDailySelectionScores(range, context)
  else await recalibrateDailySelectionScores(range)
  if (context && shouldStopForExecutionBudget(context)) return 0

  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      kickoff_at,
      api_sports_fixture_id,
      enrichment_status,
      odds_updated_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_score,
      data_readiness_status,
      analysis:match_analysis(id, match_id, recommendation, ranking_score, confidence_score, calibrated_confidence_score, risk_level, risk_score, market_edge_score, professional_score, value_edge_score, risk_control_score, league_quality_score, data_quality_score, market_quality_score, data_validation_status, data_validation_notes, raw, ${analysisReadinessMetadataSelect})
    `)
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)

  if (result.error) {
    if (isMissingColumnError(result.error)) return 0
    throw result.error
  }

  const matchIds = (result.data ?? []).map((match: any) => match.id).filter(Boolean)
  if (!matchIds.length) return 0
  const oddsMatchIds = await fetchMatchIdsWithOdds(matchIds)

  const rows = (result.data ?? [])
    .map((match: any) => {
      const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
      if (!analysis) return null
      const readiness = classifyRankingReadiness(match, oddsMatchIds)
      return { matchId: match.id, analysis, readiness }
    })
    .filter(Boolean)

  const resetResult = await supabase
    .from('match_analysis')
    .update({ is_top_pick: false, is_final_pick: false, final_rank: null, final_pick_note: null })
    .in('match_id', matchIds)

  if (resetResult.error) {
    if (isMissingColumnError(resetResult.error)) return 0
    throw resetResult.error
  }

  if (!rows.length) return 0
  await markInsufficientMarketDataRows(rows, context)

  const ranked = rows
    .filter((row: any) => String(row.analysis.data_validation_status ?? 'VALID').toUpperCase() !== 'INVALID')
    .filter((row: any) => isProfessionalRankingCandidate(row))
    .sort((a: any, b: any) => {
      const recommendationDiff = recommendationPriority(getCoverageAwareRecommendation(a)) - recommendationPriority(getCoverageAwareRecommendation(b))
      const professionalDiff = Number(b.analysis.professional_score ?? b.analysis.raw?.professional_pipeline?.totalScore ?? b.analysis.ranking_score ?? 0) - Number(a.analysis.professional_score ?? a.analysis.raw?.professional_pipeline?.totalScore ?? a.analysis.ranking_score ?? 0)
      const confidenceDiff = Number(b.analysis.calibrated_confidence_score ?? b.analysis.confidence_score ?? 0) - Number(a.analysis.calibrated_confidence_score ?? a.analysis.confidence_score ?? 0)
      const valueDiff = Number(b.analysis.value_edge_score ?? b.analysis.market_edge_score ?? 0) - Number(a.analysis.value_edge_score ?? a.analysis.market_edge_score ?? 0)
      const riskControlDiff = Number(b.analysis.risk_control_score ?? 100 - Number(b.analysis.risk_score ?? 100)) - Number(a.analysis.risk_control_score ?? 100 - Number(a.analysis.risk_score ?? 100))
      const leagueQualityDiff = Number(b.analysis.league_quality_score ?? 0) - Number(a.analysis.league_quality_score ?? 0)
      return recommendationDiff || professionalDiff || confidenceDiff || valueDiff || riskControlDiff || leagueQualityDiff
    })

  let updated = 0
  for (const [index, row] of ranked.entries()) {
    if (context && shouldStopForExecutionBudget(context)) break
    const recommendation = getCoverageAwareRecommendation(row)
    const updateResult = await supabase
      .from('match_analysis')
      .update({
        is_top_pick: true,
        is_final_pick: index === 0,
        final_rank: index + 1,
        final_pick_note: index === 0 ? buildFinalPickNoteV2(recommendation) : null,
      })
      .eq('match_id', row.matchId)

    if (updateResult.error) {
      if (isMissingColumnError(updateResult.error)) return updated
      throw updateResult.error
    }
    updated += 1
  }

  return updated
}

function classifyRankingReadiness(match: any, oddsMatchIds: Set<string>) {
  const hasStoredOdds = oddsMatchIds.has(match.id)
  const hasMarketData = hasStoredOdds
  const status = String(match.data_readiness_status ?? '').toUpperCase()
  if (status === 'FAILED') return 'FAILED'
  if (status === 'SKIPPED_NO_COVERAGE') return 'SKIPPED_NO_COVERAGE'
  if (status === 'PENDING' && !hasMarketData) return 'PENDING'
  if (status === 'NO_MARKET_DATA' && !hasMarketData) return 'NO_MARKET_DATA'
  if (hasMarketData && Boolean(match.has_fixture_detail)) return 'READY'
  if (hasMarketData) return 'PARTIAL'
  if (match.enrichment_status && match.enrichment_status !== 'PENDING') return 'NO_MARKET_DATA'
  return 'PENDING'
}

function rankingReadinessPriority(status: string) {
  if (status === 'READY') return 1
  if (status === 'PARTIAL') return 2
  if (status === 'NO_MARKET_DATA') return 3
  if (status === 'SKIPPED_NO_COVERAGE') return 4
  if (status === 'PENDING') return 5
  if (status === 'FAILED') return 6
  return 5
}

function getCoverageAwareRecommendation(row: any) {
  const readiness = String(row?.readiness ?? '').toUpperCase()
  if (!['READY', 'PARTIAL'].includes(readiness)) return 'NO BET'
  return String(row?.analysis?.recommendation ?? 'NO BET').toUpperCase()
}

function isProfessionalRankingCandidate(row: any) {
  const analysis = row?.analysis ?? {}
  const pipeline = analysis.raw?.professional_pipeline ?? {}
  const professionalScore = Number(analysis.professional_score ?? pipeline.totalScore ?? analysis.ranking_score ?? 0)
  const leagueQuality = Number(analysis.league_quality_score ?? pipeline.scores?.leagueQuality ?? 0)
  const dataQuality = Number(analysis.data_quality_score ?? pipeline.scores?.dataQuality ?? analysis.match_quality_score ?? 0)
  return professionalScore >= 55 && leagueQuality >= 55 && dataQuality >= 50
}

async function markInsufficientMarketDataRows(rows: Array<any>, context?: FootballEnrichmentContext) {
  for (const row of rows) {
    if (context && shouldStopForExecutionBudget(context)) break
    if (['READY', 'PARTIAL'].includes(String(row.readiness ?? '').toUpperCase())) continue
    const raw = row.analysis.raw && typeof row.analysis.raw === 'object' ? row.analysis.raw : {}
    const updateResult = await supabase
      .from('match_analysis')
      .update({
        recommendation: 'NO BET',
        analysis_status: 'INSUFFICIENT_MARKET_DATA',
        recommendation_reason: 'ข้อมูลตลาด/ราคา/odds ยังไม่พร้อม จึงไม่ยกระดับเป็นคู่แนะนำ',
        market_data_used: false,
        odds_rows_used: 0,
        recalculated_at: new Date().toISOString(),
        analysis_version: marketReadinessAnalysisVersion,
        data_validation_status: 'PARTIAL',
        data_validation_notes: appendValidationNote(row.analysis.data_validation_notes, 'INSUFFICIENT_MARKET_DATA'),
        analysis_summary: 'INSUFFICIENT_MARKET_DATA: market odds/line data is not ready, so this match cannot be promoted to BET.',
        raw: {
          ...raw,
          analysis_status: 'INSUFFICIENT_MARKET_DATA',
          recommendation_reason: 'ข้อมูลตลาด/ราคา/odds ยังไม่พร้อม จึงไม่ยกระดับเป็นคู่แนะนำ',
          market_data_used: false,
          odds_rows_used: 0,
          data_readiness_status: row.readiness,
          analysis_version: marketReadinessAnalysisVersion,
          ranking_gate: 'INSUFFICIENT_MARKET_DATA',
        },
      })
      .eq('match_id', row.matchId)
    if (updateResult.error) {
      if (isMissingColumnError(updateResult.error)) return
      throw updateResult.error
    }
    row.analysis.recommendation = 'NO BET'
    row.analysis.analysis_status = 'INSUFFICIENT_MARKET_DATA'
    row.analysis.market_data_used = false
    row.analysis.odds_rows_used = 0
    row.analysis.data_validation_status = 'PARTIAL'
  }
}

function appendValidationNote(current: unknown, note: string) {
  const parts = String(current ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!parts.includes(note)) parts.push(note)
  return parts.join(', ')
}

async function recalibrateDailySelectionScores(range: { startUtc: string; endUtc: string }, context?: FootballEnrichmentContext) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_fixture_id,
      api_provider,
      api_sports_fixture_id,
      api_sports_league_id,
      kickoff_at,
      status,
      home_goals,
      away_goals,
      odds_updated_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_score,
      data_readiness_status,
      raw,
      league:football_leagues(id, api_league_id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name, country),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name, country),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, risk_score, ranking_score, data_validation_status, match_quality_score, team_strength_score, form_score, goal_scoring_score, defensive_stability_score, tactical_matchup_score, motivation_score, market_reading_score, home_away_score, edge_score, ai_score, market_edge_score, odds_confidence_score, odds_movement_score, injuries_score, lineups_score, data_depth_score, learning_adjustment_score, historical_accuracy_score, value_market, value_side, value_line, raw, ${analysisReadinessMetadataSelect})
    `)
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)
    .limit(1000)

  if (result.error) {
    if (isMissingColumnError(result.error)) return 0
    throw result.error
  }
  if (context && shouldStopForExecutionBudget(context)) return 0

  let updated = 0
  const matchIds = (result.data ?? []).map((row: any) => row.id).filter(Boolean)
  const oddsByMatchId = await fetchStoredOddsByMatchIds(matchIds)
  for (const row of result.data ?? []) {
    if (context && shouldStopForExecutionBudget(context)) break
    const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
    if (!analysis) continue
    const rawAnalysis = analysis.raw ?? {}
    const rawMatch = row.raw ?? rawAnalysis.raw_match ?? {}
    const match = {
      ...rawMatch,
      id: rawMatch.id ?? row.api_fixture_id ?? row.id,
      api_sports_league_id: row.api_sports_league_id,
      utcDate: rawMatch.utcDate ?? row.kickoff_at,
      kickoff_at: row.kickoff_at,
      status: rawMatch.status ?? row.status,
      competition: {
        ...(rawMatch.competition ?? {}),
        id: rawMatch.competition?.id ?? row.league?.api_league_id,
        api_league_id: row.league?.api_league_id,
        name: rawMatch.competition?.name ?? row.league?.name,
        country: rawMatch.competition?.country ?? row.league?.country,
      },
      league: {
        ...(rawMatch.league ?? {}),
        id: rawMatch.league?.id ?? row.league?.api_league_id,
        api_league_id: row.league?.api_league_id,
        name: rawMatch.league?.name ?? row.league?.name,
        country: rawMatch.league?.country ?? row.league?.country,
      },
      homeTeam: rawMatch.homeTeam ?? { id: row.homeTeam?.api_team_id, name: row.homeTeam?.name },
      awayTeam: rawMatch.awayTeam ?? { id: row.awayTeam?.api_team_id, name: row.awayTeam?.name },
    }
    const next = buildSelectionV2Analysis(match, {
      ...(rawAnalysis ?? {}),
      ...(analysis ?? {}),
      recommendation: analysis.recommendation,
      confidence_score: analysis.confidence_score,
      risk_score: analysis.risk_score,
      ranking_score: analysis.ranking_score,
    })
    const oddsRows = oddsByMatchId.get(row.id) ?? []
    const marketAware = buildMarketReadinessRecomputeAnalysis(row, {
      ...(rawAnalysis ?? {}),
      ...(analysis ?? {}),
      recommendation: analysis.recommendation,
      confidence_score: analysis.confidence_score,
      calibrated_confidence_score: analysis.calibrated_confidence_score,
      risk_score: analysis.risk_score,
      risk_level: analysis.risk_level,
      ranking_score: analysis.ranking_score,
    }, oddsRows)
    const professional = buildProfessionalSelectionScoreEdge(match, {
      ...(rawAnalysis ?? {}),
      ...(analysis ?? {}),
      ...next,
      ...marketAware,
    })
    const nextPayload = {
        league_quality_score: next.league_quality_score,
        match_quality_score: next.match_quality_score,
        team_strength_score: next.team_strength_score,
        form_score: next.form_score,
        goal_scoring_score: next.goal_scoring_score,
        defensive_stability_score: next.defensive_stability_score,
        tactical_matchup_score: next.tactical_matchup_score,
        motivation_score: next.motivation_score,
        market_reading_score: next.market_reading_score,
        home_away_score: next.home_away_score,
        edge_score: next.edge_score,
        ...marketAware,
        recommendation_tier: getRecommendationTierV2(String(marketAware.recommendation ?? 'NO BET'), Number(marketAware.confidence_score ?? 0), Number(marketAware.risk_score ?? 100)),
        data_validation_status: next.data_validation_status,
        data_validation_notes: next.data_validation_notes,
        analysis_summary: marketAware.enriched_summary ?? next.analysis_summary,
        professional_score: professional.totalScore,
        data_quality_score: professional.scores.dataQuality,
        market_quality_score: professional.scores.marketQuality,
        statistical_edge_score: professional.scores.statisticalEdge,
        tactical_edge_score: professional.scores.tacticalEdge,
        risk_control_score: professional.scores.riskControl,
        value_edge_score: professional.scores.valueEdge,
        pipeline_stage: professional.pipelineStage,
        pipeline_reasons: professional.reasons,
        pipeline_warnings: professional.warnings,
        raw: {
          ...rawAnalysis,
          ...(marketAware.raw && typeof marketAware.raw === 'object' ? marketAware.raw : {}),
          league_quality_score: next.league_quality_score,
          confidence_score: marketAware.confidence_score,
          ranking_score: marketAware.ranking_score,
          recommendation: marketAware.recommendation,
          professional_pipeline: professional,
          leagueQualitySource: leagueQualityScoringVersion,
        },
      }
    const updateResult = await supabase
      .from('match_analysis')
      .update(nextPayload)
      .eq('match_id', row.id)

    if (updateResult.error) {
      if (isMissingColumnError(updateResult.error)) {
        const compatibleResult = await supabase
          .from('match_analysis')
          .update(stripApiFootballPickPayload(nextPayload))
          .eq('match_id', row.id)
        if (compatibleResult.error) return updated
      } else {
        throw updateResult.error
      }
    }
    updated += 1
  }

  return updated
}

async function countAnalyzedCandidates(range: { startUtc: string; endUtc: string }) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      analysis:match_analysis(id, data_validation_status)
    `)
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)

  if (result.error) {
    if (isMissingColumnError(result.error)) return null
    throw result.error
  }

  return (result.data ?? []).filter((match: any) => {
    const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
    return analysis && String(analysis.data_validation_status ?? 'VALID').toUpperCase() !== 'INVALID'
  }).length
}

async function getRankingReadinessSummary(range: { startUtc: string; endUtc: string }) {
  const result = await supabase
    .from('football_matches')
    .select('id, enrichment_status, odds_updated_at, has_market_data, has_fixture_detail, data_readiness_status')
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)

  if (result.error) {
    if (isMissingColumnError(result.error)) {
      const fallback = await supabase
        .from('football_matches')
        .select('id, enrichment_status, odds_updated_at')
        .gte('kickoff_at', range.startUtc)
        .lt('kickoff_at', range.endUtc)
      if (fallback.error) return { totalFixtures: 0, ready: 0, partial: 0, noMarketData: 0, pending: 0, failed: 0 }
      const ids = (fallback.data ?? []).map((row: any) => row.id).filter(Boolean)
      const oddsIds = await fetchMatchIdsWithOdds(ids)
      return summarizeRankingReadiness(fallback.data ?? [], oddsIds)
    }
    throw result.error
  }

  const ids = (result.data ?? []).map((row: any) => row.id).filter(Boolean)
  const oddsIds = await fetchMatchIdsWithOdds(ids)
  return summarizeRankingReadiness(result.data ?? [], oddsIds)
}

function summarizeRankingReadiness(rows: Array<any>, oddsIds: Set<string>) {
  const summary = {
    totalFixtures: rows.length,
    ready: 0,
    partial: 0,
    noMarketData: 0,
    pending: 0,
    failed: 0,
  }
  for (const row of rows) {
    const status = classifyRankingReadiness(row, oddsIds)
    if (status === 'READY') summary.ready += 1
    else if (status === 'PARTIAL') summary.partial += 1
    else if (status === 'FAILED') summary.failed += 1
    else if (status === 'PENDING') summary.pending += 1
    else summary.noMarketData += 1
  }
  return summary
}

async function fetchTopSelectionsDebug(range: { startUtc: string; endUtc: string }) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      kickoff_at,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      league:football_leagues(id, api_league_id, name, country),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, name),
      analysis:match_analysis(final_rank, recommendation, confidence_score, ranking_score, risk_level, league_quality_score, raw, ${analysisReadinessMetadataSelect})
    `)
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)
    .limit(1000)

  if (result.error) {
    if (isMissingColumnError(result.error)) return []
    throw result.error
  }

  return (result.data ?? [])
    .map((match: any) => {
      const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
      if (!analysis?.final_rank) return null
      return {
        finalRank: analysis.final_rank,
        leagueId: match.league?.api_league_id ?? null,
        country: match.league?.country ?? null,
        league: match.league?.name ?? null,
        homeTeam: match.homeTeam?.name ?? null,
        awayTeam: match.awayTeam?.name ?? null,
        recommendation: analysis.recommendation ?? null,
        confidence_score: analysis.confidence_score ?? null,
        ranking_score: analysis.ranking_score ?? null,
        risk_level: analysis.risk_level ?? null,
        data_readiness_status: match.data_readiness_status ?? null,
        has_market_data: Boolean(match.has_market_data),
        has_fixture_detail: Boolean(match.has_fixture_detail),
        analysis_status: analysis.analysis_status ?? analysis.raw?.analysis_status ?? null,
        recommendation_reason: analysis.recommendation_reason ?? analysis.raw?.recommendation_reason ?? null,
        market_data_used: Boolean(analysis.market_data_used ?? analysis.raw?.market_data_used),
        odds_rows_used: analysis.odds_rows_used ?? analysis.raw?.odds_rows_used ?? null,
        recalculated_at: analysis.recalculated_at ?? null,
        analysis_version: analysis.analysis_version ?? analysis.raw?.analysis_version ?? null,
        league_quality_score: analysis.league_quality_score ?? null,
        leagueQualitySource: analysis.raw?.leagueQualitySource ?? leagueQualityScoringVersion,
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(a.finalRank ?? 999) - Number(b.finalRank ?? 999))
}

function isMissingColumnError(error: any) {
  const message = String(error?.message ?? error?.details ?? '')
  return error?.code === '42703' || /column .* does not exist/i.test(message) || /Could not find .* column/i.test(message)
}

function analyzeMatch({ match, homeForm, awayForm, standings, leaguePriority, recentMatches, recentOpponents }: any) {
  const homeStanding = findStanding(standings, match.homeTeam?.id)
  const awayStanding = findStanding(standings, match.awayTeam?.id)
  const dataCompleteness = getDataCompletenessFromSource(match, homeForm, awayForm, standings)
  const analysisBreakdown = buildModuleBreakdown(match, homeForm, awayForm, homeStanding, awayStanding, leaguePriority)
  const baseConfidence = Math.round(
    analysisBreakdown.team_strength.score * 0.1 +
      analysisBreakdown.recent_form.score * 0.1 +
      analysisBreakdown.home_away_advantage.score * 0.14 +
      analysisBreakdown.away_weakness.score * 0.14 +
      analysisBreakdown.attack_quality.score * 0.16 +
      analysisBreakdown.defensive_stability.score * 0.16 +
      analysisBreakdown.market_odds_risk.score * 0.14 +
      analysisBreakdown.motivation_context.score * 0.06,
  )
  const footballIntelligence = calculateFootballIntelligence(match, {
    homeForm,
    awayForm,
    recentMatches,
    recentOpponents,
    baseConfidence,
  })
  const footballModifier = footballIntelligence.modifier
  const dataIntelligence = calculateDataIntelligence(match, {
    homeForm,
    awayForm,
    recentOpponents,
    baseConfidence,
    footballModifier,
  })
  const dataIntelligenceModifier = dataIntelligence.modifier
  const intelligenceModifier = getCombinedIntelligenceModifier(baseConfidence, footballModifier, dataIntelligenceModifier)
  const rawConfidence = Math.round(clamp(baseConfidence + intelligenceModifier, 0, 100))
  const confidence = applyMarketDataConfidenceGuard(rawConfidence, baseConfidence, analysisBreakdown)
  analysisBreakdown.football_intelligence = footballIntelligence
  analysisBreakdown.data_intelligence = dataIntelligence
  const overallRisk = calculateOverallRisk(analysisBreakdown, confidence, dataCompleteness, footballIntelligence)
  analysisBreakdown.overall_risk = overallRisk
  const riskLevel = overallRisk.level
  const roundedModules = {
    teamStrength: analysisBreakdown.team_strength.score,
    recentForm: analysisBreakdown.recent_form.score,
    attackQuality: analysisBreakdown.attack_quality.score,
    defensiveStability: analysisBreakdown.defensive_stability.score,
    homeAwayAdvantage: analysisBreakdown.home_away_advantage.score,
    awayWeakness: analysisBreakdown.away_weakness.score,
    motivationContext: analysisBreakdown.motivation_context.score,
    marketOddsRisk: analysisBreakdown.market_odds_risk.score,
  }
  const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
  logFootballIntelligenceV3({
    match,
    baseConfidence,
    footballModifier,
    dataIntelligenceModifier,
    intelligenceModifier,
    confidence,
    riskLevel,
    recommendation,
    modules: roundedModules,
    intelligenceSignals: footballIntelligence.signals,
  })
  const analysisSummary = buildAnalysisSummary(match, confidence, riskLevel, recommendation, analysisBreakdown)
  const pick = derivePickSideFromAnalysis(match, {
    home_advantage_score: analysisBreakdown.home_away_advantage.score,
    away_weakness_score: analysisBreakdown.away_weakness.score,
    goal_scoring_score: analysisBreakdown.attack_quality.score,
    defensive_stability_score: analysisBreakdown.defensive_stability.score,
    market_risk_score: analysisBreakdown.market_odds_risk.score,
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
  })
  const finalPick = normalizeFinalPickFields(match, {
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
    pick_side: pick.pick_side,
  })

  return {
    provider: 'football-data.org',
    framework: systemVersions.decision_model_version,
    team_strength_score: analysisBreakdown.team_strength.score,
    form_score: analysisBreakdown.recent_form.score,
    home_advantage_score: analysisBreakdown.home_away_advantage.score,
    away_weakness_score: analysisBreakdown.away_weakness.score,
    goal_scoring_score: analysisBreakdown.attack_quality.score,
    defensive_stability_score: analysisBreakdown.defensive_stability.score,
    motivation_score: analysisBreakdown.motivation_context.score,
    market_risk_score: analysisBreakdown.market_odds_risk.score,
    confidence_score: confidence,
    base_confidence_score: baseConfidence,
    intelligence_modifier: intelligenceModifier,
    football_intelligence_modifier: footballModifier,
    data_intelligence_modifier: dataIntelligenceModifier,
    final_confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
    pick_side: pick.pick_side,
    pick_team: pick.pick_team,
    pick_reason: pick.pick_reason,
    market_type: finalPick.market_type,
    market_line: finalPick.market_line,
    fair_line: finalPick.fair_line,
    model_probability: finalPick.model_probability,
    value_status: finalPick.value_status,
    value_reason: finalPick.value_reason,
    analysis_summary: analysisSummary,
    thai_reason: analysisSummary,
    modules: roundedModules,
    analysis_breakdown: analysisBreakdown,
    data_completeness: dataCompleteness,
    homeForm,
    awayForm,
    standings,
    recent_matches: recentMatches,
    raw_match: match,
  }
}

function buildModuleBreakdown(match: any, homeForm: any, awayForm: any, homeStanding: any, awayStanding: any, leaguePriority: number) {
  return {
    team_strength: scoreTeamStrength(match, homeForm, awayForm, homeStanding, awayStanding),
    recent_form: scoreRecentForm(homeForm, awayForm),
    attack_quality: scoreAttackQuality(homeForm, awayForm, homeStanding, awayStanding),
    defensive_stability: scoreDefensiveStability(homeForm, awayForm),
    home_away_advantage: scoreHomeAwayAdvantage(match, homeForm),
    away_weakness: scoreAwayWeakness(awayForm, awayStanding),
    motivation_context: scoreMotivationContext(match, leaguePriority),
    market_odds_risk: scoreMarketOddsRisk(match, homeForm, awayForm),
  }
}

function scoreTeamStrength(match: any, homeForm: any, awayForm: any, homeStanding: any, awayStanding: any) {
  if (homeStanding && awayStanding) {
    const standingGap = Number(awayStanding.position ?? 12) - Number(homeStanding.position ?? 12)
    const pointsGap = Number(homeStanding.points ?? 0) - Number(awayStanding.points ?? 0)
    const goalDiffGap = Number(homeStanding.goalDifference ?? 0) - Number(awayStanding.goalDifference ?? 0)
    const score = clamp(58 + standingGap * 2 + pointsGap * 0.7 + goalDiffGap * 0.8, 28, 90)
    return moduleResult(score, standingGap >= 0 ? 'อันดับและแต้มโดยรวมหนุนฝั่งเจ้าบ้านมากกว่า' : 'อันดับตารางไม่ได้หนุนฝั่งเจ้าบ้านชัดเจน')
  }

  const formGap = formPoints(homeForm) - formPoints(awayForm)
  const goalDiffGap = formGoalDiff(homeForm) - formGoalDiff(awayForm)
  const nameSignal = (match.homeTeam?.name ? 3 : 0) + (match.awayTeam?.name ? 2 : 0)
  const score = clamp(55 + formGap * 1.4 + goalDiffGap * 1.8 + nameSignal, 35, 78)
  return moduleResult(score, 'ไม่มีตารางคะแนนครบ จึงใช้ฟอร์มและข้อมูลทีมที่มีเป็น proxy')
}

function scoreRecentForm(homeForm: any, awayForm: any) {
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return moduleResult(56, 'ข้อมูลฟอร์มล่าสุดจำกัด จึงประเมินแบบกลางจากบริบทคู่แข่ง')

  const pointsRate = ((formPoints(homeForm) + formPoints(awayForm)) / Math.max(played * 3, 1)) * 100
  const goalBalance = clamp((formGoalDiff(homeForm) + formGoalDiff(awayForm)) * 2.5, -18, 18)
  const score = clamp(42 + pointsRate * 0.38 + goalBalance, 25, 86)
  return moduleResult(score, played >= 8 ? 'ฟอร์ม 5 นัดล่าสุดมีข้อมูลรองรับเพียงพอ' : 'มีข้อมูลฟอร์มบางส่วน แต่ยังไม่เต็มหน้าต่าง 5 นัด')
}

function scoreAttackQuality(homeForm: any, awayForm: any, homeStanding: any, awayStanding: any) {
  const goalsFor = Number(homeForm?.goals_for ?? 0) + Number(awayForm?.goals_for ?? 0)
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  const standingBoost = homeStanding || awayStanding ? clamp((Number(homeStanding?.goalsFor ?? 0) + Number(awayStanding?.goalsFor ?? 0)) * 0.25, 0, 12) : 0

  if (!played && !standingBoost) return moduleResult(57, 'ยังไม่มี xG หรือสถิติเกมรุกละเอียด จึงใช้ค่ากลางแบบระมัดระวัง')

  const goalsPerMatch = goalsFor / Math.max(played, 1)
  const score = clamp(48 + goalsPerMatch * 18 + standingBoost, 30, 88)
  return moduleResult(score, goalsPerMatch >= 1.4 ? 'เกมรุกมีแนวโน้มสร้างประตูได้ดีจากข้อมูลล่าสุด' : 'เกมรุกยังไม่ได้เด่นชัดจากข้อมูลประตูที่มี')
}

function scoreDefensiveStability(homeForm: any, awayForm: any) {
  const goalsAgainst = Number(homeForm?.goals_against ?? 0) + Number(awayForm?.goals_against ?? 0)
  const cleanSheets = Number(homeForm?.clean_sheets ?? 0) + Number(awayForm?.clean_sheets ?? 0)
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return moduleResult(58, 'ข้อมูลเกมรับจำกัด จึงยังประเมินความมั่นคงในระดับกลาง')

  const concededPerMatch = goalsAgainst / Math.max(played, 1)
  const score = clamp(74 - concededPerMatch * 22 + cleanSheets * 4, 25, 90)
  return moduleResult(score, concededPerMatch <= 1 ? 'เกมรับค่อนข้างมั่นคงจากอัตราเสียประตู' : 'เกมรับยังมีความเสี่ยงจากอัตราเสียประตู')
}

function scoreHomeAwayAdvantage(match: any, homeForm: any) {
  const venueText = String(match.venue ?? match.raw?.venue ?? '').toLowerCase()
  if (venueText.includes('neutral')) return moduleResult(52, 'สนามเป็นกลางหรือมีสัญญาณว่าเจ้าบ้านไม่ได้เปรียบเต็มที่')

  const played = Number(homeForm?.played ?? 0)
  const homeWinRate = played ? Number(homeForm?.wins ?? 0) / played : 0.4
  const score = clamp(57 + homeWinRate * 22 + Math.max(formGoalDiff(homeForm), 0) * 1.3, 48, 78)
  return moduleResult(score, played ? 'เจ้าบ้านมีแรงหนุนจากสภาพการแข่งขันและฟอร์มฝั่งเหย้า' : 'ไม่มีข้อมูลสนามละเอียด จึงให้น้ำหนักเจ้าบ้านแบบจำกัด')
}

function scoreAwayWeakness(awayForm: any, awayStanding: any) {
  const played = Number(awayForm?.played ?? 0)
  const standingPosition = Number(awayStanding?.position ?? 0)

  if (!played && !standingPosition) {
    return moduleResult(55, 'ข้อมูลจุดอ่อนทีมเยือนยังจำกัด จึงประเมินแบบระมัดระวัง')
  }

  const lossRate = played ? Number(awayForm?.losses ?? 0) / played : 0.25
  const concededPerMatch = played ? Number(awayForm?.goals_against ?? 0) / played : 1.2
  const failedRate = played ? Number(awayForm?.failed_to_score ?? 0) / played : 0.2
  const tableWeakness = standingPosition ? clamp((standingPosition - 6) * 2.2, -8, 18) : 0
  const score = clamp(45 + lossRate * 24 + concededPerMatch * 12 + failedRate * 12 + tableWeakness, 28, 88)

  return moduleResult(
    score,
    score >= 68
      ? 'ทีมเยือนมีสัญญาณเปราะจากฟอร์มแพ้/เสียประตูและอันดับตาราง'
      : 'ทีมเยือนยังไม่เห็นจุดอ่อนชัดพอ จึงให้คะแนนแบบกลางค่อนไปทางระวัง',
  )
}

function scoreMotivationContext(match: any, leaguePriority: number) {
  const stage = String(match.stage ?? match.group ?? match.round ?? '').toLowerCase()
  const knockoutBoost = ['final', 'semi', 'quarter', 'last_16', 'playoff'].some((item) => stage.includes(item)) ? 8 : 0
  const priorityScore = leaguePriority <= 15 ? 65 : leaguePriority <= 30 ? 61 : leaguePriority <= 50 ? 58 : 55
  const score = clamp(priorityScore + knockoutBoost, 52, 78)
  return moduleResult(score, knockoutBoost ? 'รายการหรือรอบการแข่งขันเพิ่มแรงจูงใจเชิงบริบท' : 'ข้อมูลแรงจูงใจยังจำกัด จึงใช้คะแนนกลางตามความสำคัญรายการ')
}

function scoreMarketOddsRisk(match: any, homeForm: any, awayForm: any) {
  const hasOdds = hasMarketData(match)
  if (!hasOdds) {
    return {
      ...moduleResult(52, 'ข้อมูลราคาตลาดยังจำกัด จึงให้คะแนน conservative และไม่ใช้เป็นเหตุผลหนุน BET เต็มตัว'),
      has_market_data: false,
    }
  }

  const formGap = Math.abs(formPoints(homeForm) - formPoints(awayForm))
  const score = clamp(58 + Math.min(formGap, 8) * 2.2, 42, 82)
  return { ...moduleResult(score, 'มีข้อมูลตลาดบางส่วนและใช้ร่วมกับความต่างของฟอร์มเพื่อประเมินความเสี่ยง'), has_market_data: true }
}

function calculateOverallRiskV2Legacy(breakdown: any, confidence: number, dataCompleteness: number) {
  const scores = [
    breakdown.team_strength.score,
    breakdown.recent_form.score,
    breakdown.attack_quality.score,
    breakdown.defensive_stability.score,
    breakdown.home_away_advantage.score,
    breakdown.motivation_context.score,
    breakdown.market_odds_risk.score,
  ]
  const spread = Math.max(...scores) - Math.min(...scores)
  const weakCore = ['team_strength', 'recent_form', 'attack_quality', 'defensive_stability'].filter((key) => breakdown[key].score < 45).length

  if (confidence < 48 || weakCore >= 2 || spread >= 42) {
    return { level: 'HIGH', reason: 'คะแนนสำคัญหลายด้านอ่อนหรือขัดแย้งกันมาก จึงจัดเป็นความเสี่ยงสูง' }
  }
  if (confidence >= 72 && dataCompleteness >= 70 && spread <= 28) {
    return { level: 'LOW', reason: 'หลายโมดูลให้ภาพสอดคล้องกันและข้อมูลรองรับค่อนข้างครบ' }
  }
  return { level: 'MEDIUM', reason: 'มีข้อมูลสนับสนุนบางส่วน แต่ยังไม่ครบทุกมิติหรือคะแนนยังไม่สอดคล้องเต็มที่' }
}

function moduleResult(score: number, reason: string) {
  return { score: Math.round(clamp(score, 0, 100)), reason }
}

function getDataCompletenessFromSource(match: any, homeForm: any, awayForm: any, standings: Array<any>) {
  const checks = [
    Boolean(match.id),
    Boolean(match.utcDate),
    Boolean(match.competition?.name),
    Boolean(match.homeTeam?.name),
    Boolean(match.awayTeam?.name),
    Number(homeForm?.played ?? 0) > 0,
    Number(awayForm?.played ?? 0) > 0,
    Boolean(standings?.length),
    Boolean(match.score),
    Boolean(match.status),
  ]

  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function formPoints(form: any) {
  return Number(form?.wins ?? 0) * 3 + Number(form?.draws ?? 0)
}

function formGoalDiff(form: any) {
  return Number(form?.goals_for ?? 0) - Number(form?.goals_against ?? 0)
}

function getRecommendationFromConfidence(confidence: number, riskLevel = 'medium') {
  if (normalizeRiskLevel(riskLevel) === 'HIGH') return 'NO BET'
  if (confidence >= 72) return 'BET'
  if (confidence >= 58) return 'LEAN'
  return 'NO BET'
}

function applyMarketDataConfidenceGuard(confidence: number, baseConfidence: number, breakdown: any) {
  if (breakdown?.market_odds_risk?.has_market_data !== false || confidence < 72) return confidence

  const coreScores = [
    breakdown.home_away_advantage?.score,
    breakdown.away_weakness?.score,
    breakdown.attack_quality?.score,
    breakdown.defensive_stability?.score,
  ].map((score) => Number(score ?? 0))
  const coreAverage = coreScores.reduce((total, score) => total + score, 0) / Math.max(coreScores.length, 1)
  const footballCaseIsVeryStrong = baseConfidence >= 78 && coreAverage >= 74

  return footballCaseIsVeryStrong ? confidence : Math.min(confidence, 71)
}

function hasMarketData(match: any) {
  const rows = Array.isArray(match?.odds) ? match.odds : []
  return rows.some((row: any) => row?.match_id || row?.id || row?.market_name)
}

function buildSelectionV2Analysis(match: any, analysis: any) {
  const leagueQualityScore = getLeagueQualityScore(match)
  const matchQualityScore = getMatchQualityScoreV2(match, analysis)
  const validation = getDataValidationStatusV2(match, analysis)
  const base = normalizeScore(60 + (leagueQualityScore - 65) * 0.1 + recommendationBoost(analysis?.recommendation) + (Number(analysis?.confidence_score ?? 0) - 60) * 0.08)
  const teamStrengthScore = normalizeScore(analysis?.team_strength_score ?? analysis?.modules?.teamStrength ?? base)
  const formScore = normalizeScore(analysis?.form_score ?? analysis?.modules?.recentForm ?? base)
  const goalScoringScore = normalizeScore(analysis?.goal_scoring_score ?? analysis?.modules?.attackQuality ?? base)
  const defensiveStabilityScore = normalizeScore(analysis?.defensive_stability_score ?? analysis?.modules?.defensiveStability ?? base)
  const tacticalMatchupScore = normalizeScore(analysis?.tactical_matchup_score ?? analysis?.tactical_score ?? base)
  const motivationScore = normalizeScore(analysis?.motivation_score ?? analysis?.modules?.motivationContext ?? base)
  const marketReadingScore = normalizeScore(analysis?.market_reading_score ?? analysis?.market_context_score ?? analysis?.market_risk_score ?? analysis?.modules?.marketOddsRisk ?? base)
  const homeAwayScore = normalizeScore(analysis?.home_away_score ?? analysis?.home_advantage_score ?? analysis?.modules?.homeAwayAdvantage ?? base + 2)
  const aiScore = roundScore(
    teamStrengthScore * 0.2 +
      formScore * 0.15 +
      goalScoringScore * 0.15 +
      defensiveStabilityScore * 0.1 +
      tacticalMatchupScore * 0.1 +
      motivationScore * 0.1 +
      marketReadingScore * 0.1 +
      homeAwayScore * 0.1,
  )
  const edgeScore = getEdgeScoreV2(match, analysis, marketReadingScore)
  const riskScore = getRiskScoreV2(matchQualityScore, analysis)
  const confidenceScore = validation.status === 'INVALID'
    ? 0
    : roundScore(aiScore * 0.45 + edgeScore * 0.2 + leagueQualityScore * 0.15 + matchQualityScore * 0.15 - riskScore * 0.05)
  const recommendation = validation.status === 'INVALID' ? 'NO BET' : getRecommendationV2(confidenceScore, riskScore)
  const rankingScore = validation.status === 'INVALID'
    ? 0
    : roundScore(confidenceScore * 0.5 + aiScore * 0.25 + edgeScore * 0.15 + leagueQualityScore * 0.1 - riskScore * 0.1)

  return {
    data_validation_status: validation.status,
    data_validation_notes: validation.notes.join(', '),
    league_quality_score: leagueQualityScore,
    match_quality_score: matchQualityScore,
    team_strength_score: teamStrengthScore,
    form_score: formScore,
    goal_scoring_score: goalScoringScore,
    defensive_stability_score: defensiveStabilityScore,
    tactical_matchup_score: tacticalMatchupScore,
    motivation_score: motivationScore,
    market_reading_score: marketReadingScore,
    home_away_score: homeAwayScore,
    risk_score: riskScore,
    edge_score: edgeScore,
    ai_score: aiScore,
    confidence_score: confidenceScore,
    ranking_score: rankingScore,
    final_rank: analysis?.final_rank ?? null,
    recommendation,
    recommendation_tier: getRecommendationTierV2(recommendation, confidenceScore, riskScore),
    final_pick_note: analysis?.final_pick_note ?? null,
    is_top_pick: Boolean(analysis?.is_top_pick ?? false),
    is_final_pick: Boolean(analysis?.is_final_pick ?? false),
    analysis_summary: buildSelectionSummaryV2(recommendation, confidenceScore, riskScore, leagueQualityScore, matchQualityScore, edgeScore),
  }
}

function getDataValidationStatusV2(match: any, analysis: any) {
  const notes: Array<string> = []
  if (!(match?.id ?? analysis?.raw_match?.id)) notes.push('missing match_id')
  if (!(match?.homeTeam?.name ?? match?.home_team?.name)) notes.push('missing home_team')
  if (!(match?.awayTeam?.name ?? match?.away_team?.name)) notes.push('missing away_team')
  if (!(match?.competition?.name ?? match?.league?.name)) notes.push('missing league')
  if (!(match?.utcDate ?? match?.kickoff_at)) notes.push('missing kickoff_time')

  const criticalMissing = notes.some((note) => ['missing match_id', 'missing home_team', 'missing away_team', 'missing league', 'missing kickoff_time'].includes(note))
  if (criticalMissing) return { status: 'INVALID', notes }
  if (!(analysis?.confidence_score ?? analysis?.recommendation ?? analysis?.analysis_summary)) notes.push('limited analysis data')
  return { status: notes.length ? 'PARTIAL' : 'VALID', notes: notes.length ? notes : ['ready'] }
}

function getLeagueQualityScore(source: any) {
  const league = typeof source === 'string' ? { name: source, country: '' } : getLeagueMeta(source)
  const homeName = firstText(source?.homeTeam?.name, source?.home_team?.name, source?.raw?.apiFootball?.teams?.home?.name) ?? ''
  const awayName = firstText(source?.awayTeam?.name, source?.away_team?.name, source?.raw?.apiFootball?.teams?.away?.name) ?? ''
  const tierScore = getLeagueTierScore(league)
  const penalty = getFixtureSoftPenalty({ leagueName: league.name, homeName, awayName })
  const cap = getFixtureScoreCap({ leagueName: league.name, country: league.country, homeName, awayName })
  return normalizeScore(Math.min(cap, tierScore - penalty))
}

function getMatchQualityScoreV2(match: any, analysis: any) {
  const checks = [
    Boolean(match?.homeTeam?.name ?? match?.home_team?.name),
    Boolean(match?.awayTeam?.name ?? match?.away_team?.name),
    Boolean(match?.competition?.name ?? match?.league?.name),
    Boolean(match?.utcDate ?? match?.kickoff_at),
    Boolean(analysis?.recommendation ?? analysis?.confidence_score ?? analysis?.analysis_summary),
    Boolean(analysis?.market_line ?? match?.market_line ?? match?.odds),
    Boolean(analysis?.team_strength_score ?? analysis?.form_score ?? analysis?.modules),
  ]
  return normalizeScore(35 + checks.filter(Boolean).length * 9)
}

function getEdgeScoreV2(match: any, analysis: any, marketReadingScore: number) {
  const fairLine = parseLineNumber(firstText(analysis?.fair_line, match?.fair_line))
  const marketLine = parseLineNumber(firstText(analysis?.market_line, match?.market_line, match?.odds?.line))
  if (fairLine !== null && marketLine !== null) {
    const edge = Math.abs(fairLine - marketLine)
    if (edge >= 0.5) return 95
    if (edge >= 0.35) return 88
    if (edge >= 0.25) return 80
    if (edge >= 0.15) return 70
    if (edge >= 0.05) return 60
    return 50
  }
  return normalizeScore(marketReadingScore * 0.65 + Number(analysis?.confidence_score ?? 58) * 0.35)
}

function getRiskScoreV2(matchQualityScore: number, analysis: any) {
  if (analysis?.risk_score !== undefined && analysis?.risk_score !== null) return normalizeScore(analysis.risk_score)
  const marketReading = Number(analysis?.market_risk_score ?? analysis?.market_reading_score ?? 0)
  if (marketReading) return normalizeScore(100 - marketReading)
  return normalizeScore(100 - matchQualityScore)
}

function getRecommendationV2(confidence: number, risk: number) {
  if (confidence >= 85 && risk <= 45) return 'BET'
  if (confidence >= 80 && risk <= 55) return 'BET'
  if (confidence >= 70) return 'LEAN'
  if (confidence >= 60) return 'WATCH'
  return 'NO BET'
}

function getRecommendationTierV2(recommendation: string, confidence: number, risk: number) {
  if (recommendation === 'BET' && confidence >= 85 && risk <= 45) return '*****'
  if (recommendation === 'BET') return '****'
  if (recommendation === 'LEAN') return '***'
  if (recommendation === 'WATCH') return '**'
  return '*'
}

function recommendationBoost(recommendation: unknown) {
  const value = String(recommendation ?? '').toUpperCase()
  if (value === 'BET') return 8
  if (value === 'LEAN') return 4
  if (value === 'WATCH') return 1
  return -2
}

function buildSelectionSummaryV2(recommendation: string, confidence: number, risk: number, league: number, quality: number, edge: number) {
  if (recommendation === 'BET') return `คู่นี้ผ่านการคัดเลือกด้วยคะแนนรวม ${confidence} จากคุณภาพลีก ${league}, คุณภาพข้อมูล ${quality} และ Edge Score ${edge} โดยมีความเสี่ยง ${risk} จึงอยู่ในระดับ BET`
  if (recommendation === 'LEAN') return `คู่นี้มีแนวโน้มดีแต่ยังไม่ชัดพอสำหรับ BET จึงจัดเป็น LEAN ด้วยความมั่นใจ ${confidence} และความเสี่ยง ${risk}`
  if (recommendation === 'WATCH') return `คู่นี้น่าติดตาม แต่ยังมีปัจจัยเสี่ยงหรือข้อมูลไม่ชัดพอ จึงจัดเป็น WATCH ด้วยความมั่นใจ ${confidence}`
  return `คู่นี้ยังไม่เหมาะสำหรับการเดิมพัน เนื่องจากคะแนนความมั่นใจ ${confidence} หรือความเสี่ยง ${risk} ยังไม่ผ่านเกณฑ์`
}

function getRiskLevelFromRiskScore(riskScore: number) {
  if (riskScore >= 70) return 'HIGH'
  if (riskScore >= 36) return 'MEDIUM'
  return 'LOW'
}

function buildFinalPickNoteV2(recommendation: string) {
  if (recommendation === 'LEAN') return 'อันดับ 1 วันนี้ยังไม่ถึงระดับ BET แต่เป็นคู่ที่ AI ประเมินดีที่สุด'
  if (recommendation === 'WATCH' || recommendation === 'NO BET') return 'อันดับ 1 วันนี้ยังมีความเสี่ยงสูง AI ไม่แนะนำให้เดิมพัน แต่เป็นคู่ที่น่าติดตามที่สุดของวัน'
  return 'วันนี้ AI เลือกคู่นี้เป็นอันดับ 1 ของวัน'
}

function recommendationPriority(recommendation: unknown) {
  const value = String(recommendation ?? '').toUpperCase().replace('_', ' ')
  if (value === 'BET') return 1
  if (value === 'LEAN') return 2
  if (value === 'WATCH') return 3
  if (value === 'NO BET') return 4
  return 5
}

function roundScore(value: number) {
  return Math.round(clamp(value, 0, 100) * 10) / 10
}

function normalizeFinalPickFields(source: any, analysis: any) {
  const marketType = firstText(
    analysis?.market_type,
    analysis?.bet_market,
    analysis?.recommended_market,
    source?.market_type,
    source?.bet_market,
    source?.recommended_market,
    source?.market?.type,
    source?.odds?.market_type,
    source?.raw?.market_type,
    source?.raw?.market?.type,
  )
  const marketLine = firstText(
    analysis?.market_line,
    analysis?.odds_line,
    analysis?.handicap_line,
    analysis?.current_line,
    source?.market_line,
    source?.odds_line,
    source?.handicap_line,
    source?.current_line,
    source?.market?.line,
    source?.odds?.line,
    source?.raw?.market_line,
    source?.raw?.market?.line,
  )
  const fairLine = firstText(analysis?.fair_line, source?.fair_line, source?.raw?.fair_line)
  const recommendation = String(analysis?.recommendation ?? 'NO BET').toUpperCase()
  const pickSide = normalizePickSide(analysis?.pick_side)
  const confidence = normalizeScore(analysis?.confidence_score ?? 0)
  const modelProbability = Math.round(clamp(firstNumber(analysis?.model_probability, source?.model_probability, source?.win_probability, confidence) ?? confidence, 0, 100))
  const valueStatus = normalizeValueStatus(analysis?.value_status, {
    recommendation,
    pickSide,
    marketLine,
    fairLine,
  })

  return {
    market_type: marketType,
    market_line: marketLine,
    fair_line: fairLine,
    model_probability: modelProbability,
    value_status: valueStatus,
    value_reason: getValueReason(valueStatus, analysis?.value_reason, marketLine, fairLine),
  }
}

function normalizeValueStatus(value: unknown, context: { recommendation: string; pickSide: string; marketLine: string | null; fairLine: string | null }) {
  if (context.recommendation === 'NO BET' || context.pickSide === 'NONE') return 'NOT_APPLICABLE'
  if (!context.marketLine || !context.fairLine) return 'WAITING_DATA'

  const normalized = String(value ?? '').toUpperCase()
  if (['YES', 'NO', 'WAITING_DATA', 'NOT_APPLICABLE'].includes(normalized)) return normalized

  const market = parseLineNumber(context.marketLine)
  const fair = parseLineNumber(context.fairLine)
  if (market === null || fair === null) return 'NO'
  return market > fair ? 'YES' : 'NO'
}

function getValueReason(status: string, storedReason: unknown, marketLine: string | null, fairLine: string | null) {
  const reason = String(storedReason ?? '').trim()
  if (reason) return reason
  if (status === 'YES') return 'ราคาตลาดดีกว่า Fair Line จากข้อมูลจริงที่มี'
  if (status === 'NO') return 'มีข้อมูลราคาแล้ว แต่ส่วนต่างยังไม่คุ้มพอ'
  if (status === 'NOT_APPLICABLE') return 'ไม่ใช่จังหวะเดิมพัน จึงไม่ประเมิน Value เชิงรุก'
  if (!marketLine || !fairLine) return 'ยังไม่มีราคาตลาดหรือ Fair Line เพียงพอสำหรับประเมิน Value'
  return 'รอข้อมูลราคาเพิ่มเติม'
}

function firstText(...values: Array<unknown>) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

function firstNumber(...values: Array<unknown>) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

function numericSortValue(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function parseLineNumber(value: unknown) {
  if (value === null || value === undefined) return null
  const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

function derivePickSideFromAnalysis(match: any, analysis: any) {
  const storedSide = normalizePickSide(analysis?.pick_side)
  const storedReason = String(analysis?.pick_reason ?? '').trim()
  const recommendation = String(analysis?.recommendation ?? 'NO BET').toUpperCase()
  const riskLevel = normalizeRiskLevel(analysis?.risk_level)
  const confidence = normalizeScore(analysis?.confidence_score ?? 0)
  const homeName = match?.homeTeam?.name ?? match?.home_team?.name ?? match?.raw_match?.homeTeam?.name ?? null
  const awayName = match?.awayTeam?.name ?? match?.away_team?.name ?? match?.raw_match?.awayTeam?.name ?? null

  if (storedSide !== 'NONE' && storedReason && recommendation !== 'NO BET' && confidence >= 58) {
    return buildPickResult(storedSide, homeName, awayName, storedReason)
  }

  if (recommendation === 'NO BET') {
    return buildPickResult('NONE', homeName, awayName, 'ไม่แนะนำเดิมพัน เพราะระบบประเมินว่ายังไม่มีความคุ้มค่าพอ')
  }
  if (riskLevel === 'HIGH') {
    return buildPickResult('NONE', homeName, awayName, 'ความเสี่ยงสูง จึงไม่แนะนำเลือกฝั่ง')
  }
  if (confidence < 58) {
    return buildPickResult('NONE', homeName, awayName, 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ')
  }

  const homeAdvantage = normalizeScore(analysis?.home_advantage_score ?? analysis?.modules?.homeAwayAdvantage ?? 56)
  const awayWeakness = normalizeScore(analysis?.away_weakness_score ?? analysis?.modules?.awayWeakness ?? 55)
  const goalScoring = normalizeScore(analysis?.goal_scoring_score ?? analysis?.modules?.attackQuality ?? 56)
  const defensiveStability = normalizeScore(analysis?.defensive_stability_score ?? analysis?.modules?.defensiveStability ?? 56)
  const marketRisk = normalizeScore(analysis?.market_risk_score ?? analysis?.modules?.marketOddsRisk ?? 52)
  const marketPenalty = Math.max(0, 55 - marketRisk) * 0.35
  const homeEdge = (homeAdvantage - 50) * 0.55 + (awayWeakness - 50) * 0.45 + (goalScoring - 55) * 0.15 + (defensiveStability - 55) * 0.1 - marketPenalty
  const awayEdge = (50 - homeAdvantage) * 0.7 + (50 - awayWeakness) * 0.55 + (goalScoring - 55) * 0.05 + (defensiveStability - 55) * 0.05 - marketPenalty

  if (homeEdge >= 14 && homeAdvantage >= 62 && awayWeakness >= 60 && marketRisk >= 48) {
    return buildPickResult('HOME', homeName, awayName, 'เจ้าบ้านได้เปรียบชัดจากคะแนนเหย้าและความอ่อนแอของทีมเยือน')
  }
  if (awayEdge >= 16 && homeAdvantage <= 42 && awayWeakness <= 42 && marketRisk >= 52) {
    return buildPickResult('AWAY', homeName, awayName, 'ทีมเยือนมีภาษีดีกว่าจากคะแนนฝั่งเจ้าบ้านที่อ่อนและทีมเยือนไม่เปราะชัด')
  }

  return buildPickResult('NONE', homeName, awayName, 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ')
}

function buildPickResult(pickSide: string, homeName: string | null, awayName: string | null, pickReason: string) {
  const normalized = normalizePickSide(pickSide)
  const pickTeam = normalized === 'HOME' ? homeName : normalized === 'AWAY' ? awayName : normalized === 'DRAW' ? 'เสมอ' : null

  return {
    pick_side: normalized,
    pick_team: pickTeam,
    pick_reason: pickReason,
  }
}

function normalizePickSide(value: unknown) {
  const normalized = String(value ?? '').toUpperCase()
  return ['HOME', 'AWAY', 'DRAW', 'NONE'].includes(normalized) ? normalized : 'NONE'
}

function normalizeRiskLevel(value: unknown) {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'low') return 'LOW'
  if (normalized === 'medium') return 'MEDIUM'
  if (normalized === 'high') return 'HIGH'
  return 'MEDIUM'
}

function normalizeScore(value: unknown) {
  return Math.round(clamp(Number(value ?? 0), 0, 100))
}

function emptyForm() {
  return { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 }
}

function logAnalysisV2Breakdown({ match, confidence, riskLevel, recommendation, modules }: any) {
  console.info('football-analysis-v2-breakdown', {
    providerMatchId: match.id,
    homeTeam: match.homeTeam?.name ?? null,
    awayTeam: match.awayTeam?.name ?? null,
    moduleScores: modules,
    confidence,
    riskLevel,
    recommendation,
  })
}

function buildAnalysisSummaryV2Legacy(match: any, confidence: number, riskLevel: string, recommendation: string, breakdown: any) {
  const summaryHome = match.homeTeam?.name ?? 'ทีมเหย้า'
  const summaryAway = match.awayTeam?.name ?? 'ทีมเยือน'
  const summaryModules = [
    { label: 'Team Strength', score: breakdown.team_strength.score },
    { label: 'Recent Form', score: breakdown.recent_form.score },
    { label: 'Attack Quality', score: breakdown.attack_quality.score },
    { label: 'Defensive Stability', score: breakdown.defensive_stability.score },
    { label: 'Home/Away Advantage', score: breakdown.home_away_advantage.score },
    { label: 'Motivation & Context', score: breakdown.motivation_context.score },
    { label: 'Market & Odds Risk', score: breakdown.market_odds_risk.score },
  ]
  const bestModule = [...summaryModules].sort((a, b) => b.score - a.score)[0]
  const weakestModule = [...summaryModules].sort((a, b) => a.score - b.score)[0]
  const riskReason = breakdown.overall_risk.reason

  if (recommendation === 'BET') {
    return `${summaryHome} พบ ${summaryAway}: คะแนนรวม ${confidence}/100 เข้าระดับ BET เพราะ ${bestModule.label} เด่น (${bestModule.score}/100) และ risk_level เป็น ${riskLevel}. ${riskReason}`
  }
  if (recommendation === 'LEAN') {
    return `${summaryHome} พบ ${summaryAway}: คะแนนรวม ${confidence}/100 เหมาะเป็น LEAN มากกว่า BET จุดหนุนหลักคือ ${bestModule.label} (${bestModule.score}/100) แต่ ${weakestModule.label} ยังถ่วงอยู่ (${weakestModule.score}/100). ${riskReason}`
  }
  return `${summaryHome} พบ ${summaryAway}: คะแนนรวม ${confidence}/100 ยังเป็น NO BET แม้มีจุดเด่นที่ ${bestModule.label} (${bestModule.score}/100) แต่ ${weakestModule.label} ยังไม่สนับสนุนพอ (${weakestModule.score}/100). ${riskReason}`

  const modules: Record<string, number> = {}
  const home = match.homeTeam?.name ?? 'ทีมเหย้า'
  const away = match.awayTeam?.name ?? 'ทีมเยือน'
  const topModule = Object.entries(modules).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'teamStrength'
  const moduleText: Record<string, string> = {
    teamStrength: 'ความแข็งแรงทีม',
    recentForm: 'ฟอร์ม 5 นัดหลัง',
    homeAdvantage: 'ความได้เปรียบในบ้าน',
    awayWeakness: 'จุดอ่อนทีมเยือน',
    goalScoring: 'ศักยภาพการทำประตู',
    defensiveStability: 'ความมั่นคงเกมรับ',
    motivation: 'แรงจูงใจและความสำคัญรายการ',
    marketRisk: 'ความเสี่ยงตลาด',
  }

  return `${home} พบ ${away}: Football Master Framework ให้คะแนน ${confidence}/100 คำแนะนำ ${getRecommendationFromConfidence(confidence, riskLevel)} จุดเด่นคือ${moduleText[topModule]} และ risk_level เป็น ${riskLevel}`
}

function calculateDataIntelligence(match: any, context: any = {}) {
  const leaguePosition = calculateLeaguePositionData(match)
  const recentForm = calculateRecentFormData(context.homeForm, context.awayForm)
  const homeAwayForm = calculateHomeAwayFormData(match)
  const headToHead = calculateHeadToHeadData(match, context)
  const strengthOfSchedule = calculateStrengthOfScheduleData(context.recentOpponents)
  const goalStatistics = calculateGoalStatisticsData(context.homeForm, context.awayForm)
  const sections: any = {
    league_position: leaguePosition,
    recent_form: recentForm,
    home_away_form: homeAwayForm,
    head_to_head: headToHead,
    strength_of_schedule: strengthOfSchedule,
    goal_statistics: goalStatistics,
  }
  const dataConfidence = calculateDataConfidenceScore(sections)
  const modifier = calculateDataIntelligenceModifier({ ...sections, data_confidence: dataConfidence }, context.baseConfidence, context.footballModifier)

  return { ...sections, data_confidence: dataConfidence, consistency: calculateDataConsistency(sections), modifier }
}

function calculateLeaguePositionData(match: any) {
  const standings = match.standings ?? []
  const homeStanding = findStanding(standings, getTeamId(match.homeTeam))
  const awayStanding = findStanding(standings, getTeamId(match.awayTeam))
  if (!homeStanding || !awayStanding) return { score: 58, confidence: 'low', home_rank: null, away_rank: null, point_gap: null, goal_difference_gap: null, edge: 'unknown', reason: 'ยังไม่มีข้อมูลอันดับลีกเพียงพอ' }

  const homeRank = Number(homeStanding.position ?? 0)
  const awayRank = Number(awayStanding.position ?? 0)
  const pointGap = Number(homeStanding.points ?? 0) - Number(awayStanding.points ?? 0)
  const goalDiffGap = Number(homeStanding.goalDifference ?? 0) - Number(awayStanding.goalDifference ?? 0)
  const score = Math.round(clamp(58 + (awayRank - homeRank) * 1.8 + pointGap * 0.45 + goalDiffGap * 0.35, 35, 85))
  return { score, confidence: 'high', home_rank: homeRank || null, away_rank: awayRank || null, point_gap: pointGap, goal_difference_gap: goalDiffGap, edge: score >= 62 ? 'home' : score <= 54 ? 'away' : 'none', reason: `อันดับลีกจริง เจ้าบ้านอันดับ ${homeRank || '-'} ทีมเยือนอันดับ ${awayRank || '-'} แต้มต่าง ${pointGap} และประตูได้เสียต่าง ${goalDiffGap}` }
}

function calculateRecentFormData(homeForm: any, awayForm: any) {
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return { score: 58, confidence: 'low', home: emptyDataForm(), away: emptyDataForm(), trend: 'unknown', reason: 'ข้อมูลฟอร์มล่าสุดยังจำกัด' }

  const score = Math.round(clamp(56 + (formPoints(homeForm) - formPoints(awayForm)) * 1.4 + (formGoalDiff(homeForm) - formGoalDiff(awayForm)) * 1.2, 35, 82))
  return { score, confidence: played >= 8 ? 'high' : played >= 4 ? 'medium' : 'low', home: summarizeDataForm(homeForm), away: summarizeDataForm(awayForm), trend: score >= 63 ? 'positive' : score <= 49 ? 'negative' : 'neutral', reason: `ฟอร์มล่าสุดมีข้อมูลจริง ${played} นัด เจ้าบ้าน ${formatDataForm(homeForm)} ทีมเยือน ${formatDataForm(awayForm)}` }
}

function calculateHomeAwayFormData(match: any) {
  const venueData = match.homeAwayForm ?? match.venueForm ?? {}
  const homeForm = venueData.home ?? match.homeHomeForm
  const awayForm = venueData.away ?? match.awayAwayForm
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return { score: 58, confidence: 'low', home_win_rate: null, away_win_rate: null, home: emptyDataForm(), away: emptyDataForm(), advantage: 'unknown', reason: 'ฟอร์มเหย้า/เยือนยังไม่ชัด' }

  const homeRate = Number(homeForm?.played ?? 0) ? Number(homeForm?.wins ?? 0) / Number(homeForm?.played ?? 1) : null
  const awayRate = Number(awayForm?.played ?? 0) ? Number(awayForm?.wins ?? 0) / Number(awayForm?.played ?? 1) : null
  const score = Math.round(clamp(57 + ((homeRate ?? 0.4) - (awayRate ?? 0.35)) * 28 + (formGoalDiff(homeForm) - formGoalDiff(awayForm)) * 0.9, 35, 82))
  return { score, confidence: played >= 8 ? 'high' : 'medium', home_win_rate: homeRate === null ? null : Math.round(homeRate * 100), away_win_rate: awayRate === null ? null : Math.round(awayRate * 100), home: summarizeDataForm(homeForm), away: summarizeDataForm(awayForm), advantage: score >= 63 ? 'home' : score <= 51 ? 'away' : 'none', reason: `ใช้ข้อมูลเหย้า/เยือนจริง advantage ${score >= 63 ? 'home' : score <= 51 ? 'away' : 'none'}` }
}

function calculateHeadToHeadData(match: any, context: any) {
  const matches = getH2HMatches(match, context)
  if (!matches.length) return { score: 58, confidence: 'low', matches_count: 0, home_wins: 0, away_wins: 0, draws: 0, goals_average: null, reason: 'ไม่มี H2H เพียงพอ' }

  const summary = summarizeH2H(matches.slice(0, 10), getTeamId(match.homeTeam), getTeamId(match.awayTeam))
  return { score: Math.round(clamp(56 + (summary.homeWins - summary.awayWins) * 3 + Math.min(summary.played, 5), 42, 78)), confidence: summary.played >= 8 ? 'high' : summary.played >= 4 ? 'medium' : 'low', matches_count: summary.played, home_wins: summary.homeWins, away_wins: summary.awayWins, draws: summary.draws, goals_average: summary.played ? Math.round((summary.goals / summary.played) * 100) / 100 : null, reason: `H2H มีข้อมูลจริง ${summary.played} นัด เจ้าบ้านชนะ ${summary.homeWins} เสมอ ${summary.draws} ทีมเยือนชนะ ${summary.awayWins}` }
}

function calculateStrengthOfScheduleData(recentOpponents: any) {
  const ranks = flattenRecentOpponents(recentOpponents).map((item: any) => Number(item.opponent?.position ?? item.position ?? item.rank ?? 0)).filter((rank: number) => rank > 0)
  if (!ranks.length) return { score: 58, confidence: 'low', average_opponent_rank: null, difficulty: 'unknown', reason: 'ยังไม่มีข้อมูลคุณภาพคู่แข่ง 3-5 นัดล่าสุดเพียงพอ' }

  const average = ranks.reduce((total: number, rank: number) => total + rank, 0) / ranks.length
  const difficulty = average <= 6 ? 'hard' : average >= 14 ? 'easy' : 'medium'
  return { score: difficulty === 'hard' ? 55 : difficulty === 'easy' ? 62 : 58, confidence: ranks.length >= 6 ? 'high' : ranks.length >= 3 ? 'medium' : 'low', average_opponent_rank: Math.round(average * 100) / 100, difficulty, reason: `คู่แข่งล่าสุดมีอันดับเฉลี่ย ${Math.round(average * 100) / 100} ระดับความยาก ${difficulty}` }
}

function calculateGoalStatisticsData(homeForm: any, awayForm: any) {
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return { score: 58, confidence: 'low', average_goals_scored: null, average_goals_conceded: null, clean_sheet_rate: null, btts_rate: null, over_2_5_rate: null, reason: 'สถิติประตูยังจำกัด และไม่สร้างค่า xG เอง' }

  const goalsFor = Number(homeForm?.goals_for ?? 0) + Number(awayForm?.goals_for ?? 0)
  const goalsAgainst = Number(homeForm?.goals_against ?? 0) + Number(awayForm?.goals_against ?? 0)
  const cleanSheets = Number(homeForm?.clean_sheets ?? 0) + Number(awayForm?.clean_sheets ?? 0)
  const averageFor = goalsFor / played
  const averageAgainst = goalsAgainst / played
  return { score: Math.round(clamp(52 + averageFor * 10 - averageAgainst * 5 + (cleanSheets / played) * 8, 35, 84)), confidence: played >= 8 ? 'high' : played >= 4 ? 'medium' : 'low', average_goals_scored: Math.round(averageFor * 100) / 100, average_goals_conceded: Math.round(averageAgainst * 100) / 100, clean_sheet_rate: Math.round((cleanSheets / played) * 100), btts_rate: null, over_2_5_rate: null, reason: `สถิติประตูจากข้อมูลจริง ${played} นัด ยิงเฉลี่ย ${Math.round(averageFor * 100) / 100} เสียเฉลี่ย ${Math.round(averageAgainst * 100) / 100}` }
}

function calculateDataConfidenceScore(sections: any) {
  const keys = ['league_position', 'recent_form', 'home_away_form', 'head_to_head', 'strength_of_schedule', 'goal_statistics']
  const available = keys.filter((key) => {
    const item = sections[key]
    if (key === 'league_position') return item.confidence !== 'low' && item.home_rank !== null && item.away_rank !== null
    if (key === 'recent_form') return item.confidence !== 'low' && Number(item.home?.played ?? 0) + Number(item.away?.played ?? 0) > 0
    if (key === 'home_away_form') return item.confidence !== 'low' && item.advantage !== 'unknown'
    if (key === 'head_to_head') return item.confidence !== 'low' && Number(item.matches_count ?? 0) > 0
    if (key === 'strength_of_schedule') return item.confidence !== 'low' && item.difficulty !== 'unknown'
    return item.confidence !== 'low' && item.average_goals_scored !== null
  })
  const missing = keys.filter((key) => !available.includes(key))
  const score = Math.round((available.length / keys.length) * 100)
  const level = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low'
  return { score, level, available, missing, reason: `ข้อมูลจริงพร้อมใช้ ${available.length}/${keys.length} หมวด ระดับ ${level}` }
}

function calculateDataIntelligenceModifier(data: any, baseConfidence = 0, footballModifier = 0) {
  const keys = ['league_position', 'recent_form', 'home_away_form', 'head_to_head', 'strength_of_schedule', 'goal_statistics']
  const scores = keys.map((key) => Number(data[key]?.score ?? 58))
  const average = scores.reduce((total, score) => total + score, 0) / scores.length
  const lowConfidenceCount = keys.filter((key) => data[key]?.confidence === 'low' || data[key]?.level === 'low').length
  let modifier = (average - 58) * 0.12
  if (data.recent_form?.trend === 'positive') modifier += 1.5
  if (data.recent_form?.trend === 'negative') modifier -= 1.5
  if (Number(data.goal_statistics?.score ?? 0) >= 64 && data.goal_statistics?.confidence !== 'low') modifier += 1
  if (data.head_to_head?.confidence !== 'low' && Number(data.head_to_head?.score ?? 0) >= 61) modifier += 1
  if (Number(data.data_confidence?.score ?? 0) < 35) modifier -= 2.5
  else if (Number(data.data_confidence?.score ?? 0) < 60) modifier -= 1
  modifier -= Math.min(3, lowConfidenceCount * 0.35)
  const positiveCap = baseConfidence && baseConfidence < 75 ? Math.max(0, 74 - baseConfidence - Number(footballModifier ?? 0)) : 10
  const total = Number(footballModifier ?? 0) + modifier
  return Math.round(clamp(clamp(total, -10, positiveCap) - Number(footballModifier ?? 0), -10, 10))
}

function getCombinedIntelligenceModifier(baseConfidence: number, footballModifier: number, dataIntelligenceModifier: number) {
  const positiveCap = baseConfidence && baseConfidence < 75 ? Math.max(0, 74 - baseConfidence) : 10
  return Math.round(clamp(Number(footballModifier ?? 0) + Number(dataIntelligenceModifier ?? 0), -10, positiveCap))
}

function calculateDataConsistency(sections: any) {
  const scores = ['league_position', 'recent_form', 'home_away_form', 'head_to_head', 'strength_of_schedule', 'goal_statistics'].map((key) => Number(sections[key]?.score ?? 0)).filter(Boolean)
  if (scores.length < 2) return 58
  const average = scores.reduce((total, score) => total + score, 0) / scores.length
  return Math.round(clamp(100 - (Math.max(...scores) - Math.min(...scores)) * 1.1 - Math.abs(average - 58) * 0.15, 30, 100))
}

function summarizeDataForm(form: any) {
  return { played: Number(form?.played ?? 0), wins: Number(form?.wins ?? 0), draws: Number(form?.draws ?? 0), losses: Number(form?.losses ?? 0), goals_for: Number(form?.goals_for ?? 0), goals_against: Number(form?.goals_against ?? 0), clean_sheets: Number(form?.clean_sheets ?? 0) }
}

function emptyDataForm() {
  return summarizeDataForm({})
}

function formatDataForm(form: any) {
  return `${Number(form?.wins ?? 0)}-${Number(form?.draws ?? 0)}-${Number(form?.losses ?? 0)}`
}

function calculateFootballIntelligence(match: any, context: any = {}) {
  const h2h = calculateH2HIntelligence(match, context)
  const leagueContext = calculateLeagueContext(match)
  const restDays = calculateRestDays(match, context.recentMatches)
  const scheduleDifficulty = calculateScheduleDifficulty(context.recentOpponents)
  const squadContext = calculateSquadContext(match, context.squadData)
  const momentum = calculateMomentum({ home: context.homeForm, away: context.awayForm })
  const matchImportance = calculateMatchImportance(match)
  const intelligence = {
    h2h,
    league_context: leagueContext,
    rest_days: restDays,
    schedule_difficulty: scheduleDifficulty,
    squad_context: squadContext,
    momentum,
    match_importance: matchImportance,
  }
  const modifier = calculateIntelligenceModifier(intelligence, context.baseConfidence)
  const signals = collectIntelligenceSignals(intelligence)

  return {
    ...intelligence,
    ai_explanation: {
      summary: buildFootballIntelligenceExplanation(intelligence, modifier),
      signals,
      data_confidence: getIntelligenceDataConfidence(intelligence),
    },
    modifier,
    signals,
  }
}

function calculateH2HIntelligence(match: any, context: any = {}) {
  const h2hMatches = getH2HMatches(match, context)
  if (!h2hMatches.length) {
    return { score: 58, confidence: 'low', reason: 'ยังไม่มีข้อมูล H2H เพียงพอ', signals: ['missing_h2h'] }
  }

  const latest10 = h2hMatches.slice(0, 10)
  const latest5 = latest10.slice(0, 5)
  const homeId = getTeamId(match.homeTeam)
  const awayId = getTeamId(match.awayTeam)
  const samples = summarizeH2H(latest10, homeId, awayId)
  const homeAwaySamples = latest10.filter((item: any) => getTeamId(item.homeTeam) === homeId && getTeamId(item.awayTeam) === awayId)
  const goalsAverage = samples.played ? (samples.goals / samples.played).toFixed(2) : null
  const confidence = latest10.length >= 8 ? 'high' : latest10.length >= 4 ? 'medium' : 'low'
  const signals = [
    `h2h_${latest5.length}_of_5_available`,
    `h2h_${latest10.length}_of_10_available`,
    homeAwaySamples.length ? `home_away_history_${homeAwaySamples.length}` : 'home_away_history_limited',
  ]
  if (goalsAverage) signals.push(`h2h_goals_avg_${goalsAverage}`)

  return {
    score: Math.round(clamp(56 + (samples.homeWins - samples.awayWins) * 3 + Math.min(latest5.length, 5), 45, 76)),
    confidence,
    reason: `H2H มีข้อมูลจริง ${latest10.length} นัดล่าสุด เจ้าบ้านชนะ ${samples.homeWins} เสมอ ${samples.draws} ทีมเยือนชนะ ${samples.awayWins}${goalsAverage ? ` ค่าเฉลี่ยประตู ${goalsAverage}` : ''}`,
    signals,
  }
}

function calculateLeagueContext(match: any) {
  const type = classifyCompetition(getCompetitionText(match))
  const byType: Record<string, any> = {
    league: { score: 62, risk_modifier: -1, reason: 'รายการลีกมีบริบทต่อเนื่องและประเมินเสถียรกว่า' },
    cup: { score: 58, risk_modifier: 2, reason: 'รายการถ้วยมีแรงจูงใจสูง แต่ความผันผวนมากขึ้น' },
    friendly: { score: 52, risk_modifier: 3, reason: 'เกมกระชับมิตรมีความเสี่ยงจากการทดลองทีมและแรงจูงใจต่ำกว่า' },
    international: { score: 57, risk_modifier: 1, reason: 'เกมทีมชาติมีบริบทเฉพาะและข้อมูลสโมสรใช้ได้จำกัด' },
    youth: { score: 53, risk_modifier: 2, reason: 'รายการเยาวชนมีความนิ่งของข้อมูลต่ำกว่ารายการหลัก' },
    women: { score: 54, risk_modifier: 2, reason: 'รายการหญิงอาจมี coverage ข้อมูลน้อยกว่ารายการหลัก' },
    unknown: { score: 58, risk_modifier: 0, reason: 'ยังจำแนกประเภทการแข่งขันไม่ได้ชัด จึงให้ค่ากลาง' },
  }

  return { type, ...byType[type] }
}

function calculateRestDays(match: any, recentMatches: any) {
  const homeRestDays = getRestDays(match, getTeamRecentMatches(recentMatches, 'home'))
  const awayRestDays = getRestDays(match, getTeamRecentMatches(recentMatches, 'away'))

  if (homeRestDays === null && awayRestDays === null) {
    return { home_rest_days: null, away_rest_days: null, score: 58, advantage: 'none', reason: 'ยังไม่มีข้อมูลวันพักทีมล่าสุด' }
  }

  const diff = (homeRestDays ?? 0) - (awayRestDays ?? 0)
  const advantage = Math.abs(diff) >= 2 ? (diff > 0 ? 'home' : 'away') : 'none'

  return {
    home_rest_days: homeRestDays,
    away_rest_days: awayRestDays,
    score: Math.round(clamp(58 + scoreRestDays(homeRestDays) - scoreRestDays(awayRestDays), 45, 72)),
    advantage,
    reason: `วันพักล่าสุด เจ้าบ้าน ${formatRestDays(homeRestDays)} ทีมเยือน ${formatRestDays(awayRestDays)} ภาพรวมได้เปรียบ: ${advantage}`,
  }
}

function calculateScheduleDifficulty(recentOpponents: any) {
  const opponents = flattenRecentOpponents(recentOpponents)
  const rated = opponents.map(getOpponentDifficulty).filter((value: number | null) => value !== null)

  if (!rated.length) {
    return { score: 58, difficulty: 'unknown', reason: 'ยังไม่มีข้อมูลคุณภาพคู่แข่ง 3-5 นัดล่าสุดเพียงพอ', confidence: 'low' }
  }

  const average = rated.reduce((total: number, value: number | null) => total + Number(value ?? 0), 0) / rated.length
  const difficulty = average >= 68 ? 'hard' : average <= 42 ? 'easy' : 'medium'

  return {
    score: difficulty === 'hard' ? 54 : difficulty === 'easy' ? 62 : 58,
    difficulty,
    reason: `ประเมินความยากคู่แข่งล่าสุดจากข้อมูลจริง ${rated.length} รายการ ระดับ ${difficulty}`,
    confidence: rated.length >= 6 ? 'high' : rated.length >= 3 ? 'medium' : 'low',
  }
}

function calculateSquadContext(match: any, squadData: any) {
  const data = squadData ?? match.squadData
  if (!data || (Array.isArray(data) && !data.length)) {
    return { score: 58, confidence: 'low', reason: 'ยังไม่มีข้อมูลตัวผู้เล่น/อาการบาดเจ็บเพียงพอ', signals: ['missing_squad_data'] }
  }

  const injuries = countItems(data.injuries ?? data.injury)
  const suspensions = countItems(data.suspensions ?? data.suspension)
  const missingKeyPlayers = countItems(data.missing_key_players ?? data.missingKeyPlayers)
  const rotationRisk = Boolean(data.rotation || data.rotation_risk)
  const penalty = injuries * 1.5 + suspensions * 2 + missingKeyPlayers * 3 + (rotationRisk ? 3 : 0)
  const signals = []
  if (injuries) signals.push(`injuries_${injuries}`)
  if (suspensions) signals.push(`suspensions_${suspensions}`)
  if (missingKeyPlayers) signals.push(`missing_key_players_${missingKeyPlayers}`)
  if (rotationRisk) signals.push('rotation_risk')

  return {
    score: Math.round(clamp(62 - penalty, 35, 68)),
    confidence: signals.length ? 'medium' : 'low',
    reason: signals.length ? 'มีข้อมูล squad จริงบางส่วนและนำมาหักความเสี่ยงตามผลกระทบ' : 'มีข้อมูล squad แต่ยังไม่พบสัญญาณผู้เล่นสำคัญชัดเจน',
    signals,
  }
}

function calculateMomentum(formData: any) {
  const homeForm = formData?.home
  const awayForm = formData?.away
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)

  if (!played) {
    return { score: 56, momentum: 'unknown', signals: ['missing_detailed_form'], reason: 'ยังไม่มีข้อมูลโมเมนตัมละเอียด จึงไม่เดาเพิ่มจากข้อมูลที่ไม่มี' }
  }

  const pointsRate = ((formPoints(homeForm) + formPoints(awayForm)) / Math.max(played * 3, 1)) * 100
  const goalsPerMatch = (Number(homeForm?.goals_for ?? 0) + Number(awayForm?.goals_for ?? 0)) / Math.max(played, 1)
  const concededPerMatch = (Number(homeForm?.goals_against ?? 0) + Number(awayForm?.goals_against ?? 0)) / Math.max(played, 1)
  const cleanSheets = Number(homeForm?.clean_sheets ?? 0) + Number(awayForm?.clean_sheets ?? 0)
  const signals = []
  if (goalsPerMatch >= 1.5) signals.push('scoring_trend_positive')
  if (concededPerMatch >= 1.7) signals.push('conceding_trend_risky')
  if (cleanSheets >= 3) signals.push('clean_sheet_support')
  const score = Math.round(clamp(44 + pointsRate * 0.35 + goalsPerMatch * 6 - concededPerMatch * 4 + cleanSheets * 1.5, 35, 78))

  return {
    score,
    momentum: score >= 63 ? 'positive' : score <= 49 ? 'negative' : 'neutral',
    signals: signals.length ? signals : ['form_proxy_used'],
    reason: 'ใช้ข้อมูล goals/form จาก v2 เป็น proxy โดยไม่เดาสถิติที่ยังไม่มี',
  }
}

function calculateMatchImportance(match: any) {
  const text = `${getCompetitionText(match)} ${match.round ?? ''} ${match.stage ?? ''} ${match.group ?? ''}`.toLowerCase()
  const leagueContext = calculateLeagueContext(match)
  const knockout = ['final', 'semi', 'quarter', 'last 16', 'last_16', 'playoff', 'knockout'].some((item) => text.includes(item))

  if (leagueContext.type === 'friendly') return { score: 50, importance: 'low', risk_modifier: 2, reason: 'Friendly มีความสำคัญเชิงผลการแข่งขันต่ำกว่า' }
  if (knockout) return { score: 64, importance: 'high', risk_modifier: 2, reason: 'รอบน็อกเอาต์/รอบลึกมีความสำคัญสูง แต่ variance สูงขึ้น' }
  if (leagueContext.type === 'league') return { score: 59, importance: 'medium', risk_modifier: -1, reason: 'เกมลีกปกติมีแรงจูงใจและรูปแบบค่อนข้างเสถียร' }
  return { score: 58, importance: leagueContext.type === 'unknown' ? 'unknown' : 'medium', risk_modifier: leagueContext.risk_modifier > 0 ? 1 : 0, reason: 'ยังไม่มี league table context เพียงพอ จึงไม่สรุป must-win เอง' }
}

function calculateIntelligenceModifier(intelligence: any, baseConfidence = 0) {
  const scores = [
    intelligence.h2h.score,
    intelligence.league_context.score,
    intelligence.rest_days.score,
    intelligence.schedule_difficulty.score,
    intelligence.squad_context.score,
    intelligence.momentum.score,
    intelligence.match_importance.score,
  ]
  const averageScore = scores.reduce((total, score) => total + Number(score ?? 0), 0) / scores.length
  const riskModifier = Number(intelligence.league_context.risk_modifier ?? 0) + Number(intelligence.match_importance.risk_modifier ?? 0)
  const lowConfidencePenalty = [intelligence.h2h, intelligence.schedule_difficulty, intelligence.squad_context].filter((item) => item.confidence === 'low').length * 0.4
  const rawModifier = (averageScore - 58) * 0.22 - riskModifier * 0.8 - lowConfidencePenalty
  const highConfidenceSupport = [intelligence.h2h, intelligence.schedule_difficulty, intelligence.squad_context].filter((item) => ['medium', 'high'].includes(item.confidence)).length
  const positiveCap = baseConfidence && baseConfidence < 73 ? 2 : highConfidenceSupport >= 2 ? 6 : 4

  return Math.round(clamp(rawModifier, -6, positiveCap))
}

function calculateOverallRisk(breakdown: any, confidence: number, dataCompleteness: number, intelligence: any) {
  const scores = [
    breakdown.team_strength.score,
    breakdown.recent_form.score,
    breakdown.attack_quality.score,
    breakdown.defensive_stability.score,
    breakdown.home_away_advantage.score,
    breakdown.away_weakness.score,
    breakdown.motivation_context.score,
    breakdown.market_odds_risk.score,
  ]
  const spread = Math.max(...scores) - Math.min(...scores)
  const weakCore = ['team_strength', 'recent_form', 'attack_quality', 'defensive_stability'].filter((key) => breakdown[key].score < 45).length
  const marketRiskWeak = breakdown.market_odds_risk.score < 45
  const marketDataMissing = breakdown.market_odds_risk.has_market_data === false
  const leagueType = intelligence?.league_context?.type
  const dataConfidence = intelligence?.ai_explanation?.data_confidence ?? getIntelligenceDataConfidence(intelligence)
  const totalRiskModifier = Number(intelligence?.league_context?.risk_modifier ?? 0) + Number(intelligence?.match_importance?.risk_modifier ?? 0)
  const lowConfidenceSignals = [intelligence?.h2h, intelligence?.schedule_difficulty, intelligence?.squad_context].filter((item) => item?.confidence === 'low').length

  if (confidence < 48 || weakCore >= 2 || spread >= 42 || marketRiskWeak || (leagueType === 'friendly' && dataConfidence === 'low') || (totalRiskModifier >= 4 && confidence < 68) || (marketDataMissing && confidence < 50)) {
    return { level: 'HIGH', reason: 'คะแนนสำคัญอ่อน/ขัดแย้ง หรือบริบทการแข่งขันมี variance สูง จึงจัดเป็นความเสี่ยงสูง' }
  }
  if (!marketDataMissing && confidence >= 72 && dataCompleteness >= 70 && spread <= 28 && totalRiskModifier <= 1 && lowConfidenceSignals <= 1) {
    return { level: 'LOW', reason: 'หลายโมดูลให้ภาพสอดคล้องกัน ข้อมูลรองรับค่อนข้างครบ และ risk modifier ต่ำ' }
  }
  return {
    level: 'MEDIUM',
    reason: marketDataMissing
      ? 'ข้อมูลตลาดยังจำกัด จึงคุมความเสี่ยงไว้ระดับกลางและหลีกเลี่ยง BET เว้นแต่คะแนนฝั่งฟุตบอลแข็งมาก'
      : 'ข้อมูลยังไม่ครบทุกมิติ แต่ไม่มีสัญญาณอันตรายชัด จึงคงความเสี่ยงระดับกลาง',
  }
}

function buildAnalysisSummary(match: any, confidence: number, riskLevel: string, recommendation: string, breakdown: any) {
  const summaryModules = [
    { label: 'Team Strength', score: breakdown.team_strength.score },
    { label: 'Recent Form', score: breakdown.recent_form.score },
    { label: 'Home Advantage', score: breakdown.home_away_advantage.score },
    { label: 'Away Weakness', score: breakdown.away_weakness.score },
    { label: 'Goal Scoring', score: breakdown.attack_quality.score },
    { label: 'Defensive Stability', score: breakdown.defensive_stability.score },
    { label: 'Motivation & Context', score: breakdown.motivation_context.score },
    { label: 'Market Risk', score: breakdown.market_odds_risk.score },
  ]
  const bestModule = [...summaryModules].sort((a, b) => b.score - a.score)[0]
  const weakestModule = [...summaryModules].sort((a, b) => a.score - b.score)[0]
  const marketMissing = breakdown.market_odds_risk?.has_market_data === false
  const riskText = riskLevel === 'LOW' ? 'ต่ำ' : riskLevel === 'HIGH' ? 'สูง' : 'กลาง'
  const marketText = marketMissing ? ' ข้อมูลตลาดยังจำกัด จึงไม่ควรไล่ราคาแรง' : ''
  const caution = recommendation === 'BET'
    ? 'ยังควรเช็กไลน์อัปและราคาใกล้แข่งก่อนเข้า'
    : recommendation === 'LEAN'
      ? 'เหมาะติดตามหรือรอราคานิ่งมากกว่า BET เต็มตัว'
      : 'ควรข้ามหรือรอข้อมูลใหม่ก่อน'

  return `แนะนำ ${recommendation} เพราะความมั่นใจ ${confidence}/100 และความเสี่ยงระดับ${riskText}. จุดหนุนคือ ${bestModule.label} ${bestModule.score}/100 แต่ความเสี่ยงหลักอยู่ที่ ${weakestModule.label} ${weakestModule.score}/100.${marketText} ${caution}`
}

function logFootballIntelligenceV3({ match, baseConfidence, footballModifier, dataIntelligenceModifier, intelligenceModifier, confidence, riskLevel, recommendation, modules, intelligenceSignals }: any) {
  console.info(systemVersions.decision_model_version, {
    providerMatchId: match.id,
    homeTeam: match.homeTeam?.name ?? null,
    awayTeam: match.awayTeam?.name ?? null,
    baseConfidence,
    footballModifier,
    dataIntelligenceModifier,
    intelligenceModifier,
    finalConfidence: confidence,
    riskLevel,
    recommendation,
    moduleScores: modules,
    intelligenceSignals,
  })
}

function buildFootballIntelligenceExplanation(intelligence: any, modifier: number) {
  return `v3 ประเมินบริบทเป็น ${intelligence.league_context.type}, momentum ${intelligence.momentum.momentum}, H2H confidence ${intelligence.h2h.confidence}, squad confidence ${intelligence.squad_context.confidence}; modifier ${formatSigned(modifier)}`
}

function buildContextSummary(intelligence: any) {
  const parts = [
    `บริบทการแข่งขันเป็น ${intelligence?.league_context?.type ?? 'unknown'}`,
    `โมเมนตัม ${intelligence?.momentum?.momentum ?? 'unknown'}`,
  ]
  if (intelligence?.h2h?.confidence === 'low') parts.push('ข้อมูล H2H ยังจำกัด')
  if (intelligence?.squad_context?.confidence === 'low') parts.push('ข้อมูลตัวผู้เล่นยังจำกัด')
  if (Number(intelligence?.match_importance?.risk_modifier ?? 0) > 0) parts.push('รายการมีความผันผวนเพิ่มขึ้น')
  return parts.join(', ')
}

function collectIntelligenceSignals(intelligence: any) {
  return [
    ...(intelligence?.h2h?.signals ?? []),
    ...(intelligence?.squad_context?.signals ?? []),
    ...(intelligence?.momentum?.signals ?? []),
    `league_${intelligence?.league_context?.type ?? 'unknown'}`,
    `importance_${intelligence?.match_importance?.importance ?? 'unknown'}`,
    `schedule_${intelligence?.schedule_difficulty?.difficulty ?? 'unknown'}`,
    `rest_advantage_${intelligence?.rest_days?.advantage ?? 'none'}`,
  ]
}

function getIntelligenceDataConfidence(intelligence: any) {
  const confidenceValues = [intelligence?.h2h, intelligence?.schedule_difficulty, intelligence?.squad_context]
    .map((item) => item?.confidence)
    .filter(Boolean)
  const highOrMedium = confidenceValues.filter((value) => ['medium', 'high'].includes(value)).length
  if (highOrMedium >= 3) return 'high'
  if (highOrMedium >= 2) return 'medium'
  return 'low'
}

function getH2HMatches(match: any, context: any) {
  const candidates = [
    context.h2hMatches,
    context.h2h?.matches,
    context.h2h,
    match.h2h?.matches,
    match.head_to_head,
  ]
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length) ?? []
}

function summarizeH2H(matches: Array<any>, homeId: number, awayId: number) {
  return matches.reduce(
    (total, item) => {
      const homeGoals = item.score?.fullTime?.home ?? item.home_goals ?? item.homeGoals
      const awayGoals = item.score?.fullTime?.away ?? item.away_goals ?? item.awayGoals
      if (homeGoals === null || homeGoals === undefined || awayGoals === null || awayGoals === undefined) return total
      const itemHomeId = getTeamId(item.homeTeam)
      const itemAwayId = getTeamId(item.awayTeam)
      const homeSideGoals = itemHomeId === homeId ? homeGoals : itemAwayId === homeId ? awayGoals : null
      const awaySideGoals = itemAwayId === awayId ? awayGoals : itemHomeId === awayId ? homeGoals : null
      if (homeSideGoals === null || awaySideGoals === null) return total
      total.played += 1
      total.goals += Number(homeGoals ?? 0) + Number(awayGoals ?? 0)
      if (homeSideGoals > awaySideGoals) total.homeWins += 1
      else if (homeSideGoals < awaySideGoals) total.awayWins += 1
      else total.draws += 1
      return total
    },
    { played: 0, goals: 0, homeWins: 0, awayWins: 0, draws: 0 },
  )
}

function classifyCompetition(name: string) {
  const text = String(name ?? '').toLowerCase()
  if (!text) return 'unknown'
  if (['women', 'womens', 'feminine'].some((item) => text.includes(item))) return 'women'
  if (['u17', 'u18', 'u19', 'u20', 'u21', 'u23', 'youth'].some((item) => text.includes(item))) return 'youth'
  if (['friendly', 'friendlies'].some((item) => text.includes(item))) return 'friendly'
  if (['world cup', 'euro', 'nations league', 'afcon', 'copa america', 'international'].some((item) => text.includes(item))) return 'international'
  if (['cup', 'trophy', 'knockout', 'playoff', 'play-off'].some((item) => text.includes(item))) return 'cup'
  if (['league', 'division', 'serie', 'liga', 'bundesliga', 'premier', 'championship'].some((item) => text.includes(item))) return 'league'
  return 'unknown'
}

function getCompetitionText(match: any) {
  return [match.competition?.name, match.league?.name, match.name].filter(Boolean).join(' ')
}

function getTeamRecentMatches(recentMatches: any, side: string) {
  if (!recentMatches) return []
  if (Array.isArray(recentMatches)) return recentMatches
  return recentMatches[side] ?? recentMatches[`${side}Matches`] ?? []
}

function getRestDays(match: any, recentMatches: Array<any>) {
  if (!Array.isArray(recentMatches) || !recentMatches.length) return null
  const matchTime = new Date(match.utcDate ?? match.kickoff_at ?? match.kickoffAt ?? Date.now()).getTime()
  const previous = recentMatches
    .map((item) => new Date(item.utcDate ?? item.kickoff_at ?? item.kickoffAt ?? item.date ?? 0).getTime())
    .filter((time) => Number.isFinite(time) && time > 0 && time < matchTime)
    .sort((a, b) => b - a)[0]
  if (!previous) return null
  return Math.max(0, Math.floor((matchTime - previous) / 86400000))
}

function scoreRestDays(days: number | null) {
  if (days === null) return 0
  if (days <= 2) return -5
  if (days <= 5) return 0
  if (days <= 9) return 4
  if (days > 14) return -2
  return 1
}

function formatRestDays(days: number | null) {
  return days === null ? 'ไม่ทราบ' : `${days} วัน`
}

function flattenRecentOpponents(recentOpponents: any) {
  if (!recentOpponents) return []
  if (Array.isArray(recentOpponents)) return recentOpponents
  return [...(recentOpponents.home ?? []), ...(recentOpponents.away ?? [])]
}

function getOpponentDifficulty(item: any) {
  const opponent = item.opponent ?? item.awayTeam ?? item.homeTeam ?? item.team
  const position = Number(opponent?.position ?? item.position ?? 0)
  const points = Number(opponent?.points ?? item.points ?? 0)
  const rating = Number(opponent?.rating ?? item.rating ?? item.strength ?? 0)
  if (rating) return clamp(rating, 0, 100)
  if (position) return clamp(82 - position * 3, 20, 85)
  if (points) return clamp(points, 20, 85)
  return null
}

function countItems(value: any) {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') return Object.keys(value).length
  return value ? 1 : 0
}

function getTeamId(team: any) {
  return Number(team?.api_team_id ?? team?.id ?? team?.apiTeamId ?? 0)
}

function formatSigned(value: number) {
  return `${value >= 0 ? '+' : ''}${value}`
}

function summarizeRecentForm(matches: Array<any>, teamId: number) {
  return matches.reduce(
    (total, match) => {
      const isHome = match.homeTeam?.id === teamId
      const homeGoals = match.score?.fullTime?.home
      const awayGoals = match.score?.fullTime?.away
      const goalsFor = Number(isHome ? homeGoals : awayGoals ?? 0)
      const goalsAgainst = Number(isHome ? awayGoals : homeGoals ?? 0)

      if (homeGoals === null || homeGoals === undefined || awayGoals === null || awayGoals === undefined) {
        return total
      }

      total.played += 1
      total.goals_for += goalsFor
      total.goals_against += goalsAgainst

      if (goalsFor > goalsAgainst) total.wins += 1
      else if (goalsFor === goalsAgainst) total.draws += 1
      else total.losses += 1

      if (goalsAgainst === 0) total.clean_sheets += 1
      if (goalsFor === 0) total.failed_to_score += 1

      return total
    },
    { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 },
  )
}

function findStanding(standings: Array<any>, teamId: number) {
  const totalTable = standings.find((standing) => standing.type === 'TOTAL')?.table ?? standings[0]?.table ?? []
  return totalTable.find((row: any) => row.team?.id === teamId)
}

async function resetMatchesForRange(range: { startUtc: string; endUtc: string }) {
  const resetResult = await supabase.from('football_matches').delete().gte('kickoff_at', range.startUtc).lt('kickoff_at', range.endUtc)
  if (resetResult.error) throw resetResult.error
}

function formatRound(match: any) {
  return [match.stage, match.group, match.matchday ? `Matchday ${match.matchday}` : ''].filter(Boolean).join(' · ') || null
}

function buildThaiReason(homeForm: Record<string, number>, awayForm: Record<string, number>, confidence: number, riskLevel: string) {
  const riskText = riskLevel === 'low' ? 'ความเสี่ยงโดยรวมต่ำ' : riskLevel === 'medium' ? 'ยังมีจุดที่ต้องติดตามก่อนแข่ง' : 'ความเสี่ยงสูงกว่าปกติ'
  return `ทีมเหย้ามีผลงาน 5 นัดหลัง ชนะ ${homeForm.wins} เสมอ ${homeForm.draws} แพ้ ${homeForm.losses} ยิงได้ ${homeForm.goals_for} ประตู ส่วนทีมเยือนชนะ ${awayForm.wins} เสมอ ${awayForm.draws} แพ้ ${awayForm.losses} ระบบประเมินความมั่นใจที่ ${confidence}% และ${riskText}`
}

async function finishLog(logId: string | null, status: string, message: string, raw: unknown) {
  if (!logId) {
    const rawProvider = raw && typeof raw === 'object' && 'provider' in raw ? String((raw as any).provider) : requestedProviderName
    const result = await supabase.from('sync_logs').insert({ sync_type: rawProvider, status, message, finished_at: new Date().toISOString(), raw })
    if (result.error) throw result.error
    return
  }

  const result = await supabase.from('sync_logs').update({ status, message, finished_at: new Date().toISOString(), raw }).eq('id', logId)
  if (result.error) throw result.error
}

function assertRuntimeConfig(mode: string) {
  const needsApiFootball = requestedProviderName === 'api-football' || isFootballEnrichmentMode(mode)
  const needsFootballDataFallback = !isFootballEnrichmentMode(mode)
  if (needsApiFootball && !API_FOOTBALL_KEY) throw new Error('Missing API_FOOTBALL_KEY Supabase secret')
  if (needsApiFootball && !API_FOOTBALL_BASE_URL) throw new Error('Missing API_FOOTBALL_BASE_URL Supabase secret')
  if (needsFootballDataFallback && !FOOTBALL_DATA_TOKEN) throw new Error('Missing FOOTBALL_API_KEY Supabase secret for football-data.org fallback')
  if (needsFootballDataFallback && !FOOTBALL_DATA_BASE_URL) throw new Error('Missing FOOTBALL_API_BASE_URL Supabase secret')
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service credentials')
  if (!secretKeys.length) throw new Error('Missing Supabase secret API keys')
}

async function getServiceAuthError(request: Request, mode: string, body: Record<string, unknown> = {}) {
  const apiKey = sanitizeHeaderValue(request.headers.get('apikey') ?? '')
  const authorization = sanitizeHeaderValue(request.headers.get('authorization') ?? '')
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? ''
  const bodySecret = sanitizeHeaderValue(typeof body.sb_secret === 'string' ? body.sb_secret : '')
  const authDebug = {
    mode,
    authorizationPrefix: getSafeAuthPrefix(bearerToken || authorization),
    apiKeyPrefix: getSafeAuthPrefix(apiKey),
    bodySecretPrefix: getSafeAuthPrefix(bodySecret),
  }
  const adminOnlyMessage = isFootballEnrichmentMode(mode)
    ? 'Unauthorized enrichment request. API-Football enrichment modes are admin-only. Invoke this Edge Function with the Supabase service role key, a configured EDGE_ADMIN_SECRET_KEYS admin key, or a valid admin user JWT. Publishable/anon keys are not allowed.'
    : 'Unauthorized sync request. Invoke this Edge Function with the Supabase service role key, a configured EDGE_ADMIN_SECRET_KEYS admin key, or a valid admin user JWT. Publishable/anon keys are not allowed.'

  const apiKeyPath = getTrustedAdminTokenPath(apiKey)
  if (apiKeyPath) {
    logAdminAuthDebug({ ...authDebug, passedPath: apiKeyPath })
    return null
  }

  const bearerPath = getTrustedAdminTokenPath(bearerToken)
  if (bearerPath) {
    logAdminAuthDebug({ ...authDebug, passedPath: bearerPath })
    return null
  }

  const bodySecretPath = getTrustedAdminTokenPath(bodySecret)
  if (bodySecretPath) {
    logAdminAuthDebug({ ...authDebug, passedPath: bodySecretPath })
    return null
  }

  if (bearerToken && await isAdminJwt(bearerToken)) {
    logAdminAuthDebug({ ...authDebug, passedPath: 'admin_jwt' })
    return null
  }

  logAdminAuthDebug({ ...authDebug, passedPath: 'denied' })

  return new Response(JSON.stringify({
    ok: false,
    message: adminOnlyMessage,
    code: 'ADMIN_AUTH_REQUIRED',
    provider: isFootballEnrichmentMode(mode) ? 'api-football' : requestedProviderName,
  }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isTrustedAdminToken(value: string) {
  return Boolean(getTrustedAdminTokenPath(value))
}

function getTrustedAdminTokenPath(value: string) {
  if (!value) return false
  if (value === serviceRoleKey) return 'service_role'
  if (secretKeys.includes(value)) return 'EDGE_ADMIN_SECRET_KEYS'
  return null
}

async function isAdminJwt(token: string) {
  if (!token || isTrustedAdminToken(token)) return false
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return false
    const appRole = String(data.user.app_metadata?.role ?? '').toLowerCase()
    const userRole = String(data.user.user_metadata?.role ?? '').toLowerCase()
    return appRole === 'admin' || appRole === 'service_role' || userRole === 'admin' || data.user.app_metadata?.is_admin === true
  } catch {
    return false
  }
}

function parseSupabaseSecretKeys(value: string | undefined | null | Array<string | undefined | null>) {
  if (Array.isArray(value)) return [...new Set(value.flatMap(parseSupabaseSecretKeys))]
  const trimmed = sanitizeHeaderValue(String(value ?? ''))
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed)
    return normalizeSupabaseSecretKeyList(parsed)
  } catch {
    return splitSupabaseSecretKeys(trimmed)
  }
}

function normalizeSupabaseSecretKeyList(value: unknown): Array<string> {
  if (!value) return []
  if (typeof value === 'string') return splitSupabaseSecretKeys(value)
  if (Array.isArray(value)) return value.flatMap(normalizeSupabaseSecretKeyList)
  if (typeof value === 'object') return Object.values(value).flatMap(normalizeSupabaseSecretKeyList)
  return splitSupabaseSecretKeys(String(value))
}

function splitSupabaseSecretKeys(value: string) {
  return value
    .split(/[\s,]+/)
    .map((key) => sanitizeHeaderValue(key))
    .filter(Boolean)
}

function getSafeAuthPrefix(value: string) {
  if (!value) return 'missing'
  const token = value.replace(/^Bearer\s+/i, '').trim()
  if (token.startsWith('sb_secret_')) return 'sb_secret'
  if (token.startsWith('sb_publishable_')) return 'sb_publishable'
  if (token.split('.').length === 3) return 'jwt'
  return 'other'
}

function logAdminAuthDebug(payload: { mode: string; authorizationPrefix: string; apiKeyPrefix: string; bodySecretPrefix: string; passedPath: string }) {
  console.log('admin auth debug', payload)
}

function sanitizeUrl(value: string) {
  return value.trim().replace(/^["'<]+|[>"']+$/g, '').replace(/\/$/, '')
}

function sanitizeHeaderValue(value: string) {
  return value.trim().replace(/^["'<]+|[>"']+$/g, '').replace(/[^\x20-\x7E]/g, '')
}

function normalizeProviderName(value: string) {
  const normalized = sanitizeHeaderValue(value).toLowerCase()
  if (['api-football', 'api_football', 'apisports', 'api-sports'].includes(normalized)) return 'api-football'
  return 'api-football'
}

function normalizeRequestedMode(value: unknown) {
  return String(value ?? 'manual').trim().toLowerCase() || 'manual'
}

function normalizeSyncMode(value: unknown) {
  const mode = normalizeRequestedMode(value)
  if (['manual', 'enrich', 'recompute', 'learning', ...footballEnrichmentModes].includes(mode)) return mode
  return null
}

function getSupportedSyncModes() {
  return ['manual', 'enrich', 'recompute', 'learning', ...footballEnrichmentModes]
}

function getSyncLimit(value: unknown, mode = 'manual') {
  if (mode === 'sync-odds') return getPositiveLimit(value, 10, maxFootballEnrichmentLimit)
  if (mode === 'sync-fixture-odds') return getPositiveLimit(value, 1, 3)
  if (isResultPipelineMode(mode)) return getPositiveLimit(value, 10, 20)
  const defaultLimit = isFootballEnrichmentMode(mode) ? defaultFootballEnrichmentLimit : mode === 'enrich' ? defaultEnrichLimit : defaultManualLimit
  const maxLimit = isFootballEnrichmentMode(mode) ? maxFootballEnrichmentLimit : mode === 'enrich' ? maxEnrichLimit : maxManualLimit
  const numeric = Number(value ?? defaultLimit)
  if (!Number.isFinite(numeric) || numeric <= 0) return defaultLimit
  return Math.max(1, Math.min(Math.floor(numeric), maxLimit))
}

function isFootballEnrichmentMode(mode: unknown) {
  return footballEnrichmentModes.includes(String(mode ?? '').toLowerCase())
}

function isResultPipelineMode(mode: unknown) {
  return [
    'sync-completed-fixtures',
    'backfill-ai-pick-results',
    'settle-ai-pick-results',
    'settle-ai-pick-results-date',
    'recompute-performance-daily',
    'result-refresh',
    'diagnose-result-pipeline',
  ].includes(String(mode ?? '').toLowerCase())
}

function isDailySyncOrchestratorMode(mode: unknown) {
  return [
    'daily-sync-start',
    'daily-sync-phase',
    'daily-sync-status',
    'daily-sync-next',
    'daily-sync-auto',
    'daily-full-sync-safe',
    'daily-full-sync',
    'auto-daily-enrichment',
  ].includes(String(mode ?? '').toLowerCase())
}

function getSyncOffset(value: unknown) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.floor(numeric)
}

function normalizeFixtureIds(value: unknown) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return [...new Set(items.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0).map((item) => Math.floor(item)))]
}

function getSyncDateRange(body: Record<string, unknown>) {
  const dateInput = typeof body.selectionDate === 'string' && body.selectionDate
    ? body.selectionDate
    : typeof body.date === 'string' && body.date
    ? body.date
    : typeof body.dateKey === 'string' && body.dateKey
    ? body.dateKey
    : typeof body.dateFrom === 'string' && body.dateFrom
      ? body.dateFrom
      : new Date()

  return getBangkokDayRange(dateInput)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack }
  return error
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return sanitizeText(error.message)
  if (error && typeof error === 'object') {
    const item = error as any
    return sanitizeText(item.message ?? item.details ?? item.hint ?? fallback)
  }
  return sanitizeText(error ?? fallback)
}

async function safeJson(request: Request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
