import { validateFixture } from './validation.js'

const SCORE_FIELDS = Object.freeze([
  'leagueQualityScore',
  'dataQualityScore',
  'baseAnalysisScore',
  'formScore',
])

const PRE_RANKING_IGNORED_FIELDS = new Set([
  'odds',
  'matchOdds',
  'match_odds',
  'marketAvailable',
  'market_available',
  'marketAvailability',
  'market_availability',
])

export function evaluateFixtureEligibility(fixture = {}) {
  const validation = validateFixture(fixture)
  return {
    eligible: validation.valid,
    reasons: validation.errors,
    warnings: validation.warnings,
  }
}

export function buildCandidatePool(fixtures = []) {
  const byFixtureId = new Map()
  for (const fixture of Array.isArray(fixtures) ? fixtures : []) {
    const eligibility = evaluateFixtureEligibility(fixture)
    const key = canonicalFixtureId(getFixtureId(fixture))
    if (!eligibility.eligible || key === null) continue

    const candidate = sanitizePreRankingCandidate(fixture)
    const choice = {
      candidate,
      fixtureId: getFixtureId(candidate),
      preRankingScore: calculatePreRankingScore(candidate),
      signature: stableSignature(candidate),
    }
    const existing = byFixtureId.get(key)
    if (!existing || compareDuplicateChoices(choice, existing) < 0) byFixtureId.set(key, choice)
  }

  return [...byFixtureId.values()]
    .sort((left, right) => compareFixtureIds(left.fixtureId, right.fixtureId))
    .map(({ candidate }) => candidate)
}

export function rankCandidates(candidates = []) {
  return buildCandidatePool(candidates)
    .map((candidate) => ({
      candidate,
      preRankingScore: calculatePreRankingScore(candidate),
      fixtureId: getFixtureId(candidate),
    }))
    .sort(compareCandidates)
    .map(({ candidate, preRankingScore }, index) => ({
      ...candidate,
      preRankingScore,
      rank: index + 1,
    }))
}

export function validateDynamicRanking(candidates = []) {
  const errors = []
  const warnings = []
  const fixtureIds = new Set()
  const ranks = new Set()
  const list = Array.isArray(candidates) ? candidates : []

  for (const candidate of list) {
    const fixtureId = canonicalFixtureId(getFixtureId(candidate))
    const rank = candidate?.rank
    if (fixtureId === null) errors.push('RANKED_FIXTURE_ID_MISSING')
    else if (fixtureIds.has(fixtureId)) errors.push(`DUPLICATE_FIXTURE_ID:${fixtureId}`)
    if (fixtureId !== null) fixtureIds.add(fixtureId)
    if (!Number.isInteger(rank) || rank < 1) errors.push(`RANK_INVALID:${rank}`)
    else if (ranks.has(rank)) errors.push(`DUPLICATE_RANK:${rank}`)
    if (Number.isInteger(rank) && rank >= 1) ranks.add(rank)
  }

  const sortedRanks = [...ranks].sort((a, b) => a - b)
  for (let index = 0; index < sortedRanks.length; index += 1) {
    if (sortedRanks[index] !== index + 1) {
      errors.push(`RANK_SEQUENCE_INVALID:EXPECTED_${index + 1}`)
      break
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings }
}

function calculatePreRankingScore(candidate) {
  const values = SCORE_FIELDS.map((field) => normalizedScore(candidate[field] ?? candidate.scores?.[field]))
  return round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function compareCandidates(left, right) {
  if (left.preRankingScore !== right.preRankingScore) return right.preRankingScore - left.preRankingScore
  return compareFixtureIds(left.fixtureId, right.fixtureId)
}

function compareDuplicateChoices(left, right) {
  if (left.preRankingScore !== right.preRankingScore) return right.preRankingScore - left.preRankingScore
  if (left.signature === right.signature) return 0
  return left.signature < right.signature ? -1 : 1
}

function compareFixtureIds(left, right) {
  const leftKey = canonicalFixtureId(left) ?? ''
  const rightKey = canonicalFixtureId(right) ?? ''
  const leftInteger = integerId(leftKey)
  const rightInteger = integerId(rightKey)
  if (leftInteger !== null && rightInteger !== null && leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1
  if (leftKey === rightKey) return 0
  return leftKey < rightKey ? -1 : 1
}

function canonicalFixtureId(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  const integer = integerId(normalized)
  return integer === null ? normalized : integer.toString()
}

function integerId(value) {
  if (!/^[+-]?\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function getFixtureId(fixture) {
  return fixture?.id ?? fixture?.fixtureId ?? fixture?.fixture_id ?? fixture?.apiFixtureId ?? fixture?.api_fixture_id
}

function normalizedScore(value) {
  if (value === null || value === undefined || value === '') return 0
  if (!['number', 'string'].includes(typeof value)) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0
}

function sanitizePreRankingCandidate(candidate) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return {}
  return Object.fromEntries(
    Object.keys(candidate)
      .filter((key) => !PRE_RANKING_IGNORED_FIELDS.has(key))
      .map((key) => [key, candidate[key]]),
  )
}

function stableSignature(value, seen = new WeakSet()) {
  if (value === undefined) return '"[Undefined]"'
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (typeof value === 'symbol' || typeof value === 'function') return JSON.stringify(String(value))
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (seen.has(value)) return '"[Circular]"'
  seen.add(value)
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map((item) => stableSignature(item, seen)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSignature(value[key], seen)}`).join(',')}}`
}

function round(value) {
  return Math.round(value * 100) / 100
}
