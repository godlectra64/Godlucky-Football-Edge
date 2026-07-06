import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settleAiPickResult } from '../src/utils/resultSettlement.js'
import { getResultTrackerStatusLabel } from '../src/utils/matchStatus.js'

const cases = [
  ['FT + MATCH_WINNER HOME hit', { statusShort: 'FT', homeScore: 2, awayScore: 1, marketFocus: 'MATCH_WINNER', direction: 'HOME' }, 'HIT', 'SETTLED'],
  ['FT + MATCH_WINNER HOME miss', { statusShort: 'FT', homeScore: 1, awayScore: 2, marketFocus: 'MATCH_WINNER', direction: 'HOME' }, 'MISS', 'SETTLED'],
  ['OU OVER 2.5 total 3 hit', { statusShort: 'FT', homeScore: 2, awayScore: 1, marketFocus: 'OU', direction: 'OVER', line: 2.5 }, 'HIT', 'SETTLED'],
  ['OU UNDER 2.5 total 3 miss', { statusShort: 'FT', homeScore: 2, awayScore: 1, marketFocus: 'OU', direction: 'UNDER', line: 2.5 }, 'MISS', 'SETTLED'],
  ['OU line 2 total 2 push', { statusShort: 'FT', homeScore: 1, awayScore: 1, marketFocus: 'OU', direction: 'OVER', line: 2 }, 'PUSH', 'SETTLED'],
  ['AH HOME -1 score 2-1 push', { statusShort: 'FT', homeScore: 2, awayScore: 1, marketFocus: 'AH', direction: 'HOME', line: -1 }, 'PUSH', 'SETTLED'],
  ['AH HOME -0.5 score 2-1 hit', { statusShort: 'FT', homeScore: 2, awayScore: 1, marketFocus: 'AH', direction: 'HOME', line: -0.5 }, 'HIT', 'SETTLED'],
  ['AH AWAY +1 score 2-1 push', { statusShort: 'FT', homeScore: 2, awayScore: 1, marketFocus: 'AH', direction: 'AWAY', line: 1 }, 'PUSH', 'SETTLED'],
  ['NS pending', { statusShort: 'NS', homeScore: null, awayScore: null, marketFocus: 'MATCH_WINNER', direction: 'HOME' }, 'PENDING', 'PENDING'],
  ['CANC void', { statusShort: 'CANC', homeScore: null, awayScore: null, marketFocus: 'MATCH_WINNER', direction: 'HOME' }, 'VOID', 'VOID'],
  ['OU missing line void', { statusShort: 'FT', homeScore: 2, awayScore: 1, marketFocus: 'OU', direction: 'OVER' }, 'VOID', 'VOID'],
  ['finished score missing pending', { statusShort: 'FT', homeScore: null, awayScore: 1, marketFocus: 'MATCH_WINNER', direction: 'HOME' }, 'PENDING', 'PENDING'],
]

for (const [name, input, expectedOutcome, expectedStatus] of cases) {
  const actual = settleAiPickResult(input)
  assert.equal(actual.simulation_outcome, expectedOutcome, `${name}: simulation_outcome`)
  assert.equal(actual.settlement_status, expectedStatus, `${name}: settlement_status`)
}

assert.equal(
  getResultTrackerStatusLabel({ statusShort: 'FT', homeScore: 2, awayScore: 1, settlementStatus: 'PENDING' }),
  'จบแล้ว',
  'Result Tracker must show finished matches with scores as จบแล้ว even before settlement catches up',
)
assert.equal(getResultTrackerStatusLabel({ statusShort: 'NS', settlementStatus: 'PENDING' }), 'รอผล', 'scheduled Result Tracker rows should show รอผล')
assert.equal(getResultTrackerStatusLabel({ statusShort: 'CANC', settlementStatus: 'VOID' }), 'ไม่ประเมิน', 'void Result Tracker rows should show ไม่ประเมิน')

const edgeSource = readFileSync('supabase/functions/sync-football-data/index.ts', 'utf8')
assert.match(edgeSource, /function normalizeResultFixtureId[\s\S]*Math\.abs/, 'edge result pipeline must normalize fixture ids to positive values')
assert.match(edgeSource, /trackedApiFootballGet\(context, '\/fixtures', \{ id: fixtureId \}/, 'API-Football fixture fetch must use normalized fixtureId')
assert.match(edgeSource, /api_fixture_id\.eq\.\$\{-id\}/, 'candidate lookup must support legacy negative football_matches.api_fixture_id')
assert.match(edgeSource, /api_fixture_id: normalizeResultFixtureId\(row\.api_fixture_id \?\? pick\.api_fixture_id\)/, 'backfill must store positive result api_fixture_id')
assert.match(edgeSource, /\.upsert\(rows, \{ onConflict: 'ai_final_pick_id' \}\)/, 'result backfill must upsert by ai_final_pick_id for idempotent reruns')
assert.doesNotMatch(edgeSource, /\.upsert\(rows, \{ onConflict: 'match_id,selection_date' \}\)/, 'result backfill must not use match/date as the primary conflict target')
assert.match(edgeSource, /uniqueRowsByAiFinalPickId/, 'result backfill must dedupe payload rows by ai_final_pick_id before upsert')
assert.match(edgeSource, /api_fixture_id: normalizeResultFixtureId\(row\.api_fixture_id \?\? match\.api_fixture_id \?\? match\.api_sports_fixture_id\)/, 'settlement must normalize copied result api_fixture_id')
assert.match(edgeSource, /const matchHomeScore = nullableNumber\(match\.home_score \?\? match\.home_goals\)/, 'settlement must normalize home score before updating result rows')
assert.match(edgeSource, /const matchAwayScore = nullableNumber\(match\.away_score \?\? match\.away_goals\)/, 'settlement must normalize away score before updating result rows')
assert.match(edgeSource, /home_score: matchHomeScore/, 'settlement must copy normalized home score into result rows')
assert.match(edgeSource, /away_score: matchAwayScore/, 'settlement must copy normalized away score into result rows')
assert.match(edgeSource, /settlement_status: outcome\.settlement_status/, 'settlement must update settlement_status')
assert.match(edgeSource, /settledRows/, 'result pipeline response must include settledRows diagnostic')
assert.match(edgeSource, /scoreUpdatedRows/, 'result pipeline response must include scoreUpdatedRows diagnostic')

console.log(`result settlement smoke tests passed (${cases.length})`)
