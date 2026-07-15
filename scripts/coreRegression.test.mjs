import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildSimpleBettingDecision } from '../src/utils/bettingDecision.js'
import { getBangkokDayRange, isWithinBangkokDay } from '../src/utils/bangkokDateRange.js'
import { classifyDecision } from '../src/utils/decisionClassification.js'
import { normalizeMarketFocus } from '../src/utils/oddsUtils.js'
import { getNearKickoffWindow } from '../src/utils/nearKickoffPolicy.js'
import { buildUsableDailySelection } from '../src/utils/selectionEngineV2.js'

const checks = []

function check(name, worker) {
  checks.push({ name, worker })
}

function fixture(index, overrides = {}) {
  return {
    id: `fixture-${index}`,
    kickoffAt: new Date(Date.parse('2026-07-14T10:00:00.000Z') + index * 60_000).toISOString(),
    status: 'NS',
    league: { name: 'Regression League' },
    homeTeam: { name: `Home ${index}` },
    awayTeam: { name: `Away ${index}` },
    analysis: {
      recommendation: 'BET',
      analysis_status: 'MARKET_DATA_READY_RECALCULATED',
      confidence_score: 88,
      calibrated_confidence_score: 88,
      risk_level: 'LOW',
      market_edge_score: 85,
      market_data_used: true,
      data_quality_score: 90,
      market_quality_score: 90,
      feature_completeness_score: 90,
    },
    odds: [{
      id: `odds-${index}`,
      match_id: `fixture-${index}`,
      market_focus: 'AH',
      market_name: 'Asian Handicap',
      selection: 'Home -0.5',
      line: '-0.5',
      price: 1.9,
      is_latest: true,
      snapshot_at: '2026-07-14T09:55:00.000Z',
    }],
    aiFinalPick: {
      signal: 'STRONG_SIGNAL',
      final_pick: { type: 'AH', label: 'Home -0.5' },
    },
    ...overrides,
  }
}

function dailySteps(overrides = {}) {
  return [
    { phase: 'core', step_order: 1, status: 'success', attempt_count: 1, max_attempts: 3 },
    { phase: 'fixture-enrichment', step_order: 2, status: 'pending', attempt_count: 1, max_attempts: 3 },
    { phase: 'team-enrichment', step_order: 3, status: 'pending', attempt_count: 0, max_attempts: 3 },
    { phase: 'league-enrichment', step_order: 4, status: 'pending', attempt_count: 0, max_attempts: 3 },
    { phase: 'ranking', step_order: 5, status: 'pending', attempt_count: 0, max_attempts: 3 },
  ].map((step) => ({ ...step, ...(overrides[step.phase] ?? {}) }))
}

async function importPipelinePolicy() {
  return import('../supabase/functions/_shared/pipelinePolicy.js')
}

async function importMarketContract() {
  return import('../supabase/functions/_shared/marketContract.js')
}

check('discovery and board preserve more than ten fixtures', () => {
  const rows = Array.from({ length: 14 }, (_, index) => fixture(index))
  const result = buildUsableDailySelection(rows, { now: '2026-07-14T09:00:00.000Z', windowHours: 36 })
  assert.equal(result.selected.length, 14)
})

check('dynamic decision board supports zero through N READY rows', () => {
  const ready = Array.from({ length: 14 }, (_, index) => classifyDecision(fixture(index), { finalPick: { type: 'AH', label: 'Home -0.5' }, now: '2026-07-14T09:00:00.000Z' }))
  assert.equal(ready.filter((row) => row.status === 'READY').length, 14)
  const zero = Array.from({ length: 3 }, (_, index) => classifyDecision(fixture(index, { odds: [] }), { finalPick: { type: 'NO_DECISION' }, now: '2026-07-14T09:00:00.000Z' }))
  assert.equal(zero.filter((row) => row.status === 'READY').length, 0)
})

check('retry resumes cursor and never reuses a completed batch signature', async () => {
  const { advanceContinuation, createContinuationState, shouldProcessBatch } = await importPipelinePolicy()
  const initial = createContinuationState({ oddsOffset: 0 })
  const advanced = advanceContinuation(initial, { oddsOffset: 5, processedFixtureCount: 5, lastProcessedFixtureId: 105, batchSignature: 'batch-a' })
  assert.equal(advanced.oddsOffset, 5)
  assert.equal(advanced.lastProcessedFixtureId, 105)
  assert.equal(shouldProcessBatch(advanced, 'batch-a'), false)
  assert.equal(shouldProcessBatch(advanced, 'batch-b'), true)
})

check('provider pagination resumes from the persisted provider page', async () => {
  const { collectProviderPages } = await importPipelinePolicy()
  const visited = []
  const result = await collectProviderPages(({ page }) => {
    visited.push(page)
    return Promise.resolve({ response: [`page-${page}`], paging: { current: page, total: 4 } })
  }, {}, { startPage: 3 })
  assert.deepEqual(visited, [3, 4])
  assert.deepEqual(result.rows, ['page-3', 'page-4'])
  assert.equal(result.lastPage, 4)
})

check('partial required phase blocks ranking and final pick', async () => {
  const { canRunRequiredPhase } = await importPipelinePolicy()
  const steps = [
    { step_order: 1, phase: 'core', status: 'success' },
    { step_order: 2, phase: 'fixture-enrichment', status: 'pending_retry' },
    { step_order: 3, phase: 'team-enrichment', status: 'pending' },
    { step_order: 4, phase: 'league-enrichment', status: 'pending' },
    { step_order: 5, phase: 'ranking', status: 'pending' },
  ]
  assert.equal(canRunRequiredPhase(steps, 'ranking'), false)
})

check('odds pagination handles 0, 999, 1000, 1001 and 3150 rows', async () => {
  const { fetchPaginatedOddsRows } = await import('../src/repositories/oddsRepository.js')
  for (const count of [0, 999, 1000, 1001, 3150]) {
    const rows = Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, match_id: 'match-1', snapshot_at: `2026-07-14T00:00:${String(index % 60).padStart(2, '0')}.000Z` }))
    const result = await fetchPaginatedOddsRows(createMockOddsClient(rows), ['match-1'], { pageSize: 1000 })
    assert.equal(result.data.length, count, `row count ${count}`)
    assert.equal(result.diagnostics.fetchedRows, count)
  }
})

check('odds pagination deduplicates rows and reports partial provider errors', async () => {
  const { fetchPaginatedOddsRows } = await import('../src/repositories/oddsRepository.js')
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: `row-${index}`, match_id: 'match-1', snapshot_at: '2026-07-14T00:00:00.000Z' }))
  rows.push({ ...rows[2] })
  const complete = await fetchPaginatedOddsRows(createMockOddsClient(rows), ['match-1'], { pageSize: 1000 })
  assert.equal(complete.data.length, 1001)
  assert.equal(complete.diagnostics.duplicateRows, 1)
  const partial = await fetchPaginatedOddsRows(createMockOddsClient(rows, { failPage: 2 }), ['match-1'], { pageSize: 1000 })
  assert.ok(partial.error)
  assert.equal(partial.diagnostics.partial, true)
})

check('UI and verifier use the same canonical classifier', async () => {
  const source = await readFile(new URL('./verifyDailyDecisionBoard.mjs', import.meta.url), 'utf8')
  assert.match(source, /classifyDecision/)
  assert.doesNotMatch(source, /inferFinalPick/)

  const now = Date.now()
  const baseMatch = fixture(1)
  const match = {
    ...baseMatch,
    kickoffAt: new Date(now + 60 * 60 * 1000).toISOString(),
    odds: baseMatch.odds.map((row) => ({
      ...row,
      snapshot_at: new Date(now - 5 * 60 * 1000).toISOString(),
    })),
  }

  const direct = classifyDecision(match, {
    finalPick: { type: 'AH', label: 'Home -0.5' },
    now: new Date(now).toISOString(),
  })
  const ui = buildSimpleBettingDecision(match)

  assert.equal(ui.decision_status, direct.decision_status)
})
check('WAIT has no actionable final pick', () => {
  const match = fixture(1, { kickoffAt: '2036-07-14T10:00:00.000Z', odds: [], aiFinalPick: null, analysis: { recommendation: 'NO BET', confidence_score: 60, risk_level: 'MEDIUM' } })
  const decision = buildSimpleBettingDecision(match)
  assert.equal(decision.status, 'WAIT')
  assert.equal(decision.final_pick.type, 'NO_DECISION')
})

check('READY requires a supported fresh market and actionable final pick', () => {
  const ready = classifyDecision(fixture(1), { finalPick: { type: 'AH', label: 'Home -0.5' }, now: '2026-07-14T09:00:00.000Z' })
  assert.equal(ready.status, 'READY')
  assert.equal(ready.market_readiness.ready, true)
  const unsupported = classifyDecision(fixture(1), { finalPick: { type: 'CORRECT_SCORE', label: '2-1' }, now: '2026-07-14T09:00:00.000Z' })
  assert.notEqual(unsupported.status, 'READY')
})

check('Double Chance survives normalization with its selection', async () => {
  const { normalizeMarketRow } = await importMarketContract()
  assert.equal(normalizeMarketFocus('Double Chance'), 'DOUBLE_CHANCE')
  const row = normalizeMarketRow({ market_name: 'Double Chance', selection: '1X', price: 1.45 })
  assert.equal(row.marketType, 'DOUBLE_CHANCE')
  assert.equal(row.selection, '1X')
  assert.equal(row.valid, true)
})

check('Correct Score remains insight-only', async () => {
  const { normalizeMarketRow } = await importMarketContract()
  const row = normalizeMarketRow({ market_name: 'Correct Score', selection: '2:1', price: 8.5 })
  assert.equal(row.marketType, 'CORRECT_SCORE')
  assert.equal(row.insightOnly, true)
  assert.equal(row.actionable, false)
})

check('Bangkok date boundaries are exact', () => {
  const range = getBangkokDayRange('2026-07-14')
  assert.equal(range.startUtc, '2026-07-13T17:00:00.000Z')
  assert.equal(range.endUtc, '2026-07-14T17:00:00.000Z')
  assert.equal(isWithinBangkokDay('2026-07-13T17:00:00.000Z', '2026-07-14'), true)
  assert.equal(isWithinBangkokDay('2026-07-14T16:59:59.999Z', '2026-07-14'), true)
  assert.equal(isWithinBangkokDay('2026-07-14T17:00:00.000Z', '2026-07-14'), false)
})

check('near-kickoff windows map T-90, T-60, T-30 and T-15 exactly', () => {
  const kickoff = '2026-07-14T12:00:00.000Z'
  assert.equal(getNearKickoffWindow(kickoff, '2026-07-14T10:30:00.000Z'), 90)
  assert.equal(getNearKickoffWindow(kickoff, '2026-07-14T11:00:00.000Z'), 60)
  assert.equal(getNearKickoffWindow(kickoff, '2026-07-14T11:30:00.000Z'), 30)
  assert.equal(getNearKickoffWindow(kickoff, '2026-07-14T11:45:00.000Z'), 15)
  assert.equal(getNearKickoffWindow(kickoff, kickoff), null)
})

check('missing market is distinct from stale market', () => {
  const missing = classifyDecision(fixture(1, { odds: [] }), { finalPick: { type: 'AH' }, now: '2026-07-14T09:00:00.000Z' })
  assert.ok(missing.decision_reason_codes.includes('MARKET_MISSING'))
  assert.ok(!missing.decision_reason_codes.includes('MARKET_STALE'))
  const stale = classifyDecision(fixture(1, { odds: [{ id: 'stale', match_id: 'fixture-1', market_focus: 'AH', selection: 'Home -0.5', line: '-0.5', price: 1.9, snapshot_at: '2026-07-12T00:00:00.000Z' }] }), { finalPick: { type: 'AH' }, now: '2026-07-14T09:00:00.000Z' })
  assert.ok(stale.decision_reason_codes.includes('MARKET_STALE'))
})

check('historical stale running steps are detected', async () => {
  const { auditPipelineState } = await importPipelinePolicy()
  const report = auditPipelineState({ id: 'run-1', status: 'running', total_steps: 5 }, [
    { id: 'step-1', step_order: 1, phase: 'core', status: 'running', attempt_count: 1, max_attempts: 3, updated_at: '2026-07-14T00:00:00.000Z' },
  ], { now: '2026-07-14T01:00:00.000Z', staleAfterMs: 15 * 60_000 })
  assert.equal(report.staleRunning.length, 1)
})

check('exhausted required step makes the canonical run failed', async () => {
  const { getRequiredRunStatus } = await importPipelinePolicy()
  const status = getRequiredRunStatus([
    { phase: 'core', status: 'success', attempt_count: 1, max_attempts: 20 },
    { phase: 'fixture-enrichment', status: 'failed', attempt_count: 20, max_attempts: 20 },
    { phase: 'team-enrichment', status: 'pending', attempt_count: 0, max_attempts: 3 },
    { phase: 'league-enrichment', status: 'pending', attempt_count: 0, max_attempts: 3 },
    { phase: 'ranking', status: 'pending', attempt_count: 0, max_attempts: 3 },
  ])
  assert.equal(status, 'failed')
})

check('partial run with a valid future retry is an accepted pending state', async () => {
  const { auditPipelineCompletion } = await importPipelinePolicy()
  const report = auditPipelineCompletion({ status: 'partial', progress_percent: 20 }, dailySteps({
    'fixture-enrichment': { status: 'pending_retry', next_retry_at: '2026-07-14T02:00:00.000Z' },
  }), { now: '2026-07-14T01:00:00.000Z' })
  assert.deepEqual(report.violations, [])
  assert.equal(report.validRetrySteps.length, 1)
})

check('partial run with an overdue retry fails completion', async () => {
  const { auditPipelineCompletion } = await importPipelinePolicy()
  const report = auditPipelineCompletion({ status: 'partial', progress_percent: 20 }, dailySteps({
    'fixture-enrichment': { status: 'pending_retry', next_retry_at: '2026-07-14T00:30:00.000Z' },
  }), { now: '2026-07-14T01:00:00.000Z' })
  assert.ok(report.violations.includes('PARTIAL_WITHOUT_VALID_CONTINUATION'))
  assert.ok(report.overdueDurationMs > 0)
})

check('partial run without retry metadata fails completion', async () => {
  const { auditPipelineCompletion } = await importPipelinePolicy()
  const report = auditPipelineCompletion({ status: 'partial', progress_percent: 20 }, dailySteps({
    'fixture-enrichment': { status: 'partial', next_retry_at: null },
  }), { now: '2026-07-14T01:00:00.000Z' })
  assert.ok(report.violations.includes('PARTIAL_WITHOUT_VALID_CONTINUATION'))
  assert.ok(report.violations.includes('REQUIRED_PENDING_WITHOUT_SCHEDULE'))
})

check('success run with pending required steps fails completion', async () => {
  const { auditPipelineCompletion } = await importPipelinePolicy()
  const report = auditPipelineCompletion({ status: 'success', progress_percent: 40 }, dailySteps(), { now: '2026-07-14T01:00:00.000Z' })
  assert.ok(report.violations.includes('SUCCESS_WITH_INCOMPLETE_REQUIRED_STEPS'))
  assert.ok(report.violations.includes('TERMINAL_PROGRESS_BELOW_100'))
})

check('success run with all required steps passes completion', async () => {
  const { auditPipelineCompletion } = await importPipelinePolicy()
  const steps = dailySteps(Object.fromEntries(['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase) => [phase, { status: 'success' }])))
  const report = auditPipelineCompletion({ status: 'success', current_phase: 'complete', progress_percent: 100 }, steps, { now: '2026-07-14T01:00:00.000Z' })
  assert.deepEqual(report.violations, [])
})

check('failed terminal run is an explicit completion failure', async () => {
  const { auditPipelineCompletion } = await importPipelinePolicy()
  const report = auditPipelineCompletion({ status: 'failed', progress_percent: 40 }, dailySteps(), { now: '2026-07-14T01:00:00.000Z' })
  assert.ok(report.violations.includes('FAILED_TERMINAL_RUN'))
})

check('COMPLETE phase with incomplete steps fails completion', async () => {
  const { auditPipelineCompletion } = await importPipelinePolicy()
  const report = auditPipelineCompletion({ status: 'partial', current_phase: 'complete', progress_percent: 40 }, dailySteps(), { now: '2026-07-14T01:00:00.000Z' })
  assert.ok(report.violations.includes('COMPLETE_WITH_INCOMPLETE_REQUIRED_STEPS'))
  assert.ok(report.violations.includes('TERMINAL_PROGRESS_BELOW_100'))
})

check('result repair dry-run returns naturally without forcing process shutdown', async () => {
  const source = await readFile(new URL('./repairResultSettlement.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /process\.exit\s*\(/)
  assert.match(source, /if \(apply && proposals\.length\) await applyProposals/)
})

check('verification scripts do not contain database writes', async () => {
  const names = [
    'verifyAnalysisIntegrity.mjs',
    'verifyOddsIntegrity.mjs',
    'verifyAiFinalPickIntegrity.mjs',
    'verifyDailyProductionHealth.mjs',
    'verifyDailyDecisionBoard.mjs',
    'verifyDailyPipelineCompletion.mjs',
    'verifyNearKickoff.mjs',
    'verifyFinalLock.mjs',
    'verifyResultSettlementIntegrity.mjs',
    'verifyProductionAcceptance.mjs',
  ]
  for (const name of names) {
    const source = await readFile(new URL(name, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\s*\(/, name)
  }
})

check('repair commands require explicit apply and production project confirmation', async () => {
  const names = [
    'repairDailyPipelineState.mjs',
    'repairOddsIntegrity.mjs',
    'repairResultSettlement.mjs',
  ]
  for (const name of names) {
    const source = await readFile(new URL(name, import.meta.url), 'utf8')
    assert.match(source, /process\.argv\.includes\('--apply'\)/, name)
    assert.match(source, /--confirm-project/, name)
    assert.match(source, /fzjbnxomflqopwhzxfog/, name)
    assert.doesNotMatch(source, /\.delete\s*\(/, name)
  }
})

check('recovery migration is additive and legacy cursor backfill is bounded', async () => {
  const source = await readFile(new URL('../supabase/migrations/20260715020000_market_ready_core_recovery.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\b(?:drop|truncate|alter\s+type|cascade)\b/i)
  assert.doesNotMatch(source, /\bdelete\s+from\b/i)
  assert.match(source, /where phase = 'fixture-enrichment'/)
  assert.match(source, /and fixture_offset = 0/)
  assert.match(source, /and odds_offset = 0/)
  assert.match(source, /summary #>> '\{details,fixtureDetailAttempted\}'/)
  assert.match(source, /summary #>> '\{details,oddsAttempted\}'/)
  assert.match(source, /where phase in \('core', 'fixture-enrichment'\)/)
})

let failures = 0
for (const item of checks) {
  try {
    await item.worker()
    console.log(`PASS ${item.name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${item.name}: ${error.message}`)
  }
}

assert.equal(failures, 0, `${failures} core regression checks failed`)
console.log(`Core regression tests passed (${checks.length} checks).`)

function createMockOddsClient(rows, options = {}) {
  return {
    from() {
      const state = { from: 0, to: 999 }
      const query = {
        select() { return query },
        in() { return query },
        order() { return query },
        range(from, to) {
          state.from = from
          state.to = to
          const page = Math.floor(from / Math.max(1, to - from + 1)) + 1
          if (options.failPage === page) return Promise.resolve({ data: rows.slice(from, to + 1), error: new Error(`page ${page} failed`) })
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        },
      }
      return query
    },
  }
}
