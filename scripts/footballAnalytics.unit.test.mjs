import assert from 'node:assert/strict'
import { normalizeAnalysisStatus } from '../src/utils/analysisStatus.js'
import { buildFootballAnalyticsOutput, FOOTBALL_ANALYSIS_MODEL_VERSION, FOOTBALL_ANALYTICS_PIPELINE_VERSION } from '../src/utils/footballAnalytics.js'

assert.equal(normalizeAnalysisStatus('READY_PRIMARY'), 'ANALYSIS_READY')
assert.equal(normalizeAnalysisStatus('READY_ALTERNATIVE'), 'PARTIAL_ANALYSIS')
assert.equal(normalizeAnalysisStatus('WAITING_MARKET'), 'WAITING_DATA')
assert.equal(normalizeAnalysisStatus('INSUFFICIENT_DATA'), 'INSUFFICIENT_DATA')

const analytics = buildFootballAnalyticsOutput({
  id: 'match-1',
  api_sports_fixture_id: 123,
  kickoff_at: '2026-07-12T12:00:00.000Z',
  selection_status: 'READY_PRIMARY',
  league: { name: 'League' },
  homeTeam: { name: 'Home' },
  awayTeam: { name: 'Away' },
  analysis: {
    confidence_score: 82,
    data_quality_score: 88,
    team_strength_score: 78,
    form_score: 72,
    home_advantage_score: 70,
    goal_scoring_score: 66,
    defensive_stability_score: 58,
    tactical_matchup_score: 64,
  },
}, { selectionDate: '2026-07-12', generatedAt: '2026-07-12T00:00:00.000Z' })

const probabilitySum = analytics.matchOutlook.homeWin + analytics.matchOutlook.draw + analytics.matchOutlook.awayWin
assert.ok(Math.abs(probabilitySum - 1) < 0.001, `probability sum ${probabilitySum}`)
assert.ok(analytics.confidence >= 0 && analytics.confidence <= 100)
assert.equal(analytics.expectedScorePredictions.length, 3)
assert.equal(analytics.pipelineVersion, FOOTBALL_ANALYTICS_PIPELINE_VERSION)
assert.equal(analytics.analysisModelVersion, FOOTBALL_ANALYSIS_MODEL_VERSION)

const fixtureOnly = buildFootballAnalyticsOutput({
  id: 'fixture-only',
  api_sports_fixture_id: 999,
  homeTeam: { name: 'Home' },
  awayTeam: { name: 'Away' },
  analysis: { confidence_score: 95 },
})
assert.equal(fixtureOnly.confidence, 60)
assert.equal(fixtureOnly.dataQuality.fixtureOnly, true)

const publicText = JSON.stringify(analytics)
for (const term of ['Best Bet', 'Double Chance Pick', 'Asian Handicap Pick', 'Over/Under Pick']) {
  assert.equal(publicText.includes(term), false, `public analytics contains ${term}`)
}

console.log('football analytics unit tests passed')
