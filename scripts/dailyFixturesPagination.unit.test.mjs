import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE,
  advanceDailyFixtureCursor,
  buildApiFootballDailyFixturesParams,
  buildSinglePageFixtureDiscovery,
  selectDailyFixtureBatch,
} from '../supabase/functions/_shared/dailyFixturesPolicy.js'

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

const requestUrl = new URL('https://v3.football.api-sports.io/fixtures')
for (const [key, value] of Object.entries(params)) requestUrl.searchParams.set(key, value)
assert.equal(requestUrl.searchParams.has('page'), false, 'The Page field do not exist error cannot originate from this request path')
assert.equal(requestUrl.search, '?date=2026-07-16')

const source = await readFile(new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url), 'utf8')
const fetchStart = source.indexOf('async function fetchApiFootballFixturesWithPaging')
const fetchEnd = source.indexOf('function getProviderFetchSignal', fetchStart)
const fetchSource = source.slice(fetchStart, fetchEnd)
assert.ok(fetchStart >= 0 && fetchEnd > fetchStart)
assert.match(fetchSource, /apiFootballGet\('\/fixtures', buildApiFootballDailyFixturesParams\(dateKey\), context\)/)
assert.doesNotMatch(fetchSource, /\bpage\s*:/)
assert.doesNotMatch(fetchSource, /startPage|collectProviderPages/)

const syncStart = source.indexOf('async function syncApiFootballDailyFixtures')
const syncEnd = source.indexOf('async function runDailyRankingStep', syncStart)
const syncSource = source.slice(syncStart, syncEnd)
assert.ok(syncStart >= 0 && syncEnd > syncStart)
assert.match(syncSource, /const providerPage = API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE/)
assert.doesNotMatch(syncSource, /providerPage\s*\+\s*1/)
assert.match(syncSource, /providerComplete: cursor\.providerComplete/)

console.log('daily fixtures pagination unit tests passed')
