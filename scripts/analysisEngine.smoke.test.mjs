import assert from 'node:assert/strict'
import {
  calculateRankingScore,
  calculateFootballMasterAnalysis,
  calculateLeagueContext,
  getRecommendationFromConfidence,
  rankTopMatches,
} from '../src/utils/analysisEngine.js'
import {
  calculateDataIntelligence,
  calculateDataIntelligenceModifier,
} from '../src/utils/dataIntelligence.js'
import {
  extractDataIntelligence,
  extractFootballIntelligence,
  formatRecommendation,
  getDataIntelligenceItems,
  getDataQuality,
  getMatchRoute,
  getRiskLabel,
  getScoreLabel,
  normalizeDetailPayload,
} from '../src/utils/matchDetail.js'
import {
  addImmutableSnapshot,
  buildPerformanceGroups,
  calculatePerformanceMetrics,
  createPredictionSnapshot,
  evaluatePrediction,
  getPerformanceContext,
  getResultTracking,
} from '../src/utils/performanceIntelligence.js'

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
assert.ok(missingH2H.analysisBreakdown.data_intelligence, 'data_intelligence should be added to analysis_breakdown')
assert.ok(missingH2H.analysisBreakdown.data_intelligence.data_confidence.score >= 0)
assert.ok(missingH2H.analysisBreakdown.data_intelligence.data_confidence.score <= 100)
assert.ok(missingH2H.intelligenceModifier >= -10 && missingH2H.intelligenceModifier <= 10, 'combined modifier stays bounded')
assert.equal(missingH2H.analysisBreakdown.data_intelligence.head_to_head.confidence, 'low')
assert.notEqual(missingH2H.riskLevel, 'high', 'missing data_intelligence H2H alone must not force high risk')

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
assert.ok(base72.dataIntelligenceModifier >= -10 && base72.dataIntelligenceModifier <= 10)

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
assert.equal(normalizedEmptyDetail.dataIntelligence.data_confidence.level, 'low')
assert.doesNotThrow(() => normalizeDetailPayload({ id: 'missing-fi', analysis: { raw: { analysis_breakdown: {} } } }))
assert.equal(extractFootballIntelligence({ id: 'missing-fi' }).league_context.type, 'unknown')
assert.equal(extractDataIntelligence({ id: 'missing-di' }).data_confidence.level, 'low')
assert.equal(getDataIntelligenceItems(extractDataIntelligence({ id: 'missing-di' })).length, 7)
assert.equal(getScoreLabel(78).scoreLabel, 'ดี')
assert.equal(getScoreLabel(62).scoreLabel, 'กลาง')
assert.equal(getScoreLabel(40).scoreLabel, 'เสี่ยง')
assert.equal(getRiskLabel('high').label, 'สูง')
assert.equal(formatRecommendation('LEAN'), 'LEAN')
assert.equal(formatRecommendation('MAYBE'), 'NO BET')
assert.ok(getDataQuality(normalizedEmptyDetail).missing.length > 0, 'data quality should expose missing fields')
assert.equal(getMatchRoute('abc-123'), '/match/abc-123')

const directDataIntelligence = calculateDataIntelligence(baseMatch, { baseConfidence: missingH2H.baseConfidence, footballModifier: missingH2H.footballModifier })
assert.ok(directDataIntelligence.data_confidence.score >= 0 && directDataIntelligence.data_confidence.score <= 100)
assert.ok(calculateDataIntelligenceModifier(directDataIntelligence, 72, 2) <= 0, 'data modifier must not boost base 72 + football modifier 2 into BET')

const performanceSnapshot = createPredictionSnapshot({
  id: 'match-1',
  fixtureId: 'fixture-1',
  homeTeam: { name: 'Home FC' },
  awayTeam: { name: 'Away FC' },
  league: { name: 'Premier League' },
  kickoffAt: '2026-06-26T12:00:00Z',
  analysis: {
    recommendation: 'BET',
    confidence_score: 82,
    risk_level: 'medium',
    raw: {
      framework: 'data-intelligence-v1',
      analysis_breakdown: {
        data_intelligence: {
          league_position: { edge: 'home' },
        },
      },
    },
  },
})
const immutableSnapshots = addImmutableSnapshot([performanceSnapshot], { ...performanceSnapshot, confidence_score: 10 })
assert.equal(immutableSnapshots[0].confidence_score, 82, 'snapshot must not be overwritten')

const pendingResult = getResultTracking({ status: 'SCHEDULED' })
assert.equal(pendingResult.status, 'pending')
const finishedResult = getResultTracking({ status: 'FINISHED', homeGoals: 2, awayGoals: 1, updatedAt: '2026-06-26T14:00:00Z' })
assert.equal(finishedResult.status, 'finished')
assert.equal(finishedResult.result, 'home')

const correctEvaluation = evaluatePrediction(performanceSnapshot, finishedResult)
assert.equal(correctEvaluation.evaluation_status, 'correct')
const noBetEvaluation = evaluatePrediction({ ...performanceSnapshot, recommendation: 'NO BET' }, finishedResult)
assert.equal(noBetEvaluation.evaluation_status, 'no_evaluation')

const performanceRows = [
  { ...performanceSnapshot, id: 'snap-1', result: finishedResult, evaluation: correctEvaluation },
  { ...performanceSnapshot, id: 'snap-2', recommendation: 'LEAN', confidence_score: 70, ranking_score: 71, result: finishedResult, evaluation: { evaluation_status: 'incorrect' } },
  { ...performanceSnapshot, id: 'snap-3', recommendation: 'NO BET', confidence_score: 55, ranking_score: 56, result: pendingResult, evaluation: { evaluation_status: 'pending' } },
]
const performanceMetrics = calculatePerformanceMetrics(performanceRows)
assert.equal(performanceMetrics.totalPredictions, 3)
assert.equal(performanceMetrics.totalBet, 1)
assert.equal(performanceMetrics.totalLean, 1)
assert.equal(performanceMetrics.totalNoBet, 1)
assert.equal(performanceMetrics.correct, 1)
assert.equal(performanceMetrics.incorrect, 1)
assert.equal(performanceMetrics.winRate, 50)
assert.doesNotThrow(() => buildPerformanceGroups(performanceRows))
assert.equal(getPerformanceContext(performanceRows), 'กำลังสะสมข้อมูล')

console.log('analysisEngine smoke tests passed')
