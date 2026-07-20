import assert from 'node:assert/strict'

import { PIPELINE_STAGE, REQUIRED_PIPELINE_SEQUENCE } from '../supabase/functions/_shared/cleanCore/contracts.js'
import {
  getNextRequiredStage,
  isValidStageTransition,
  validatePipelineCompletion,
} from '../supabase/functions/_shared/cleanCore/pipeline.js'

assert.equal(getNextRequiredStage(PIPELINE_STAGE.OPEN_DAY), PIPELINE_STAGE.FIXTURE_DISCOVERY)
assert.equal(isValidStageTransition(PIPELINE_STAGE.OPEN_DAY, PIPELINE_STAGE.FIXTURE_DISCOVERY), true, 'sequential transition must pass')
assert.equal(isValidStageTransition(PIPELINE_STAGE.OPEN_DAY, PIPELINE_STAGE.BASE_ENRICHMENT), false, 'skipped stage must fail')
assert.equal(isValidStageTransition(PIPELINE_STAGE.BASE_ENRICHMENT, PIPELINE_STAGE.FIXTURE_DISCOVERY), false, 'backward transition must fail')

const completeRun = validatePipelineCompletion({
  currentStage: PIPELINE_STAGE.COMPLETE,
  completedStages: REQUIRED_PIPELINE_SEQUENCE,
})
assert.equal(completeRun.valid, true, completeRun.errors.join(', '))

const earlyComplete = validatePipelineCompletion({
  currentStage: PIPELINE_STAGE.COMPLETE,
  completedStages: [PIPELINE_STAGE.OPEN_DAY, PIPELINE_STAGE.COMPLETE],
})
assert.equal(earlyComplete.valid, false, 'COMPLETE before required stages must fail')
assert.ok(earlyComplete.errors.some((error) => error.startsWith('REQUIRED_STAGE_INCOMPLETE:')))

const settlementBeforeRefresh = validatePipelineCompletion({
  currentStage: PIPELINE_STAGE.COMPLETE,
  completedStages: [PIPELINE_STAGE.OPEN_DAY, PIPELINE_STAGE.RESULT_SETTLEMENT, PIPELINE_STAGE.COMPLETE],
})
assert.equal(settlementBeforeRefresh.valid, false, 'RESULT_SETTLEMENT before RESULT_REFRESH must fail')
assert.ok(settlementBeforeRefresh.errors.includes('RESULT_SETTLEMENT_REQUIRES_RESULT_REFRESH'))

console.log('clean core pipeline unit tests passed')
