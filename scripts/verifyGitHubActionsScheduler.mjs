import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/daily-football-sync.yml', 'utf8')

requireText('secrets.EDGE_ADMIN_SECRET')
requirePattern(/SUPABASE_URL:\s*\$\{\{\s*secrets\.SUPABASE_URL\s*\}\}/, 'Supabase URL secret')
requirePattern(/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/, 'Supabase service-role secret')
requirePattern(/GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/, 'workflow-scoped GitHub token')
if (/GITHUB_TOKEN:\s*\$\{\{\s*secrets\./.test(workflow)) throw new Error('self-dispatch must not use a stored GitHub token secret')
requireText('daily-sync-auto')
requireText('result-refresh')
requireText('requiredPhases')
requireText('pending_retry')
requireText('next_retry_at')
requireText('Continuation changed run id')
requireText('continuation scheduled')
requireText('schedule_next_workflow')
requireText('STUCK_CONTINUATION')
requireText('processedFixtureCount')
requireText('uniqueProcessedFixtureCount')
requireText('processedFixtureIds')
requireText('fixtureRemainingCount')
requireText('fixtureStableEmptyPasses')
requireText("required.every((step) => step.status === 'success')")
requireText('https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data')
const cronEntries = [...workflow.matchAll(/cron:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
if (cronEntries.length !== 1 || cronEntries[0] !== '*/15 * * * *') {
  throw new Error(`workflow must have only the 15-minute schedule; found ${JSON.stringify(cronEntries)}`)
}
for (const obsoleteCron of ['10 0 * * *', '10 11 * * *', '40 16 * * *']) {
  if (cronEntries.includes(obsoleteCron)) throw new Error(`workflow must not retain obsolete cron ${obsoleteCron}`)
}
requirePattern(/workflow_dispatch:/, 'manual dispatch')
requirePattern(/group:\s*daily-football-sync/, 'canonical concurrency group')
requirePattern(/cancel-in-progress:\s*false/, 'non-cancelling concurrency')
requireText('no continuation due')
requireText('daily bootstrap required')
requireText('daily bootstrap invoked')
requireText('canonical run created')
requireText('active claim')
requireText('self continuation required')
requireText('waiting for next_retry_at')
requireText('self continuation dispatched')
requireText('no continuation required')
requireText('continuation chain depth exhausted')
requireText("eventName === 'schedule'")
requirePattern(/workflow_dispatch:\s*[\s\S]*?continuation_chain_depth:\s*[\s\S]*?default:\s*['"]0['"][\s\S]*?type:\s*string/, 'continuation chain-depth input')
const permissionsBlock = /^permissions:\s*\r?\n((?: {2}[^\r\n]+\r?\n?)+)/m.exec(workflow)
if (!permissionsBlock) throw new Error('workflow missing permissions block')
const permissionEntries = permissionsBlock[1].trim().split(/\r?\n/).map((line) => line.trim()).sort()
if (JSON.stringify(permissionEntries) !== JSON.stringify(['actions: write', 'contents: read'])) {
  throw new Error(`workflow permissions must be exactly contents: read and actions: write; found ${JSON.stringify(permissionEntries)}`)
}
requirePattern(/function\s+bangkokDateKey\s*\([\s\S]*?timeZone:\s*['"]Asia\/Bangkok['"]/, 'Bangkok canonical date')
requirePattern(/if\s*\(continuation\.bootstrap\)[\s\S]*?dailyBootstrap\s*=\s*\{\s*runDate:\s*continuation\.runDate\s*\}[\s\S]*?daily bootstrap required/, 'scheduled daily bootstrap branch')
requirePattern(/let\s+initialPayload\s*=\s*\{\s*mode:\s*['"]daily-sync-auto['"]\s*\}/, 'manual daily bootstrap payload')
requirePattern(/initialPayload\s*=\s*\{[\s\S]*?mode:\s*['"]daily-sync-auto['"][\s\S]*?runId:\s*continuation\.runId/, 'scheduled same-run continuation')
requirePattern(/runId,\s*\n\s*autoAdvance:\s*true/, 'same-run continuation')
requirePattern(/getCanonicalState\(canonicalRunDate,\s*['"]canonical post-invoke check['"]\)/, 'post-invocation canonical state verification')
requirePattern(/assertCanonicalRunCreated\(canonicalState,\s*dailyBootstrap\.runDate,\s*runId\)/, 'post-bootstrap canonical run verification')
requirePattern(/runs\.length\s*!==\s*1/, 'canonical run uniqueness assertion')
requirePattern(/!selfContinuationDriver\s*&&\s*!isComplete\(dailySync\)/, 'single Edge invocation self-continuation driver')
requirePattern(/continuationChainDepth\s*>=\s*20/, 'continuation chain depth limit')
if ((workflow.match(/await dispatchSelfContinuation\s*\(/g) ?? []).length !== 1) throw new Error('workflow must dispatch self-continuation from exactly one call site')
requirePattern(/invocation <= 12/, 'bounded workflow invocations')
const countNormalizerSource = functionSource(workflow, 'normalizeExplicitNonNegativeInteger')
requireSourcePattern(countNormalizerSource, /typeof value === ['"]number['"][\s\S]*?Number\.isInteger\(value\)[\s\S]*?value >= 0/, 'explicit non-negative numeric count validation')
requireSourcePattern(countNormalizerSource, /typeof value !== ['"]string['"][\s\S]*?return null/, 'non-number and non-string count rejection')
requireSourcePattern(countNormalizerSource, /normalized = value\.trim\(\)[\s\S]*?Number\.isSafeInteger\(parsed\)/, 'safe numeric-string count parsing')
const failureEvidenceSource = functionSource(workflow, 'getCanonicalCurrentFailureEvidence')
requireSourcePattern(failureEvidenceSource, /failedCount\s*=\s*normalizeExplicitNonNegativeInteger\(result\.failed\)/, 'canonical result.failed normalization')
requireSourcePattern(failureEvidenceSource, /stepFailedCount\s*=\s*normalizeExplicitNonNegativeInteger\(currentStep\?\.failed\)/, 'canonical step.failed normalization')
requireSourcePattern(failureEvidenceSource, /failedCount !== null && failedCount > 0\) reasons\.push\(['"]RESULT_FAILED_COUNT['"]\)/, 'positive explicit result.failed gate')
requireSourcePattern(failureEvidenceSource, /stepFailedCount !== null && stepFailedCount > 0\) reasons\.push\(['"]STEP_FAILED_COUNT['"]\)/, 'positive explicit step.failed gate')
for (const [forbiddenFallback, pattern] of [
  ['currentStep?.summary?.failed', /currentStep\?\.summary\?\.failed(?![A-Za-z0-9_$])/],
  ['attempt_count', /attempt_count/],
  ['result.failureAttempts', /result\.failureAttempts/],
  ['result.failures.length', /result\.failures\.length/],
]) {
  if (pattern.test(failureEvidenceSource)) throw new Error(`canonical failed-count evidence must not use ${forbiddenFallback}`)
}
const restPreflightSource = functionSource(workflow, 'getRestRows')
requireSourcePattern(restPreflightSource, /apikey:\s*restServiceRoleKey/, 'REST apikey service-role header')
requireSourcePattern(restPreflightSource, /Authorization:\s*`Bearer \$\{restServiceRoleKey\}`/, 'REST Bearer service-role header')
requireSourcePattern(restPreflightSource, /['"]Content-Type['"]:\s*['"]application\/json['"]/, 'REST JSON content type')
for (const forbidden of ['adminSecret', 'RESULT_ADMIN_SECRET', 'SUPABASE_READ_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'sb_secret']) {
  if (restPreflightSource.includes(forbidden)) throw new Error(`REST preflight must not use ${forbidden}`)
}
const canonicalRunsSource = functionSource(workflow, 'getCanonicalRuns')
requireSourcePattern(canonicalRunsSource, /run_date:\s*`eq\.\$\{runDate\}`/, 'today-only canonical run filter')
requireSourcePattern(canonicalRunsSource, /mode:\s*['"]eq\.daily-full-sync-safe['"]/, 'canonical run mode filter')
requireSourcePattern(canonicalRunsSource, /limit:\s*['"]2['"]/, 'duplicate-detection query limit')
const selfContinuationDecisionSource = functionSource(workflow, 'getSelfContinuationDecision')
for (const requiredGate of ['run_id_mismatch', 'active_claim', 'failed_step_', 'canonical_run_complete', 'pending_retry', 'planned_continuation', 'failure_attempts_reported', 'retry_exhausted', 'invalid_next_retry_at']) {
  if (!selfContinuationDecisionSource.includes(requiredGate)) throw new Error(`self-continuation decision missing ${requiredGate} gate`)
}
requireSourcePattern(selfContinuationDecisionSource, /normalizeExplicitNonNegativeInteger\(step\.failed\)/, 'explicit self-continuation step.failed normalization')
if (/Number\(step\.failed/.test(selfContinuationDecisionSource)) throw new Error('self-continuation must not coerce step.failed with Number()')
const selfContinuationWaitSource = functionSource(workflow, 'getSelfContinuationWaitMs')
requireSourcePattern(selfContinuationWaitSource, /Math\.min\(900_000,\s*Math\.max\(5_000,\s*nextRetryMs\s*-\s*nowMs\s*\+\s*5_000\)\)/, 'bounded next-retry wait calculation')
const waitSource = functionSource(workflow, 'waitForSelfContinuation')
requireSourcePattern(waitSource, /setTimeout\(resolve,\s*waitMs\)/, 'non-busy continuation wait')
const edgeInvocationSource = functionSource(workflow, 'postSync')
requireSourcePattern(edgeInvocationSource, /sb_secret:\s*adminSecret/, 'Edge Function admin-secret body')
if (edgeInvocationSource.includes('serviceRoleKey')) throw new Error('Edge Function invocation must not use the REST service-role key')
const dispatchSource = functionSource(workflow, 'dispatchSelfContinuation')
requireSourcePattern(dispatchSource, /https:\/\/api\.github\.com\/repos\/\$\{githubRepository\}\/actions\/workflows\/daily-football-sync\.yml\/dispatches/, 'GitHub workflow dispatch endpoint')
requireSourcePattern(dispatchSource, /Authorization:\s*`Bearer \$\{githubToken\}`/, 'GitHub workflow-token authorization')
requireSourcePattern(dispatchSource, /Accept:\s*['"]application\/vnd\.github\+json['"]/, 'GitHub API Accept header')
requireSourcePattern(dispatchSource, /['"]X-GitHub-Api-Version['"]:\s*['"]2026-03-10['"]/, 'GitHub API version header')
requireSourcePattern(dispatchSource, /ref:\s*['"]main['"]/, 'main branch dispatch ref')
requireSourcePattern(dispatchSource, /continuation_chain_depth:\s*String\(nextDepth\)/, 'incremented continuation depth input')
requireSourcePattern(dispatchSource, /\[200,\s*204\]\.includes\(response\.status\)/, 'GitHub dispatch success statuses')
for (const forbidden of ['adminSecret', 'serviceRoleKey', 'supabaseUrl', 'EDGE_ADMIN_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (dispatchSource.includes(forbidden)) throw new Error(`GitHub dispatch must not use ${forbidden}`)
}
for (const obsoleteRestCredential of ['SUPABASE_REST_ENDPOINT', 'SUPABASE_READ_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'RESULT_ADMIN_SECRET']) {
  if (workflow.includes(obsoleteRestCredential)) throw new Error(`workflow must not use obsolete REST credential ${obsoleteRestCredential}`)
}
requirePattern(/hostname\s*!==\s*['"]fzjbnxomflqopwhzxfog\.supabase\.co['"]/, 'canonical Supabase project validation')
requirePattern(/`\$\{parsedUrl\.origin\}\/rest\/v1`/, 'REST endpoint derived from SUPABASE_URL')
if (/retryAfterSeconds > 60\) throw new Error/.test(workflow)) throw new Error('planned continuation over 60 seconds must not fail the workflow')
for (const obsolete of ['strict-api-football-daily-picks', 'select-usable-daily-picks', 'lock-daily-top10']) {
  if (workflow.includes(obsolete)) throw new Error(`workflow must not call obsolete selection mode ${obsolete}`)
}
if (/sb_secret_[A-Za-z0-9._-]+/.test(workflow)) throw new Error('workflow must not hardcode an admin secret')
console.log('GitHub Actions canonical scheduler workflow verified.')

function requireText(value) {
  if (!workflow.includes(value)) throw new Error(`workflow missing ${value}`)
}

function requirePattern(pattern, label) {
  if (!pattern.test(workflow)) throw new Error(`workflow missing ${label}`)
}

function requireSourcePattern(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`workflow missing ${label}`)
}

function functionSource(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source)
  if (!match) throw new Error(`workflow function ${name} not found`)
  const open = source.indexOf('{', match.index)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(match.index, index + 1)
  }
  throw new Error(`workflow function ${name} is not balanced`)
}
