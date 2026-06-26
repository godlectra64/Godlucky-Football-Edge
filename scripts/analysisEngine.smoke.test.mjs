import assert from 'node:assert/strict'
import {
  calculateRankingScore,
  calculateFootballMasterAnalysis,
  calculateLeagueContext,
  getRecommendationFromConfidence,
  rankTopMatches,
} from '../src/utils/analysisEngine.js'
import {
  extractFootballIntelligence,
  formatRecommendation,
  getDataQuality,
  getMatchRoute,
  getRiskLabel,
  getScoreLabel,
  normalizeDetailPayload,
} from '../src/utils/matchDetail.js'

const baseMatch = {
  id: 'match-1',
  kickoffAt: '2026-06-26T12:00:00Z',
  status: 'SCHEDULED',
  league: { name: 'Premier League', priority: 10 },
  homeTeam: { id: 1, api_team_id: 1, name: 'Home FC' },
  awayTeam: { id: 2, api_team_id: 2, name: 'Away FC' },
  homeForm: { played: 5, wins: 3, draws: 1, losses: 1, goals_for: 9, goals_against: 4, clean_sheets: 2 },
  awayForm: { played: 5, wins: 2, draws: 2, losses: 1, goals_for: 7, goals_against: 5, clean_sheets: 1 },
  standings: [
    {
      type: 'TOTAL',
      table: [
        { team: { id: 1 }, position: 4, points: 32, goalDifference: 12, goalsFor: 30 },
        { team: { id: 2 }, position: 8, points: 27, goalDifference: 6, goalsFor: 24 },
      ],
    },
  ],
}

const missingH2H = calculateFootballMasterAnalysis(baseMatch)
assert.equal(missingH2H.analysisBreakdown.football_intelligence.h2h.reason, 'ยังไม่มีข้อมูล H2H เพียงพอ')
assert.notEqual(missingH2H.riskLevel, 'high', 'missing H2H alone must not force high risk')

const friendlyLowData = calculateFootballMasterAnalysis({
  ...baseMatch,
  id: 'friendly-low-data',
  league: { name: 'Club Friendly' },
  homeForm: null,
  awayForm: null,
  standings: [],
})
assert.equal(friendlyLowData.analysisBreakdown.football_intelligence.league_context.type, 'friendly')
assert.equal(friendlyLowData.riskLevel, 'high')
assert.ok(friendlyLowData.analysisSummary.length > 0)

const leagueContext = calculateLeagueContext({ league: { name: 'Premier League' } })
const cupContext = calculateLeagueContext({ league: { name: 'FA Cup' } })
assert.equal(leagueContext.type, 'league')
assert.equal(cupContext.type, 'cup')
assert.ok(leagueContext.risk_modifier < cupContext.risk_modifier)

assert.ok(missingH2H.intelligenceModifier >= -6 && missingH2H.intelligenceModifier <= 6)
assert.equal(getRecommendationFromConfidence(75, 'medium'), 'BET')

const base72Match = {
  ...baseMatch,
  id: 'base-72',
  analysis: {
    raw: {
      framework: 'football-master-v2',
      analysis_breakdown: {
        team_strength: { score: 72, reason: 'stored' },
        recent_form: { score: 72, reason: 'stored' },
        attack_quality: { score: 72, reason: 'stored' },
        defensive_stability: { score: 72, reason: 'stored' },
        home_away_advantage: { score: 72, reason: 'stored' },
        motivation_context: { score: 72, reason: 'stored' },
        market_odds_risk: { score: 72, reason: 'stored' },
      },
    },
  },
}
const base72 = calculateFootballMasterAnalysis(base72Match)
assert.equal(base72.baseConfidence, 72)
assert.ok(base72.intelligenceModifier <= 2, 'base 72 should not be boosted into a hardcoded BET jump')
assert.ok(base72.confidence <= 74)

for (const key of ['h2h', 'league_context', 'rest_days', 'schedule_difficulty', 'squad_context', 'momentum', 'match_importance', 'ai_explanation']) {
  assert.ok(missingH2H.analysisBreakdown.football_intelligence[key], `missing football_intelligence.${key}`)
}

const betCandidate = {
  ...baseMatch,
  id: 'bet-candidate',
  confidence: 82,
  recommendation: 'BET',
  riskLevel: 'medium',
}
const noBetCandidate = {
  ...baseMatch,
  id: 'no-bet-candidate',
  confidence: 58,
  recommendation: 'NO BET',
  riskLevel: 'medium',
}
assert.ok(calculateRankingScore(betCandidate) > calculateRankingScore(noBetCandidate), 'BET high confidence should rank above NO BET')

const mediumRiskScore = calculateRankingScore({ ...betCandidate, id: 'medium-risk', riskLevel: 'medium' })
const highRiskScore = calculateRankingScore({ ...betCandidate, id: 'high-risk', riskLevel: 'high' })
assert.ok(highRiskScore < mediumRiskScore, 'high risk should reduce ranking score')

const missingRawScore = calculateRankingScore({ id: 'missing-raw' })
assert.ok(missingRawScore >= 0 && missingRawScore <= 100, 'missing raw ranking score stays bounded')

const ranked = rankTopMatches([
  noBetCandidate,
  { ...betCandidate, id: 'rank-1', confidence: 85 },
  { ...betCandidate, id: 'rank-2', confidence: 75 },
])
assert.deepEqual(ranked.map((match) => match.id), ['rank-1', 'rank-2', 'no-bet-candidate'])
assert.ok(ranked.every((match) => match.rankingScore >= 0 && match.rankingScore <= 100), 'ranked scores are bounded')

const sixMatches = Array.from({ length: 6 }, (_, index) => ({
  ...baseMatch,
  id: `six-${index}`,
  confidence: 70 + index,
  recommendation: index % 2 ? 'LEAN' : 'NO BET',
  riskLevel: 'medium',
}))
assert.equal(rankTopMatches(sixMatches, 10).length, 6, 'six matches should render six, not fake ten')

const normalizedEmptyDetail = normalizeDetailPayload({ id: 'empty-detail', analysis: { raw: null } })
assert.equal(normalizedEmptyDetail.footballIntelligence.h2h.reason, 'ยังไม่มีข้อมูล H2H เพียงพอ')
assert.doesNotThrow(() => normalizeDetailPayload({ id: 'missing-fi', analysis: { raw: { analysis_breakdown: {} } } }))
assert.equal(extractFootballIntelligence({ id: 'missing-fi' }).league_context.type, 'unknown')
assert.equal(getScoreLabel(78).scoreLabel, 'ดี')
assert.equal(getScoreLabel(62).scoreLabel, 'กลาง')
assert.equal(getScoreLabel(40).scoreLabel, 'เสี่ยง')
assert.equal(getRiskLabel('high').label, 'สูง')
assert.equal(formatRecommendation('LEAN'), 'LEAN')
assert.equal(formatRecommendation('MAYBE'), 'NO BET')
assert.ok(getDataQuality(normalizedEmptyDetail).missing.length > 0, 'data quality should expose missing fields')
assert.equal(getMatchRoute('abc-123'), '/match/abc-123')

console.log('analysisEngine smoke tests passed')
