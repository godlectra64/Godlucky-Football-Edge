import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRankingCompletionState } from '../src/utils/dailyRankingCompletion.js'
import { selectDailyTop10 } from '../src/utils/dailySelectionEngine.js'

const selectionDate = '2026-07-12'

const noMarketCompletion = buildRankingCompletionState({
  selectedCount: 10,
  eligibleCandidateCount: 17,
  rankingReadiness: {
    totalFixtures: 17,
    ready: 0,
    partial: 0,
    noMarketData: 17,
    pending: 0,
    hasMarketDataCount: 0,
  },
})
assert.equal(noMarketCompletion.rankingStatus, 'success')
assert.equal(noMarketCompletion.selectionCompleted, true)
assert.equal(noMarketCompletion.retryable, false)
assert.equal(noMarketCompletion.retryReasonCode, 'NONE')
assert.equal(noMarketCompletion.marketReadinessStatus, 'waiting_market')
assert.equal(noMarketCompletion.bettingReadiness, 'NOT_READY')

const productionReadinessCompletion = buildRankingCompletionState({
  selectedCount: 10,
  eligibleCandidateCount: 17,
  rankingReadiness: {
    totalFixtures: 17,
    ready: 0,
    partial: 2,
    noMarketData: 1,
    pending: 14,
    failed: 0,
    hasMarketDataCount: 2,
    hasFixtureDetailCount: 5,
  },
})
assert.equal(productionReadinessCompletion.rankingStatus, 'success')
assert.equal(productionReadinessCompletion.selectionCompleted, true)
assert.equal(productionReadinessCompletion.retryable, false)
assert.equal(productionReadinessCompletion.marketReadinessStatus, 'market_partial')
assert.equal(productionReadinessCompletion.bettingReadiness, 'NOT_READY')

const writeFailureCompletion = buildRankingCompletionState({
  selectedCount: 9,
  eligibleCandidateCount: 17,
  writeFailures: 1,
  rankingReadiness: { totalFixtures: 17, ready: 0, pending: 17 },
})
assert.equal(writeFailureCompletion.rankingStatus, 'pending_retry')
assert.equal(writeFailureCompletion.selectionCompleted, false)
assert.equal(writeFailureCompletion.retryable, true)
assert.equal(writeFailureCompletion.retryReasonCode, 'DATABASE_WRITE_FAILED')

const noOddsSelection = selectDailyTop10(createCandidates(12, { odds: [] }), { selectionDate })
assert.equal(noOddsSelection.selected.length, 10)
assert.ok(noOddsSelection.selected.every((row) => row.selectionStatus === 'SELECTED_WAITING_MARKET'))
assert.ok(noOddsSelection.selected.every((row) => row.softRanking.finalPickAllowed === false))
const noOddsCompletion = buildRankingCompletionState({
  selectedCount: noOddsSelection.selected.length,
  eligibleCandidateCount: noOddsSelection.summary.eligibleCandidateCount,
  rankingReadiness: { totalFixtures: 12, ready: 0, noMarketData: 12, hasMarketDataCount: 0 },
})
assert.equal(noOddsCompletion.rankingStatus, 'success')
assert.equal(noOddsCompletion.selectionCompleted, true)
assert.equal(noOddsCompletion.bettingReadiness, 'NOT_READY')

const rerunRows = createCandidates(14, { odds: [{ id: 'odds', market_name: 'Asian Handicap', price: 1.91 }] })
const rerunA = selectDailyTop10(rerunRows, { selectionDate })
const rerunB = selectDailyTop10([...rerunRows].reverse(), { selectionDate })
assert.deepEqual(
  rerunA.selected.map((row) => `${row.rank}:${row.fixtureId}`),
  rerunB.selected.map((row) => `${row.rank}:${row.fixtureId}`),
)

const shortSelection = selectDailyTop10(createCandidates(8, { odds: [] }), { selectionDate })
const shortCompletion = buildRankingCompletionState({
  selectedCount: shortSelection.selected.length,
  eligibleCandidateCount: shortSelection.summary.eligibleCandidateCount,
  rankingReadiness: { totalFixtures: 8, ready: 0, noMarketData: 8 },
})
assert.equal(shortCompletion.rankingStatus, 'success')
assert.equal(shortCompletion.selectionCompleted, true)
assert.equal(shortCompletion.selectionHealth, 'INSUFFICIENT_ELIGIBLE_CANDIDATES')
assert.equal(shortCompletion.retryable, false)

const orchestratorSource = readFileSync('supabase/functions/sync-football-data/index.ts', 'utf8')
assert.ok(orchestratorSource.includes('buildRankingCompletionState'))
assert.equal(orchestratorSource.includes('readyFixtures === 0'), false)

console.log('dailyRankingCompletion unit tests passed')

function createCandidates(count, patch = {}) {
  return Array.from({ length: count }, (_, index) => candidate(index + 1, patch))
}

function candidate(index, patch = {}) {
  return {
    id: `${patch.prefix ?? 'match'}-${index}`,
    api_sports_fixture_id: `fixture-${patch.prefix ?? 'match'}-${index}`,
    kickoff_at: `2026-07-12T${String(index % 16).padStart(2, '0')}:00:00.000Z`,
    status_short: 'NS',
    league: { id: 100 + index, api_league_id: 39 + index, name: `League ${index}`, country: 'England', enabled: true },
    homeTeam: { id: `home-${index}`, name: `Home ${index}` },
    awayTeam: { id: `away-${index}`, name: `Away ${index}` },
    has_market_data: Boolean(patch.odds?.length),
    has_fixture_detail: true,
    odds: patch.odds ?? [],
    analysis: {
      recommendation: 'BET',
      confidence_score: 90 - index * 0.5,
      calibrated_confidence_score: 90 - index * 0.5,
      ranking_score: 90 - index * 0.5,
      risk_score: 25 + index,
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
    },
  }
}
