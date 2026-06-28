export const LEAGUE_QUALITY_SCORING_VERSION = 'league-quality-v4.1'

const priorityLeagues = new Map([
  ['UEFA Champions League', 8],
  ['Champions League', 8],
  ['Premier League', 10],
  ['Primera Division', 12],
  ['La Liga', 12],
  ['Serie A', 14],
  ['Bundesliga', 16],
  ['Ligue 1', 18],
  ['UEFA Europa League', 20],
  ['Europa League', 20],
])

const apiFootballLeagueTierScores = new Map([
  [2, 100],
  [3, 96],
  [848, 95],
  [39, 100],
  [140, 98],
  [135, 97],
  [78, 97],
  [61, 95],
  [40, 92],
  [88, 90],
  [94, 90],
  [144, 88],
  [203, 88],
  [179, 86],
  [207, 86],
  [218, 86],
  [119, 86],
  [71, 84],
  [128, 83],
  [253, 82],
  [262, 82],
  [98, 80],
  [292, 80],
  [307, 80],
  [188, 78],
])

export function getFixtureSyncPriority(fixture = {}) {
  const leagueMeta = getLeagueMeta(fixture)
  const homeName = firstText(fixture?.homeTeam?.name, fixture?.home_team?.name, fixture?.raw?.apiFootball?.teams?.home?.name) ?? ''
  const awayName = firstText(fixture?.awayTeam?.name, fixture?.away_team?.name, fixture?.raw?.apiFootball?.teams?.away?.name) ?? ''
  const leagueQualityScore = getLeagueQualityScore(fixture)
  const knownLeagueBonus = getKnownLeagueBonus(leagueMeta)
  const coverageBonus = leagueQualityScore >= 85 ? 8 : leagueQualityScore >= 75 ? 5 : leagueQualityScore >= 60 ? 2 : 0
  const softPenalty = getFixtureSoftPenalty({ leagueName: leagueMeta.name, homeName, awayName })
  const scoreCap = getFixtureScoreCap({ leagueName: leagueMeta.name, country: leagueMeta.country, homeName, awayName })
  const syncPriorityScore = normalizeScore(Math.min(scoreCap, leagueQualityScore + knownLeagueBonus + coverageBonus - softPenalty))
  return {
    leagueId: leagueMeta.id,
    country: leagueMeta.country,
    leagueQualityScore,
    syncPriorityScore,
    scoringVersion: LEAGUE_QUALITY_SCORING_VERSION,
  }
}

export function getLeagueQualityScore(source = {}) {
  const league = typeof source === 'string' ? { id: null, name: source, country: '' } : getLeagueMeta(source)
  const homeName = firstText(source?.homeTeam?.name, source?.home_team?.name, source?.raw?.apiFootball?.teams?.home?.name) ?? ''
  const awayName = firstText(source?.awayTeam?.name, source?.away_team?.name, source?.raw?.apiFootball?.teams?.away?.name) ?? ''
  const tierScore = getLeagueTierScore(league)
  const penalty = getFixtureSoftPenalty({ leagueName: league.name, homeName, awayName })
  const cap = getFixtureScoreCap({ leagueName: league.name, country: league.country, homeName, awayName })
  return normalizeScore(Math.min(cap, tierScore - penalty))
}

export function getLeagueMeta(source = {}) {
  const apiFootballLeague = source?.raw?.apiFootball?.league ?? source?.raw?.raw?.apiFootball?.league
  const id = getApiFootballLeagueId(firstText(
    apiFootballLeague?.id,
    source?.api_sports_league_id,
    source?.competition?.api_league_id,
    source?.competition?.id,
    source?.league?.api_league_id,
    source?.league?.id,
  ))
  const rawName = firstText(source?.competition?.name, source?.league?.name, apiFootballLeague?.name)
  const country = normalizeCountry(firstText(
    source?.competition?.country,
    source?.competition?.area?.name,
    source?.league?.country,
    source?.area?.name,
    apiFootballLeague?.country,
  ))
  return {
    id,
    name: normalizeLeagueName(rawName),
    country,
    season: firstText(source?.season, apiFootballLeague?.season),
  }
}

function getKnownLeagueBonus(league) {
  const tierScore = getLeagueTierScore(league)
  if (tierScore >= 95) return 8
  if (tierScore >= 85) return 5
  if (tierScore >= 75) return 3
  const normalized = league.name.toLowerCase()
  for (const key of priorityLeagues.keys()) {
    if (normalized.includes(key.toLowerCase())) return 12
  }
  return 0
}

function getApiFootballLeagueId(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric === 0) return null
  return Math.abs(Math.trunc(numeric))
}

function normalizeLeagueName(value) {
  return String(value ?? '').trim()
}

function normalizeCountry(value) {
  return String(value ?? '').trim()
}

function getLeagueTierScore(source) {
  const league = typeof source === 'string'
    ? { name: source, country: '' }
    : source?.name !== undefined || source?.country !== undefined
      ? { id: getApiFootballLeagueId(source.id), name: normalizeLeagueName(source.name), country: normalizeCountry(source.country) }
      : getLeagueMeta(source)
  if (league.id && apiFootballLeagueTierScores.has(league.id)) return apiFootballLeagueTierScores.get(league.id) ?? 65
  const name = league.name.toLowerCase()
  const country = league.country.toLowerCase()
  const exactCountryLeague = `${country}:${name}`

  if (name.includes('champions league') && (country.includes('world') || country.includes('europe') || country.includes('uefa') || !country)) return 100
  if (name.includes('europa league') || name.includes('conference league')) return 96
  if (exactCountryLeague.includes('england:premier league')) return 100
  if ((country.includes('spain') || country.includes('espana')) && (name.includes('la liga') || name.includes('primera'))) return 98
  if (country.includes('italy') && name.includes('serie a')) return 97
  if (country.includes('germany') && name.includes('bundesliga')) return 97
  if (country.includes('france') && name.includes('ligue 1')) return 95

  if (country.includes('england') && name.includes('championship')) return 92
  if (country.includes('netherlands') && name.includes('eredivisie')) return 90
  if (country.includes('portugal') && (name.includes('primeira') || name.includes('liga portugal'))) return 90
  if (country.includes('belgium') && (name.includes('pro league') || name.includes('first division'))) return 88
  if (country.includes('turkey') && (name.includes('super lig') || name.includes('super liga'))) return 88
  if (country.includes('scotland') && name.includes('premiership')) return 86
  if (country.includes('switzerland') && name.includes('super league')) return 86
  if (country.includes('austria') && name.includes('bundesliga')) return 86
  if (country.includes('denmark') && name.includes('superliga')) return 86

  if ((country.includes('brazil') || country.includes('brasil')) && name.includes('serie a')) return 84
  if (country.includes('argentina') && name.includes('primera')) return 83
  if ((country.includes('usa') || country.includes('united states')) && (name === 'major league soccer' || name === 'mls')) return 82
  if (country.includes('mexico') && name.includes('liga mx')) return 82
  if (country.includes('japan') && (name.includes('j1') || name.includes('j. league'))) return 80
  if ((country.includes('korea') || country.includes('south-korea')) && name.includes('k league 1')) return 80
  if (country.includes('saudi') && name.includes('pro league')) return 80
  if (country.includes('australia') && name.includes('a-league')) return 78

  if (isLowerDevelopmentLeague({ leagueName: name, homeName: '', awayName: '' })) return 50
  if (name.includes('premier league')) return isHighTierPremierCountry(country) ? 85 : 72
  return 65
}

function isHighTierPremierCountry(country) {
  return ['england', 'scotland', 'wales', 'northern ireland'].some((item) => country.includes(item))
}

function getFixtureSoftPenalty({ leagueName, homeName, awayName }) {
  const text = `${leagueName} ${homeName} ${awayName}`.toLowerCase()
  let penalty = 0
  if (/\b(u19|u20|u21|u23|youth)\b/i.test(text)) penalty += 35
  if (/\b(reserve|reserves|academy|development)\b/i.test(text)) penalty += 30
  if (/\b(w|women|woman|femenil|feminine)\b/i.test(text)) penalty += 15
  if (/\b(ii|b)\b/i.test(text)) penalty += 30
  if (text.includes('next pro') || text.includes('league two') || text.includes('lower division') || text.includes('amateur')) penalty += 25
  return Math.min(penalty, 45)
}

function getFixtureScoreCap({ leagueName, country, homeName, awayName }) {
  const text = `${leagueName} ${homeName} ${awayName}`.toLowerCase()
  let cap = 100
  if (/\b(u19|u20|u21|u23|youth)\b/i.test(text)) cap = Math.min(cap, 50)
  if (/\b(reserve|reserves|academy|development|ii|b)\b/i.test(text)) cap = Math.min(cap, 55)
  if (text.includes('next pro') || text.includes('league two') || text.includes('lower division') || text.includes('amateur')) cap = Math.min(cap, 55)
  if (/\b(w|women|woman|femenil|feminine)\b/i.test(text)) cap = Math.min(cap, 70)
  if (leagueName.toLowerCase().includes('premier league') && !isHighTierPremierCountry(country.toLowerCase())) cap = Math.min(cap, 72)
  return cap
}

function isLowerDevelopmentLeague({ leagueName, homeName, awayName }) {
  const text = `${leagueName} ${homeName} ${awayName}`.toLowerCase()
  return text.includes('next pro') ||
    text.includes('league two') ||
    text.includes('reserve') ||
    text.includes('academy') ||
    text.includes('development') ||
    /\b(u19|u20|u21|u23|youth)\b/i.test(text)
}

function normalizeScore(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(Math.max(0, Math.min(100, numeric)) * 10) / 10
}

function firstText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return null
}
