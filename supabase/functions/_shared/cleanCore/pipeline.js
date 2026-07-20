import { PIPELINE_STAGE, REQUIRED_PIPELINE_SEQUENCE } from './contracts.js'

const REQUIRED_BEFORE_COMPLETE = REQUIRED_PIPELINE_SEQUENCE.slice(0, -1)

export function getNextRequiredStage(currentStage) {
  if (currentStage === null || currentStage === undefined || currentStage === '') return PIPELINE_STAGE.OPEN_DAY
  const index = REQUIRED_PIPELINE_SEQUENCE.indexOf(currentStage)
  return index >= 0 ? REQUIRED_PIPELINE_SEQUENCE[index + 1] ?? null : null
}

export function isValidStageTransition(fromStage, toStage) {
  return getNextRequiredStage(fromStage) === toStage
}

export function validatePipelineCompletion(run = {}) {
  const errors = []
  const warnings = []
  const entries = getStageEntries(run)
  const completedStages = entries
    .filter((entry) => entry.success)
    .map((entry) => entry.stage)
  const claimedStage = run.currentStage ?? run.stage ?? run.status ?? null
  const claimedComplete = claimedStage === PIPELINE_STAGE.COMPLETE || completedStages.includes(PIPELINE_STAGE.COMPLETE)

  for (const entry of entries) {
    if (!REQUIRED_PIPELINE_SEQUENCE.includes(entry.stage)) errors.push(`UNKNOWN_STAGE:${entry.stage}`)
  }

  const seen = new Set()
  for (const stage of completedStages) {
    if (seen.has(stage)) errors.push(`DUPLICATE_STAGE:${stage}`)
    seen.add(stage)
  }

  const canonicalCompleted = completedStages.filter((stage) => REQUIRED_PIPELINE_SEQUENCE.includes(stage))
  for (let index = 0; index < canonicalCompleted.length; index += 1) {
    const expected = REQUIRED_PIPELINE_SEQUENCE[index]
    if (canonicalCompleted[index] !== expected) {
      errors.push(`INVALID_STAGE_ORDER:${canonicalCompleted[index]}:EXPECTED_${expected}`)
      break
    }
  }

  if (!claimedComplete) errors.push('PIPELINE_NOT_COMPLETE')
  if (claimedComplete) {
    for (const stage of REQUIRED_BEFORE_COMPLETE) {
      if (!completedStages.includes(stage)) errors.push(`REQUIRED_STAGE_INCOMPLETE:${stage}`)
    }
  }

  if (completedStages.includes(PIPELINE_STAGE.RESULT_SETTLEMENT) && !completedStages.includes(PIPELINE_STAGE.RESULT_REFRESH)) {
    errors.push('RESULT_SETTLEMENT_REQUIRES_RESULT_REFRESH')
  }
  if (completedStages.includes(PIPELINE_STAGE.DECISION_BOARD_READY) && !completedStages.includes(PIPELINE_STAGE.DECISION_CLASSIFICATION)) {
    errors.push('DECISION_BOARD_REQUIRES_CLASSIFICATION')
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings }
}

function getStageEntries(run) {
  const source = run.completedStages ?? run.successfulStages ?? run.stages ?? []
  return (Array.isArray(source) ? source : []).map((entry) => {
    if (typeof entry === 'string') return { stage: entry, success: true }
    const stage = entry?.stage ?? entry?.name ?? entry?.pipelineStage ?? null
    const status = String(entry?.status ?? 'SUCCESS').toUpperCase()
    return { stage, success: ['SUCCESS', 'SUCCEEDED', 'COMPLETE', 'COMPLETED'].includes(status) }
  })
}
