import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/daily-football-sync.yml', 'utf8')

requireText('secrets.EDGE_ADMIN_SECRET')
requireText('daily-sync-auto')
requireText('result-refresh')
requireText('requiredPhases')
requireText('pending_retry')
requireText('next_retry_at')
requireText('Continuation changed run id')
requireText("required.every((step) => step.status === 'success')")
requireText('https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data')
requirePattern(/cron:\s*['"]10 0 \* \* \*['"]/, '00:10 UTC schedule')
requirePattern(/cron:\s*['"]10 11 \* \* \*['"]/, '11:10 UTC schedule')
requirePattern(/cron:\s*['"]40 16 \* \* \*['"]/, '16:40 UTC schedule')
requirePattern(/workflow_dispatch:/, 'manual dispatch')
requirePattern(/runId,\s*\n\s*autoAdvance:\s*true/, 'same-run continuation')
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
