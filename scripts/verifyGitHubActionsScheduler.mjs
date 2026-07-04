import { readFileSync } from 'node:fs'

const workflowPath = '.github/workflows/daily-football-sync.yml'
const workflow = readFileSync(workflowPath, 'utf8')

function assertIncludes(value, message) {
  if (!workflow.includes(value)) throw new Error(message)
}

function assertMatch(pattern, message) {
  if (!pattern.test(workflow)) throw new Error(message)
}

assertIncludes('secrets.EDGE_ADMIN_SECRET', 'workflow must use secrets.EDGE_ADMIN_SECRET')
assertIncludes('daily-sync-auto', 'workflow must call daily-sync-auto')
assertIncludes('strict-api-football-daily-picks', 'workflow must call strict-api-football-daily-picks after daily-sync-auto')
assertIncludes('result-refresh', 'workflow must call result-refresh')
assertIncludes('https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data', 'workflow must call the sync-football-data endpoint')
assertMatch(/cron:\s*['"]10 0 \* \* \*['"]/, 'workflow must schedule 00:10 UTC')
assertMatch(/cron:\s*['"]10 11 \* \* \*['"]/, 'workflow must schedule 11:10 UTC')
assertMatch(/cron:\s*['"]40 16 \* \* \*['"]/, 'workflow must schedule 16:40 UTC')
assertMatch(/workflow_dispatch:/, 'workflow must support manual dispatch')
assertMatch(/sb_secret:\s*adminSecret/, 'workflow must pass sb_secret from the secret environment value')
assertMatch(/maxStepsPerRequest:\s*2/, 'workflow must continue with maxStepsPerRequest: 2')
assertMatch(/autoAdvance:\s*true/, 'workflow must continue with autoAdvance: true')
assertMatch(/limit:\s*20/, 'workflow must run result-refresh with limit 20')
assertMatch(/strict-api-football-daily-picks[\s\S]*result-refresh/, 'workflow must run strict daily selection before result-refresh')
assertIncludes('pending_retry', 'workflow must support pending_retry')
assertIncludes('retryAfterSeconds', 'workflow must support retryAfterSeconds')
assertIncludes('daily sync complete', 'workflow must treat daily sync complete as complete')
assertIncludes('partial_success', 'workflow must tolerate partial_success without real failures')
assertIncludes('assertNoRealFailure', 'workflow must centralize real failure checks')
assertMatch(/result\.ok\s*===\s*false/, 'workflow must fail on ok:false')
assertMatch(/Number\(result\.failed\s*\?\?\s*0\)\s*>\s*0/, 'workflow must fail on failed > 0')
assertMatch(/hasItems\(result\.failures\)/, 'workflow must fail on non-empty failures')
assertMatch(/step\?\.(status)\s*===\s*['"]failed['"]/, 'workflow must fail on failed step status')

if (/sb_secret_[A-Za-z0-9._-]+/.test(workflow)) {
  throw new Error('workflow must not hardcode an sb_secret value')
}

if (/EDGE_ADMIN_SECRET:\s*(?!\$\{\{\s*secrets\.EDGE_ADMIN_SECRET\s*\}\})\S+/.test(workflow)) {
  throw new Error('workflow must not hardcode EDGE_ADMIN_SECRET')
}

console.log('GitHub Actions scheduler workflow verified.')
