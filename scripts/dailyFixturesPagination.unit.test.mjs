import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE,
  PROCESSED_FIXTURE_IDS_CURSOR_MODE,
  addProcessedFixtureId,
  advanceDailyFixtureCursor,
  buildApiFootballDailyFixturesParams,
  buildSinglePageFixtureDiscovery,
  getFixtureStableEmptyDecision,
  initializeProcessedFixtureCursor,
  normalizeDailyFixtureCandidates,
  selectProcessedFixtureBatch,
  selectDailyFixtureBatch,
} from '../supabase/functions/_shared/dailyFixturesPolicy.js'
import { advanceContinuation, buildBatchSignature, createContinuationState, shouldProcessBatch } from '../supabase/functions/_shared/pipelinePolicy.js'

const params = buildApiFootballDailyFixturesParams('2026-07-16')
assert.deepEqual(params, { date: '2026-07-16' })
assert.equal(Object.hasOwn(params, 'page'), false, '/fixtures date request must not contain page')

const discovery = buildSinglePageFixtureDiscovery({
  response: [{ fixture: { id: 101 } }, { fixture: { id: 102 } }],
  paging: { current: 1, total: 9 },
}, (fixture) => fixture.fixture.id)
assert.deepEqual(discovery.matches, [101, 102])
assert.equal(discovery.pageCount, 1)
assert.equal(discovery.totalPages, 1)

const fixtures = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }))
const batchIds = []
const offsets = []
const providerPages = []
let fixtureOffset = 0
let providerComplete = false
while (!providerComplete) {
  const selected = selectDailyFixtureBatch(fixtures, fixtureOffset, 5)
  batchIds.push(selected.batch.map((fixture) => fixture.id))
  const cursor = advanceDailyFixtureCursor({
    totalFixtures: selected.totalFixtures,
    fixtureOffset: selected.fixtureOffset,
    advancedBy: selected.batch.length,
    batchComplete: true,
  })
  fixtureOffset = cursor.fixtureOffset
  providerComplete = cursor.providerComplete
  offsets.push(fixtureOffset)
  providerPages.push(cursor.providerPage)
}
assert.deepEqual(batchIds, [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12]])
assert.deepEqual(offsets, [5, 10, 12])
assert.equal(providerComplete, true)
assert.deepEqual(providerPages, [1, 1, 1])
assert.equal(Math.max(...providerPages), API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE)
assert.equal(advanceDailyFixtureCursor({ totalFixtures: 10, fixtureOffset: 12, batchComplete: true }).fixtureOffset, 12, 'fixtureOffset must never move backwards')

const candidate = (id, priority = 0) => ({ raw_fixture_id: id, priority })
const compareCandidates = (left, right) => right.priority - left.priority

const normalizedDuplicates = normalizeDailyFixtureCandidates([
  candidate(3),
  candidate(2),
  candidate(2),
  candidate(null),
  candidate(''),
  candidate(1),
], compareCandidates)
assert.deepEqual(normalizedDuplicates.map((row) => row.raw_fixture_id), [1, 2, 3], 'duplicate and invalid provider fixture IDs must be removed')

let processedFixtureIds = []
const firstSnapshot = normalizeDailyFixtureCandidates([candidate(1), candidate(2), candidate(3)], compareCandidates)
let processedSelection = selectProcessedFixtureBatch(firstSnapshot, processedFixtureIds, 2)
assert.deepEqual(processedSelection.batch.map((row) => row.raw_fixture_id), [1, 2])
for (const row of processedSelection.batch) processedFixtureIds = addProcessedFixtureId(processedFixtureIds, row.raw_fixture_id)

const reorderedSnapshot = normalizeDailyFixtureCandidates([candidate(3), candidate(1), candidate(2)], compareCandidates)
processedSelection = selectProcessedFixtureBatch(reorderedSnapshot, processedFixtureIds, 5)
assert.deepEqual(processedSelection.batch.map((row) => row.raw_fixture_id), [3], 'snapshot reorder must neither repeat nor skip fixtures')

const shrunkSnapshot = normalizeDailyFixtureCandidates([candidate(2), candidate(3)], compareCandidates)
processedSelection = selectProcessedFixtureBatch(shrunkSnapshot, [1], 5)
assert.deepEqual(processedSelection.batch.map((row) => row.raw_fixture_id), [2, 3], 'snapshot shrink must not skip unprocessed fixture IDs')

const insertedBeforeSnapshot = normalizeDailyFixtureCandidates([candidate(1), candidate(2), candidate(3)], compareCandidates)
processedSelection = selectProcessedFixtureBatch(insertedBeforeSnapshot, [2, 3], 5)
assert.deepEqual(processedSelection.batch.map((row) => row.raw_fixture_id), [1], 'a newly inserted fixture before the former position must still be processed')

const partialSuccessIds = addProcessedFixtureId([], 1)
processedSelection = selectProcessedFixtureBatch(firstSnapshot, partialSuccessIds, 5)
assert.deepEqual(processedSelection.remainingCandidates.map((row) => row.raw_fixture_id), [2, 3], 'failed or unattempted IDs must remain after a partial batch')

const legacyCursor = initializeProcessedFixtureCursor({ fixtureOffset: 722, processedFixtureCount: 722, lastProcessedFixtureId: 999 })
assert.equal(legacyCursor.fixtureCursorMode, PROCESSED_FIXTURE_IDS_CURSOR_MODE)
assert.deepEqual(legacyCursor.processedFixtureIds, [], 'legacy positional offset must not bootstrap processed fixture IDs')
assert.equal(legacyCursor.uniqueProcessedFixtureCount, 0)
assert.equal(legacyCursor.legacyFixtureOffsetIgnored, true)
assert.equal(legacyCursor.legacyFixtureOffsetValue, 722)

const overlappingSignature = buildBatchSignature([1, 2])
const legacyCompletedBatch = advanceContinuation(createContinuationState(), { batchSignature: overlappingSignature, batchComplete: true })
assert.equal(shouldProcessBatch(legacyCompletedBatch, overlappingSignature), false)
processedSelection = selectProcessedFixtureBatch(firstSnapshot, [1], 5)
assert.deepEqual(processedSelection.batch.map((row) => row.raw_fixture_id), [2, 3], 'processed-ID mode must ignore completed batch signatures and filter by fixture ID')

const tiedCandidates = normalizeDailyFixtureCandidates([candidate(9, 10), candidate(7, 10), candidate(8, 10)], compareCandidates)
assert.deepEqual(tiedCandidates.map((row) => row.raw_fixture_id), [7, 8, 9], 'fixture ID must be the deterministic final sort tie-breaker')

const emptySnapshotSignature = buildBatchSignature([])
const firstEmpty = getFixtureStableEmptyDecision({ previousSnapshotSignature: null, snapshotSignature: emptySnapshotSignature, previousPasses: 0, remainingCount: 0 })
assert.deepEqual(firstEmpty, { fixtureStableEmptyPasses: 1, providerComplete: false }, 'first stable empty pass must remain a planned continuation')
const secondEmpty = getFixtureStableEmptyDecision({ previousSnapshotSignature: emptySnapshotSignature, snapshotSignature: emptySnapshotSignature, previousPasses: firstEmpty.fixtureStableEmptyPasses, remainingCount: 0 })
assert.deepEqual(secondEmpty, { fixtureStableEmptyPasses: 2, providerComplete: true }, 'second unchanged empty pass may complete fixtures')
const changedEmpty = getFixtureStableEmptyDecision({ previousSnapshotSignature: emptySnapshotSignature, snapshotSignature: buildBatchSignature([4]), previousPasses: 1, remainingCount: 0 })
assert.deepEqual(changedEmpty, { fixtureStableEmptyPasses: 0, providerComplete: false }, 'snapshot signature change must reset stable-empty confirmation')
assert.deepEqual(getFixtureStableEmptyDecision({ previousSnapshotSignature: emptySnapshotSignature, snapshotSignature: emptySnapshotSignature, previousPasses: 1, remainingCount: 1 }), { fixtureStableEmptyPasses: 0, providerComplete: false }, 'new remaining fixtures must reset stable-empty confirmation')

const requestUrl = new URL('https://v3.football.api-sports.io/fixtures')
for (const [key, value] of Object.entries(params)) requestUrl.searchParams.set(key, value)
assert.equal(requestUrl.searchParams.has('page'), false, 'The Page field do not exist error cannot originate from this request path')
assert.equal(requestUrl.search, '?date=2026-07-16')

const source = await readFile(new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url), 'utf8')
const fetchStart = source.indexOf('async function fetchApiFootballFixturesWithPaging')
const fetchEnd = source.indexOf('function getProviderFetchSignal', fetchStart)
const fetchSource = source.slice(fetchStart, fetchEnd)
assert.ok(fetchStart >= 0 && fetchEnd > fetchStart)
assert.match(fetchSource, /runProviderFetchWithinBudget\(context\.executionBudget/)
assert.match(fetchSource, /apiFootballGet\('\/fixtures', buildApiFootballDailyFixturesParams\(dateKey\), context, fetchPlan\)/)
assert.doesNotMatch(fetchSource, /\bpage\s*:/)
assert.doesNotMatch(fetchSource, /startPage|collectProviderPages/)

const syncStart = source.indexOf('async function syncApiFootballDailyFixtures')
const syncEnd = source.indexOf('async function runDailyRankingStep', syncStart)
const syncSource = source.slice(syncStart, syncEnd)
assert.ok(syncStart >= 0 && syncEnd > syncStart)
assert.match(syncSource, /const providerPage = API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE/)
assert.doesNotMatch(syncSource, /providerPage\s*\+\s*1/)
assert.match(syncSource, /normalizeDailyFixtureCandidates\(discovery\.matches, compareFixtureSyncPriority\)/)
assert.match(syncSource, /selectProcessedFixtureBatch\(matches, fixtureCursor\.processedFixtureIds, batchSize\)/)
assert.doesNotMatch(syncSource, /shouldProcessBatch\(/, 'processed-ID core mode must not skip by completed batch signature')
assert.doesNotMatch(syncSource, /selectDailyFixtureBatch\(/, 'processed-ID core mode must not slice a fresh snapshot by fixtureOffset')
assert.match(syncSource, /const stableEmpty = \{ fixtureStableEmptyPasses: 0, providerComplete: false \}/, 'a non-empty invocation must reset stable-empty state even when it processes the last remaining fixture')
assert.match(syncSource, /await syncMatch\([\s\S]*?addProcessedFixtureId\(/, 'a fixture ID may be checkpointed only after syncMatch succeeds')
assert.match(syncSource, /fixtureStableEmptyPasses: stableEmpty\.fixtureStableEmptyPasses/)
assert.match(source, /fixtureResult\?\.providerComplete === true[\s\S]*?persistStepContinuation\(context, \{ coreStage: 'coverage' \}\)/, 'core must enter coverage only after provider completion without failure')
assert.match(source, /if \(!response\.ok\)[\s\S]*?throw new Error/)
assert.match(source, /if \(hasApiErrors\) throw Object\.assign\(new Error/, 'provider HTTP or API errors must throw instead of completing fixtures')

console.log('daily fixtures pagination unit tests passed')
