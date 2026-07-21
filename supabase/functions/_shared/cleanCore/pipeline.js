import { PIPELINE_STAGE, REQUIRED_PIPELINE_SEQUENCE } from './contracts.js'

const SUCCESS_STATUSES = new Set(['SUCCESS', 'SUCCEEDED', 'COMPLETE', 'COMPLETED'])
const FAILED_STATUSES = new Set(['FAILED', 'FAILURE', 'ERROR'])
const PENDING_STATUSES = new Set(['PENDING', 'QUEUED'])
const RUNNING_STATUSES = new Set(['RUNNING', 'IN_PROGRESS'])

export function getNextRequiredStage(currentStage) {
  if (currentStage === null || currentStage === undefined || currentStage === '') return PIPELINE_STAGE.OPEN_DAY
  const index = REQUIRED_PIPELINE_SEQUENCE.indexOf(currentStage)
  return index >= 0 ? REQUIRED_PIPELINE_SEQUENCE[index + 1] ?? null : null
}

export function isValidStageTransition(fromStage, toStage) {
  if (!REQUIRED_PIPELINE_SEQUENCE.includes(fromStage) || !REQUIRED_PIPELINE_SEQUENCE.includes(toStage)) return false
  return getNextRequiredStage(fromStage) === toStage
}

export function validatePipelineCompletion(run) {
  const errors = []
  const warnings = []
  const source = isRecord(run) ? run : null

  if (!source) errors.push('PIPELINE_RUN_MISSING')
  const { entries, present } = getStageEntries(source)
  if (!present || entries.length === 0) errors.push('PIPELINE_STEPS_MISSING')

  const claimedStage = source?.currentStage ?? source?.stage ?? source?.status ?? null
  if (claimedStage !== null && !REQUIRED_PIPELINE_SEQUENCE.includes(claimedStage)) {
    errors.push(`UNKNOWN_CLAIMED_STAGE:${claimedStage}`)
  }

  const seen = new Set()
  for (const entry of entries) {
    if (!REQUIRED_PIPELINE_SEQUENCE.includes(entry.stage)) errors.push(`UNKNOWN_STAGE:${entry.stage}`)
    if (seen.has(entry.stage)) errors.push(`DUPLICATE_STAGE:${entry.stage}`)
    seen.add(entry.stage)
  }

  const canonicalEntries = entries.filter((entry) => REQUIRED_PIPELINE_SEQUENCE.includes(entry.stage))
  for (let index = 0; index < canonicalEntries.length; index += 1) {
    const expected = REQUIRED_PIPELINE_SEQUENCE[index]
    if (canonicalEntries[index].stage !== expected) {
      errors.push(`INVALID_STAGE_ORDER:${canonicalEntries[index].stage}:EXPECTED_${expected}`)
      break
    }
  }

  const claimedComplete = claimedStage === PIPELINE_STAGE.COMPLETE
    || canonicalEntries.some((entry) => entry.stage === PIPELINE_STAGE.COMPLETE && entry.success)
  if (!claimedComplete) errors.push('PIPELINE_NOT_COMPLETE')

  if (claimedComplete) {
    for (const stage of REQUIRED_PIPELINE_SEQUENCE) {
      const entry = canonicalEntries.find((candidate) => candidate.stage === stage)
      if (!entry) {
        errors.push(`REQUIRED_STAGE_INCOMPLETE:${stage}`)
        continue
      }
      if (entry.success) continue
      errors.push(requiredStageError(stage, entry.status))
    }
  }

  if (seen.has(PIPELINE_STAGE.RESULT_SETTLEMENT) && !seen.has(PIPELINE_STAGE.RESULT_REFRESH)) {
    errors.push('RESULT_SETTLEMENT_REQUIRES_RESULT_REFRESH')
  }
  if (seen.has(PIPELINE_STAGE.DECISION_BOARD_READY) && !seen.has(PIPELINE_STAGE.DECISION_CLASSIFICATION)) {
    errors.push('DECISION_BOARD_REQUIRES_CLASSIFICATION')
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings }
}

function getStageEntries(run) {
  if (!run) return { entries: [], present: false }
  const keys = ['completedStages', 'successfulStages', 'stages', 'steps']
  const key = keys.find((candidate) => Object.hasOwn(run, candidate))
  if (!key || !Array.isArray(run[key])) return { entries: [], present: Boolean(key) }

  return {
    present: true,
    entries: run[key].map((entry) => {
      if (typeof entry === 'string') return { stage: entry, status: 'SUCCESS', success: true }
      const stage = entry?.stage ?? entry?.name ?? entry?.pipelineStage ?? entry?.pipeline_stage ?? null
      const status = String(entry?.status ?? 'SUCCESS').trim().toUpperCase()
      return { stage, status, success: SUCCESS_STATUSES.has(status) }
    }),
  }
}

function requiredStageError(stage, status) {
  if (FAILED_STATUSES.has(status)) return `REQUIRED_STAGE_FAILED:${stage}`
  if (PENDING_STATUSES.has(status)) return `REQUIRED_STAGE_PENDING:${stage}`
  if (RUNNING_STATUSES.has(status)) return `REQUIRED_STAGE_RUNNING:${stage}`
  return `REQUIRED_STAGE_NOT_SUCCESSFUL:${stage}`
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
