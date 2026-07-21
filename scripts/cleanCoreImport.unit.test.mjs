import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const coreDirectory = path.resolve('supabase/functions/_shared/cleanCore')
const moduleFiles = (await readdir(coreDirectory)).filter((name) => name.endsWith('.js')).sort()
const contents = new Map()
for (const name of moduleFiles) contents.set(name, await readFile(path.join(coreDirectory, name), 'utf8'))

for (const [name, source] of contents) {
  for (const [pattern, label] of [
    [/node:fs|from\s+['"]fs['"]/, 'filesystem import'],
    [/process\.env|Deno\.env/, 'environment access'],
    [/\bfetch\s*\(/, 'fetch'],
    [/from\s+['"](?:react|@supabase\/)/i, 'React or Supabase import'],
  ]) assert.equal(pattern.test(source), false, `${name} must not contain ${label}`)

  for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    assert.equal(specifier.startsWith('./'), true, `${name} may only import local pure-JS modules`)
    assert.equal(specifier.endsWith('.js'), true, `${name} import must include .js: ${specifier}`)
  }
}

const graph = new Map(moduleFiles.map((name) => [name, dependencies(contents.get(name))]))
for (const name of moduleFiles) assertNoCycle(name, graph)

const originalFetch = globalThis.fetch
const originalConsole = { log: console.log, warn: console.warn, error: console.error }
let fetchCalls = 0
const consoleCalls = []
globalThis.fetch = () => { fetchCalls += 1; throw new Error('Clean Core import must not fetch') }
console.log = (...args) => consoleCalls.push(['log', ...args])
console.warn = (...args) => consoleCalls.push(['warn', ...args])
console.error = (...args) => consoleCalls.push(['error', ...args])

let publicApi
try {
  publicApi = await import(`${pathToFileURL(path.join(coreDirectory, 'index.js')).href}?smoke=1`)
} finally {
  globalThis.fetch = originalFetch
  console.log = originalConsole.log
  console.warn = originalConsole.warn
  console.error = originalConsole.error
}

assert.equal(fetchCalls, 0)
assert.deepEqual(consoleCalls, [])
assert.deepEqual(Object.keys(publicApi).sort(), [
  'CONFIDENCE_COMPONENT_WEIGHTS',
  'DECISION_STATUS',
  'DEFAULT_DECISION_THRESHOLDS',
  'FIXTURE_ONLY_CONFIDENCE_CAP',
  'FUTURE_PIPELINE_STAGE',
  'MARKET_CAPABILITIES',
  'MARKET_TYPE',
  'PIPELINE_STAGE',
  'REASON_CODE',
  'REQUIRED_PIPELINE_SEQUENCE',
  'RISK_LEVEL',
  'buildCandidatePool',
  'buildCanonicalFinalPick',
  'calculateDecisionConfidence',
  'canMarketProduceReady',
  'canSettleMarket',
  'classifyDecision',
  'evaluateFixtureEligibility',
  'getMarketCapability',
  'getNextRequiredStage',
  'isActionableMarket',
  'isSettlementSupported',
  'isValidStageTransition',
  'normalizeMarketType',
  'rankCandidates',
  'validateAnalysis',
  'validateDynamicRanking',
  'validateFinalPick',
  'validateFixture',
  'validateMarket',
  'validatePipelineCompletion',
  'validateSettlementInput',
].sort())
assert.equal('deepFreeze' in publicApi, false, 'internal immutable helper must not be public')
assert.equal('normalizeMatchStatus' in publicApi, false, 'internal status helper must not be public')

console.log('clean core import smoke tests passed')

function dependencies(source) {
  return [...source.matchAll(/(?:from\s+|import\s*)['"]\.\/([^'"]+\.js)['"]/g)].map((match) => match[1])
}

function assertNoCycle(start, moduleGraph) {
  const visiting = new Set()
  const visited = new Set()
  const visit = (name) => {
    if (visiting.has(name)) assert.fail(`cyclic import detected at ${name}`)
    if (visited.has(name)) return
    visiting.add(name)
    for (const dependency of moduleGraph.get(name) ?? []) visit(dependency)
    visiting.delete(name)
    visited.add(name)
  }
  visit(start)
}
