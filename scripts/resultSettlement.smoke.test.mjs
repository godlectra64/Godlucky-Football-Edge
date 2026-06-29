import assert from 'node:assert/strict'
import { settleAiPickResult } from '../src/utils/resultSettlement.js'

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

console.log(`result settlement smoke tests passed (${cases.length})`)
