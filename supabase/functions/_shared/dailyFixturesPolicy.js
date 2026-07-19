export const API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE = 1
export const PROCESSED_FIXTURE_IDS_CURSOR_MODE = 'processed-fixture-ids-v1'

export function buildApiFootballDailyFixturesParams(dateKey) {
  return { date: String(dateKey ?? '') }
}

export function buildSinglePageFixtureDiscovery(payload = {}, normalizeFixture = (fixture) => fixture) {
  const response = Array.isArray(payload?.response) ? payload.response : []
  return {
    matches: response.map(normalizeFixture),
    pageCount: 1,
    totalPages: 1,
  }
}

export function selectDailyFixtureBatch(matches = [], fixtureOffset = 0, batchSize = 1) {
  const rows = Array.isArray(matches) ? matches : []
  const offset = nonNegativeInteger(fixtureOffset)
  const limit = positiveInteger(batchSize, 1)
  return {
    batch: rows.slice(offset, offset + limit),
    fixtureOffset: offset,
    totalFixtures: rows.length,
  }
}

export function normalizeDailyFixtureCandidates(matches = [], compareFixtures = () => 0) {
  const byFixtureId = new Map()
  for (const match of Array.isArray(matches) ? matches : []) {
    const fixtureId = normalizeFixtureId(match?.raw_fixture_id)
    if (fixtureId === null || byFixtureId.has(fixtureId)) continue
    byFixtureId.set(fixtureId, match)
  }
  return [...byFixtureId.values()].sort((left, right) => {
    const compared = Number(compareFixtures(left, right))
    if (Number.isFinite(compared) && compared !== 0) return compared
    return normalizeFixtureId(left?.raw_fixture_id) - normalizeFixtureId(right?.raw_fixture_id)
  })
}

export function initializeProcessedFixtureCursor(value = {}) {
  const row = objectValue(value)
  const currentMode = row.fixtureCursorMode === PROCESSED_FIXTURE_IDS_CURSOR_MODE
  const legacyFixtureOffsetValue = currentMode
    ? nonNegativeInteger(row.legacyFixtureOffsetValue ?? row.fixtureOffset)
    : nonNegativeInteger(row.fixtureOffset)
  const legacyProgress = legacyFixtureOffsetValue > 0
    || nonNegativeInteger(row.processedFixtureCount) > 0
    || normalizeFixtureId(row.lastProcessedFixtureId) !== null
  const processedFixtureIds = currentMode ? normalizeProcessedFixtureIds(row.processedFixtureIds) : []
  return {
    fixtureCursorMode: PROCESSED_FIXTURE_IDS_CURSOR_MODE,
    processedFixtureIds,
    uniqueProcessedFixtureCount: processedFixtureIds.length,
    fixtureCandidateCount: currentMode ? nonNegativeInteger(row.fixtureCandidateCount) : 0,
    fixtureRemainingCount: currentMode ? nonNegativeInteger(row.fixtureRemainingCount) : 0,
    fixtureSnapshotSignature: currentMode ? textOrNull(row.fixtureSnapshotSignature) : null,
    fixtureStableEmptyPasses: currentMode ? Math.min(2, nonNegativeInteger(row.fixtureStableEmptyPasses)) : 0,
    legacyFixtureOffsetIgnored: currentMode ? Boolean(row.legacyFixtureOffsetIgnored) : legacyProgress,
    legacyFixtureOffsetValue,
  }
}

export function selectProcessedFixtureBatch(candidates = [], processedFixtureIds = [], batchSize = 1) {
  const processed = new Set(normalizeProcessedFixtureIds(processedFixtureIds))
  const rows = Array.isArray(candidates) ? candidates : []
  const remainingCandidates = rows.filter((match) => {
    const fixtureId = normalizeFixtureId(match?.raw_fixture_id)
    return fixtureId !== null && !processed.has(fixtureId)
  })
  return {
    batch: remainingCandidates.slice(0, positiveInteger(batchSize, 1)),
    remainingCandidates,
    totalCandidates: rows.length,
    remainingCount: remainingCandidates.length,
  }
}

export function addProcessedFixtureId(processedFixtureIds = [], fixtureId) {
  const nextFixtureId = normalizeFixtureId(fixtureId)
  const current = normalizeProcessedFixtureIds(processedFixtureIds)
  if (nextFixtureId === null || current.includes(nextFixtureId)) return current
  return [...current, nextFixtureId]
}

export function getFixtureStableEmptyDecision({ previousSnapshotSignature = null, snapshotSignature = null, previousPasses = 0, remainingCount = 0 } = {}) {
  if (nonNegativeInteger(remainingCount) > 0) return { fixtureStableEmptyPasses: 0, providerComplete: false }
  const previousSignature = textOrNull(previousSnapshotSignature)
  const currentSignature = textOrNull(snapshotSignature)
  if (previousSignature && previousSignature !== currentSignature) {
    return { fixtureStableEmptyPasses: 0, providerComplete: false }
  }
  const fixtureStableEmptyPasses = Math.min(2, nonNegativeInteger(previousPasses) + 1)
  return { fixtureStableEmptyPasses, providerComplete: fixtureStableEmptyPasses >= 2 }
}

export function normalizeProcessedFixtureIds(values = []) {
  const fixtureIds = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const fixtureId = normalizeFixtureId(value)
    if (fixtureId === null || seen.has(fixtureId)) continue
    seen.add(fixtureId)
    fixtureIds.push(fixtureId)
  }
  return fixtureIds
}

export function advanceDailyFixtureCursor({ totalFixtures = 0, fixtureOffset = 0, advancedBy = 0, batchComplete = false } = {}) {
  const total = nonNegativeInteger(totalFixtures)
  const offset = nonNegativeInteger(fixtureOffset)
  const nextOffset = Math.max(offset, Math.min(total, offset + nonNegativeInteger(advancedBy)))
  return {
    providerPage: API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE,
    fixtureOffset: nextOffset,
    providerComplete: Boolean(batchComplete) && nextOffset >= total,
  }
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function normalizeFixtureId(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function textOrNull(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
