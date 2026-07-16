export const API_FOOTBALL_DAILY_FIXTURES_PROVIDER_PAGE = 1

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
