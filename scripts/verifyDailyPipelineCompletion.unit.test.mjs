import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const date = '2099-01-02'
const verifierPath = fileURLToPath(new URL('./verifyDailyPipelineCompletion.mjs', import.meta.url))
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const verifierSource = await readFile(verifierPath, 'utf8')

assert.doesNotMatch(verifierSource, /\bprocess\.exit\s*\(/)
assert.match(verifierSource, /process\.exitCode\s*=\s*1/)

const missing = await runVerifier({ runs: [], steps: [] })
assert.equal(missing.timedOut, false, 'missing-run verifier must not leave active handles')
assert.equal(missing.code, 1, `missing-run verifier must exit 1\n${missing.stderr}`)
assert.equal(missing.signal, null)
assert.match(missing.stdout, /missing run: 1/)
assert.doesNotMatch(missing.stdout, /Daily pipeline completion checks passed/)
assert.doesNotMatch(`${missing.stdout}\n${missing.stderr}`, /Assertion failed|UV_HANDLE_CLOSING/)
assert.equal(missing.requests.filter((path) => path.includes('api_football_daily_sync_runs')).length, 1)
assert.equal(missing.requests.some((path) => path.includes('api_football_daily_sync_steps')), false)

const completedRun = {
  id: 'run-complete',
  run_date: date,
  mode: 'daily-sync-auto',
  status: 'success',
  current_phase: 'COMPLETE',
  progress_percent: 100,
  started_at: '2099-01-02T00:00:00.000Z',
}
const completedSteps = ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase, index) => ({
  id: `step-${index + 1}`,
  run_id: completedRun.id,
  phase,
  step_order: index + 1,
  status: 'success',
  attempt_count: 1,
  max_attempts: 3,
}))
const completed = await runVerifier({ runs: [completedRun], steps: completedSteps })
assert.equal(completed.timedOut, false, 'completed-run verifier must not leave active handles')
assert.equal(completed.code, 0, `completed-run verifier must exit 0\n${completed.stderr}`)
assert.equal(completed.signal, null)
assert.match(completed.stdout, /missing run: 0/)
assert.match(completed.stdout, /Daily pipeline completion checks passed/)
assert.doesNotMatch(`${completed.stdout}\n${completed.stderr}`, /Assertion failed|UV_HANDLE_CLOSING/)

console.log('Daily pipeline completion verifier unit tests passed.')

async function runVerifier({ runs, steps }) {
  const requests = []
  const server = createServer((request, response) => {
    const path = request.url ?? ''
    requests.push(path)
    const rows = path.includes('api_football_daily_sync_steps') ? steps : runs
    response.writeHead(200, {
      connection: 'close',
      'content-type': 'application/json',
    })
    response.end(JSON.stringify(rows))
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  let child
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    child = spawn(process.execPath, [verifierPath, date], {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
        VITE_SUPABASE_ANON_KEY: 'local-verifier-test-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return { ...await collectChild(child), requests }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill()
      await new Promise((resolve) => child.once('close', resolve))
    }
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 10_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })
}
