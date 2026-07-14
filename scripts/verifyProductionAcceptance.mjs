import { spawnSync } from 'node:child_process'

const checks = [
  'verify:analysis',
  'verify:odds',
  'verify:ai-final-pick',
  'verify:daily-production-health',
  'verify:daily-decision-board',
  'verify:daily-pipeline-completion',
  'verify:near-kickoff',
  'verify:final-lock',
  'verify:results',
]
const results = []

for (const command of checks) {
  const result = spawnSync('npm', ['run', command], { encoding: 'utf8', shell: true, env: process.env })
  const status = result.status === 0 ? 'PASS' : 'FAIL'
  results.push({ command, status, exitCode: result.status ?? 1 })
  console.log(`[${status}] ${command} exit=${result.status ?? 1}`)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

const summary = {
  status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
  passed: results.filter((item) => item.status === 'PASS').length,
  failed: results.filter((item) => item.status === 'FAIL').length,
  results,
}
console.log(`PRODUCTION_ACCEPTANCE_JSON=${JSON.stringify(summary)}`)
if (summary.status === 'FAIL') process.exit(1)
