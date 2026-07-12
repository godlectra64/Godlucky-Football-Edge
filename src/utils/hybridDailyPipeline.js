import { calculateSoftRanking, dailySelectionConfig, DAILY_SELECTION_ALGORITHM_VERSION } from './dailySelectionEngine.js'
import { getBangkokSelectionWindow } from './bangkokDateRange.js'

export const HYBRID_DAILY_PIPELINE_VERSION = 'hybrid-daily-pipeline-v1'

export const hybridDailyPipelinePhases = Object.freeze([
  'OPEN_DAY',
  'FIXTURE_DISCOVERY',
  'BASE_ENRICHMENT',
  'PRE_RANKING',
  'CANDIDATE_POOL_READY',
  'CANDIDATE_MARKET_SYNC',
  'MARKET_RECONCILIATION',
  'FINAL_RANKING',
  'PRELIMINARY_TOP10',
  'TOP10_LOCKED',
  'NEAR_KICKOFF_REFRESH',
  'RESULT_REFRESH',
  'RESULT_SETTLEMENT',
  'COMPLETE',
])

export const hybridDailySchedule = Object.freeze([
  { localTime: '00:20', phase: 'OPEN_DAY', modes: ['daily-sync-auto'] },
  { localTime: '04:00', phase: 'BASE_ENRICHMENT', modes: ['daily-sync-auto'] },
  { localTime: '05:30', phase: 'PRE_RANKING', modes: ['build-daily-market-candidates'] },
  { localTime: '06:00', phase: 'CANDIDATE_MARKET_SYNC', modes: ['sync-daily-candidate-odds', 'finalize-market-ready-candidates'] },
  { localTime: '09:30', phase: 'MARKET_RECONCILIATION', modes: ['sync-daily-candidate-odds', 'finalize-market-ready-candidates'] },
  { localTime: '*/15', phase: 'TOP10_LOCKED', modes: ['lock-daily-top10', 'get-daily-top10-status'] },
  { localTime: '*/15', phase: 'NEAR_KICKOFF_REFRESH', modes: ['sync-daily-top10-odds', 'refresh-locked-top10-signals'] },
  { localTime: '*/15', phase: 'RESULT_REFRESH', modes: ['sync-completed-fixtures'] },
  { localTime: '*/15', phase: 'RESULT_SETTLEMENT', modes: ['settle-ai-pick-results'] },
])

export const hybridDailyNearKickoffWindows = Object.freeze([90, 60, 30, 15])

export const preRankingConfig = Object.freeze({
  ...dailySelectionConfig,
  weights: Object.freeze({
    leagueQuality: 0.18,
    dataQuality: 0.24,
    marketQuality: 0,
    valueScore: 0,
    tacticalScore: 0.17,
    motivationScore: 0.12,
    confidenceScore: 0.20,
    riskSafetyScore: 0.09,
  }),
})

export function buildHybridPipelineMetadata(dateInput = new Date(), overrides = {}) {
  const window = getBangkokSelectionWindow(dateInput)
  return {
    pipelineVersion: HYBRID_DAILY_PIPELINE_VERSION,
    selectionAlgorithmVersion: DAILY_SELECTION_ALGORITHM_VERSION,
    timezone: window.timezone,
    selectionDate: window.selectionDate,
    selectionWindow: window,
    phases: hybridDailyPipelinePhases,
    schedule: hybridDailySchedule,
    nearKickoffWindowsMinutes: hybridDailyNearKickoffWindows,
    ...overrides,
  }
}

export function getHybridPhaseForDailySyncPhase(phase) {
  if (phase === 'core') return 'FIXTURE_DISCOVERY'
  if (phase === 'fixture-enrichment') return 'BASE_ENRICHMENT'
  if (phase === 'team-enrichment') return 'BASE_ENRICHMENT'
  if (phase === 'league-enrichment') return 'BASE_ENRICHMENT'
  if (phase === 'odds-sync') return 'CANDIDATE_MARKET_SYNC'
  if (phase === 'ranking') return 'FINAL_RANKING'
  return 'OPEN_DAY'
}

export function getHybridPhaseForMode(mode) {
  if (mode === 'daily-sync-auto' || mode === 'daily-sync-start' || mode === 'daily-sync-next') return 'FIXTURE_DISCOVERY'
  if (mode === 'build-daily-market-candidates') return 'CANDIDATE_POOL_READY'
  if (mode === 'sync-daily-candidate-odds') return 'CANDIDATE_MARKET_SYNC'
  if (mode === 'finalize-market-ready-candidates') return 'MARKET_RECONCILIATION'
  if (mode === 'strict-api-football-daily-picks') return 'PRELIMINARY_TOP10'
  if (mode === 'lock-daily-top10' || mode === 'get-daily-top10-status') return 'TOP10_LOCKED'
  if (mode === 'sync-daily-top10-odds' || mode === 'refresh-locked-top10-signals') return 'NEAR_KICKOFF_REFRESH'
  if (mode === 'sync-completed-fixtures' || mode === 'result-refresh') return 'RESULT_REFRESH'
  if (mode === 'settle-ai-pick-results' || mode === 'settle-ai-pick-results-date') return 'RESULT_SETTLEMENT'
  return 'OPEN_DAY'
}

export function sanitizeMatchForPreRanking(match = {}) {
  const analysis = match.analysis && typeof match.analysis === 'object'
    ? Array.isArray(match.analysis)
      ? match.analysis.map(stripMarketAnalysisFields)
      : stripMarketAnalysisFields(match.analysis)
    : match.analysis
  return {
    ...match,
    analysis,
    odds: [],
    has_market_data: false,
    hasMarketData: false,
    odds_updated_at: null,
  }
}

export function calculatePreRankingScore(match = {}, options = {}) {
  const selectionDate = options.selectionDate ?? getBangkokSelectionWindow(options.now ?? match.kickoff_at ?? new Date()).selectionDate
  return calculateSoftRanking(sanitizeMatchForPreRanking(match), {
    ...options,
    selectionDate,
    config: preRankingConfig,
  })
}

export function buildHybridCandidatePool(matches = [], options = {}) {
  const requestedLimit = Number(options.limit ?? 50)
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 50)) : 50
  const selectionDate = options.selectionDate ?? getBangkokSelectionWindow(options.now ?? new Date()).selectionDate
  const seenFixtureIds = new Set()
  const candidates = (matches ?? [])
    .map((match, inputIndex) => {
      const fixtureId = getFixtureId(match)
      return {
        match,
        inputIndex,
        fixtureId,
        preRanking: calculatePreRankingScore(match, { selectionDate }),
      }
    })
    .filter((item) => item.fixtureId && !consumeDuplicate(seenFixtureIds, item.fixtureId))
    .sort(compareHybridCandidatePoolRows)
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      candidateRank: index + 1,
      candidateTier: index < 30 ? 'CORE' : 'RESERVE',
    }))

  return {
    pipelineVersion: HYBRID_DAILY_PIPELINE_VERSION,
    selectionAlgorithmVersion: DAILY_SELECTION_ALGORITHM_VERSION,
    selectionDate,
    limit,
    candidates,
    candidatePoolCount: candidates.length,
    candidateCoreCount: candidates.filter((item) => item.candidateTier === 'CORE').length,
    candidateReserveCount: candidates.filter((item) => item.candidateTier === 'RESERVE').length,
  }
}

export function calculateDynamicLockDeadline(earliestKickoffAt) {
  const kickoff = new Date(earliestKickoffAt)
  if (!Number.isFinite(kickoff.getTime())) return null
  const localParts = getBangkokLocalParts(kickoff)
  const kickoffMinutes = localParts.hour * 60 + localParts.minute
  if (kickoffMinutes < 10 * 60) return localDateTimeToUtcIso(localParts.dateKey, '06:00')
  if (kickoffMinutes < 14 * 60) return localDateTimeToUtcIso(localParts.dateKey, '09:00')
  return localDateTimeToUtcIso(localParts.dateKey, '10:00')
}

function stripMarketAnalysisFields(analysis = {}) {
  return {
    ...analysis,
    market_quality_score: null,
    market_edge_score: null,
    value_edge_score: null,
    market_reading_score: null,
    odds_confidence_score: null,
    odds_movement_score: null,
    value_market: null,
    value_side: null,
    value_line: null,
    latest_line: null,
    latest_odds: null,
  }
}

function consumeDuplicate(seen, value) {
  if (seen.has(value)) return true
  seen.add(value)
  return false
}

function compareHybridCandidatePoolRows(a, b) {
  return (
    b.preRanking.finalScore - a.preRanking.finalScore ||
    new Date(a.match?.kickoff_at ?? a.match?.kickoffAt ?? 0).getTime() - new Date(b.match?.kickoff_at ?? b.match?.kickoffAt ?? 0).getTime() ||
    String(a.fixtureId).localeCompare(String(b.fixtureId)) ||
    a.inputIndex - b.inputIndex
  )
}

function getFixtureId(match = {}) {
  const value = match.api_sports_fixture_id ?? match.api_fixture_id ?? match.fixture_id ?? match.fixtureId ?? match.id ?? match.match_id
  const text = String(value ?? '').trim()
  return text || null
}

function getBangkokLocalParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

function localDateTimeToUtcIso(dateKey, timeText) {
  return new Date(`${dateKey}T${timeText}:00+07:00`).toISOString()
}
