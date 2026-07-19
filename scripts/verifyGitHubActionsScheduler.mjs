import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/daily-football-sync.yml', 'utf8')

requireText('secrets.EDGE_ADMIN_SECRET')
requirePattern(/SUPABASE_URL:\s*\$\{\{\s*secrets\.SUPABASE_URL\s*\}\}/, 'Supabase URL secret')
requirePattern(/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/, 'Supabase service-role secret')
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
requireText("eventName === 'schedule'")
requirePattern(/function\s+bangkokDateKey\s*\([\s\S]*?timeZone:\s*['"]Asia\/Bangkok['"]/, 'Bangkok canonical date')
requirePattern(/if\s*\(continuation\.bootstrap\)[\s\S]*?dailyBootstrap\s*=\s*\{\s*runDate:\s*continuation\.runDate\s*\}[\s\S]*?daily bootstrap required/, 'scheduled daily bootstrap branch')
requirePattern(/let\s+initialPayload\s*=\s*\{\s*mode:\s*['"]daily-sync-auto['"]\s*\}/, 'manual daily bootstrap payload')
requirePattern(/initialPayload\s*=\s*\{[\s\S]*?mode:\s*['"]daily-sync-auto['"][\s\S]*?runId:\s*continuation\.runId/, 'scheduled same-run continuation')
requirePattern(/runId,\s*\n\s*autoAdvance:\s*true/, 'same-run continuation')
requirePattern(/assertCanonicalRunCreated\(dailyBootstrap\.runDate,\s*runId\)/, 'post-bootstrap canonical run verification')
requirePattern(/runs\.length\s*!==\s*1/, 'canonical run uniqueness assertion')
requirePattern(/if\s*\(dailyBootstrap\)[\s\S]*?assertCanonicalRunCreated\(dailyBootstrap\.runDate,\s*runId\)[\s\S]*?return/, 'single-invocation scheduled bootstrap guard')
requirePattern(/invocation <= 12/, 'bounded workflow invocations')
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
const edgeInvocationSource = functionSource(workflow, 'postSync')
requireSourcePattern(edgeInvocationSource, /sb_secret:\s*adminSecret/, 'Edge Function admin-secret body')
if (edgeInvocationSource.includes('serviceRoleKey')) throw new Error('Edge Function invocation must not use the REST service-role key')
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
