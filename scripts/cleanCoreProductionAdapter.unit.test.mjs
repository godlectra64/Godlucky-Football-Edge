import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  CLEAN_CORE_DECISION_ADAPTER_VERSION,
  CLEAN_CORE_SHADOW_MISMATCH_CODES,
  adaptCleanCoreDecision,
  buildCleanCoreShadowComparison,
  runCleanCoreDecisionShadow,
} from '../supabase/functions/_shared/cleanCoreDecisionAdapter.js'
import {
  DECISION_STATUS,
  MARKET_TYPE,
  MATCH_STATUS_CATEGORY,
  REASON_CODE,
} from '../supabase/functions/_shared/cleanCore/contracts.js'

for (const status of ['NS', 'TBD', 'SCHEDULED', ' ns ', '  tbd  ', ' scheduled ']) {
  const output = adaptCleanCoreDecision(readyInput({
    fixture: fixture({ status_short: status }),
  }))
  assert.equal(output.normalizedFixtureStatus, status.trim().toUpperCase())
  assert.equal(output.statusCategory, MATCH_STATUS_CATEGORY.PREMATCH_DECISION_ELIGIBLE)
  assert.equal(output.decisionEligible, true)
  assert.equal(output.decisionStatus, DECISION_STATUS.READY, status)
  assert.equal(output.actionableFinalPickPresent, true, status)
}

const watch = adaptCleanCoreDecision(readyInput({
  analysis: analysis({
    ranking_score: 74,
    calibrated_confidence_score: 74,
    confidence_score: 74,
  }),
}))
assert.equal(watch.decisionStatus, DECISION_STATUS.WATCH)
assert.equal(watch.reasonCode, REASON_CODE.WATCH_CONFIDENCE_BELOW_READY)
assert.equal(watch.actionableFinalPickPresent, false)
assert.equal(watch.mappedFinalPick, null)

for (const status of ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE', 'IN_PLAY']) {
  const output = adaptCleanCoreDecision(readyInput({
    fixture: fixture({ status_short: status }),
    analysis: analysis({
      ranking_score: 100,
      calibrated_confidence_score: 100,
      confidence_score: 100,
    }),
  }))
  assert.equal(output.normalizedFixtureStatus, status)
  assert.equal(output.statusCategory, MATCH_STATUS_CATEGORY.STARTED_OR_LIVE, status)
  assert.equal(output.decisionEligible, false, status)
  assert.equal(output.decisionStatus, DECISION_STATUS.REJECTED, status)
  assert.equal(output.reasonCode, REASON_CODE.REJECT_MATCH_ALREADY_STARTED, status)
  assert.equal(output.actionableFinalPickPresent, false, status)
  assert.equal(output.mappedFinalPick, null, status)
}

const startedFixture = fixture({ status_short: 'LIVE' })
const startedLegacy = legacyReady({
  pickConfidence: 100,
  confidenceScore: 100,
})
const startedPayload = legacyPayload()
const startedShadow = runCleanCoreDecisionShadow({
  ...readyInput({
    fixture: startedFixture,
    analysis: analysis({
      ranking_score: 100,
      calibrated_confidence_score: 100,
      confidence_score: 100,
    }),
  }),
  legacyResult: startedLegacy,
  legacyWritePayload: startedPayload,
  invocationMode: 'recompute-ai-final-picks',
})
assert.equal(startedShadow.cleanCoreDecision.actionableFinalPickPresent, false)
assert.ok(startedShadow.comparison.mismatchCodes.includes('ELIGIBILITY_MISMATCH'))
assert.ok(startedShadow.comparison.mismatchCodes.includes('DECISION_STATUS_MISMATCH'))
assert.ok(startedShadow.comparison.mismatchCodes.includes('ACTIONABLE_PICK_MISMATCH'))
assert.strictEqual(startedShadow.legacyWritePayload, startedPayload)
assert.deepEqual(startedShadow.legacyWritePayload, startedPayload)

for (const status of ['PST', ' pst ', ' postponed ']) {
  const output = adaptCleanCoreDecision(readyInput({
    fixture: fixture({ status_short: status }),
  }))
  assert.equal(output.normalizedFixtureStatus, 'PST', status)
  assert.equal(output.statusCategory, MATCH_STATUS_CATEGORY.RETRYABLE_NOT_READY, status)
  assert.equal(output.decisionStatus, DECISION_STATUS.WAIT, status)
  assert.equal(output.reasonCode, REASON_CODE.WAIT_MATCH_RESCHEDULE, status)
  assert.equal(output.actionableFinalPickPresent, false, status)
}

for (const status of ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO']) {
  const output = adaptCleanCoreDecision(readyInput({
    fixture: fixture({ status_short: status }),
  }))
  assert.equal(output.statusCategory, MATCH_STATUS_CATEGORY.TERMINAL_OR_VOID, status)
  assert.equal(output.decisionEligible, false, status)
  assert.equal(output.decisionStatus, DECISION_STATUS.REJECTED, status)
  assert.equal(output.reasonCode, REASON_CODE.REJECT_MATCH_NOT_PLAYABLE, status)
  assert.equal(output.actionableFinalPickPresent, false, status)
}

const terminalBeforeStale = adaptCleanCoreDecision(readyInput({
  fixture: fixture({ status_short: 'FT' }),
  marketState: marketState({ fresh: false }),
}))
assert.equal(terminalBeforeStale.reasonCode, REASON_CODE.REJECT_MATCH_NOT_PLAYABLE)
assert.ok(terminalBeforeStale.reasonCodes.includes(REASON_CODE.WAIT_MARKET_STALE))

const unknownStatus = adaptCleanCoreDecision(readyInput({
  fixture: fixture({ status_short: 'provider-new-state' }),
}))
assert.equal(unknownStatus.normalizedFixtureStatus, 'PROVIDER_NEW_STATE')
assert.equal(unknownStatus.statusCategory, MATCH_STATUS_CATEGORY.UNKNOWN)
assert.equal(unknownStatus.decisionEligible, false)
assert.equal(unknownStatus.decisionStatus, DECISION_STATUS.REJECTED)
assert.equal(unknownStatus.reasonCode, REASON_CODE.REJECT_FIXTURE_INVALID)
assert.equal(unknownStatus.actionableFinalPickPresent, false)

const missingStatusInput = readyInput({ fixture: fixture({ status_short: undefined }) })
delete missingStatusInput.fixture.status
delete missingStatusInput.fixture.match_status
const missingStatus = adaptCleanCoreDecision(missingStatusInput)
assert.equal(missingStatus.normalizedFixtureStatus, 'UNKNOWN')
assert.equal(missingStatus.decisionStatus, DECISION_STATUS.REJECTED)
assert.equal(missingStatus.actionableFinalPickPresent, false)
assert.equal(missingStatus.inputCompleteness.complete, false)
assert.ok(missingStatus.inputCompleteness.missingFields.includes('fixture.status'))
assert.ok(comparisonFor(missingStatusInput, missingStatus).mismatchCodes.includes('CORE_INPUT_INCOMPLETE'))

for (const [name, malformedFixture, expectedMissing] of [
  [
    'missing home team',
    fixture({ homeTeam: { api_team_id: 1 }, status_short: 'LIVE' }),
    'fixture.homeTeam.name',
  ],
  [
    'invalid kickoff',
    fixture({ kickoff_at: 'not-a-date' }),
    null,
  ],
  [
    'missing league id',
    fixture({ api_sports_league_id: undefined, league: { name: 'Test League' } }),
    'fixture.league.id',
  ],
  [
    'missing league name',
    fixture({ league: { api_league_id: 99 } }),
    'fixture.league.name',
  ],
]) {
  const output = adaptCleanCoreDecision(readyInput({ fixture: malformedFixture }))
  assert.equal(output.decisionStatus, DECISION_STATUS.REJECTED, name)
  assert.equal(output.reasonCode, REASON_CODE.REJECT_FIXTURE_INVALID, name)
  assert.equal(output.actionableFinalPickPresent, false, name)
  assert.equal(output.inputCompleteness.complete, false, name)
  if (expectedMissing) assert.ok(output.inputCompleteness.missingFields.includes(expectedMissing), name)
}

const malformedBeforeStarted = adaptCleanCoreDecision(readyInput({
  fixture: fixture({
    status_short: 'LIVE',
    homeTeam: { api_team_id: 1 },
  }),
}))
assert.equal(malformedBeforeStarted.reasonCode, REASON_CODE.REJECT_FIXTURE_INVALID)
assert.ok(malformedBeforeStarted.reasonCodes.includes(REASON_CODE.REJECT_MATCH_ALREADY_STARTED))

for (const [marketType, selection, line, expectedType] of [
  ['AH', 'HOME', -0.5, MARKET_TYPE.ASIAN_HANDICAP],
  ['AH', 'HOME', '-0.5', MARKET_TYPE.ASIAN_HANDICAP],
  ['OU', 'OVER', 2.5, MARKET_TYPE.OVER_UNDER],
  ['OU', 'UNDER', '2.5', MARKET_TYPE.OVER_UNDER],
]) {
  const output = adaptCleanCoreDecision(readyInput({
    analysis: analysis({
      value_market: marketType,
      value_side: selection,
      value_line: line,
    }),
    marketState: marketState({
      marketType,
      selection,
      line,
    }),
  }))
  assert.equal(output.decisionStatus, DECISION_STATUS.READY, `${marketType} ${selection} ${line}`)
  assert.equal(output.mappedFinalPick.marketType, expectedType)
  assert.equal(output.mappedFinalPick.selection, selection)
  assert.equal(output.mappedFinalPick.line, Number(line))
}

const matchWinner = adaptCleanCoreDecision(readyInput({
  analysis: analysis({
    value_market: 'MATCH_WINNER',
    value_side: 'HOME',
    value_line: null,
  }),
  marketState: marketState({
    marketType: 'MATCH_WINNER',
    selection: 'HOME',
    line: null,
  }),
}))
assert.equal(matchWinner.marketType, MARKET_TYPE.MATCH_WINNER)
assert.equal(matchWinner.line, null)
assert.equal(matchWinner.decisionStatus, DECISION_STATUS.WATCH)
assert.equal(matchWinner.actionableFinalPickPresent, false)
assert.equal(matchWinner.mappedFinalPick, null)

const unsupportedMarket = adaptCleanCoreDecision(readyInput({
  analysis: analysis({
    value_market: 'EXOTIC_MARKET',
    value_side: 'HOME',
    value_line: null,
  }),
  marketState: marketState({
    marketType: 'EXOTIC_MARKET',
    selection: 'HOME',
    line: null,
  }),
}))
assert.equal(unsupportedMarket.marketType, MARKET_TYPE.UNKNOWN)
assert.notEqual(unsupportedMarket.decisionStatus, DECISION_STATUS.READY)
assert.equal(unsupportedMarket.actionableFinalPickPresent, false)
assert.equal(unsupportedMarket.mappedFinalPick, null)

const cleanReady = adaptCleanCoreDecision(readyInput())
const equivalentLegacy = legacyReady()
const equivalent = buildCleanCoreShadowComparison({
  fixture: fixture(),
  legacyResult: equivalentLegacy,
  cleanCoreDecision: cleanReady,
  invocationMode: 'recompute-ai-final-picks',
})
assert.deepEqual(equivalent.mismatchCodes, [])
assert.equal(equivalent.matchId, 'match-1')
assert.equal(equivalent.invocationMode, 'recompute-ai-final-picks')
assert.equal(equivalent.rawFixtureStatus.statusShort, 'NS')
assert.equal(equivalent.normalizedFixtureStatus, 'NS')
assert.equal(equivalent.cleanCoreStatusCategory, MATCH_STATUS_CATEGORY.PREMATCH_DECISION_ELIGIBLE)
assert.equal(equivalent.existingDecisionLocked, 'UNKNOWN')
assert.equal(equivalent.lockMetadataAvailable, false)
assert.equal(equivalent.adapterVersion, CLEAN_CORE_DECISION_ADAPTER_VERSION)
assert.equal(equivalent.cleanCoreVersion, null)

for (const [code, legacyOverrides, coreOverrides] of [
  [
    'STATUS_NORMALIZATION_MISMATCH',
    { normalizedFixtureStatus: 'TBD' },
    {},
  ],
  [
    'ELIGIBILITY_MISMATCH',
    { decisionEligible: false },
    {},
  ],
  [
    'DECISION_STATUS_MISMATCH',
    { selectionStatus: 'WATCH', actionableFinalPickPresent: true },
    {},
  ],
  [
    'ACTIONABLE_PICK_MISMATCH',
    { actionableFinalPickPresent: false },
    {},
  ],
  [
    'MARKET_MAPPING_MISMATCH',
    { pickSelection: 'AWAY' },
    {},
  ],
  [
    'REASON_PRECEDENCE_MISMATCH',
    { primaryReasonCode: 'MARKET_STALE' },
    {},
  ],
  [
    'CORE_INPUT_INCOMPLETE',
    {},
    { inputCompleteness: { ...cleanReady.inputCompleteness, complete: false } },
  ],
]) {
  const comparison = buildCleanCoreShadowComparison({
    fixture: fixture(),
    legacyResult: legacyReady(legacyOverrides),
    cleanCoreDecision: { ...cleanReady, ...coreOverrides },
  })
  assert.deepEqual(comparison.mismatchCodes, [code], code)
}

const allMismatches = buildCleanCoreShadowComparison({
  fixture: fixture(),
  legacyResult: legacyReady({
    normalizedFixtureStatus: 'TBD',
    decisionEligible: false,
    selectionStatus: 'WATCH',
    pickSelection: 'AWAY',
    primaryReasonCode: 'MARKET_STALE',
  }),
  cleanCoreDecision: {
    ...cleanReady,
    decisionStatus: 'READY',
    inputCompleteness: { ...cleanReady.inputCompleteness, complete: false },
  },
})
assert.deepEqual(allMismatches.mismatchCodes, [
  'STATUS_NORMALIZATION_MISMATCH',
  'ELIGIBILITY_MISMATCH',
  'DECISION_STATUS_MISMATCH',
  'MARKET_MAPPING_MISMATCH',
  'REASON_PRECEDENCE_MISMATCH',
  'CORE_INPUT_INCOMPLETE',
])
assert.deepEqual(
  [...allMismatches.mismatchCodes].sort(
    (left, right) => CLEAN_CORE_SHADOW_MISMATCH_CODES.indexOf(left)
      - CLEAN_CORE_SHADOW_MISMATCH_CODES.indexOf(right),
  ),
  allMismatches.mismatchCodes,
)

assert.equal(buildCleanCoreShadowComparison({
  fixture: fixture(),
  legacyResult: legacyReady(),
  cleanCoreDecision: cleanReady,
  lockMetadata: { locked: true },
}).existingDecisionLocked, true)
assert.equal(buildCleanCoreShadowComparison({
  fixture: fixture(),
  legacyResult: legacyReady(),
  cleanCoreDecision: cleanReady,
  lockMetadata: { is_locked: false },
}).existingDecisionLocked, false)
assert.equal(buildCleanCoreShadowComparison({
  fixture: fixture({ locked_at: '2030-07-20T08:00:00.000Z' }),
  legacyResult: legacyReady(),
  cleanCoreDecision: cleanReady,
}).existingDecisionLocked, true)

const immutableFixture = deepFreeze(fixture())
const immutableAnalysis = deepFreeze(analysis())
const immutableMarket = deepFreeze(marketState())
const immutableLegacy = deepFreeze(legacyReady())
const immutablePayload = deepFreeze(legacyPayload())
const immutableBefore = {
  fixture: JSON.stringify(immutableFixture),
  analysis: JSON.stringify(immutableAnalysis),
  market: JSON.stringify(immutableMarket),
  legacy: JSON.stringify(immutableLegacy),
  payload: JSON.stringify(immutablePayload),
}
const immutableShadow = runCleanCoreDecisionShadow({
  fixture: immutableFixture,
  analysis: immutableAnalysis,
  marketState: immutableMarket,
  legacyResult: immutableLegacy,
  legacyWritePayload: immutablePayload,
})
assert.equal(JSON.stringify(immutableFixture), immutableBefore.fixture)
assert.equal(JSON.stringify(immutableAnalysis), immutableBefore.analysis)
assert.equal(JSON.stringify(immutableMarket), immutableBefore.market)
assert.equal(JSON.stringify(immutableLegacy), immutableBefore.legacy)
assert.equal(JSON.stringify(immutablePayload), immutableBefore.payload)
assert.strictEqual(immutableShadow.legacyWritePayload, immutablePayload)

const disagreementPayload = legacyPayload()
const disagreementBytesBefore = Buffer.from(JSON.stringify(disagreementPayload))
const disagreement = runCleanCoreDecisionShadow({
  ...readyInput({ fixture: fixture({ status_short: '1H' }) }),
  legacyResult: legacyReady(),
  legacyWritePayload: disagreementPayload,
})
const disagreementBytesAfter = Buffer.from(JSON.stringify(disagreement.legacyWritePayload))
assert.deepEqual(disagreementBytesAfter, disagreementBytesBefore)
assert.strictEqual(disagreement.legacyWritePayload, disagreementPayload)
assert.ok(disagreement.comparison.mismatchCodes.includes('ACTIONABLE_PICK_MISMATCH'))
assert.deepEqual(Object.keys(disagreementPayload), [
  'match_id',
  'signal',
  'selection_status',
  'pick_market',
  'pick_selection',
  'pick_price',
  'updated_at',
])

const integrationSource = fs.readFileSync(
  new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url),
  'utf8',
)
const adapterSource = fs.readFileSync(
  new URL('../supabase/functions/_shared/cleanCoreDecisionAdapter.js', import.meta.url),
  'utf8',
)
assert.match(integrationSource, /runCleanCoreDecisionShadow\(\{/)
assert.match(integrationSource, /upsertAiFinalPickPayload\(payload\)/)
assert.doesNotMatch(integrationSource, /upsertAiFinalPickPayload\(shadow\./)
assert.match(integrationSource, /status_short,/)
assert.match(integrationSource, /match_status,/)
assert.match(integrationSource, /league:football_leagues\(id, api_league_id, name\)/)
assert.doesNotMatch(adapterSource, /\.from\(/)
assert.doesNotMatch(adapterSource, /\bfetch\(/)
assert.doesNotMatch(adapterSource, /Deno\.env/)

console.log('clean core production adapter unit tests passed')

function readyInput(overrides = {}) {
  return {
    fixture: fixture(),
    analysis: analysis(),
    marketState: marketState(),
    ...overrides,
  }
}

function fixture(overrides = {}) {
  return {
    id: 'match-1',
    api_sports_fixture_id: 101,
    api_sports_league_id: 99,
    api_sports_home_team_id: 1,
    api_sports_away_team_id: 2,
    kickoff_at: '2030-07-20T12:00:00.000Z',
    status: 'SCHEDULED',
    status_short: 'NS',
    status_long: 'Not Started',
    match_status: 'NS',
    homeTeam: { api_team_id: 1, name: 'Alpha' },
    awayTeam: { api_team_id: 2, name: 'Beta' },
    league: { api_league_id: 99, name: 'Test League' },
    ...overrides,
  }
}

function analysis(overrides = {}) {
  return {
    id: 'analysis-1',
    ranking_score: 86,
    confidence_score: 86,
    calibrated_confidence_score: 86,
    risk_level: 'LOW',
    recommendation: 'BET',
    data_quality_score: 82,
    value_market: 'AH',
    value_side: 'HOME',
    value_line: -0.5,
    ...overrides,
  }
}

function marketState(overrides = {}) {
  return {
    present: true,
    marketType: 'AH',
    selection: 'HOME',
    line: -0.5,
    source: 'API_FOOTBALL',
    bookmaker: 'Test Bookmaker',
    timestamp: '2030-07-20T09:00:00.000Z',
    fresh: true,
    ...overrides,
  }
}

function legacyReady(overrides = {}) {
  return {
    selectionStatus: 'READY',
    actionableFinalPickPresent: true,
    decisionEligible: true,
    normalizedFixtureStatus: 'NS',
    pickMarket: 'AH',
    pickSelection: 'HOME',
    pickLine: -0.5,
    pickConfidence: 86,
    confidenceScore: 86,
    primaryReasonCode: 'READY_SCORE_PASSED',
    ...overrides,
  }
}

function legacyPayload() {
  return {
    match_id: 'match-1',
    signal: 'STRONG_SIGNAL',
    selection_status: 'READY',
    pick_market: 'AH',
    pick_selection: 'HOME',
    pick_price: 1.91,
    updated_at: '2030-07-20T08:00:00.000Z',
  }
}

function comparisonFor(input, cleanCoreDecision) {
  return buildCleanCoreShadowComparison({
    fixture: input.fixture,
    legacyResult: legacyReady(),
    cleanCoreDecision,
  })
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
