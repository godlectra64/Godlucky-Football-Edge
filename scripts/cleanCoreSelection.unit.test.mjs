import assert from 'node:assert/strict'

import {
  buildCandidatePool,
  rankCandidates,
  validateDynamicRanking,
} from '../supabase/functions/_shared/cleanCore/selection.js'

assert.deepEqual(buildCandidatePool([]), [], 'zero candidates must be valid')

const fewerThanTen = Array.from({ length: 4 }, (_, index) => fixture(index + 1, 80 - index))
assert.equal(rankCandidates(fewerThanTen).length, 4, 'fewer than ten candidates must remain dynamic')

const moreThanTen = Array.from({ length: 14 }, (_, index) => fixture(index + 1, 80 - index))
const rankedMoreThanTen = rankCandidates(moreThanTen)
assert.equal(rankedMoreThanTen.length, 14, 'more than ten candidates must remain dynamic')
assert.equal(rankedMoreThanTen.some((candidate) => candidate.rank > 10), true, 'ranking must not truncate at ten')
assert.equal(validateDynamicRanking(rankedMoreThanTen).valid, true)

const duplicatePool = buildCandidatePool([fixture(1, 80), fixture(1, 70), fixture(2, 60)])
assert.deepEqual(duplicatePool.map((candidate) => candidate.id), [1, 2], 'duplicate fixtures must be prevented')

const duplicateFixtureValidation = validateDynamicRanking([
  { id: 1, rank: 1 },
  { id: 1, rank: 2 },
])
assert.equal(duplicateFixtureValidation.valid, false)
assert.ok(duplicateFixtureValidation.errors.includes('DUPLICATE_FIXTURE_ID:1'))

const duplicateRankValidation = validateDynamicRanking([
  { id: 1, rank: 1 },
  { id: 2, rank: 1 },
])
assert.equal(duplicateRankValidation.valid, false)
assert.ok(duplicateRankValidation.errors.includes('DUPLICATE_RANK:1'))

const tied = rankCandidates([fixture(20, 75), fixture(3, 75), fixture(11, 75)])
assert.deepEqual(tied.map((candidate) => candidate.id), [3, 11, 20], 'fixture id must break score ties deterministically')

const oddsVariantA = rankCandidates([
  { ...fixture(1, 80), odds: [{ price: 1.4 }], marketAvailable: false },
  { ...fixture(2, 70), odds: [{ price: 9.9 }], marketAvailable: true },
])
const oddsVariantB = rankCandidates([
  { ...fixture(1, 80), odds: [{ price: 99 }], marketAvailable: true },
  { ...fixture(2, 70), odds: [], marketAvailable: false },
])
assert.deepEqual(
  oddsVariantA.map(({ id, rank, preRankingScore }) => ({ id, rank, preRankingScore })),
  oddsVariantB.map(({ id, rank, preRankingScore }) => ({ id, rank, preRankingScore })),
  'odds and market availability must not affect pre-ranking',
)

const invalidExcluded = buildCandidatePool([fixture(1, 80), { ...fixture(2, 70), status: 'FT' }])
assert.deepEqual(invalidExcluded.map((candidate) => candidate.id), [1], 'invalid fixtures must be excluded')

console.log('clean core selection unit tests passed')

function fixture(id, score) {
  return {
    id,
    homeTeam: { name: `Home ${id}` },
    awayTeam: { name: `Away ${id}` },
    kickoffAt: '2030-07-20T12:00:00.000Z',
    league: { name: 'Test League' },
    status: 'NS',
    leagueQualityScore: score,
    dataQualityScore: score,
    baseAnalysisScore: score,
    formScore: score,
  }
}
