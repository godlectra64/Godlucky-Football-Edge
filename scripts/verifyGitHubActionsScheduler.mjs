import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/daily-football-sync.yml', 'utf8')

requireText('secrets.EDGE_ADMIN_SECRET')
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
requireText("eventName === 'schedule'")
requirePattern(/initialPayload\s*=\s*\{[\s\S]*?mode:\s*['"]daily-sync-auto['"][\s\S]*?runId:\s*continuation\.runId/, 'scheduled same-run continuation')
requirePattern(/runId,\s*\n\s*autoAdvance:\s*true/, 'same-run continuation')
requirePattern(/invocation <= 12/, 'bounded workflow invocations')
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
