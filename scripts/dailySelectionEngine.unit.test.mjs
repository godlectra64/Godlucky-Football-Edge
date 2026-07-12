import assert from 'node:assert/strict'
import {
  DAILY_SELECTION_ALGORITHM_VERSION,
  dailySelectionConfig,
  evaluateHardFilter,
  selectDailyTop10,
} from '../src/utils/dailySelectionEngine.js'

const selectionDate = '2026-07-12'

assert.ok(Math.abs(Object.values(dailySelectionConfig.weights).reduce((total, value) => total + value, 0) - 1) < 0.000001)

const fullMarket = { id: 'odds', match_id: 'x', market_name: 'Asian Handicap', price: 1.9 }

const scenario1 = selectDailyTop10(createCandidates(20, { odds: [fullMarket] }), { selectionDate })
assert.equal(scenario1.selected.length, 10)
assert.deepEqual(scenario1.selected.map((row) => row.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
assert.equal(new Set(scenario1.selected.map((row) => row.fixtureId)).size, 10)
assert.ok(scenario1.selected.every((row) => row.tier === 'PRIMARY'))

const scenario2Rows = [
  ...createCandidates(10, { odds: [fullMarket], prefix: 'market' }),
  ...createCandidates(6, { odds: [], prefix: 'no-market', scoreOffset: -1 }),
]
const scenario2 = selectDailyTop10(scenario2Rows, { selectionDate })
assert.equal(scenario2.selected.length, 10)
assert.equal(scenario2.rejected.filter((row) => row.hardFilter.reasons.some((item) => item.code === 'WAITING_MARKET_DATA')).length, 0)
assert.ok(scenario2.candidates.some((row) => !row.hasMarketData && row.softRanking.penalties.some((item) => item.code === 'MISSING_MARKET_DATA')))
assert.ok(scenario2.selected.filter((row) => !row.hasMarketData).every((row) => row.selectionStatus === 'SELECTED_WAITING_MARKET'))
assert.ok(scenario2.selected.filter((row) => !row.hasMarketData).every((row) => row.softRanking.finalPickAllowed === false))

const scenario3 = selectDailyTop10(createCandidates(8, { odds: [fullMarket] }), { selectionDate })
assert.equal(scenario3.selected.length, 8)
assert.equal(scenario3.summary.healthStatus, 'INSUFFICIENT_ELIGIBLE_CANDIDATES')

const sameLeague = selectDailyTop10(createCandidates(14, { odds: [fullMarket], league: { name: 'Same League', country: 'England' } }), { selectionDate })
assert.equal(sameLeague.selected.length, 10)
assert.ok(sameLeague.selected.some((row) => row.tier === 'SECONDARY' || row.tier === 'FALLBACK'))

for (const status_short of ['CANC', 'PST', 'FT']) {
  const rejected = evaluateHardFilter(candidate(1, { status_short, odds: [fullMarket] }), buildContext())
  assert.equal(rejected.passed, false)
  assert.ok(rejected.reasons.some((item) => item.code === 'INVALID_FIXTURE_STATUS'))
}

const noOddsWithStats = selectDailyTop10(createCandidates(12, { odds: [], scoreOffset: 0 }), { selectionDate })
assert.equal(noOddsWithStats.selected.length, 10)
assert.ok(noOddsWithStats.selected.every((row) => row.softRanking.finalScore >= 0 && row.softRanking.finalScore <= 100))
assert.ok(noOddsWithStats.selected.every((row) => row.selectionStatus === 'SELECTED_WAITING_MARKET'))

const ordered = createCandidates(14, { odds: [fullMarket] })
const shuffled = [...ordered].reverse()
assert.deepEqual(
  selectDailyTop10(ordered, { selectionDate }).selected.map((row) => row.fixtureId),
  selectDailyTop10(shuffled, { selectionDate }).selected.map((row) => row.fixtureId),
)

const bangkokBoundary = selectDailyTop10([
  candidate(1, { kickoff_at: '2026-07-11T17:00:00.000Z', odds: [fullMarket] }),
  candidate(2, { kickoff_at: '2026-07-12T16:59:59.000Z', odds: [fullMarket] }),
  candidate(3, { kickoff_at: '2026-07-12T17:00:00.000Z', odds: [fullMarket] }),
], { selectionDate })
assert.deepEqual(bangkokBoundary.selected.map((row) => row.fixtureId), ['fixture-match-1', 'fixture-match-2'])

const rerunA = selectDailyTop10(createCandidates(12, { odds: [fullMarket] }), { selectionDate })
const rerunB = selectDailyTop10(createCandidates(12, { odds: [fullMarket] }), { selectionDate })
assert.deepEqual(rerunA.selected.map((row) => `${row.rank}:${row.fixtureId}`), rerunB.selected.map((row) => `${row.rank}:${row.fixtureId}`))

const malformed = selectDailyTop10([
  candidate(1, {
    odds: [fullMarket],
    analysis: {
      confidence_score: null,
      risk_score: Number.NaN,
      market_quality_score: 'unknown',
      league_quality_score: 150,
      team_strength_score: 60,
    },
  }),
], { selectionDate })
assert.equal(malformed.selected.length, 1)
assert.ok(Number.isFinite(malformed.selected[0].softRanking.finalScore))
assert.ok(malformed.selected[0].softRanking.finalScore >= 0 && malformed.selected[0].softRanking.finalScore <= 100)
assert.equal(malformed.algorithmVersion, DAILY_SELECTION_ALGORITHM_VERSION)

console.log('dailySelectionEngine unit tests passed')

function createCandidates(count, patch = {}) {
  return Array.from({ length: count }, (_, index) => candidate(index + 1, patch))
}

function candidate(index, patch = {}) {
  const league = patch.league ?? { id: 39 + index, api_league_id: 39, name: `Premier League ${index}`, country: 'England', enabled: true }
  const analysis = {
    recommendation: 'BET',
    confidence_score: 88 - index * 0.4 + Number(patch.scoreOffset ?? 0),
    calibrated_confidence_score: 88 - index * 0.4 + Number(patch.scoreOffset ?? 0),
    ranking_score: 88 - index * 0.4 + Number(patch.scoreOffset ?? 0),
    risk_score: 30 + index * 0.5,
    risk_level: 'LOW',
    league_quality_score: 96,
    data_quality_score: 82,
    market_quality_score: patch.odds?.length ? 80 : 25,
    value_edge_score: patch.odds?.length ? 78 : 45,
    tactical_matchup_score: 76,
    motivation_score: 72,
    team_strength_score: 78,
    form_score: 76,
    raw: {
      homeForm: { played: 5, wins: 3, draws: 1, losses: 1, goals_for: 9, goals_against: 5 },
      awayForm: { played: 5, wins: 2, draws: 1, losses: 2, goals_for: 7, goals_against: 7 },
    },
    ...(patch.analysis ?? {}),
  }
  return {
    id: `${patch.prefix ?? 'match'}-${index}`,
    api_sports_fixture_id: `fixture-${patch.prefix ?? 'match'}-${index}`,
    kickoff_at: patch.kickoff_at ?? `2026-07-12T${String(index % 16).padStart(2, '0')}:00:00.000Z`,
    status_short: patch.status_short ?? 'NS',
    league,
    homeTeam: { id: `home-${index}`, name: `Home ${index}` },
    awayTeam: { id: `away-${index}`, name: `Away ${index}` },
    has_market_data: Boolean(patch.odds?.length),
    has_fixture_detail: true,
    odds: patch.odds ?? [],
    analysis,
  }
}

function buildContext() {
  return {
    selectionDate,
    fixtureIdCounts: new Map(),
  }
}
