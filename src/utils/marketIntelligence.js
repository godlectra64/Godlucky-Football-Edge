const MARKET_FIELDS = [
  'asian_handicap',
  'over_under',
  'one_x_two',
  'opening_odds',
  'closing_odds',
  'odds_movement',
  'market_edge',
  'value_rating',
]

export function normalizeMarketIntelligence(input = {}) {
  const raw = input.raw ?? input.match?.raw ?? input.market ?? input
  const market = raw.market_intelligence ?? raw.market ?? raw.odds ?? {}
  const normalized = MARKET_FIELDS.reduce((result, field) => {
    result[field] = market[field] ?? raw[field] ?? null
    return result
  }, {})
  const available = MARKET_FIELDS.filter((field) => normalized[field] !== null && normalized[field] !== undefined)
  const hasMarketData = available.length > 0 || Boolean(raw.bookmakers)

  return {
    ...normalized,
    hasMarketData,
    available,
    missing: MARKET_FIELDS.filter((field) => !available.includes(field)),
    confidence: hasMarketData ? 'partial' : 'none',
    reason: hasMarketData ? 'มีข้อมูลตลาดบางส่วน' : 'ยังไม่มีข้อมูลตลาด',
  }
}
