import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  claimDailyStepOnce,
  getDailySyncCacheDecision,
  requiredDailyPhases,
} from '../supabase/functions/_shared/pipelinePolicy.js'

const now = '2026-07-16T08:00:00.000Z'

function stepsWith(overrides = {}) {
  return requiredDailyPhases.map((phase, index) => ({
    id: `step-${index + 1}`,
    phase,
    step_order: index + 1,
    status: 'success',
    attempt_count: 1,
    max_attempts: phase === 'core' ? 20 : 3,
    next_retry_at: null,
    continuation_state: { fixtureOffset: index },
    ...(overrides[phase] ?? {}),
  }))
}

{
  const decision = getDailySyncCacheDecision({ id: 'run-terminal', status: 'success', current_phase: 'complete' }, stepsWith(), { now })
  assert.equal(decision.cacheDecision, 'hit')
  assert.equal(decision.canUseCachedSummary, true)
  assert.equal(decision.shouldResume, false)
  assert.equal(decision.continuationAction, 'return_terminal_cache')
}

{
  const steps = stepsWith({
    core: { status: 'pending_retry', next_retry_at: '2026-07-16T08:05:00.000Z' },
  })
  const decision = getDailySyncCacheDecision({ id: 'run-future', status: 'partial', current_phase: 'core' }, steps, { now })
  assert.equal(decision.cacheDecision, 'wait')
  assert.equal(decision.cacheBypassReason, 'RETRY_NOT_DUE')
  assert.equal(decision.shouldWait, true)
  assert.equal(decision.shouldResume, false)
}

{
  const steps = stepsWith({
    core: { status: 'pending_retry', next_retry_at: '2026-07-16T07:51:39.001Z' },
  })
  const decision = getDailySyncCacheDecision({ id: 'run-overdue', status: 'partial', current_phase: 'core' }, steps, { now })
  assert.equal(decision.cacheDecision, 'bypass')
  assert.equal(decision.cacheBypassReason, 'RETRY_DUE_OR_OVERDUE')
  assert.equal(decision.shouldResume, true)
  assert.equal(decision.needsSelfHeal, false)
  assert.equal(decision.retryStep, 'core')
}

{
  const steps = stepsWith({
    core: { status: 'partial', next_retry_at: null },
  })
  const decision = getDailySyncCacheDecision({ id: 'run-self-heal', status: 'partial', current_phase: 'core' }, steps, { now })
  assert.equal(decision.cacheDecision, 'bypass')
  assert.equal(decision.cacheBypassReason, 'MISSING_OR_INVALID_RETRY_SCHEDULE')
  assert.equal(decision.shouldResume, true)
  assert.equal(decision.needsSelfHeal, true)
  assert.equal(decision.continuationAction, 'self_heal_and_resume')
}

{
  const step = {
    id: 'step-concurrent',
    phase: 'core',
    status: 'pending_retry',
    attempt_count: 2,
    max_attempts: 20,
    next_retry_at: '2026-07-16T07:51:39.001Z',
    continuation_state: { fixtureOffset: 12 },
  }
  let persisted = { ...step }
  let executed = 0
  const compareAndSet = async (claim) => {
    await Promise.resolve()
    if (persisted.id !== claim.expected.id
      || persisted.status !== claim.expected.status
      || persisted.attempt_count !== claim.expected.attemptCount
      || persisted.next_retry_at !== claim.expected.nextRetryAt) return null
    persisted = { ...persisted, ...claim.update }
    return { ...persisted }
  }
  const contenders = await Promise.all([
    claimDailyStepOnce(step, compareAndSet, now),
    claimDailyStepOnce(step, compareAndSet, now),
  ])
  for (const contender of contenders) {
    if (contender.claimed) executed += 1
  }
  assert.equal(contenders.filter((result) => result.claimed).length, 1)
  assert.equal(executed, 1)
  assert.equal(persisted.status, 'running')
  assert.equal(persisted.attempt_count, 3)
  assert.deepEqual(persisted.continuation_state, { fixtureOffset: 12 })
}

const source = await readFile(new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url), 'utf8')
assert.match(source, /const cacheDecision = getDailySyncCacheDecision\(state\.run, state\.steps\)/)
assert.match(source, /if \(cacheDecision\.canUseCachedSummary\)/)
assert.match(source, /if \(cacheDecision\.needsSelfHeal\)/)
assert.match(source, /async function claimDailySyncStepAtomically/)
assert.match(source, /\.eq\('status', step\.status\)/)
assert.match(source, /\.eq\('attempt_count', Number\(step\.attempt_count \?\? 0\)\)/)
assert.match(source, /cacheBypassReason:/)
assert.match(source, /continuationAction:/)

console.log('daily sync continuation unit tests passed')
