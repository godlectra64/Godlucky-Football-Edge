import { validateFixture } from './validation.js'

const SCORE_FIELDS = Object.freeze([
  'leagueQualityScore',
  'dataQualityScore',
  'baseAnalysisScore',
  'formScore',
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
  const candidates = []
  const fixtureIds = new Set()
  for (const fixture of Array.isArray(fixtures) ? fixtures : []) {
    const eligibility = evaluateFixtureEligibility(fixture)
    const fixtureId = getFixtureId(fixture)
    const key = String(fixtureId)
    if (!eligibility.eligible || fixtureIds.has(key)) continue
    fixtureIds.add(key)
    candidates.push({ ...fixture })
  }
  return candidates
}

export function rankCandidates(candidates = []) {
  return buildCandidatePool(candidates)
    .map((candidate, inputIndex) => ({
      candidate,
      inputIndex,
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
    const fixtureId = String(getFixtureId(candidate) ?? '')
    const rank = Number(candidate?.rank)
    if (!fixtureId) errors.push('RANKED_FIXTURE_ID_MISSING')
    else if (fixtureIds.has(fixtureId)) errors.push(`DUPLICATE_FIXTURE_ID:${fixtureId}`)
    fixtureIds.add(fixtureId)
    if (!Number.isInteger(rank) || rank < 1) errors.push(`RANK_INVALID:${candidate?.rank}`)
    else if (ranks.has(rank)) errors.push(`DUPLICATE_RANK:${rank}`)
    ranks.add(rank)
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
  const numericDifference = compareNumericFixtureIds(left.fixtureId, right.fixtureId)
  if (numericDifference !== null && numericDifference !== 0) return numericDifference
  const leftText = String(left.fixtureId)
  const rightText = String(right.fixtureId)
  const lexicalDifference = leftText === rightText ? 0 : leftText < rightText ? -1 : 1
  return lexicalDifference || left.inputIndex - right.inputIndex
}

function compareNumericFixtureIds(left, right) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return null
  return leftNumber - rightNumber
}

function getFixtureId(fixture) {
  return fixture?.id ?? fixture?.fixtureId ?? fixture?.fixture_id ?? fixture?.apiFixtureId ?? fixture?.api_fixture_id
}

function normalizedScore(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0
}

function round(value) {
  return Math.round(value * 100) / 100
}
