export const recommendationLabels = {
  bet: 'BET',
  lean: 'LEAN',
  noBet: 'NO BET',
}

export const riskLabels = {
  low: 'low',
  medium: 'medium',
  high: 'high',
}

export const footballMasterModules = [
  { key: 'team_strength_score', breakdownKey: 'team_strength', label: 'Team Strength', weight: 0.18, max: 100 },
  { key: 'form_score', breakdownKey: 'recent_form', label: 'Recent Form', weight: 0.17, max: 100 },
  { key: 'goal_scoring_score', legacyKey: 'goal_quality_score', breakdownKey: 'attack_quality', label: 'Attack Quality', weight: 0.15, max: 100 },
  { key: 'defensive_stability_score', breakdownKey: 'defensive_stability', label: 'Defensive Stability', weight: 0.15, max: 100 },
  { key: 'home_advantage_score', legacyKey: 'home_away_score', breakdownKey: 'home_away_advantage', label: 'Home/Away Advantage', weight: 0.12, max: 100 },
  { key: 'motivation_score', breakdownKey: 'motivation_context', label: 'Motivation & Context', weight: 0.1, max: 100 },
  { key: 'market_risk_score', legacyKey: 'risk_score', breakdownKey: 'market_odds_risk', label: 'Market & Odds Risk', weight: 0.13, max: 100 },
]

export const analysisModuleLabels = Object.fromEntries(footballMasterModules.map((module) => [module.key, module.label]))

export function calculateFootballMasterAnalysis(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const storedBreakdown = analysis.raw?.analysis_breakdown
  const moduleBreakdown = storedBreakdown ? getStoredModuleBreakdown(storedBreakdown) : buildModuleBreakdown(match)
  const modules = footballMasterModules.map((module) => ({
    ...module,
    score: moduleBreakdown[module.breakdownKey].score,
    reason: moduleBreakdown[module.breakdownKey].reason,
  }))
  const confidence = Math.round(clamp(modules.reduce((total, module) => total + module.score * module.weight, 0), 0, 100))
  const dataCompleteness = getDataCompleteness(match)
  const overallRisk = storedBreakdown?.overall_risk ?? calculateOverallRisk(moduleBreakdown, confidence, dataCompleteness)
  const riskLevel = normalizeRiskLevel(overallRisk.level)
  const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
  const analysisBreakdown = {
    ...moduleBreakdown,
    overall_risk: {
      level: riskLevel,
      reason: overallRisk.reason,
    },
  }

  return {
    framework: 'football-master-v2',
    modules,
    confidence,
    riskLevel,
    recommendation,
    analysisSummary: buildAnalysisSummary(match, modules, confidence, riskLevel, recommendation, analysisBreakdown),
    analysisBreakdown,
    dataCompleteness,
  }
}

export function calculateAnalysisScore(match) {
  return calculateFootballMasterAnalysis(match).confidence
}

export function getRiskLevel(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const stored = String(analysis.risk_level ?? analysis.raw?.analysis_breakdown?.overall_risk?.level ?? '').toLowerCase()

  if (analysis.raw?.framework === 'football-master-v2' && ['low', 'medium', 'high'].includes(stored)) return stored
  return calculateFootballMasterAnalysis(match).riskLevel
}

export function getRecommendation(match) {
  return getRecommendationFromConfidence(getConfidence(match), getRiskLevel(match))
}

export function getRecommendationFromConfidence(confidence, riskLevel = riskLabels.medium) {
  if (String(riskLevel).toLowerCase() === riskLabels.high) return recommendationLabels.noBet
  if (confidence >= 75) return recommendationLabels.bet
  if (confidence >= 62) return recommendationLabels.lean
  return recommendationLabels.noBet
}

export function getRiskAdjustedRecommendation(confidence, riskLevel = riskLabels.medium) {
  return getRecommendationFromConfidence(confidence, riskLevel)
}

export function getConfidence(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const storedConfidence = numberValue(analysis.confidence_score)

  if (analysis.raw?.framework === 'football-master-v2' && storedConfidence > 0) {
    return Math.round(clamp(storedConfidence, 0, 100))
  }

  return calculateFootballMasterAnalysis(match).confidence
}

export function getModuleScores(match) {
  return calculateFootballMasterAnalysis(match).modules.map((module) => ({
    key: module.key,
    label: module.label,
    score: module.score,
    max: module.max,
    reason: module.reason,
  }))
}

export function getAnalysisSummary(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  return analysis.analysis_summary || analysis.raw?.analysis_summary || analysis.thai_reason || calculateFootballMasterAnalysis(match).analysisSummary
}

export function getDataCompleteness(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const checks = [
    Boolean(match.id),
    Boolean(match.kickoffAt ?? match.kickoff_at),
    Boolean(match.league?.name),
    Boolean(match.homeTeam?.name),
    Boolean(match.awayTeam?.name),
    Boolean(match.homeForm ?? analysis.raw?.homeForm),
    Boolean(match.awayForm ?? analysis.raw?.awayForm),
    hasRecentForm(match.homeForm ?? analysis.raw?.homeForm),
    hasRecentForm(match.awayForm ?? analysis.raw?.awayForm),
    Boolean((match.standings ?? analysis.raw?.standings ?? []).length),
  ]

  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export function getTopMatches(matches, limit = 10) {
  return [...matches]
    .map((match) => enrichMatch(match))
    .sort(compareForTopMatches)
    .slice(0, limit)
}

export function enrichMatch(match) {
  const master = calculateFootballMasterAnalysis(match)

  return {
    ...match,
    confidence: master.confidence,
    recommendation: master.recommendation,
    riskLevel: master.riskLevel,
    totalAnalysisScore: master.confidence,
    dataCompleteness: master.dataCompleteness,
    analysisSummary: master.analysisSummary,
    analysisBreakdown: master.analysisBreakdown,
  }
}

export function compareForTopMatches(a, b) {
  const confidenceDiff = getConfidence(b) - getConfidence(a)
  const kickoffA = new Date(a.kickoffAt ?? a.kickoff_at ?? 0).getTime()
  const kickoffB = new Date(b.kickoffAt ?? b.kickoff_at ?? 0).getTime()

  return confidenceDiff || kickoffA - kickoffB
}

export function calculateStats(matches) {
  const enriched = matches.map((match) => enrichMatch(match))
  const settled = enriched.filter((match) => ['FT', 'AET', 'PEN', 'FINISHED'].includes(match.status))
  const bet = enriched.filter((match) => match.recommendation === recommendationLabels.bet)
  const lean = enriched.filter((match) => match.recommendation === recommendationLabels.lean)
  const noBet = enriched.filter((match) => match.recommendation === recommendationLabels.noBet)
  const lowRisk = enriched.filter((match) => match.riskLevel === 'low')
  const mediumRisk = enriched.filter((match) => match.riskLevel === 'medium')
  const highRisk = enriched.filter((match) => match.riskLevel === 'high')
  const averageConfidence = enriched.length
    ? Math.round(enriched.reduce((total, match) => total + match.confidence, 0) / enriched.length)
    : 0

  return {
    total: enriched.length,
    settled: settled.length,
    strongCount: bet.length,
    watchCount: lean.length,
    skippedCount: noBet.length,
    lowRiskCount: lowRisk.length,
    mediumRiskCount: mediumRisk.length,
    highRiskCount: highRisk.length,
    averageConfidence,
    updatedCount: enriched.filter((match) => match.analysis?.updated_at).length,
  }
}

function buildModuleBreakdown(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const homeForm = match.homeForm ?? analysis.raw?.homeForm
  const awayForm = match.awayForm ?? analysis.raw?.awayForm
  const standings = match.standings ?? analysis.raw?.standings ?? []
  const leaguePriority = numberValue(match.league?.priority ?? analysis.raw?.leaguePriority ?? 50)
  const homeStanding = findStanding(standings, match.homeTeam?.api_team_id ?? match.homeTeam?.id)
  const awayStanding = findStanding(standings, match.awayTeam?.api_team_id ?? match.awayTeam?.id)

  return {
    team_strength: scoreTeamStrength(match, homeForm, awayForm, homeStanding, awayStanding),
    recent_form: scoreRecentForm(homeForm, awayForm),
    attack_quality: scoreAttackQuality(homeForm, awayForm, homeStanding, awayStanding),
    defensive_stability: scoreDefensiveStability(homeForm, awayForm),
    home_away_advantage: scoreHomeAwayAdvantage(match, homeForm),
    motivation_context: scoreMotivationContext(match, leaguePriority),
    market_odds_risk: scoreMarketOddsRisk(match, homeForm, awayForm),
  }
}

function getStoredModuleBreakdown(breakdown) {
  return Object.fromEntries(
    footballMasterModules.map((module) => {
      const item = breakdown[module.breakdownKey] ?? {}
      return [module.breakdownKey, { score: Math.round(clamp(numberValue(item.score), 0, 100)), reason: String(item.reason ?? '') }]
    }),
  )
}

function scoreTeamStrength(match, homeForm, awayForm, homeStanding, awayStanding) {
  if (homeStanding && awayStanding) {
    const standingGap = numberValue(awayStanding.position) - numberValue(homeStanding.position)
    const pointsGap = numberValue(homeStanding.points) - numberValue(awayStanding.points)
    const goalDiffGap = numberValue(homeStanding.goalDifference) - numberValue(awayStanding.goalDifference)
    const score = clamp(58 + standingGap * 2 + pointsGap * 0.7 + goalDiffGap * 0.8, 28, 90)
    return moduleResult(score, standingGap >= 0 ? 'อันดับและแต้มโดยรวมหนุนฝั่งเจ้าบ้านมากกว่า' : 'อันดับตารางไม่ได้หนุนฝั่งเจ้าบ้านชัดเจน')
  }

  const formGap = formPoints(homeForm) - formPoints(awayForm)
  const goalDiffGap = formGoalDiff(homeForm) - formGoalDiff(awayForm)
  const nameSignal = (match.homeTeam?.name ? 3 : 0) + (match.awayTeam?.name ? 2 : 0)
  const score = clamp(55 + formGap * 1.4 + goalDiffGap * 1.8 + nameSignal, 35, 78)
  return moduleResult(score, 'ไม่มีตารางคะแนนครบ จึงใช้ฟอร์มและข้อมูลทีมที่มีเป็น proxy')
}

function scoreRecentForm(homeForm, awayForm) {
  const played = numberValue(homeForm?.played) + numberValue(awayForm?.played)
  if (!played) return moduleResult(56, 'ข้อมูลฟอร์มล่าสุดจำกัด จึงประเมินแบบกลางจากบริบทคู่แข่ง')

  const pointsRate = ((formPoints(homeForm) + formPoints(awayForm)) / Math.max(played * 3, 1)) * 100
  const goalBalance = clamp((formGoalDiff(homeForm) + formGoalDiff(awayForm)) * 2.5, -18, 18)
  const score = clamp(42 + pointsRate * 0.38 + goalBalance, 25, 86)
  return moduleResult(score, played >= 8 ? 'ฟอร์ม 5 นัดล่าสุดมีข้อมูลรองรับเพียงพอ' : 'มีข้อมูลฟอร์มบางส่วน แต่ยังไม่เต็มหน้าต่าง 5 นัด')
}

function scoreAttackQuality(homeForm, awayForm, homeStanding, awayStanding) {
  const goalsFor = numberValue(homeForm?.goals_for) + numberValue(awayForm?.goals_for)
  const played = numberValue(homeForm?.played) + numberValue(awayForm?.played)
  const standingBoost = homeStanding || awayStanding ? clamp((numberValue(homeStanding?.goalsFor) + numberValue(awayStanding?.goalsFor)) * 0.25, 0, 12) : 0

  if (!played && !standingBoost) return moduleResult(57, 'ยังไม่มี xG หรือสถิติเกมรุกละเอียด จึงใช้ค่ากลางแบบระมัดระวัง')

  const goalsPerMatch = goalsFor / Math.max(played, 1)
  const score = clamp(48 + goalsPerMatch * 18 + standingBoost, 30, 88)
  return moduleResult(score, goalsPerMatch >= 1.4 ? 'เกมรุกมีแนวโน้มสร้างประตูได้ดีจากข้อมูลล่าสุด' : 'เกมรุกยังไม่ได้เด่นชัดจากข้อมูลประตูที่มี')
}

function scoreDefensiveStability(homeForm, awayForm) {
  const goalsAgainst = numberValue(homeForm?.goals_against) + numberValue(awayForm?.goals_against)
  const cleanSheets = numberValue(homeForm?.clean_sheets) + numberValue(awayForm?.clean_sheets)
  const played = numberValue(homeForm?.played) + numberValue(awayForm?.played)
  if (!played) return moduleResult(58, 'ข้อมูลเกมรับจำกัด จึงยังประเมินความมั่นคงในระดับกลาง')

  const concededPerMatch = goalsAgainst / Math.max(played, 1)
  const score = clamp(74 - concededPerMatch * 22 + cleanSheets * 4, 25, 90)
  return moduleResult(score, concededPerMatch <= 1 ? 'เกมรับค่อนข้างมั่นคงจากอัตราเสียประตู' : 'เกมรับยังมีความเสี่ยงจากอัตราเสียประตู')
}

function scoreHomeAwayAdvantage(match, homeForm) {
  const venueText = String(match.venue ?? match.raw?.venue ?? '').toLowerCase()
  const neutral = venueText.includes('neutral')
  if (neutral) return moduleResult(52, 'สนามเป็นกลางหรือมีสัญญาณว่าเจ้าบ้านไม่ได้เปรียบเต็มที่')

  const played = numberValue(homeForm?.played)
  const homeWinRate = played ? numberValue(homeForm?.wins) / played : 0.4
  const score = clamp(57 + homeWinRate * 22 + Math.max(formGoalDiff(homeForm), 0) * 1.3, 48, 78)
  return moduleResult(score, played ? 'เจ้าบ้านมีแรงหนุนจากสภาพการแข่งขันและฟอร์มฝั่งเหย้า' : 'ไม่มีข้อมูลสนามละเอียด จึงให้น้ำหนักเจ้าบ้านแบบจำกัด')
}

function scoreMotivationContext(match, leaguePriority) {
  const raw = match.raw ?? {}
  const stage = String(raw.stage ?? raw.group ?? match.round ?? '').toLowerCase()
  const knockoutBoost = ['final', 'semi', 'quarter', 'last_16', 'playoff'].some((item) => stage.includes(item)) ? 8 : 0
  const priorityScore = leaguePriority <= 15 ? 65 : leaguePriority <= 30 ? 61 : leaguePriority <= 50 ? 58 : 55
  const score = clamp(priorityScore + knockoutBoost, 52, 78)
  return moduleResult(score, knockoutBoost ? 'รายการหรือรอบการแข่งขันเพิ่มแรงจูงใจเชิงบริบท' : 'ข้อมูลแรงจูงใจยังจำกัด จึงใช้คะแนนกลางตามความสำคัญรายการ')
}

function scoreMarketOddsRisk(match, homeForm, awayForm) {
  const raw = match.raw ?? {}
  const hasOdds = Boolean(raw.odds || raw.market || raw.bookmakers)
  if (!hasOdds) return moduleResult(60, 'ยังไม่มีข้อมูลราคาเพียงพอ จึงประเมินแบบกลางและไม่ยกระดับเป็น high risk อัตโนมัติ')

  const formGap = Math.abs(formPoints(homeForm) - formPoints(awayForm))
  const score = clamp(58 + Math.min(formGap, 8) * 2.2, 42, 82)
  return moduleResult(score, 'มีข้อมูลตลาดบางส่วนและใช้ร่วมกับความต่างของฟอร์มเพื่อประเมินความเสี่ยง')
}

function calculateOverallRisk(breakdown, confidence, dataCompleteness) {
  const scores = footballMasterModules.map((module) => breakdown[module.breakdownKey].score)
  const spread = Math.max(...scores) - Math.min(...scores)
  const weakCore = ['team_strength', 'recent_form', 'attack_quality', 'defensive_stability'].filter((key) => breakdown[key].score < 45).length

  if (confidence < 48 || weakCore >= 2 || spread >= 42) {
    return { level: riskLabels.high, reason: 'คะแนนสำคัญหลายด้านอ่อนหรือขัดแย้งกันมาก จึงจัดเป็นความเสี่ยงสูง' }
  }
  if (confidence >= 72 && dataCompleteness >= 70 && spread <= 28) {
    return { level: riskLabels.low, reason: 'หลายโมดูลให้ภาพสอดคล้องกันและข้อมูลรองรับค่อนข้างครบ' }
  }
  return { level: riskLabels.medium, reason: 'มีข้อมูลสนับสนุนบางส่วน แต่ยังไม่ครบทุกมิติหรือคะแนนยังไม่สอดคล้องเต็มที่' }
}

function buildAnalysisSummary(match, modules, confidence, riskLevel, recommendation, breakdown) {
  const home = match.homeTeam?.name ?? 'ทีมเหย้า'
  const away = match.awayTeam?.name ?? 'ทีมเยือน'
  const bestModule = [...modules].sort((a, b) => b.score - a.score)[0]
  const weakestModule = [...modules].sort((a, b) => a.score - b.score)[0]
  const riskReason = breakdown.overall_risk.reason

  if (recommendation === recommendationLabels.bet) {
    return `${home} พบ ${away}: คะแนนรวม ${confidence}/100 เข้าระดับ BET เพราะ ${bestModule.label} เด่น (${bestModule.score}/100) และ risk_level เป็น ${riskLevel}. ${riskReason}`
  }
  if (recommendation === recommendationLabels.lean) {
    return `${home} พบ ${away}: คะแนนรวม ${confidence}/100 เหมาะเป็น LEAN มากกว่า BET จุดหนุนหลักคือ ${bestModule.label} (${bestModule.score}/100) แต่ ${weakestModule.label} ยังถ่วงอยู่ (${weakestModule.score}/100). ${riskReason}`
  }
  return `${home} พบ ${away}: คะแนนรวม ${confidence}/100 ยังเป็น NO BET แม้มีจุดเด่นที่ ${bestModule.label} (${bestModule.score}/100) แต่ ${weakestModule.label} ยังไม่สนับสนุนพอ (${weakestModule.score}/100). ${riskReason}`
}

function moduleResult(score, reason) {
  return { score: Math.round(clamp(score, 0, 100)), reason }
}

function findStanding(standings, teamId) {
  const totalTable = standings.find((standing) => standing.type === 'TOTAL')?.table ?? standings[0]?.table ?? []
  return totalTable.find((row) => Number(row.team?.id) === Number(teamId))
}

function hasRecentForm(form) {
  return numberValue(form?.played) > 0
}

function formPoints(form) {
  return numberValue(form?.wins) * 3 + numberValue(form?.draws)
}

function formGoalDiff(form) {
  return numberValue(form?.goals_for) - numberValue(form?.goals_against)
}

function normalizeRiskLevel(value) {
  const normalized = String(value ?? '').toLowerCase()
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : riskLabels.medium
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
