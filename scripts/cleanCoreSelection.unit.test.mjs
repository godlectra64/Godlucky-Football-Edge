import assert from 'node:assert/strict'

import {
  buildCandidatePool,
  rankCandidates,
  validateDynamicRanking,
} from '../supabase/functions/_shared/cleanCore/selection.js'

assert.deepEqual(buildCandidatePool([]), [])
for (const count of [0, 1, 9, 10, 11, 100]) {
  const ranked = rankCandidates(Array.from({ length: count }, (_, index) => fixture(index + 1, 100 - index)))
  assert.equal(ranked.length, count, `${count} eligible fixtures must remain dynamic`)
  assert.deepEqual(ranked.map(({ rank }) => rank), Array.from({ length: count }, (_, index) => index + 1))
  assert.equal(new Set(ranked.map(({ rank }) => rank)).size, count)
  assert.equal(validateDynamicRanking(ranked).valid, true)
}

const duplicateNumberAndString = [fixture(1, 70), fixture('1', 90), fixture(2, 60)]
const duplicateForward = rankCandidates(duplicateNumberAndString)
const duplicateReverse = rankCandidates([...duplicateNumberAndString].reverse())
assert.deepEqual(duplicateForward, duplicateReverse, 'duplicate normalization must not depend on input order')
assert.equal(duplicateForward.length, 2)
assert.equal(duplicateForward[0].preRankingScore, 90, 'highest deterministic pre-ranking record must win a duplicate ID')
assert.equal(buildCandidatePool([fixture('01', 80), fixture(1, 70)]).length, 1, 'numeric ID aliases must deduplicate')

const duplicateFixtureValidation = validateDynamicRanking([{ id: 1, rank: 1 }, { id: '1', rank: 2 }])
assert.ok(duplicateFixtureValidation.errors.includes('DUPLICATE_FIXTURE_ID:1'))
const duplicateRankValidation = validateDynamicRanking([{ id: 1, rank: 1 }, { id: 2, rank: 1 }])
assert.ok(duplicateRankValidation.errors.includes('DUPLICATE_RANK:1'))
assert.ok(validateDynamicRanking([{ id: 1, rank: 2 }]).errors.includes('RANK_SEQUENCE_INVALID:EXPECTED_1'))

const tied = rankCandidates([fixture(20, 75), fixture(3, 75), fixture(11, 75)])
assert.deepEqual(tied.map(({ id }) => id), [3, 11, 20], 'fixture ID must break score ties deterministically')

const stableFixtures = [fixture(9, 70), fixture(2, 80), fixture(5, 80), fixture(1, 0)]
assert.deepEqual(rankCandidates(stableFixtures), rankCandidates([...stableFixtures].reverse()), 'ranking must be stable when input order changes')

const oddsVariantA = rankCandidates([
  { ...fixture(1, 80), odds: [{ price: 1.4 }], marketAvailable: false },
  { ...fixture(2, 70), odds: [{ price: 9.9 }], marketAvailable: true },
])
const oddsVariantB = rankCandidates([
  { ...fixture(1, 80), odds: [{ price: 99 }], marketAvailable: true },
  { ...fixture(2, 70), odds: [], marketAvailable: false },
])
assert.deepEqual(oddsVariantA, oddsVariantB, 'odds and market availability must not affect or leak into pre-ranking output')
const unreadOdds = fixture(3, 60)
Object.defineProperty(unreadOdds, 'odds', {
  enumerable: true,
  get() { throw new Error('pre-ranking must not read odds') },
})
assert.doesNotThrow(() => rankCandidates([unreadOdds]))

const scoreEdges = rankCandidates([
  fixture(1, 0),
  fixture(2, NaN),
  fixture(3, Infinity),
  fixture(4, undefined),
  fixture(5, '25'),
  fixture(6, Symbol('invalid')),
])
assert.equal(scoreEdges.find(({ id }) => id === 1).preRankingScore, 0, 'score 0 must not be missing')
assert.equal(scoreEdges.find(({ id }) => id === 2).preRankingScore, 0, 'NaN must normalize to 0')
assert.equal(scoreEdges.find(({ id }) => id === 3).preRankingScore, 0, 'Infinity must normalize to 0')
assert.equal(scoreEdges.find(({ id }) => id === 4).preRankingScore, 0, 'missing score contract is 0')
assert.equal(scoreEdges.find(({ id }) => id === 5).preRankingScore, 25, 'numeric strings are normalized consistently')
assert.equal(scoreEdges.find(({ id }) => id === 6).preRankingScore, 0, 'malformed scores must not throw or enter ranking as NaN')

const invalidExcluded = buildCandidatePool([fixture(1, 80), fixture(2, 70, { status: 'FT' })])
assert.deepEqual(invalidExcluded.map(({ id }) => id), [1])

const frozenInput = deepFreeze([fixture(1, 80), fixture(2, 70)])
const frozenBefore = JSON.stringify(frozenInput)
assert.doesNotThrow(() => rankCandidates(frozenInput))
assert.equal(JSON.stringify(frozenInput), frozenBefore, 'ranking must not mutate frozen input')

console.log('clean core selection unit tests passed')

function fixture(id, score, overrides = {}) {
  return {
    id,
    homeTeam: { id: `home-${id}`, name: `Home ${id}` },
    awayTeam: { id: `away-${id}`, name: `Away ${id}` },
    kickoffAt: '2030-07-20T12:00:00.000Z',
    league: { id: 99, name: 'Test League' },
    status: 'NS',
    leagueQualityScore: score,
    dataQualityScore: score,
    baseAnalysisScore: score,
    formScore: score,
    ...overrides,
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}
