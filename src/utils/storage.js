import { recommendationLabels } from './analysisEngine'

export async function loadDevFallbackMatches() {
  if (!import.meta.env.DEV) return []

  const { demoMatches } = await import('../data/demoMatches')
  return demoMatches.map((match) => ({
    id: match.id,
    kickoffAt: `${match.date}T${match.time}:00+07:00`,
    status: normalizeResult(match.result),
    venue: '',
    round: '',
    homeGoals: null,
    awayGoals: null,
    league: {
      id: `dev-${match.league}`,
      name: match.league,
      country: '',
      logo: '',
      enabled: true,
      priority: 80,
    },
    homeTeam: {
      id: `dev-${match.homeTeam}`,
      name: match.homeTeam,
      logo: '',
      country: '',
    },
    awayTeam: {
      id: `dev-${match.awayTeam}`,
      name: match.awayTeam,
      logo: '',
      country: '',
    },
    homeForm: {
      wins: Math.max(0, Math.round((match.modules?.recentForm ?? 6) / 3)),
      draws: 1,
      losses: 1,
      goals_for: Math.round(match.modules?.goalChance ?? 6),
      goals_against: 4,
    },
    awayForm: {
      wins: 2,
      draws: 1,
      losses: 2,
      goals_for: 5,
      goals_against: 5,
    },
    analysis: {
      team_strength_score: (match.modules?.teamStrength ?? 6) * 10,
      form_score: (match.modules?.recentForm ?? 6) * 10,
      goal_quality_score: (match.modules?.goalChance ?? 6) * 10,
      tactical_score: (match.modules?.tacticalMatchup ?? 6) * 10,
      home_away_score: (match.modules?.homeAway ?? 6) * 10,
      motivation_score: (match.modules?.motivation ?? 6) * 10,
      market_context_score: (match.modules?.marketReading ?? 6) * 10,
      risk_score: (match.modules?.riskDetection ?? 6) * 10,
      confidence_score: Math.min(96, Math.round((match.modules?.teamStrength ?? 6) * 8 + 20)),
      recommendation: mapDevRecommendation(match),
      risk_level: mapDevRisk(match.riskLevel),
      thai_reason: match.summary || 'ข้อมูล dev fallback สำหรับตรวจหน้าจอเมื่อยังไม่ตั้งค่า Supabase',
      raw: { source: 'dev-fallback' },
      updated_at: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
    raw: { source: 'dev-fallback' },
  }))
}

function mapDevRecommendation(match) {
  const score = Number(match.modules?.teamStrength ?? 0) + Number(match.modules?.recentForm ?? 0)
  if (score >= 16 && mapDevRisk(match.riskLevel) !== 'high') return recommendationLabels.bet
  if (score >= 12) return recommendationLabels.lean
  return recommendationLabels.noBet
}

function mapDevRisk(riskLevel) {
  if (riskLevel === 'ต่ำ') return 'low'
  if (riskLevel === 'สูง') return 'high'
  return 'medium'
}

function normalizeResult(result) {
  if (result === 'Win' || result === 'Lose' || result === 'Push') return 'FT'
  return 'NS'
}
