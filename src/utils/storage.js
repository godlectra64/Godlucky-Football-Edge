import { demoMatches } from '../data/demoMatches'

const STORAGE_KEY = 'godlucky-football-edge-matches'

export function loadMatches() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return demoMatches

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length ? parsed : demoMatches
  } catch {
    return demoMatches
  }
}

export function saveMatches(matches) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(matches))
}

export function resetMatches() {
  saveMatches(demoMatches)
  return demoMatches
}

export function createEmptyMatch() {
  return {
    id: `match-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    time: '20:00',
    league: '',
    homeTeam: '',
    awayTeam: '',
    ahLine: '',
    ahOddsHome: '',
    ahOddsAway: '',
    ouLine: '',
    overOdds: '',
    underOdds: '',
    recommendedMarket: 'AH',
    fairLine: '',
    edge: '',
    riskLevel: 'กลาง',
    marketMovement: '',
    supportReasons: [''],
    cautionReasons: [''],
    summary: '',
    result: 'Pending',
    userStatus: '',
    modules: {
      teamStrength: 6,
      recentForm: 6,
      goalChance: 6,
      tacticalMatchup: 6,
      homeAway: 6,
      motivation: 6,
      marketReading: 6,
      riskDetection: 6,
    },
    selection: {
      dataQualityScore: 10,
      leagueTrustScore: 7,
      oddsClarityScore: 10,
      formQualityScore: 10,
      goalChanceScore: 10,
      motivationScore: 7,
      marketMovementScore: 7,
      riskControlScore: 7,
    },
  }
}
