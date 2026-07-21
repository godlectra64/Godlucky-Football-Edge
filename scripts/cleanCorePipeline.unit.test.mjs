import assert from 'node:assert/strict'

import { PIPELINE_STAGE, REQUIRED_PIPELINE_SEQUENCE } from '../supabase/functions/_shared/cleanCore/contracts.js'
import {
  getNextRequiredStage,
  isValidStageTransition,
  validatePipelineCompletion,
} from '../supabase/functions/_shared/cleanCore/pipeline.js'

for (let index = 0; index < REQUIRED_PIPELINE_SEQUENCE.length - 1; index += 1) {
  const from = REQUIRED_PIPELINE_SEQUENCE[index]
  const to = REQUIRED_PIPELINE_SEQUENCE[index + 1]
  assert.equal(getNextRequiredStage(from), to)
  assert.equal(isValidStageTransition(from, to), true, `${from} -> ${to} must be valid`)
  assert.equal(isValidStageTransition(from, from), false, 'same-stage transition is not idempotent in V1')
  if (index + 2 < REQUIRED_PIPELINE_SEQUENCE.length) {
    assert.equal(isValidStageTransition(from, REQUIRED_PIPELINE_SEQUENCE[index + 2]), false, 'skipped stage must fail')
  }
}
assert.equal(getNextRequiredStage(PIPELINE_STAGE.COMPLETE), null)
assert.equal(isValidStageTransition(PIPELINE_STAGE.COMPLETE, PIPELINE_STAGE.OPEN_DAY), false)
assert.equal(isValidStageTransition(PIPELINE_STAGE.BASE_ENRICHMENT, PIPELINE_STAGE.FIXTURE_DISCOVERY), false)
for (const invalid of [null, undefined, '', 'UNKNOWN']) {
  assert.equal(isValidStageTransition(invalid, PIPELINE_STAGE.OPEN_DAY), false)
  assert.equal(isValidStageTransition(PIPELINE_STAGE.OPEN_DAY, invalid), false)
}

const completeSteps = REQUIRED_PIPELINE_SEQUENCE.map((stage) => ({ stage, status: 'SUCCESS' }))
const completeRun = validatePipelineCompletion({ currentStage: PIPELINE_STAGE.COMPLETE, steps: completeSteps })
assert.equal(completeRun.valid, true, completeRun.errors.join(', '))

const missingRun = validatePipelineCompletion()
assert.deepEqual(missingRun.errors.slice(0, 2), ['PIPELINE_RUN_MISSING', 'PIPELINE_STEPS_MISSING'])
assert.ok(validatePipelineCompletion({ currentStage: PIPELINE_STAGE.COMPLETE }).errors.includes('PIPELINE_STEPS_MISSING'))

const incomplete = validatePipelineCompletion({
  currentStage: PIPELINE_STAGE.COMPLETE,
  steps: completeSteps.filter(({ stage }) => stage !== PIPELINE_STAGE.DECISION_BOARD_READY),
})
assert.ok(incomplete.errors.includes(`REQUIRED_STAGE_INCOMPLETE:${PIPELINE_STAGE.DECISION_BOARD_READY}`))

const duplicate = validatePipelineCompletion({
  currentStage: PIPELINE_STAGE.COMPLETE,
  steps: [...completeSteps, { stage: PIPELINE_STAGE.OPEN_DAY, status: 'FAILED' }],
})
assert.ok(duplicate.errors.includes(`DUPLICATE_STAGE:${PIPELINE_STAGE.OPEN_DAY}`))

const wrongOrderSteps = [...completeSteps]
;[wrongOrderSteps[1], wrongOrderSteps[2]] = [wrongOrderSteps[2], wrongOrderSteps[1]]
assert.ok(validatePipelineCompletion({ currentStage: PIPELINE_STAGE.COMPLETE, steps: wrongOrderSteps }).errors.some((error) => error.startsWith('INVALID_STAGE_ORDER:')))

for (const [status, expected] of [
  ['FAILED', 'REQUIRED_STAGE_FAILED'],
  ['PENDING', 'REQUIRED_STAGE_PENDING'],
  ['RUNNING', 'REQUIRED_STAGE_RUNNING'],
]) {
  const steps = completeSteps.map((entry) => entry.stage === PIPELINE_STAGE.DEEP_ANALYSIS ? { ...entry, status } : entry)
  assert.ok(validatePipelineCompletion({ currentStage: PIPELINE_STAGE.COMPLETE, steps }).errors.includes(`${expected}:${PIPELINE_STAGE.DEEP_ANALYSIS}`))
}

const unknown = validatePipelineCompletion({
  currentStage: PIPELINE_STAGE.COMPLETE,
  steps: [...completeSteps.slice(0, -1), { stage: 'UNKNOWN', status: 'SUCCESS' }],
})
assert.ok(unknown.errors.includes('UNKNOWN_STAGE:UNKNOWN'))

const settlementWithoutRefresh = validatePipelineCompletion({
  currentStage: PIPELINE_STAGE.COMPLETE,
  steps: completeSteps.filter(({ stage }) => stage !== PIPELINE_STAGE.RESULT_REFRESH),
})
assert.ok(settlementWithoutRefresh.errors.includes('RESULT_SETTLEMENT_REQUIRES_RESULT_REFRESH'))
const boardWithoutClassification = validatePipelineCompletion({
  currentStage: PIPELINE_STAGE.COMPLETE,
  steps: completeSteps.filter(({ stage }) => stage !== PIPELINE_STAGE.DECISION_CLASSIFICATION),
})
assert.ok(boardWithoutClassification.errors.includes('DECISION_BOARD_REQUIRES_CLASSIFICATION'))

const frozenRun = Object.freeze({ currentStage: PIPELINE_STAGE.COMPLETE, steps: Object.freeze(completeSteps.map(Object.freeze)) })
const before = JSON.stringify(frozenRun)
assert.equal(validatePipelineCompletion(frozenRun).valid, true)
assert.equal(JSON.stringify(frozenRun), before, 'pipeline validation must not mutate input')

console.log('clean core pipeline unit tests passed')
