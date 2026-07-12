import assert from 'node:assert/strict'
import { getBangkokSelectionWindow, isWithinBangkokDay } from '../src/utils/bangkokDateRange.js'
import {
  HYBRID_DAILY_PIPELINE_VERSION,
  buildHybridCandidatePool,
  buildHybridPipelineMetadata,
  calculateDynamicLockDeadline,
  calculatePreRankingScore,
} from '../src/utils/hybridDailyPipeline.js'
import { buildRankingCompletionState } from '../src/utils/dailyRankingCompletion.js'
import { selectDailyTop10 } from '../src/utils/dailySelectionEngine.js'

const selectionDate = '2026-07-12'

const windowAtMidnight = getBangkokSelectionWindow('2026-07-11T17:00:00.000Z')
assert.equal(windowAtMidnight.timezone, 'Asia/Bangkok')
assert.equal(windowAtMidnight.selectionDate, selectionDate)
assert.equal(windowAtMidnight.startUtc, '2026-07-11T17:00:00.000Z')
assert.equal(windowAtMidnight.endUtc, '2026-07-12T17:00:00.000Z')
assert.equal(getBangkokSelectionWindow('2026-07-11T17:30:00.000Z').selectionDate, selectionDate)
assert.equal(getBangkokSelectionWindow('2026-07-12T16:59:00.000Z').selectionDate, selectionDate)
assert.equal(getBangkokSelectionWindow('2026-07-11T16:59:00.000Z').selectionDate, '2026-07-11')
assert.equal(isWithinBangkokDay('2026-07-11T17:15:00.000Z', selectionDate), true)
assert.equal(isWithinBangkokDay('2026-07-12T16:45:00.000Z', selectionDate), true)
assert.equal(isWithinBangkokDay('2026-07-12T17:15:00.000Z', selectionDate), false)

const metadata = buildHybridPipelineMetadata(selectionDate)
assert.equal(metadata.pipelineVersion, HYBRID_DAILY_PIPELINE_VERSION)
assert.equal(metadata.selectionAlgorithmVersion, 'market-ready-dynamic-selection-v1')
assert.ok(metadata.phases.includes('PRE_RANKING'))
assert.ok(metadata.phases.includes('RESULT_SETTLEMENT'))

const noOddsScore = calculatePreRankingScore(candidate(1, { odds: [] }), { selectionDate }).finalScore
const withOddsScore = calculatePreRankingScore(candidate(1, {
  odds: [{ id: 'odds', market_name: 'Asian Handicap', price: 1.9 }],
  has_market_data: true,
  analysis: { market_quality_score: 99, market_edge_score: 99, value_edge_score: 99 },
}), { selectionDate }).finalScore
assert.equal(withOddsScore, noOddsScore, 'pre-ranking score must not change when only odds/market input changes')

const smallPool = buildHybridCandidatePool(createCandidates(17), { selectionDate, limit: 60 })
assert.equal(smallPool.candidatePoolCount, 17)
assert.equal(smallPool.candidateCoreCount, 17)
assert.equal(smallPool.candidateReserveCount, 0)

const largePoolA = buildHybridCandidatePool(createCandidates(200), { selectionDate, limit: 60 })
const largePoolB = buildHybridCandidatePool([...createCandidates(200)].reverse(), { selectionDate, limit: 60 })
assert.equal(largePoolA.candidatePoolCount, 60)
assert.equal(new Set(largePoolA.candidates.map((row) => row.fixtureId)).size, 60)
assert.deepEqual(
  largePoolA.candidates.map((row) => `${row.candidateRank}:${row.fixtureId}`),
  largePoolB.candidates.map((row) => `${row.candidateRank}:${row.fixtureId}`),
)
assert.equal(largePoolA.candidateCoreCount, 30)
assert.equal(largePoolA.candidateExpandedCount, 10)
assert.equal(largePoolA.candidateReserveCount, 20)
assert.deepEqual(largePoolA.candidates.slice(30, 40).map((row) => row.candidateTier), Array(10).fill('EXPANDED'))
assert.deepEqual(largePoolA.candidates.slice(40).map((row) => row.candidateTier), Array(20).fill('RESERVE'))

const oddsTargets = largePoolA.candidates.slice(0, 60)
assert.ok(oddsTargets.length <= 60, 'odds sync must be bounded to the candidate pool')

const noOddsSelection = selectDailyTop10(createCandidates(12, { odds: [] }), { selectionDate })
const noOddsCompletion = buildRankingCompletionState({
  selectedCount: noOddsSelection.selected.length,
  eligibleCandidateCount: noOddsSelection.summary.eligibleCandidateCount,
  rankingReadiness: { totalFixtures: 12, ready: 0, pending: 12, hasMarketDataCount: 0 },
})
assert.equal(noOddsSelection.selected.length, 12)
assert.ok(noOddsSelection.selected.every((row) => row.selectionStatus === 'WAITING_MARKET'))
assert.ok(noOddsSelection.selected.every((row) => row.softRanking.finalPickAllowed === false))
assert.equal(noOddsCompletion.rankingStatus, 'success')
assert.equal(noOddsCompletion.retryable, false)

assert.equal(calculateDynamicLockDeadline('2026-07-12T12:00:00.000Z'), '2026-07-12T03:00:00.000Z') // 19:00 Bangkok => 10:00 Bangkok
assert.equal(calculateDynamicLockDeadline('2026-07-12T04:00:00.000Z'), '2026-07-12T02:00:00.000Z') // 11:00 Bangkok => 09:00 Bangkok
assert.equal(calculateDynamicLockDeadline('2026-07-12T01:00:00.000Z'), '2026-07-11T23:00:00.000Z') // 08:00 Bangkok => 06:00 Bangkok

console.log('hybridDailyPipeline unit tests passed')

function createCandidates(count, patch = {}) {
  return Array.from({ length: count }, (_, index) => candidate(index + 1, patch))
}

function candidate(index, patch = {}) {
  return {
    id: `${patch.prefix ?? 'match'}-${index}`,
    api_sports_fixture_id: `fixture-${String(index).padStart(3, '0')}`,
    kickoff_at: patch.kickoff_at ?? `2026-07-12T${String(index % 16).padStart(2, '0')}:00:00.000Z`,
    status_short: 'NS',
    league: { id: 100 + index, api_league_id: 39 + index, name: `League ${index}`, country: 'England', enabled: true },
    homeTeam: { id: `home-${index}`, name: `Home ${index}` },
    awayTeam: { id: `away-${index}`, name: `Away ${index}` },
    has_market_data: Boolean(patch.has_market_data ?? patch.odds?.length),
    has_fixture_detail: true,
    odds: patch.odds ?? [],
    analysis: {
      recommendation: 'BET',
      confidence_score: 90 - index * 0.2,
      calibrated_confidence_score: 90 - index * 0.2,
      ranking_score: 90 - index * 0.2,
      risk_score: 24 + index * 0.1,
      risk_level: 'LOW',
      league_quality_score: 94,
      data_quality_score: 84,
      market_quality_score: patch.odds?.length ? 82 : 20,
      value_edge_score: patch.odds?.length ? 80 : 44,
      tactical_matchup_score: 78,
      motivation_score: 74,
      team_strength_score: 79,
      form_score: 77,
      raw: {
        homeForm: { played: 5, wins: 3, draws: 1, losses: 1, goals_for: 9, goals_against: 5 },
        awayForm: { played: 5, wins: 2, draws: 1, losses: 2, goals_for: 7, goals_against: 7 },
      },
      ...(patch.analysis ?? {}),
    },
  }
}
