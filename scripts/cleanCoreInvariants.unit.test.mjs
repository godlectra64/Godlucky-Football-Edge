import assert from 'node:assert/strict'

import { DECISION_STATUS, PIPELINE_STAGE, REQUIRED_PIPELINE_SEQUENCE } from '../supabase/functions/_shared/cleanCore/contracts.js'
import { calculateDecisionConfidence } from '../supabase/functions/_shared/cleanCore/confidence.js'
import { classifyDecision } from '../supabase/functions/_shared/cleanCore/decision.js'
import { validatePipelineCompletion } from '../supabase/functions/_shared/cleanCore/pipeline.js'
import { rankCandidates } from '../supabase/functions/_shared/cleanCore/selection.js'

for (const value of [-100, -1, 0, 1, 25, 50, 75, 99, 100, 101, 500]) {
  const confidence = calculateDecisionConfidence({
    dataQuality: value,
    analysisQuality: 100 - value,
    modelAgreement: value,
    marketCompleteness: value,
    marketFreshness: 100 - value,
    riskPenalty: Math.max(0, value - 50),
  })
  assert.ok(confidence.score >= 0 && confidence.score <= 100)
  assert.equal(Number.isFinite(confidence.score), true)
}

for (const marketType of ['AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'UNKNOWN']) {
  for (const riskLevel of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
    for (const readinessScore of [0, 69, 70, 79, 80, 100]) {
      const output = classifyDecision(decisionInput({ marketType, riskLevel, readinessScore }))
      assertDecisionInvariant(output)
      if (marketType === 'UNKNOWN') assert.notEqual(output.status, DECISION_STATUS.READY)
      if (riskLevel === 'CRITICAL') assert.notEqual(output.status, DECISION_STATUS.READY)
    }
  }
}

for (const output of [
  classifyDecision(decisionInput()),
  classifyDecision(decisionInput({ marketPresent: false, marketType: 'UNKNOWN', marketReady: false, finalPick: null })),
  classifyDecision(decisionInput({ readinessScore: 70 })),
  classifyDecision(decisionInput({ fixtureValid: false })),
]) assertDecisionInvariant(output)

const candidates = [
  fixture(1, 90),
  fixture('1', 80),
  fixture(2, 70),
  fixture(3, 60),
  fixture(4, 50, { status: 'FT' }),
]
const ranked = rankCandidates(candidates)
assert.equal(ranked.length, 3, 'output count must equal eligible unique fixtures')
assert.equal(new Set(ranked.map(({ rank }) => rank)).size, ranked.length)

const completeSteps = REQUIRED_PIPELINE_SEQUENCE.map((stage) => ({ stage, status: 'SUCCESS' }))
assert.equal(validatePipelineCompletion({ currentStage: PIPELINE_STAGE.COMPLETE, steps: completeSteps }).valid, true)
for (const missingStage of REQUIRED_PIPELINE_SEQUENCE) {
  const result = validatePipelineCompletion({
    currentStage: PIPELINE_STAGE.COMPLETE,
    steps: completeSteps.filter(({ stage }) => stage !== missingStage),
  })
  assert.equal(result.valid, false, `COMPLETE must fail when ${missingStage} is missing`)
  assert.ok(result.errors.includes(`REQUIRED_STAGE_INCOMPLETE:${missingStage}`))
}

console.log('clean core invariant tests passed')

function assertDecisionInvariant(output) {
  if (output.status === DECISION_STATUS.READY) {
    assert.equal(output.marketReady, true)
    assert.ok(output.finalPick)
    assert.equal(output.finalPick.actionable, true)
  } else {
    assert.equal(output.finalPick, null)
  }
  if (output.status === DECISION_STATUS.REJECTED) assert.ok(output.reasonCode)
}

function decisionInput(overrides = {}) {
  const marketType = overrides.marketType ?? 'AH'
  const riskLevel = overrides.riskLevel ?? 'LOW'
  const readinessScore = overrides.readinessScore ?? 86
  const actionable = ['AH', 'OU'].includes(marketType)
  return {
    fixtureValid: true,
    matchPlayable: true,
    supportedLeague: true,
    analysisComplete: true,
    analysisValid: true,
    dataQuality: 90,
    marketType,
    marketPresent: marketType !== 'UNKNOWN',
    marketReady: actionable,
    marketFresh: true,
    finalPick: actionable ? {
      marketType,
      selection: marketType === 'OU' ? 'OVER' : 'HOME',
      line: marketType === 'OU' ? 2.5 : -0.5,
      confidence: readinessScore,
      riskLevel,
    } : null,
    confidence: { score: readinessScore },
    readinessScore,
    riskLevel,
    ...overrides,
  }
}

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
