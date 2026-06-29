import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getBangkokDayRange } from '../_shared/bangkokDateRange.ts'

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

const supabase = createClient(supabaseUrl, serviceRoleKey)
const legacyAnalysisSelect = 'id, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, motivation_score, market_risk_score, confidence_score, recommendation, risk_level, analysis_summary, thai_reason, raw'
const pickAnalysisSelect = `${legacyAnalysisSelect}, pick_side, pick_team, pick_reason`
const finalPickAnalysisSelect = `${pickAnalysisSelect}, market_type, market_line, fair_line, model_probability, value_status, value_reason`
const selectionV2AnalysisSelect = `${finalPickAnalysisSelect}, data_validation_status, data_validation_notes, league_quality_score, match_quality_score, tactical_matchup_score, market_reading_score, home_away_score, risk_score, edge_score, ai_score, ranking_score, final_rank, recommendation_tier, final_pick_note, is_top_pick, is_final_pick`
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
  'lock-daily-top10',
  'get-daily-top10-status',
  'refresh-locked-top10-signals',
  'sync-completed-fixtures',
  'backfill-ai-pick-results',
  'settle-ai-pick-results',
  'settle-ai-pick-results-date',
  'recompute-performance-daily',
  'result-refresh',
  'diagnose-result-pipeline',
]

const dailySyncRunMode = 'daily-full-sync-safe'
const dailySyncPhases = ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking']

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
    const mode = normalizeSyncMode(body.mode)
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
      const modeResult = await runFootballEnrichmentMode(mode, body, dayRange, limit)
      return json({
        ok: true,
        partial: modeResult.partial ?? false,
        provider: modeResult.provider ?? (isResultPipelineMode(mode) ? 'supabase' : 'api-football'),
        mode,
        runId: modeResult.runId ?? null,
        phase: modeResult.phase ?? null,
        status: modeResult.status ?? 'success',
        dateKey,
        dateFrom,
        dateTo,
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
        nextOffset: modeResult.nextOffset,
        hasMore: modeResult.hasMore,
        locked: modeResult.locked,
        alreadyLocked: modeResult.alreadyLocked,
        lockedCount: modeResult.lockedCount,
        selectionDate: modeResult.selectionDate,
        lockedAt: modeResult.lockedAt,
        lastUpdated: modeResult.lastUpdated,
        matchesWithOdds: modeResult.matchesWithOdds,
        matchesWithoutOdds: modeResult.matchesWithoutOdds,
        strongSignalCount: modeResult.strongSignalCount,
        watchCount: modeResult.watchCount,
        skipCount: modeResult.skipCount,
        updated: modeResult.updated,
        checks: modeResult.checks,
        ready: modeResult.ready,
        recommendedFix: modeResult.recommendedFix,
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
    await finishLog(logId, 'failed', errorResponse.errorMessage, { provider: errorResponse.provider, fallbackUsed: false, fallbackProvider: null, error: errorResponse.errorDetails })
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

    console.warn(`${provider.name} failed; falling back to football-data.org`, error)
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
  endpoints: Record<string, FootballEnrichmentEndpointCounter>
  skippedEndpoints: Array<{ endpoint: string; reason: string; apiFixtureId?: number; apiLeagueId?: number; apiTeamId?: number; season?: number }>
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
  endpointBreakdown?: Record<string, FootballEnrichmentEndpointCounter>
  details?: Record<string, unknown>
}

async function runFootballEnrichmentMode(mode: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
  const provider = getProviderAdapter('api-football')
  const providerResult = { provider, fallbackUsed: false, fallbackProvider: null, fallbackError: null, competitions: 0, matches: [] }
  const context = createFootballEnrichmentContext(mode, limit, typeof body.date === 'string' ? body.date : dayRange.dateKey)
  const started = Date.now()

  if (isDailySyncOrchestratorMode(mode)) {
    return runDailySyncOrchestratorMode(mode, body, dayRange, context, providerResult, started)
  }

  let processed = 0
  let totalCandidates = 0
  if (mode === 'enrich-all') {
    for (const childMode of ['coverage', 'rounds', 'squads', 'coaches', 'venues', 'injuries', 'top-players', 'fixture-enrich']) {
      if (context.rateLimited) break
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
  if (mode === 'daily-sync-status') {
    const state = await getDailySyncState(String(body.runId ?? ''))
    return buildDailySyncStatusResponse(mode, state, Date.now() - started)
  }

  if (mode === 'daily-sync-start') {
    const state = await startDailySyncRun(body, dayRange)
    return buildDailySyncStartResponse(mode, state, Date.now() - started)
  }

  if (mode === 'daily-sync-next') {
    const state = await getDailySyncState(String(body.runId ?? ''))
    const result = await runDailySyncStepBatch(state, body, getBangkokDayRange(state.run.run_date), context, body.autoAdvance === true ? getMaxStepsPerRequest(body) : 1)
    return buildDailySyncStepResponse(mode, result, providerResult, Date.now() - started)
  }

  if (mode === 'daily-sync-phase') {
    const state = await getDailySyncState(String(body.runId ?? ''))
    const result = await runRequestedDailySyncPhase(state, String(body.phase ?? ''), body, getBangkokDayRange(state.run.run_date), context)
    return buildDailySyncStepResponse(mode, result, providerResult, Date.now() - started)
  }

  if (mode === 'daily-sync-auto') {
    const state = await startDailySyncRun({ ...body, resume: body.resume ?? true }, dayRange)
    const result = await runDailySyncStepBatch(state, body, getBangkokDayRange(state.run.run_date), context, getMaxStepsPerRequest(body))
    return buildDailySyncStepResponse(mode, result, providerResult, Date.now() - started)
  }

  if (['daily-full-sync', 'daily-full-sync-safe', 'auto-daily-enrichment'].includes(mode)) {
    const state = await startDailySyncRun(body, dayRange)
    if (state.run.status === 'success') return buildDailySyncStatusResponse(mode, state, Date.now() - started, 'daily sync already completed')

    const autoAdvance = body.autoAdvance === true
    const result = await runDailySyncStepBatch(state, body, getBangkokDayRange(state.run.run_date), context, autoAdvance ? getMaxStepsPerRequest(body) : 1)
    return buildDailySyncStepResponse(mode, result, providerResult, Date.now() - started)
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
    nextRequestExample: { mode: 'daily-full-sync-safe', limit: 10, enrichmentLimit: 20 },
  })
}

async function startDailySyncRun(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>) {
  const runDate = dayRange.dateKey
  const limits = getDailyPhaseLimits(body)
  const limitValue = getPositiveLimit(body.limit, defaultFootballEnrichmentLimit, maxFootballEnrichmentLimit)
  const enrichmentLimit = getPositiveLimit(body.enrichmentLimit, 20, maxFootballEnrichmentLimit)
  const resume = body.resume === true
  const force = body.force === true
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
        summary: { phaseLimits: limits },
      })
      .select('*')
      .single()
    if (inserted.error) throw inserted.error
    run = inserted.data
    await createDailySyncSteps(run.id, limits)
    return getDailySyncState(run.id)
  }

  if (run.status === 'success' && !force) {
    return getDailySyncState(run.id)
  }

  if (run.status !== 'success' && resume && !force) {
    return getDailySyncState(run.id)
  }

  if (force || run.status !== 'success') {
    const updated = await supabase
      .from('api_football_daily_sync_runs')
      .update({
        status: 'started',
        current_phase: null,
        current_step: 0,
        total_steps: dailySyncPhases.length,
        limit_value: limitValue,
        enrichment_limit: enrichmentLimit,
        started_at: new Date().toISOString(),
        finished_at: null,
        last_error: null,
        summary: { phaseLimits: limits },
      })
      .eq('id', run.id)
      .select('*')
      .single()
    if (updated.error) throw updated.error
    await supabase.from('api_football_daily_sync_steps').delete().eq('run_id', run.id)
    await createDailySyncSteps(run.id, limits)
    return getDailySyncState(run.id)
  }

  return getDailySyncState(run.id)
}

async function createDailySyncSteps(runId: string, limits: Record<string, number>) {
  const rows = dailySyncPhases.map((phase, index) => ({
    run_id: runId,
    step_order: index + 1,
    phase,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    next_retry_at: null,
    last_attempt_at: null,
    summary: { phaseLimit: limits[phase] ?? 10 },
  }))
  const result = await supabase.from('api_football_daily_sync_steps').insert(rows)
  if (result.error) throw result.error
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
    const run = await markDailySyncRunFinished(state.run.id, state.steps)
    return { run, step: null, nextStep: null, summary: emptyDailyStepSummary('complete', 'success'), steps: state.steps }
  }
  return runDailySyncStep(state.run, step, body, dayRange, context)
}

async function runDailySyncStepBatch(state: any, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext, maxSteps: number) {
  let currentState = state
  let lastResult: any = null
  const summaries: Array<DailyFullSyncStepSummary> = []
  const safeMaxSteps = Math.min(Math.max(1, Math.floor(maxSteps || 1)), 2)

  for (let index = 0; index < safeMaxSteps; index += 1) {
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

async function runRequestedDailySyncPhase(state: any, phase: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  if (!dailySyncPhases.includes(phase)) throw new Error(`Unsupported daily sync phase: ${phase}`)
  const step = state.steps.find((item: any) => item.phase === phase)
  if (!step) throw new Error(`Daily sync phase not found: ${phase}`)
  return runDailySyncStep(state.run, step, body, dayRange, context)
}

async function runDailySyncStep(run: any, step: any, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const startedAt = Date.now()
  const limits = getDailyPhaseLimits({ ...run.summary, ...body, phaseLimits: body.phaseLimits ?? run.summary?.phaseLimits })
  const phaseLimit = limits[step.phase] ?? 10
  const attemptCount = Number(step.attempt_count ?? 0) + 1
  const maxAttempts = Number(step.max_attempts ?? 3)
  context.limit = phaseLimit

  await supabase
    .from('api_football_daily_sync_runs')
    .update({ status: 'running', current_phase: step.phase, current_step: step.step_order, last_error: null })
    .eq('id', run.id)
  await supabase
    .from('api_football_daily_sync_steps')
    .update({ status: 'running', started_at: new Date().toISOString(), finished_at: null, error_message: null, attempt_count: attemptCount, last_attempt_at: new Date().toISOString(), next_retry_at: null })
    .eq('id', step.id)

  let summary: DailyFullSyncStepSummary
  try {
    const before = cloneEndpointCounters(context.endpoints)
    summary = await executeDailySyncPhase(step.step_order, step.phase, body, dayRange, context, before)
  } catch (error) {
    const message = error instanceof Error ? error.message : `${step.phase} failed`
    summary = {
      step: step.step_order,
      mode: step.phase,
      status: 'error',
      processed: 0,
      totalCandidates: 0,
      rowsSaved: 0,
      failed: 1,
      skipped: 0,
      rateLimited: context.rateLimited,
      durationMs: Date.now() - startedAt,
      message,
    }
  }

  const retry = getDailyStepRetryPlan(summary, attemptCount, maxAttempts)
  const stepStatus = retry.status
  const finishedAt = new Date().toISOString()
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
      attempt_count: attemptCount,
      max_attempts: maxAttempts,
      last_attempt_at: finishedAt,
      next_retry_at: retry.nextRetryAt,
      summary,
      error_message: summary.message ?? null,
    })
    .eq('id', step.id)
  if (stepUpdate.error) throw stepUpdate.error

  const freshState = await getDailySyncState(run.id)
  const runStatus = getDailyRunStatus(freshState.steps)
  const runUpdate = await supabase
    .from('api_football_daily_sync_runs')
    .update({
      status: runStatus,
      current_phase: step.phase,
      current_step: step.step_order,
      finished_at: runStatus === 'success' || runStatus === 'failed' ? finishedAt : null,
      last_error: summary.message ?? null,
      summary: buildDailyRunSummary(freshState.steps, summary),
    })
    .eq('id', run.id)
    .select('*')
    .single()
  if (runUpdate.error) throw runUpdate.error

  const updatedStep = freshState.steps.find((item: any) => item.id === step.id) ?? { ...step, status: stepStatus }
  const nextStep = findNextDailySyncStep(freshState.steps)
  return { run: runUpdate.data, step: updatedStep, nextStep, summary, steps: freshState.steps }
}

async function executeDailySyncPhase(stepOrder: number, phase: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext, before: Record<string, FootballEnrichmentEndpointCounter>) {
  await logEnrichmentSync({ mode: context.mode, endpoint: `phase:${phase}`, status: 'started', started_at: new Date().toISOString(), finished_at: new Date().toISOString() })
  const startedAt = Date.now()
  const results: Array<any> = []

  if (phase === 'core') {
    results.push(await syncApiFootballDailyFixtures(dayRange, context.limit))
    results.push(await executeFootballEnrichmentMode('coverage', body, dayRange, context))
    results.push(await executeFootballEnrichmentMode('rounds', body, dayRange, context))
  } else if (phase === 'fixture-enrichment') {
    results.push(await executeFootballEnrichmentMode('fixture-enrich', body, dayRange, context))
    if (!context.rateLimited) results.push(await executeFootballEnrichmentMode('sync-odds', body, dayRange, context))
  } else if (phase === 'team-enrichment') {
    results.push(await executeFootballEnrichmentMode('injuries', body, dayRange, context))
    if (!context.rateLimited) results.push(await executeFootballEnrichmentMode('squads', body, dayRange, context))
    if (!context.rateLimited) results.push(await executeFootballEnrichmentMode('coaches', body, dayRange, context))
    if (!context.rateLimited) results.push(await executeFootballEnrichmentMode('venues', body, dayRange, context))
  } else if (phase === 'league-enrichment') {
    results.push(await executeFootballEnrichmentMode('top-players', body, dayRange, context))
  } else if (phase === 'ranking') {
    results.push(await runDailyRankingStep(dayRange, context))
  } else {
    throw new Error(`Unsupported daily sync phase: ${phase}`)
  }

  const endpointDelta = diffEndpointCounters(before, context.endpoints)
  const endpointBreakdown = diffEndpointCounterMap(before, context.endpoints)
  const processed = sumResultField(results, 'processed')
  const totalCandidates = sumResultField(results, 'totalCandidates')
  const rowsSaved = sumResultField(results, 'rowsSaved') || endpointDelta.rowsSaved || processed
  const failed = sumResultField(results, 'failed') + endpointDelta.failed
  const skipped = sumResultField(results, 'skipped') + endpointDelta.skipped
  const status = failed > 0 ? 'partial_success' : rowsSaved > 0 || processed > 0 || skipped > 0 ? 'success' : 'empty'
  await logEnrichmentSync({ mode: context.mode, endpoint: `phase:${phase}`, status: status === 'partial_success' ? 'success' : status, results_count: rowsSaved, finished_at: new Date().toISOString() })
  await logEnrichmentSync({ mode: context.mode, endpoint: `phase:${phase}`, status: 'finished', results_count: rowsSaved, finished_at: new Date().toISOString() })

  return {
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
    endpointBreakdown,
    details: buildDailyPhaseDetails(phase, results),
  }
}

async function markDailySyncRunFinished(runId: string, steps: Array<any>) {
  const status = getDailyRunStatus(steps)
  const result = await supabase
    .from('api_football_daily_sync_runs')
    .update({ status, finished_at: new Date().toISOString(), summary: buildDailyRunSummary(steps) })
    .eq('id', runId)
    .select('*')
    .single()
  if (result.error) throw result.error
  return result.data
}

function buildDailySyncStartResponse(mode: string, state: any, durationMs: number) {
  const nextStep = findNextDailySyncStep(state.steps)
  const waitingRetry = !nextStep ? findWaitingRetryStep(state.steps) : null
  return buildDailySyncSafeResponse({
    mode,
    runId: state.run.id,
    phase: nextStep?.phase ?? waitingRetry?.phase ?? null,
    status: state.run.status,
    processed: 0,
    totalCandidates: state.steps.length,
    rowsSaved: 0,
    failed: countDailySteps(state.steps, 'failed'),
    skipped: countDailySteps(state.steps, 'skipped'),
    rateLimited: false,
    durationMs,
    steps: state.steps,
    finalSummary: state.run.summary?.finalSummary ?? buildFinalDailySummary(state.steps),
    nextAction: nextStep ? 'call daily-sync-next' : waitingRetry ? 'Retry after next_retry_at' : 'daily sync already completed',
    nextRequestExample: nextStep || waitingRetry ? { mode: 'daily-sync-next', runId: state.run.id } : { mode: 'daily-sync-status', runId: state.run.id },
  })
}

function buildDailySyncStatusResponse(mode: string, state: any, durationMs: number, message = '') {
  const nextStep = findNextDailySyncStep(state.steps)
  const waitingRetry = !nextStep ? findWaitingRetryStep(state.steps) : null
  return buildDailySyncSafeResponse({
    mode,
    runId: state.run.id,
    phase: nextStep?.phase ?? waitingRetry?.phase ?? state.run.current_phase ?? null,
    status: waitingRetry ? 'pending_retry' : state.run.status,
    processed: sumStepField(state.steps, 'processed'),
    totalCandidates: state.steps.length,
    rowsSaved: sumStepField(state.steps, 'rows_saved'),
    failed: countDailySteps(state.steps, 'failed'),
    skipped: countDailySteps(state.steps, 'skipped'),
    rateLimited: state.steps.some((step: any) => step.rate_limited),
    durationMs,
    steps: state.steps,
    finalSummary: state.run.summary?.finalSummary ?? buildFinalDailySummary(state.steps),
    nextAction: nextStep ? 'call daily-sync-next again' : waitingRetry ? 'Retry after next_retry_at' : message || 'daily sync complete',
    nextRequestExample: nextStep || waitingRetry ? { mode: 'daily-sync-next', runId: state.run.id } : { mode: 'daily-sync-status', runId: state.run.id },
  })
}

function buildDailySyncStepResponse(mode: string, result: any, providerResult: any, durationMs: number, stepResults: Array<any> = []) {
  const summary = result?.summary ?? emptyDailyStepSummary(result?.step?.phase ?? null, 'success')
  const nextStep = result?.nextStep
  const steps = result?.steps ?? []
  const waitingRetry = !nextStep ? findWaitingRetryStep(steps) : null
  return {
    providerResult,
    runId: result?.run?.id ?? null,
    phase: summary.mode ?? result?.step?.phase ?? null,
    status: summary.status === 'pending_retry' || waitingRetry ? 'pending_retry' : result?.run?.status ?? summary.status,
    totalCandidates: summary.totalCandidates,
    totalFetched: summary.totalCandidates,
    processed: summary.processed,
    rowsSaved: summary.rowsSaved,
    failed: summary.failed,
    skipped: summary.skipped,
    skippedByLimit: 0,
    failures: summary.failed ? [{ message: summary.message ?? `${summary.mode} failed` }] : [],
    rankedSelectionRows: summary.mode === 'ranking' ? summary.processed : 0,
    topSelections: [],
    endpointCoverage: {},
    enrichedMatches: [],
    processedMatches: [],
    skippedEndpoints: [],
    rateLimited: summary.rateLimited,
    durationMs,
    steps: stepResults.length ? stepResults : [summary],
    limits: result?.run?.summary?.phaseLimits ?? {},
    ...calculateRunProgress(steps),
    nextPhase: nextStep?.phase ?? waitingRetry?.phase ?? null,
    retryAfterSeconds: getRetryAfterSeconds(waitingRetry),
    finalSummary: result?.run?.summary?.finalSummary ?? (result?.run?.status === 'success' ? buildFinalDailySummary(steps) : null),
    nextAction: nextStep ? (mode === 'daily-sync-auto' ? 'Call this same endpoint again later' : 'call daily-sync-next again') : waitingRetry ? 'Retry after next_retry_at' : 'No action required',
    nextRequestExample: nextStep || waitingRetry ? { mode: mode === 'daily-sync-auto' ? 'daily-sync-auto' : 'daily-sync-next', runId: result?.run?.id, autoAdvance: true, maxStepsPerRequest: 2 } : { mode: 'daily-sync-status', runId: result?.run?.id },
  }
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
  const nowMs = Date.now()
  return [...(steps ?? [])]
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0))
    .find((step) => isDailyStepRunnable(step, nowMs))
}

function findWaitingRetryStep(steps: Array<any>) {
  const nowMs = Date.now()
  return [...(steps ?? [])]
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0))
    .find((step) => {
      const status = String(step.status ?? '')
      if (!['pending_retry', 'failed', 'partial'].includes(status)) return false
      if (Number(step.attempt_count ?? 0) >= Number(step.max_attempts ?? 3)) return false
      const nextRetryMs = step.next_retry_at ? new Date(step.next_retry_at).getTime() : 0
      return nextRetryMs > nowMs
    })
}

function isDailyStepRunnable(step: any, nowMs = Date.now()) {
  const status = String(step?.status ?? 'pending')
  if (status === 'pending') return true
  if (!['pending_retry', 'failed', 'partial'].includes(status)) return false
  if (Number(step.attempt_count ?? 0) >= Number(step.max_attempts ?? 3)) return false
  const nextRetryMs = step.next_retry_at ? new Date(step.next_retry_at).getTime() : 0
  return !nextRetryMs || nextRetryMs <= nowMs
}

function mapDailyStepStatus(summary: DailyFullSyncStepSummary) {
  if (summary.status === 'error') return 'failed'
  if (summary.status === 'partial_success') return 'partial'
  if (summary.status === 'skipped_not_due') return 'skipped'
  return 'success'
}

function getDailyStepRetryPlan(summary: DailyFullSyncStepSummary, attemptCount: number, maxAttempts: number) {
  const failed = summary.status === 'error' || summary.status === 'partial_success' || summary.failed > 0
  if (!failed) return { status: mapDailyStepStatus(summary), nextRetryAt: null }
  if (attemptCount < maxAttempts) {
    return {
      status: 'pending_retry',
      nextRetryAt: new Date(Date.now() + getRetryDelayMs(attemptCount)).toISOString(),
    }
  }
  return { status: summary.status === 'partial_success' ? 'partial' : 'failed', nextRetryAt: null }
}

function getRetryDelayMs(attemptCount: number) {
  if (attemptCount <= 1) return 60 * 1000
  if (attemptCount === 2) return 3 * 60 * 1000
  return 5 * 60 * 1000
}

function getDailyRunStatus(steps: Array<any>) {
  const safeSteps = steps ?? []
  if (!safeSteps.length) return 'started'
  const failed = safeSteps.some((step) => step.status === 'failed')
  const partial = safeSteps.some((step) => step.status === 'partial')
  const pendingRetry = safeSteps.some((step) => step.status === 'pending_retry')
  const running = safeSteps.some((step) => step.status === 'running')
  const pending = safeSteps.some((step) => step.status === 'pending' || step.status === 'pending_retry')
  if (running) return 'running'
  if (pendingRetry) return 'partial'
  if (pending) return failed || partial ? 'partial' : 'running'
  if (failed) return 'failed'
  if (partial) return 'partial'
  return 'success'
}

function buildDailyRunSummary(steps: Array<any>, latest: any = null) {
  const finalSummary = buildFinalDailySummary(steps)
  return {
    completed: (steps ?? []).filter((step) => ['success', 'skipped'].includes(step.status)).length,
    failed: countDailySteps(steps, 'failed'),
    partial: countDailySteps(steps, 'partial'),
    processed: sumStepField(steps, 'processed'),
    rowsSaved: sumStepField(steps, 'rows_saved'),
    skipped: sumStepField(steps, 'skipped'),
    rateLimited: (steps ?? []).some((step) => step.rate_limited),
    finalSummary,
    latest,
  }
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

function calculateRunProgress(steps: Array<any>) {
  const safeSteps = steps ?? []
  const totalSteps = Math.max(safeSteps.length || dailySyncPhases.length, 1)
  const completedSteps = safeSteps.filter((step) => ['success', 'skipped'].includes(step.status)).length
  const failedSteps = safeSteps.filter((step) => step.status === 'failed').length
  const pendingSteps = safeSteps.filter((step) => ['pending', 'pending_retry'].includes(step.status)).length
  const runningSteps = safeSteps.filter((step) => ['running', 'partial'].includes(step.status)).length
  const weighted = safeSteps.reduce((total, step) => {
    if (['success', 'skipped'].includes(step.status)) return total + 1
    if (['running', 'partial', 'pending_retry'].includes(step.status)) return total + 0.5
    return total
  }, 0)
  const next = findNextDailySyncStep(safeSteps) ?? findWaitingRetryStep(safeSteps)
  return {
    progressPercent: Math.max(0, Math.min(100, Math.round((weighted / totalSteps) * 100))),
    completedSteps,
    totalSteps,
    failedSteps,
    pendingSteps,
    runningSteps,
    nextPhase: next?.phase ?? null,
  }
}

function buildFinalDailySummary(steps: Array<any>) {
  const endpointRows = aggregateEndpointRows(steps)
  const core = findStepSummary(steps, 'core')
  const ranking = findStepSummary(steps, 'ranking')
  return {
    fixtures: Number(core?.details?.fixturesProcessed ?? 0),
    coverage: endpointRows['/leagues'] ?? 0,
    rounds: endpointRows['/fixtures/rounds'] ?? 0,
    fixtureStatistics: endpointRows['/fixtures/statistics'] ?? 0,
    events: endpointRows['/fixtures/events'] ?? 0,
    lineups: endpointRows['/fixtures/lineups'] ?? 0,
    fixturePlayers: endpointRows['/fixtures/players'] ?? 0,
    injuries: endpointRows['/injuries'] ?? 0,
    squads: endpointRows['/players/squads'] ?? 0,
    coaches: endpointRows['/coachs'] ?? 0,
    venues: endpointRows['/venues'] ?? 0,
    topScorers: endpointRows['/players/topscorers'] ?? 0,
    topAssists: endpointRows['/players/topassists'] ?? 0,
    topYellowCards: endpointRows['/players/topyellowcards'] ?? 0,
    topRedCards: endpointRows['/players/topredcards'] ?? 0,
    topPlayers: (endpointRows['/players/topscorers'] ?? 0) + (endpointRows['/players/topassists'] ?? 0) + (endpointRows['/players/topyellowcards'] ?? 0) + (endpointRows['/players/topredcards'] ?? 0),
    ranking: ranking?.status === 'success' || ranking?.status === 'empty' ? 'success' : ranking?.status ?? 'pending',
    totalDurationMs: (steps ?? []).reduce((total, step) => total + Number(step.duration_ms ?? step.summary?.durationMs ?? 0), 0),
    failedEndpoints: aggregateEndpointNames(steps, 'failed'),
    skippedEndpoints: aggregateEndpointNames(steps, 'skipped'),
    rateLimited: (steps ?? []).some((step) => step.rate_limited || step.summary?.rateLimited),
  }
}

function aggregateEndpointRows(steps: Array<any>) {
  const rows: Record<string, number> = {}
  for (const step of steps ?? []) {
    const breakdown = step.summary?.endpointBreakdown ?? {}
    for (const [endpoint, item] of Object.entries(breakdown)) {
      rows[endpoint] = (rows[endpoint] ?? 0) + Number((item as any)?.rowsSaved ?? 0)
    }
  }
  return rows
}

function aggregateEndpointNames(steps: Array<any>, field: 'failed' | 'skipped') {
  const names = new Set<string>()
  for (const step of steps ?? []) {
    const breakdown = step.summary?.endpointBreakdown ?? {}
    for (const [endpoint, item] of Object.entries(breakdown)) {
      if (Number((item as any)?.[field] ?? 0) > 0) names.add(endpoint)
    }
  }
  return [...names]
}

function findStepSummary(steps: Array<any>, phase: string) {
  return (steps ?? []).find((step) => step.phase === phase)?.summary ?? null
}

function getRetryAfterSeconds(step: any) {
  if (!step?.next_retry_at) return null
  return Math.max(0, Math.ceil((new Date(step.next_retry_at).getTime() - Date.now()) / 1000))
}

function getDailyPhaseLimits(body: any) {
  const phaseLimits = body?.phaseLimits && typeof body.phaseLimits === 'object' ? body.phaseLimits : {}
  return {
    core: getPositiveLimit(phaseLimits.core, 10, maxFootballEnrichmentLimit),
    'fixture-enrichment': getPositiveLimit(phaseLimits['fixture-enrichment'], 5, maxFootballEnrichmentLimit),
    'team-enrichment': getPositiveLimit(phaseLimits['team-enrichment'], 10, maxFootballEnrichmentLimit),
    'league-enrichment': getPositiveLimit(phaseLimits['league-enrichment'], 10, maxFootballEnrichmentLimit),
    ranking: getPositiveLimit(phaseLimits.ranking, 10, maxFootballEnrichmentLimit),
  }
}

function getMaxStepsPerRequest(body: Record<string, unknown>) {
  return getPositiveLimit(body.maxStepsPerRequest ?? body.autoAdvanceSteps, 1, 2)
}

function sumResultField(results: Array<any>, field: string) {
  return results.reduce((total, item) => total + Number(item?.[field] ?? 0), 0)
}

function sumStepField(steps: Array<any>, field: string) {
  return (steps ?? []).reduce((total, step) => total + Number(step?.[field] ?? 0), 0)
}

function countDailySteps(steps: Array<any>, status: string) {
  return (steps ?? []).filter((step) => step.status === status).length
}

async function runDailyFullSyncMode(mode: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext, providerResult: any, started: number) {
  const fixtureLimit = getPositiveLimit(body.limit, defaultFootballEnrichmentLimit, maxFootballEnrichmentLimit)
  const enrichmentLimit = getPositiveLimit(body.enrichmentLimit, 20, maxFootballEnrichmentLimit)
  const matchLimit = getPositiveLimit(body.matchLimit, defaultManualLimit, maxManualLimit)
  const steps: Array<DailyFullSyncStepSummary> = []
  let processed = 0
  let totalCandidates = 0

  const dailySteps = [
    { step: 1, mode: 'daily-fixtures', limit: matchLimit, worker: () => syncApiFootballDailyFixtures(dayRange, matchLimit) },
    { step: 2, mode: 'coverage', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('coverage', body, dayRange, context) },
    { step: 3, mode: 'rounds', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('rounds', body, dayRange, context) },
    { step: 4, mode: 'fixture-enrich', limit: fixtureLimit, worker: () => executeFootballEnrichmentMode('fixture-enrich', body, dayRange, context) },
    { step: 5, mode: 'injuries', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('injuries', body, dayRange, context) },
    { step: 6, mode: 'squads', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('squads', body, dayRange, context) },
    { step: 7, mode: 'coaches', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('coaches', body, dayRange, context) },
    { step: 8, mode: 'venues', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('venues', body, dayRange, context) },
    { step: 9, mode: 'top-players', limit: enrichmentLimit, worker: () => executeFootballEnrichmentMode('top-players', body, dayRange, context) },
    { step: 10, mode: 'ai-top10-ranking', limit: 10, worker: () => runDailyRankingStep(dayRange, context) },
  ]

  for (const item of dailySteps) {
    if (context.rateLimited && item.mode !== 'ai-top10-ranking') {
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
    rankedSelectionRows: steps.find((step) => step.mode === 'ai-top10-ranking')?.processed ?? 0,
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

async function syncApiFootballDailyFixtures(dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
  const matches = [...await fetchApiFootballFixtures(dayRange.dateKey)].sort(compareFixtureSyncPriority)
  const batch = matches.slice(0, limit)
  const result = await processInChunks(batch, syncChunkSize, async (footballDataMatch: any) => {
    return syncMatch(footballDataMatch, { enrichFixtureData: false })
  }, { provider: 'api-football', dateKey: dayRange.dateKey, totalBatch: batch.length, totalFetched: matches.length })
  return {
    processed: result.processed,
    totalCandidates: matches.length,
    rowsSaved: result.processed,
    failed: result.failures.length,
  }
}

async function runDailyRankingStep(dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const rankedSelectionRows = await updateDailySelectionRanks(dayRange)
  const finalPickRows = await recomputeAiFinalPicks(dayRange, { ...context, limit: 10, mode: 'recompute-ai-final-picks' })
  return {
    processed: rankedSelectionRows,
    totalCandidates: rankedSelectionRows,
    rowsSaved: rankedSelectionRows + Number(finalPickRows.rowsSaved ?? 0),
    failed: Number(finalPickRows.failed ?? 0),
    aiFinalPickRows: finalPickRows.rowsSaved ?? 0,
  }
}

async function executeFootballEnrichmentMode(mode: string, body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  if (mode === 'coverage') return syncApiFootballCoverage(context)
  if (mode === 'rounds') return syncApiFootballRounds(context)
  if (mode === 'fixture-enrich') return syncApiFootballFixtureEnrichment(dayRange, context)
  if (mode === 'injuries') return syncApiFootballInjuries(String(body.date ?? context.dateKey), context)
  if (mode === 'squads') return syncApiFootballSquads(context)
  if (mode === 'coaches') return syncApiFootballCoaches(context)
  if (mode === 'venues') return syncApiFootballVenues(context)
  if (mode === 'top-players') return syncApiFootballTopPlayers(context)
  if (mode === 'sync-bookmakers') return syncApiFootballBookmakers(context)
  if (mode === 'sync-odds') return syncApiFootballOdds(body, dayRange, context)
  if (mode === 'sync-fixture-odds') return syncApiFootballFixtureOdds(body, dayRange, context)
  if (mode === 'recompute-ai-final-picks') return recomputeAiFinalPicks(dayRange, context)
  if (mode === 'lock-daily-top10') return lockDailyTop10(dayRange)
  if (mode === 'get-daily-top10-status') return getDailyTop10Status(dayRange)
  if (mode === 'refresh-locked-top10-signals') return refreshLockedTop10Signals(dayRange, context)
  if (mode === 'sync-completed-fixtures') return syncCompletedFixtures(body, dayRange, context)
  if (mode === 'backfill-ai-pick-results') return backfillAiPickResults(body, dayRange)
  if (mode === 'settle-ai-pick-results') return settleAiPickResults(body, dayRange)
  if (mode === 'settle-ai-pick-results-date') return settleAiPickResults({ ...body, selectionDate: body.selectionDate ?? dayRange.dateKey }, dayRange)
  if (mode === 'recompute-performance-daily') return recomputePerformanceDaily(body, dayRange)
  if (mode === 'result-refresh') return resultRefresh(body, dayRange, context)
  if (mode === 'diagnose-result-pipeline') return diagnoseResultPipeline(body, dayRange, context)
  return { processed: 0, totalCandidates: 0 }
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
    resultRowsInserted: backfill.inserted ?? 0,
    resultRowsUpdated: backfill.updated ?? 0,
    resultRowsSettled: settle.settled ?? 0,
    resultRowsVoid: settle.voided ?? 0,
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
  const failures: Array<Record<string, unknown>> = []

  for (const candidate of candidates.rows) {
    if (context.rateLimited) break
    const fixtureId = Number(candidate.api_fixture_id ?? candidate.api_sports_fixture_id ?? 0)
    if (!fixtureId) continue
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
      continue
    }
    const patch = normalizeResultFixturePatch(rawFixture)
    await withResultStage('update football_matches score', 'RESULT_SYNC_UPDATE_MATCH_FAILED', async () => {
      const update = await supabase.from('football_matches').update(patch).eq('id', candidate.id)
      if (update.error) throw update.error
      return update
    })
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
    processedFixtureIds: candidates.rows.map((row: any) => row.api_fixture_id ?? row.api_sports_fixture_id).filter(Boolean),
  }
}

async function fetchCompletedFixtureCandidates(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
  const selectionDate = typeof body.selectionDate === 'string' ? body.selectionDate : null
  const nowIso = new Date().toISOString()
  const matchIds = new Set<string>()
  const fixtureIds = new Set<number>()

  const addRows = (rows: Array<any>) => {
    for (const row of rows) {
      const matchId = row.match_id ?? row.match?.id ?? row.id
      const fixtureId = Number(row.api_fixture_id ?? row.match?.api_fixture_id ?? row.match?.api_sports_fixture_id ?? row.api_sports_fixture_id ?? 0)
      if (matchId) matchIds.add(String(matchId))
      if (fixtureId) fixtureIds.add(Math.trunc(fixtureId))
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
  else if (fixtureIds.size) query = query.or([...fixtureIds].map((id) => `api_fixture_id.eq.${id},api_sports_fixture_id.eq.${id}`).join(','))
  else query = query.gte('kickoff_at', dayRange.startUtc).lt('kickoff_at', dayRange.endUtc)

  const matches = await withResultStage('query football_matches', 'RESULT_CANDIDATES_MATCHES_FAILED', async () => {
    const result = await query
    if (result.error) throw result.error
    return result
  })
  const rows = (matches.data ?? [])
    .filter((row: any) => Number(row.api_fixture_id ?? row.api_sports_fixture_id ?? 0))
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

  const rows = (top10.data ?? []).map((row: any) => {
    const pick = pickByMatch.get(row.match_id) ?? {}
    return {
      selection_date: row.selection_date ?? selectionDate,
      match_id: row.match_id,
      api_fixture_id: nullableNumber(row.api_fixture_id ?? pick.api_fixture_id),
      ai_final_pick_id: row.ai_final_pick_id ?? pick.id ?? null,
      signal: pick.signal ?? row.signal ?? null,
      market_focus: pick.market_focus ?? row.market_focus ?? null,
      direction: pick.direction ?? null,
      confidence_score: pick.confidence_score ?? row.confidence_score ?? null,
      risk_level: pick.risk_level ?? row.risk_level ?? null,
    }
  })

  if (!rows.length) return { processed: 0, provider: 'supabase', totalCandidates: 0, rowsSaved: 0, inserted: 0, updated: 0, selectionDate }
  const upsert = await withResultStage('upsert football_ai_pick_results', 'RESULT_BACKFILL_UPSERT_FAILED', () => supabase
    .from('football_ai_pick_results')
    .upsert(rows, { onConflict: 'match_id,selection_date' })
    .select('id'))
  if (upsert.error) throw upsert.error
  return { processed: rows.length, provider: 'supabase', totalCandidates: rows.length, rowsSaved: rows.length, inserted: rows.length, updated: 0, selectionDate }
}

async function settleAiPickResults(body: Record<string, unknown>, dayRange: ReturnType<typeof getBangkokDayRange>) {
  const selectionDate = typeof body.selectionDate === 'string' ? body.selectionDate : null
  let query = supabase
    .from('football_ai_pick_results')
    .select(`
      id,
      selection_date,
      match_id,
      market_focus,
      direction,
      settlement_status,
      match:football_matches(id, status_short, status_long, status, home_score, away_score, home_goals, away_goals)
    `)
    .eq('settlement_status', 'PENDING')
    .limit(Math.max(1, Math.min(Number(body.limit ?? dayRange ? 20 : 20), 20)))

  if (selectionDate) query = query.eq('selection_date', selectionDate)
  else query = query.gte('selection_date', dayRange.dateFrom).lte('selection_date', dayRange.dateTo)

  const result = await withResultStage('query football_ai_pick_results', 'RESULT_SETTLE_QUERY_FAILED', async () => {
    const rows = await query
    if (rows.error) throw rows.error
    return rows
  })

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
    const outcome = settleResultRow({
      market_focus: row.market_focus,
      direction: row.direction,
      status_short: match.status_short ?? match.status,
      home_score: match.home_score ?? match.home_goals,
      away_score: match.away_score ?? match.away_goals,
    })
    if (outcome.settlement_status === 'PENDING') {
      pending += 1
      continue
    }
    const update = await withResultStage('settle result rows', 'RESULT_SETTLE_UPDATE_FAILED', () => supabase
      .from('football_ai_pick_results')
      .update({
        home_score: nullableNumber(match.home_score ?? match.home_goals),
        away_score: nullableNumber(match.away_score ?? match.away_goals),
        status_short: normalizeResultStatusShort(match.status_short ?? match.status),
        status_long: match.status_long ?? null,
        settlement_status: outcome.settlement_status,
        simulation_outcome: outcome.simulation_outcome,
        settlement_reason: outcome.settlement_reason,
        settled_at: new Date().toISOString(),
      })
      .eq('id', row.id))
    if (update.error) throw update.error
    if (outcome.settlement_status === 'VOID') voided += 1
    else settled += 1
  }

  return { processed: settled + voided, provider: 'supabase', totalCandidates: (result.data ?? []).length, rowsSaved: settled + voided, settled, voided, pending, failed, failures }
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
    super(details.message)
    this.name = 'ResultPipelineError'
    this.errorCode = errorCode
    this.errorStage = errorStage
    this.provider = provider
    this.errorDetails = details
    this.failures = Array.isArray((error as any)?.failures) ? (error as any).failures.map(sanitizeDiagnosticValue) : []
  }
}

async function withResultStage<T>(errorStage: string, errorCode: string, worker: () => PromiseLike<T>, provider = 'supabase'): Promise<T> {
  try {
    const result = await worker()
    if ((result as any)?.error) throw (result as any).error
    return result
  } catch (error) {
    if (error instanceof ResultPipelineError) throw error
    throw new ResultPipelineError(errorCode, errorStage, error, provider)
  }
}

function buildSyncErrorResponse(error: unknown, mode: string, fallbackProvider: string) {
  const resultError = error instanceof ResultPipelineError
    ? error
    : new ResultPipelineError(getDefaultErrorCode(mode), getDefaultErrorStage(mode), error, isResultPipelineMode(mode) ? 'supabase' : fallbackProvider)
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
    name: raw?.name ? sanitizeText(raw.name) : null,
  }
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/authorization|apikey|sb_secret|secret|token|key/i.test(key))
      .map(([key, item]) => [key, sanitizeDiagnosticValue(item)]))
  }
  return value
}

function sanitizeText(value: unknown) {
  let text = String(value ?? '')
  const secretValues = [serviceRoleKey, API_FOOTBALL_KEY, FOOTBALL_DATA_TOKEN, ...secretKeys].filter(Boolean)
  for (const secret of secretValues) {
    text = text.split(secret).join('[masked]')
  }
  return text
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, 'sb_secret_[masked]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [masked]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, 'jwt_[masked]')
    .replace(/(api[_-]?key|apikey|secret|token)=([^&\s]+)/gi, '$1=[masked]')
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

function createFootballEnrichmentContext(mode: string, limit: number, dateKey: string): FootballEnrichmentContext {
  return {
    mode,
    limit,
    dateKey,
    rateLimited: false,
    endpoints: {},
    skippedEndpoints: [],
  }
}

async function syncApiFootballCoverage(context: FootballEnrichmentContext) {
  const leagues = (await fetchDistinctApiFootballLeagues()).slice(0, context.limit)
  let processed = 0
  for (const item of leagues) {
    if (context.rateLimited) break
    const response = await trackedApiFootballGet(context, '/leagues', { id: item.api_league_id, season: item.season }, { apiLeagueId: item.api_league_id, season: item.season })
    if (!response.ok) continue
    const rows = (response.data ?? []).map((row: any) => normalizeLeagueCoverage(row, item))
    await upsertApiFootballData('api_football_league_coverage', 'api_league_id,season', rows)
    addEndpointRowsSaved(context, '/leagues', rows.length)
    processed += rows.length
  }
  return { processed, totalCandidates: leagues.length }
}

async function syncApiFootballRounds(context: FootballEnrichmentContext) {
  const leagues = (await fetchDistinctApiFootballLeagues()).slice(0, context.limit)
  let processed = 0
  for (const item of leagues) {
    if (context.rateLimited) break
    const allRounds = await trackedApiFootballGet(context, '/fixtures/rounds', { league: item.api_league_id, season: item.season }, { apiLeagueId: item.api_league_id, season: item.season })
    const current = context.rateLimited ? { data: [] } : await trackedApiFootballGet(context, '/fixtures/rounds', { league: item.api_league_id, season: item.season, current: 'true' }, { apiLeagueId: item.api_league_id, season: item.season })
    if (!allRounds.ok) continue
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
  }
  return { processed, totalCandidates: leagues.length }
}

async function syncApiFootballFixtureEnrichment(dayRange: ReturnType<typeof getBangkokDayRange>, context: FootballEnrichmentContext) {
  const fixtures = await fetchApiFootballFixtureCandidates(dayRange, context.limit)
  let processed = 0
  for (const group of chunk(fixtures, footballEnrichmentChunkSize)) {
    for (const match of group) {
      if (context.rateLimited) break
      processed += await enrichOneApiFootballFixture(match, context)
    }
    if (context.rateLimited) break
  }
  return { processed, totalCandidates: fixtures.length }
}

async function enrichOneApiFootballFixture(match: any, context: FootballEnrichmentContext) {
  const fixtureId = getMatchFixtureId(match)
  if (!fixtureId) return 0
  const coverage = await fetchCoverageForMatch(match)
  let saved = 0
  const calls = [
    { endpoint: '/fixtures/statistics', coverageKey: 'has_fixture_statistics', normalizer: normalizeFixtureStatisticsRows, table: 'api_football_fixture_statistics', conflict: 'api_fixture_id,api_team_id' },
    { endpoint: '/fixtures/events', coverageKey: 'has_events', normalizer: normalizeFixtureEventRows, table: 'api_football_fixture_events', conflict: '' },
    { endpoint: '/fixtures/lineups', coverageKey: 'has_lineups', normalizer: normalizeFixtureLineupRows, table: 'api_football_fixture_lineups', conflict: 'api_fixture_id,api_team_id' },
    { endpoint: '/fixtures/players', coverageKey: 'has_player_statistics', normalizer: normalizeFixturePlayerRows, table: 'api_football_fixture_players', conflict: 'api_fixture_id,api_team_id,api_player_id' },
  ]

  for (const call of calls) {
    if (context.rateLimited) break
    if (!shouldFetchFixtureEnrichment(match, call.endpoint)) {
      await logEnrichmentSync({ mode: context.mode, api_fixture_id: fixtureId, api_league_id: getMatchLeagueId(match), season: getMatchSeason(match), endpoint: call.endpoint, status: 'skipped_not_due' })
      rememberSkippedEndpoint(context, call.endpoint, 'skipped_not_due', { apiFixtureId: fixtureId, apiLeagueId: getMatchLeagueId(match), season: getMatchSeason(match) })
      continue
    }
    if (coverage && !hasCoverage(coverage, call.coverageKey)) {
      await logEnrichmentSync({ mode: context.mode, api_fixture_id: fixtureId, api_league_id: getMatchLeagueId(match), season: getMatchSeason(match), endpoint: call.endpoint, status: 'skipped_no_coverage' })
      rememberSkippedEndpoint(context, call.endpoint, 'skipped_no_coverage', { apiFixtureId: fixtureId, apiLeagueId: getMatchLeagueId(match), season: getMatchSeason(match) })
      addEndpointSkipped(context, call.endpoint)
      continue
    }
    const response = await trackedApiFootballGet(context, call.endpoint, { fixture: fixtureId }, { apiFixtureId: fixtureId, apiLeagueId: getMatchLeagueId(match), season: getMatchSeason(match) })
    if (!response.ok) continue
    const rows = call.normalizer(response.data ?? [], fixtureId)
    if (call.table === 'api_football_fixture_events') {
      await replaceApiFootballRows(call.table, { api_fixture_id: fixtureId }, rows)
    } else {
      await upsertApiFootballData(call.table, call.conflict, rows)
    }
    addEndpointRowsSaved(context, call.endpoint, rows.length)
    saved += rows.length
  }
  return saved > 0 ? 1 : 0
}

async function syncApiFootballInjuries(dateKey: string, context: FootballEnrichmentContext) {
  const fixtures = await fetchApiFootballFixtureCandidates(getBangkokDayRange(dateKey), context.limit)
  const leagues = (await fetchDistinctApiFootballLeagues()).slice(0, context.limit)
  let processed = 0

  for (const match of fixtures) {
    if (context.rateLimited) break
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
    if (context.rateLimited || processed >= context.limit) break
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
    if (context.rateLimited) break
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
    if (context.rateLimited) break
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
    if (context.rateLimited) break
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
    if (context.rateLimited) break
    const coverage = await fetchCoverageForLeague(league.api_league_id, league.season)
    for (const item of endpoints) {
      if (context.rateLimited) break
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
  const offset = getSyncOffset(body.offset)
  const maxFixturesPerRun = getPositiveLimit(body.maxFixturesPerRun ?? body.limit, 3, 5)
  const fixtureIds = normalizeFixtureIds(body.fixtureIds)
  const retryFailedOnly = body.retryFailedOnly === true
  const candidates = await fetchDbMatchCandidates(dayRange, Math.max(1, maxFixturesPerRun), true, { offset, fixtureIds, retryFailedOnly })
  return runOddsBatch(candidates.rows, candidates.totalCandidates, context, {
    offset,
    batchSize: maxFixturesPerRun,
    hardStopMs: 18000,
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

async function runOddsBatch(rows: Array<any>, totalCandidates: number, context: FootballEnrichmentContext, options: { offset: number; batchSize: number; hardStopMs: number }) {
  const startedAt = Date.now()
  const processedFixtureIds: Array<number> = []
  const skippedFixtureIds: Array<number> = []
  const failures: Array<any> = []
  let processedFixtures = 0
  let savedOdds = 0
  let failedFixtures = 0
  let emptyFixtures = 0
  let stoppedEarly = false

  for (const match of rows) {
    if (context.rateLimited || Date.now() - startedAt > options.hardStopMs) {
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
      if (result.failure) failures.push(result.failure)
    } catch (error) {
      const fixtureId = Number(match?.api_sports_fixture_id ?? match?.raw?.raw_fixture_id ?? 0) || null
      failedFixtures += 1
      if (fixtureId) skippedFixtureIds.push(fixtureId)
      const message = formatErrorMessage(error, 'odds fixture sync failed')
      failures.push({ fixtureId, message })
      await logEnrichmentSync({ mode: context.mode, api_fixture_id: fixtureId, endpoint: '/odds', status: 'partial_success', error_message: message }).catch(() => {})
    }
  }

  const attempted = processedFixtures + failedFixtures
  const nextOffset = options.offset + attempted
  const hasMore = stoppedEarly || context.rateLimited || nextOffset < totalCandidates
  const anySuccess = processedFixtures > 0 || savedOdds > 0 || emptyFixtures > 0
  const allRateLimited = failures.some((failure) => String(failure?.message ?? '').includes('429') || failure?.rateLimited === true) && !anySuccess
  const responseStatus = allRateLimited ? 429 : 200
  const partial = failedFixtures > 0 || hasMore || stoppedEarly || context.rateLimited

  return {
    processed: processedFixtures,
    totalCandidates,
    totalFetched: totalCandidates,
    rowsSaved: savedOdds,
    failed: failedFixtures,
    skipped: emptyFixtures,
    partial,
    responseStatus,
    processedFixtures,
    savedOdds,
    failedFixtures,
    emptyFixtures,
    processedFixtureIds,
    skippedFixtureIds: [...new Set(skippedFixtureIds)],
    failures,
    nextOffset,
    hasMore,
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
    return { processed: 1, rowsSaved: 0, failed: 0, empty: 1, fixtureId, skipped: true, failure: null }
  }

  await storeFootballBookmakers(normalized.bookmakers)
  await storeFootballMatchOdds(match.id, normalized.rows)
  addEndpointRowsSaved(context, '/odds', normalized.rows.length)
  await supabase.from('football_matches').update({ odds_updated_at: new Date().toISOString() }).eq('id', match.id)
  return { processed: 1, rowsSaved: normalized.rows.length, failed: 0, empty: 0, fixtureId, skipped: false, failure: null }
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
      raw,
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, ranking_score, final_rank, is_top_pick, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, market_reading_score, raw)
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
    .slice(0, context.limit || 10)

  let processed = 0
  let rowsSaved = 0
  let failed = 0
  for (const match of rows) {
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
    primary_bookmaker: pick.primaryBookmaker,
    latest_odds: pick.latestOdds,
    raw: pick,
    updated_at: new Date().toISOString(),
  }
  const upsert = await supabase.from('football_ai_final_picks').upsert(payload, { onConflict: 'match_id' }).select('id, signal, market_focus, confidence_score, risk_level').single()
  if (upsert.error) throw upsert.error
  return upsert.data
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
    const status = summarizeDailyTop10(selectionDate, existing.data ?? [])
    return { processed: status.lockedCount, totalCandidates: status.lockedCount, rowsSaved: 0, failed: 0, locked: true, alreadyLocked: true, ...status }
  }

  const matches = await fetchDailyTop10LockCandidates(dayRange)
  const matchIds = matches.map((match: any) => match.id).filter(Boolean)
  const picks = await fetchAiFinalPicksForMatches(matchIds)
  const pickByMatch = new Map(picks.map((pick: any) => [pick.match_id, pick]))
  const selected = matches
    .map((match: any) => ({ match, analysis: getAnalysis(match), pick: pickByMatch.get(match.id) ?? null }))
    .sort(compareDailyTop10LockCandidate)
    .slice(0, 10)

  for (const item of selected) {
    if (!item.pick) {
      try {
        item.pick = await upsertAiFinalPickForMatch(item.match)
      } catch (error) {
        console.warn('lock-daily-top10 ai final pick fallback failed', { matchId: item.match?.id, error: formatErrorMessage(error, 'ai final pick failed') })
      }
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
  return { processed: rows.length, totalCandidates: matches.length, rowsSaved: rows.length, failed: 0, partial: rows.length < 10, locked: true, alreadyLocked: false, ...status }
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

async function fetchDailyTop10LockCandidates(dayRange: ReturnType<typeof getBangkokDayRange>) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      kickoff_at,
      raw,
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, ranking_score, final_rank, is_top_pick, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, market_reading_score, raw)
    `)
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)
    .limit(200)
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
      raw,
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, calibrated_confidence_score, risk_level, ranking_score, final_rank, is_top_pick, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, market_reading_score, raw)
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
    .select('id, match_id, signal, market_focus, confidence_score, risk_level')
    .in('match_id', matchIds)
  if (result.error) {
    if (isMissingColumnError(result.error)) return []
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

function compareDailyTop10LockCandidate(a: any, b: any) {
  const hasPickDiff = Number(Boolean(b.pick)) - Number(Boolean(a.pick))
  const scoreDiff = dailySelectionScore(b) - dailySelectionScore(a)
  const confidenceDiff = dailyConfidenceScore(b) - dailyConfidenceScore(a)
  const riskDiff = riskSortValue(a.pick?.risk_level ?? a.analysis?.risk_level) - riskSortValue(b.pick?.risk_level ?? b.analysis?.risk_level)
  const kickoffDiff = new Date(a.match?.kickoff_at ?? 0).getTime() - new Date(b.match?.kickoff_at ?? 0).getTime()
  return hasPickDiff || scoreDiff || confidenceDiff || riskDiff || kickoffDiff
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
      error: error instanceof Error ? error.message : 'api-football request failed',
      raw: null,
    }
  }
}

async function trackedApiFootballGet(context: FootballEnrichmentContext, endpoint: string, params: Record<string, string | number | undefined> = {}, meta: any = {}) {
  if (context.rateLimited) {
    await logEnrichmentSync({ mode: context.mode, endpoint, status: 'skipped_not_due', ...toSyncMeta(meta) })
    return { ok: false, data: [], raw: null, rateLimited: true }
  }

  await sleep(700 + Math.floor(Math.random() * 501))
  bumpEndpoint(context, endpoint, 'called')
  const startedAt = new Date().toISOString()
  try {
    const raw = await apiFootballGet(endpoint, params)
    const results = Number(raw?.results ?? (Array.isArray(raw?.response) ? raw.response.length : 0))
    const status = results === 0 ? 'empty' : 'success'
    bumpEndpoint(context, endpoint, results === 0 ? 'empty' : 'withData')
    await logEnrichmentSync({ mode: context.mode, endpoint, status, results_count: results, started_at: startedAt, finished_at: new Date().toISOString(), ...toSyncMeta(meta) })
    return { ok: true, data: raw?.response ?? [], raw, rateLimited: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'api-football request failed'
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
  return [...map.values()]
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

async function fetchApiFootballFixtureCandidates(dayRange: ReturnType<typeof getBangkokDayRange>, limit: number) {
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
    `)
    .gte('kickoff_at', dayRange.startUtc)
    .lt('kickoff_at', dayRange.endUtc)
    .not('api_sports_fixture_id', 'is', null)
    .order('kickoff_at', { ascending: true })
    .limit(Math.max(limit, 10))

  if (result.error) throw result.error
  return [...(result.data ?? [])]
    .sort(compareEnrichCandidatePriority)
    .slice(0, limit)
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

function buildDailyPhaseDetails(phase: string, results: Array<any>) {
  if (phase === 'core') {
    return {
      fixturesProcessed: Number(results[0]?.processed ?? 0),
      coverageProcessed: Number(results[1]?.processed ?? 0),
      roundsProcessed: Number(results[2]?.processed ?? 0),
    }
  }
  if (phase === 'ranking') return { rankingStatus: Number(results[0]?.failed ?? 0) > 0 ? 'failed' : 'success' }
  return {}
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
  for (const item of rawRows ?? []) {
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
          rows.push({
            match_id: match.id,
            api_fixture_id: fixtureId,
            api_bookmaker_id: bookmakerId,
            bookmaker_name: bookmaker.name ?? null,
            market_focus: marketFocus,
            market_name: bet.name ?? null,
            selection: value.value ?? null,
            line: parseBetLine(value.value),
            price: nullableNumber(value.odd),
            odd_text: value.odd ? String(value.odd) : null,
            is_opening: rows.length === 0,
            is_latest: true,
            snapshot_at: new Date().toISOString(),
            raw: { bookmaker, bet, value },
            updated_at: new Date().toISOString(),
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
  if (!rows.length) return { count: 0 }
  await supabase.from('football_match_odds').update({ is_latest: false }).eq('match_id', matchId)
  const result = await supabase.from('football_match_odds').insert(rows)
  if (result.error) throw result.error
  return { count: rows.length }
}

async function fetchStoredMatchOdds(matchId: string) {
  const result = await supabase
    .from('football_match_odds')
    .select('*')
    .eq('match_id', matchId)
    .order('is_latest', { ascending: false })
    .order('snapshot_at', { ascending: false })
    .limit(80)
  if (result.error) {
    if (isMissingColumnError(result.error)) return []
    throw result.error
  }
  return result.data ?? []
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
  const text = String(value ?? '').toUpperCase()
  if (text.includes('ASIAN') || text.includes('HANDICAP')) return 'AH'
  if (text.includes('OVER') || text.includes('UNDER') || text.includes('GOALS') || text.includes('TOTAL')) return 'OU'
  if (text.includes('MATCH WINNER') || text.includes('1X2') || text.includes('HOME/AWAY')) return 'MATCH_WINNER'
  if (text.includes('BOTH TEAMS') || text.includes('BTTS')) return 'BTTS'
  return 'NONE'
}

function buildEdgeAiFinalPick(match: any) {
  const analysis = getAnalysis(match)
  const ahAnalysis = edgeAnalyzeAh(match)
  const ouAnalysis = edgeAnalyzeOu(match)
  const selected = chooseEdgeMarket(ahAnalysis, ouAnalysis)
  const odds = match.odds ?? []
  const hasOdds = odds.length > 0 && Boolean(selected.hasMarket)
  const totalAnalysisScore = normalizeScore(analysis.ranking_score ?? analysis.ai_score ?? analysis.confidence_score ?? 0)
  const selectionScore = normalizeScore(selected.confidenceScore)
  const confidenceScore = normalizeScore(Math.max(selectionScore, Number(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? selectionScore)))
  const riskLevel = normalizeRiskLevelText(analysis.risk_level ?? (selected.warnings.length >= 3 ? 'HIGH' : selected.warnings.length ? 'MEDIUM' : 'LOW'))
  const keyReasons = uniqueText([...(selected.reasons ?? [])]).slice(0, 5)
  const warningSigns = uniqueText([...(selected.warnings ?? [])]).slice(0, 5)
  const bookmakerCount = new Set(odds.map((row: any) => row.bookmaker_name).filter(Boolean)).size
  const movementAgainst = /against/i.test(String(selected.marketSignal ?? ''))
  let signal: 'STRONG_SIGNAL' | 'WATCH' | 'SKIP' = 'WATCH'
  if (totalAnalysisScore < 60 || confidenceScore < 55 || riskLevel === 'HIGH' || !hasOdds || movementAgainst || warningSigns.length > 3) signal = 'SKIP'
  else if (totalAnalysisScore >= 75 && selectionScore >= 70 && confidenceScore >= 70 && bookmakerCount >= 1 && keyReasons.length >= 3) signal = 'STRONG_SIGNAL'

  const marketFocus = signal === 'SKIP' && !hasOdds ? 'NONE' : selected.marketFocus
  const direction = signal === 'SKIP' && !hasOdds ? 'No market direction' : selected.direction
  return {
    signal,
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
    primaryBookmaker: odds.find((row: any) => row.bookmaker_name)?.bookmaker_name ?? null,
    latestOdds: odds.find((row: any) => row.market_focus === selected.marketFocus)?.odd_text ?? null,
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

  if (result.error) throw result.error
}

async function recomputeV4AnalysisRows(matchIds: Array<string>) {
  if (!matchIds.length) return { updated: 0, failures: [] }

  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      analysis:match_analysis(id, match_id, recommendation, confidence_score, risk_score, ranking_score, market_edge_score, odds_confidence_score, odds_movement_score, team_stats_score, injuries_score, lineups_score, data_depth_score, learning_adjustment_score, historical_accuracy_score, value_market, value_side, value_line)
    `)
    .in('id', matchIds)

  if (result.error) throw result.error

  let updated = 0
  const failures: Array<{ matchId?: string; message: string }> = []
  for (const row of result.data ?? []) {
    try {
      const analysis = getAnalysis(row)
      const payload = buildV4RecomputeAnalysis(analysis)
      await updateMatchAnalysisByMatchId(row.id, payload)
      updated += 1
    } catch (error) {
      failures.push({ matchId: row.id, message: error instanceof Error ? error.message : 'v4 recompute failed' })
    }
  }

  return { updated, failures }
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
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  console.log('api-football response', {
    path,
    params,
    status: response.status,
    errors: data?.errors ?? null,
    results: data?.results ?? null,
    paging: data?.paging ?? null,
  })

  if (!response.ok) {
    const message = data?.message ?? data?.error ?? text ?? `football-data.org ${response.status}`
    throw new Error(`football-data.org ${response.status}: ${message}`)
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

async function apiFootballGet(path: string, params: Record<string, string | number | undefined> = {}) {
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
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}

  if (!response.ok) {
    const message = data?.message ?? data?.error ?? text ?? `api-football ${response.status}`
    throw new Error(`api-football ${response.status}: ${message}`)
  }

  const apiErrors = data?.errors
  const hasApiErrors = Array.isArray(apiErrors) ? apiErrors.length > 0 : apiErrors && typeof apiErrors === 'object' ? Object.keys(apiErrors).length > 0 : Boolean(apiErrors)
  if (hasApiErrors) throw new Error(`api-football error: ${JSON.stringify(apiErrors)}`)

  return data
}

async function fetchApiFootballFixtures(dateKey: string) {
  const data = await apiFootballGet('/fixtures', { date: dateKey })
  return (data.response ?? []).map(normalizeApiFootballFixture)
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
    console.warn(`standings unavailable for competition ${competitionId}`, error)
    return []
  }
}

async function fetchTeamLastMatches(teamId: number, limit: number) {
  if (!teamId) return []

  try {
    const data = await footballDataApiGet(`/teams/${teamId}/matches`, { limit, status: 'FINISHED' })
    return data.matches ?? []
  } catch (error) {
    console.warn(`last matches unavailable for team ${teamId}`, error)
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
    analysis_summary: safeAnalysis.analysis_summary,
    thai_reason: safeAnalysis.thai_reason,
    raw: safeAnalysis,
  }

  const nextResult = await supabase.from('match_analysis').upsert(nextPayload, { onConflict: 'match_id' })
  if (!nextResult.error) return

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
    pick_team: pick.pick_team,
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
    leagueQualitySource: leagueQualityScoringVersion,
    analysis_summary: summary,
    thai_reason: summary,
  }
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

async function updateDailySelectionRanks(range: { startUtc: string; endUtc: string }) {
  await recalibrateDailySelectionScores(range)

  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      kickoff_at,
      analysis:match_analysis(id, match_id, recommendation, ranking_score, confidence_score, calibrated_confidence_score, risk_score, data_validation_status)
    `)
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)

  if (result.error) {
    if (isMissingColumnError(result.error)) return 0
    throw result.error
  }

  const matchIds = (result.data ?? []).map((match: any) => match.id).filter(Boolean)
  if (!matchIds.length) return 0

  const rows = (result.data ?? [])
    .map((match: any) => {
      const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
      return analysis ? { matchId: match.id, analysis } : null
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

  const ranked = rows
    .filter((row: any) => String(row.analysis.data_validation_status ?? 'VALID').toUpperCase() !== 'INVALID')
    .sort((a: any, b: any) => {
      const recommendationDiff = recommendationPriority(a.analysis.recommendation) - recommendationPriority(b.analysis.recommendation)
      const rankingDiff = Number(b.analysis.ranking_score ?? 0) - Number(a.analysis.ranking_score ?? 0)
      const confidenceDiff = Number(b.analysis.calibrated_confidence_score ?? b.analysis.confidence_score ?? 0) - Number(a.analysis.calibrated_confidence_score ?? a.analysis.confidence_score ?? 0)
      const riskDiff = Number(a.analysis.risk_score ?? 100) - Number(b.analysis.risk_score ?? 100)
      return recommendationDiff || rankingDiff || confidenceDiff || riskDiff
    })
    .slice(0, 10)

  let updated = 0
  for (const [index, row] of ranked.entries()) {
    const recommendation = String(row.analysis.recommendation ?? 'NO BET').toUpperCase()
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

async function recalibrateDailySelectionScores(range: { startUtc: string; endUtc: string }) {
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
      raw,
      league:football_leagues(id, api_league_id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name, country),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name, country),
      analysis:match_analysis(id, match_id, recommendation, confidence_score, risk_score, ranking_score, data_validation_status, match_quality_score, team_strength_score, form_score, goal_scoring_score, defensive_stability_score, tactical_matchup_score, motivation_score, market_reading_score, home_away_score, edge_score, ai_score, raw)
    `)
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)
    .limit(1000)

  if (result.error) {
    if (isMissingColumnError(result.error)) return 0
    throw result.error
  }

  let updated = 0
  for (const row of result.data ?? []) {
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
    const updateResult = await supabase
      .from('match_analysis')
      .update({
        league_quality_score: next.league_quality_score,
        match_quality_score: next.match_quality_score,
        tactical_matchup_score: next.tactical_matchup_score,
        market_reading_score: next.market_reading_score,
        home_away_score: next.home_away_score,
        risk_score: next.risk_score,
        edge_score: next.edge_score,
        ai_score: next.ai_score,
        confidence_score: next.confidence_score,
        ranking_score: next.ranking_score,
        recommendation: next.recommendation,
        recommendation_tier: next.recommendation_tier,
        data_validation_status: next.data_validation_status,
        data_validation_notes: next.data_validation_notes,
        analysis_summary: next.analysis_summary,
        raw: {
          ...rawAnalysis,
          league_quality_score: next.league_quality_score,
          confidence_score: next.confidence_score,
          ranking_score: next.ranking_score,
          recommendation: next.recommendation,
          leagueQualitySource: leagueQualityScoringVersion,
        },
      })
      .eq('match_id', row.id)

    if (updateResult.error) {
      if (isMissingColumnError(updateResult.error)) return updated
      throw updateResult.error
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

async function fetchTopSelectionsDebug(range: { startUtc: string; endUtc: string }) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      kickoff_at,
      league:football_leagues(id, api_league_id, name, country),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, name),
      analysis:match_analysis(final_rank, recommendation, confidence_score, ranking_score, league_quality_score, raw)
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
        league_quality_score: analysis.league_quality_score ?? null,
        leagueQualitySource: analysis.raw?.leagueQualitySource ?? leagueQualityScoringVersion,
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => Number(a.finalRank ?? 999) - Number(b.finalRank ?? 999))
    .slice(0, 10)
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
    framework: 'football-intelligence-v3',
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
  return Boolean(
    match?.odds ||
      match?.market ||
      match?.bookmakers ||
      match?.raw?.odds ||
      match?.raw?.market ||
      match?.raw?.bookmakers,
  )
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
  console.info('football-intelligence-v3', {
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
    await supabase.from('sync_logs').insert({ sync_type: rawProvider, status, message, finished_at: new Date().toISOString(), raw })
    return
  }

  await supabase.from('sync_logs').update({ status, message, finished_at: new Date().toISOString(), raw }).eq('id', logId)
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

function normalizeSyncMode(value: unknown) {
  const mode = String(value ?? 'manual').toLowerCase()
  if (['manual', 'enrich', 'recompute', 'learning', ...footballEnrichmentModes].includes(mode)) return mode
  return 'manual'
}

function getSyncLimit(value: unknown, mode = 'manual') {
  if (mode === 'sync-odds') return getPositiveLimit(value, 3, 5)
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
  const dateInput = typeof body.date === 'string' && body.date
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
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const item = error as any
    return String(item.message ?? item.details ?? item.hint ?? fallback)
  }
  return String(error ?? fallback)
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
