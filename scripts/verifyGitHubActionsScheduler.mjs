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
assertIncludes('restartCompleted: true', 'workflow must restart completed daily-sync-auto runs before fixture sync')
assertIncludes('build-daily-market-candidates', 'workflow must build a stable daily market candidate pool')
assertIncludes('sync-daily-candidate-odds', 'workflow must sync odds for the broad stable candidate pool')
assertIncludes('finalize-market-ready-candidates', 'workflow must finalize candidate market readiness before strict picks')
assertIncludes('strict-api-football-daily-picks', 'workflow must call strict-api-football-daily-picks')
assertIncludes("mode: 'build-daily-market-candidates', limit: 60", 'workflow must build the dynamic 60-row candidate pool')
assertIncludes("mode: 'strict-api-football-daily-picks', limit: 60, marketFirst: true", 'workflow must persist a dynamic decision board, not a fixed Top10')
assertMatch(/finalize-market-ready-candidates[\s\S]*strict-api-football-daily-picks/, 'workflow must finalize candidates before strict decision-board persistence')
assertIncludes('sync-daily-top10-odds', 'workflow must sync odds for the locked daily Top10 list')
assertIncludes('sync-today-odds-finalize', 'workflow must finalize odds sync before the final strict pick pass')
assertIncludes('get-daily-top10-status', 'workflow must verify the locked daily Top10 status')
assertIncludes('diagnose-sync-today-odds', 'workflow must verify daily odds sync diagnostics')
assertIncludes('https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data', 'workflow must call the sync-football-data endpoint')
assertMatch(/cron:\s*['"]10 0 \* \* \*['"]/, 'workflow must schedule 00:10 UTC')
assertMatch(/cron:\s*['"]10 11 \* \* \*['"]/, 'workflow must schedule 11:10 UTC')
assertMatch(/cron:\s*['"]40 16 \* \* \*['"]/, 'workflow must schedule 16:40 UTC')
assertMatch(/workflow_dispatch:/, 'workflow must support manual dispatch')
assertMatch(/sb_secret:\s*adminSecret/, 'workflow must pass sb_secret from the secret environment value')
assertMatch(/maxStepsPerRequest:\s*2/, 'workflow must continue with maxStepsPerRequest: 2')
assertMatch(/autoAdvance:\s*true/, 'workflow must continue with autoAdvance: true')
assertMatch(/daily-sync-auto[\s\S]*build-daily-market-candidates[\s\S]*sync-daily-candidate-odds[\s\S]*finalize-market-ready-candidates[\s\S]*strict-api-football-daily-picks[\s\S]*sync-daily-top10-odds[\s\S]*sync-today-odds-finalize[\s\S]*strict-api-football-daily-picks[\s\S]*get-daily-top10-status[\s\S]*diagnose-sync-today-odds/, 'workflow must run fixture sync -> build candidates -> candidate odds -> finalize candidates -> decision board -> board odds -> finalize -> decision board -> verify')
assertMatch(/attempt <= 30 && candidateOdds\.hasMore/, 'workflow must page candidate odds through the dynamic pool while hasMore is true')
assertMatch(/candidate odds sync still has more work/, 'workflow must fail only if the dynamic candidate odds pool is not exhausted')
assertMatch(/top10Odds\.hasMore/, 'workflow must continue sync-daily-top10-odds while hasMore is true')
assertMatch(/nextOffset/, 'workflow must page sync-daily-top10-odds with nextOffset')
assertMatch(/marketFirst:\s*true/g, 'workflow must run strict picks in marketFirst mode')
assertIncludes('npm run verify:scheduler', 'workflow must run scheduler verification when repo context is available')
assertIncludes('npm run verify:daily-production-health', 'workflow must run daily production health verification')
assertMatch(/verify:odds[\s\S]*verify:daily-decision-board[\s\S]*verify:daily-production-health/, 'workflow must run daily production health after scheduler, odds, and decision-board verification')
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

if (workflow.includes("mode: 'result-refresh'") || workflow.includes('mode: "result-refresh"')) {
  throw new Error('workflow must not run result-refresh in the daily fixture/top10 odds pipeline')
}

if (workflow.includes("mode: 'sync-today-odds'") || workflow.includes('mode: "sync-today-odds"')) {
  throw new Error('workflow must not use old dynamic sync-today-odds offset paging')
}

if (workflow.includes("mode: 'repair-stale-market-first-top10'") || workflow.includes('repairStaleMarketLock')) {
  throw new Error('workflow must not run stale fixed-Top10 repair in the dynamic decision-board pipeline')
}

if (/EDGE_ADMIN_SECRET:\s*(?!\$\{\{\s*secrets\.EDGE_ADMIN_SECRET\s*\}\})\S+/.test(workflow)) {
  throw new Error('workflow must not hardcode EDGE_ADMIN_SECRET')
}

console.log('GitHub Actions scheduler workflow verified.')
