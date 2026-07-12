import { getLeagueQualityScore as calculateLeagueQualityScore } from './leagueQualityScoring.js'
import { DAILY_SELECTION_ALGORITHM_VERSION, selectDailyTop10 } from './dailySelectionEngine.js'

const recommendationPriority = {
  BET: 1,
  LEAN: 2,
  WATCH: 3,
  'NO BET': 4,
}

export function runAiSelectionEngine(matches = [], options = {}) {
  const selection = selectDailyTop10(matches, options)
  const selectedById = new Map(selection.selected.map((row) => [row.fixtureId || row.match?.id, row]))
  return selection.candidates.map((candidate) => buildSelectionEngineRow(candidate, selectedById.get(candidate.fixtureId || candidate.match?.id)))
}

export function getLeagueQualityScore(source) {
  return calculateLeagueQualityScore(source)
}

export function sortSelectionRows(a, b) {
  const rankingDiff = Number(b.ranking_score ?? 0) - Number(a.ranking_score ?? 0)
  const confidenceDiff = Number(b.confidence_score ?? 0) - Number(a.confidence_score ?? 0)
  const riskDiff = Number(a.risk_score ?? 100) - Number(b.risk_score ?? 100)
  const priorityDiff = getRecommendationPriority(a.recommendation) - getRecommendationPriority(b.recommendation)
  return rankingDiff || confidenceDiff || riskDiff || priorityDiff
}

export function getRecommendationPriority(recommendation) {
  const normalized = normalizeRecommendation(recommendation)
  return recommendationPriority[normalized] ?? 5
}

function buildSelectionEngineRow(candidate, selected) {
  const match = candidate.match ?? {}
  const analysis = getAnalysis(match)
  const components = candidate.softRanking.components
  const hardReasons = candidate.hardFilter.reasons.map((item) => item.code).join(', ')
  const hardWarnings = candidate.hardFilter.warnings.map((item) => item.code).join(', ')
  const sourceRecommendation = normalizeRecommendation(analysis.recommendation ?? match.recommendation)
  const recommendation = candidate.hasMarketData || sourceRecommendation !== 'BET' ? sourceRecommendation : 'WATCH'
  const isTopPick = Boolean(selected)
  const isFinalPick = Boolean(selected && selected.rank === 1 && selected.hasMarketData)

  return {
    match_id: getMatchId(match),
    algorithm_version: DAILY_SELECTION_ALGORITHM_VERSION,
    data_validation_status: candidate.passedHardFilter ? (hardWarnings ? 'PARTIAL' : 'VALID') : 'INVALID',
    data_validation_notes: candidate.passedHardFilter ? (hardWarnings || 'ready') : hardReasons,
    league_quality_score: components.leagueQuality,
    match_quality_score: components.dataQuality,
    team_strength_score: getScore(analysis.team_strength_score, analysis.raw?.modules?.teamStrength, components.dataQuality),
    form_score: getScore(analysis.form_score, analysis.raw?.modules?.recentForm, components.dataQuality),
    goal_scoring_score: getScore(analysis.goal_scoring_score, analysis.goal_quality_score, analysis.raw?.modules?.attackQuality, components.dataQuality),
    defensive_stability_score: getScore(analysis.defensive_stability_score, analysis.raw?.modules?.defensiveStability, components.dataQuality),
    tactical_matchup_score: components.tacticalScore,
    motivation_score: components.motivationScore,
    market_reading_score: components.marketQuality,
    home_away_score: getScore(analysis.home_away_score, analysis.home_advantage_score, components.tacticalScore),
    risk_score: components.riskScore,
    edge_score: components.valueScore,
    ai_score: candidate.softRanking.weightedScore,
    confidence_score: components.confidenceScore,
    ranking_score: candidate.softRanking.finalScore,
    final_rank: selected?.rank ?? null,
    recommendation,
    recommendation_tier: getRecommendationTier(recommendation, components.confidenceScore, components.riskScore),
    final_pick_note: selected?.rank === 1 ? buildFinalPickNote(recommendation, selected) : null,
    analysis_summary: buildTwoStageSummary(candidate, recommendation),
    is_top_pick: isTopPick,
    is_final_pick: isFinalPick,
    selection_status: selected?.selectionStatus ?? null,
    selection_tier: selected?.tier ?? null,
    has_market_data: candidate.hasMarketData,
    raw: {
      daily_selection: {
        algorithmVersion: DAILY_SELECTION_ALGORITHM_VERSION,
        hardFilter: candidate.hardFilter,
        softRanking: candidate.softRanking,
        selected: isTopPick,
        rank: selected?.rank ?? null,
        tier: selected?.tier ?? null,
        selectionStatus: selected?.selectionStatus ?? null,
      },
    },
  }
}

function buildTwoStageSummary(candidate, recommendation) {
  if (!candidate.passedHardFilter) return `Rejected by hard filter: ${candidate.hardFilter.reasons.map((item) => item.code).join(', ')}`
  const marketState = candidate.hasMarketData ? 'market ready' : 'waiting market'
  return `Two-stage selection ${candidate.softRanking.finalScore}/100, ${marketState}, recommendation ${recommendation}`
}

function getRecommendationTier(recommendation, confidence, risk) {
  if (recommendation === 'BET' && confidence >= 85 && risk <= 45) return '*****'
  if (recommendation === 'BET') return '****'
  if (recommendation === 'LEAN') return '***'
  if (recommendation === 'WATCH') return '**'
  return '*'
}

function buildFinalPickNote(recommendation, selected = {}) {
  if (selected && !selected.hasMarketData) return 'Top ranked fixture is waiting for market data; no final pick is generated yet.'
  if (recommendation === 'LEAN') return 'Rank 1 is below BET level, but is the strongest available analysis.'
  if (recommendation === 'WATCH' || recommendation === 'NO BET') return 'Rank 1 is a watch/skip state; no aggressive final pick is generated.'
  return 'AI selected this fixture as rank 1 for the day.'
}

function getAnalysis(match) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
  return analysis ?? match.match_analysis ?? {}
}

function getMatchId(match) {
  return match.id ?? match.match_id ?? match.api_fixture_id ?? null
}

function getScore(...values) {
  const found = values.map(numberValue).find((value) => value > 0)
  return roundScore(found ?? 60)
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? '').toUpperCase().replace('_', ' ')
  if (['BET', 'LEAN', 'WATCH', 'NO BET'].includes(normalized)) return normalized
  return 'NO BET'
}

function numberValue(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function roundScore(value) {
  return Math.round(clamp(value, 0, 100) * 10) / 10
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
