export function normalizeDataPlatform(input = {}) {
  const matchSource = input.match ?? input
  const analysisSource = input.analysis ?? matchSource.analysis ?? matchSource.match_analysis ?? {}
  const raw = analysisSource.raw ?? matchSource.raw ?? {}
  const breakdown = raw.analysis_breakdown ?? input.analysis_breakdown ?? matchSource.analysisBreakdown ?? {}
  const prediction = input.prediction ?? input.snapshot ?? null
  const result = input.result ?? prediction?.result ?? null
  const evaluation = input.evaluation ?? prediction?.evaluation ?? null
  const confidence = numberValue(analysisSource.confidence_score ?? raw.confidence_score ?? matchSource.confidence)
  const rankingScore = numberValue(matchSource.rankingScore ?? matchSource.ranking_score ?? prediction?.ranking_score ?? confidence)

  return {
    match: {
      id: matchSource.id ?? prediction?.match_id ?? null,
      fixtureId: matchSource.apiFixtureId ?? matchSource.api_fixture_id ?? prediction?.fixture_id ?? null,
      status: matchSource.status ?? result?.status ?? 'unknown',
      raw: matchSource.raw ?? null,
    },
    teams: {
      home: matchSource.homeTeam ?? { name: prediction?.home_team ?? null },
      away: matchSource.awayTeam ?? { name: prediction?.away_team ?? null },
    },
    league: matchSource.league ?? { name: prediction?.league ?? null },
    kickoff: matchSource.kickoffAt ?? matchSource.kickoff_at ?? prediction?.kickoff ?? null,
    analysis: {
      version: raw.framework ?? raw.analysis_version ?? prediction?.analysis_version ?? 'unknown',
      recommendation: analysisSource.recommendation ?? prediction?.recommendation ?? 'NO BET',
      confidence,
      riskLevel: analysisSource.risk_level ?? prediction?.risk_level ?? 'medium',
      summary: analysisSource.analysis_summary ?? raw.analysis_summary ?? analysisSource.thai_reason ?? '',
      breakdown,
    },
    ranking: {
      score: rankingScore,
      reason: matchSource.rankReason ?? matchSource.rank_reason ?? '',
      badges: matchSource.rankBadges ?? matchSource.rank_badges ?? [],
    },
    intelligence: breakdown.football_intelligence ?? matchSource.footballIntelligence ?? {},
    dataIntelligence: breakdown.data_intelligence ?? matchSource.dataIntelligence ?? {},
    prediction: prediction ? {
      id: prediction.id ?? null,
      recommendation: prediction.recommendation ?? null,
      confidence: numberValue(prediction.confidence_score),
      rankingScore: numberValue(prediction.ranking_score),
      version: prediction.analysis_version ?? 'unknown',
      predictedOutcome: prediction.predicted_outcome ?? 'unknown',
      createdAt: prediction.created_at ?? null,
    } : null,
    result: result ? {
      status: result.status ?? 'pending',
      homeGoals: nullableNumber(result.home_goals),
      awayGoals: nullableNumber(result.away_goals),
      result: result.result ?? null,
      finishedAt: result.finished_at ?? null,
    } : null,
    evaluation: evaluation ? {
      status: evaluation.evaluation_status ?? 'pending',
      reason: evaluation.evaluation_reason ?? '',
      evaluatedAt: evaluation.evaluated_at ?? null,
    } : null,
    performance: {
      isEvaluated: ['correct', 'incorrect'].includes(evaluation?.evaluation_status),
      isPending: !evaluation || evaluation.evaluation_status === 'pending',
    },
  }
}

export function calculateDataCoverage(input = {}) {
  const platform = input.match && input.teams && input.analysis
    ? input
    : input.match || input.analysis || input.prediction
      ? normalizeDataPlatform(input)
      : input
  const raw = platform.match?.raw ?? {}
  const available = []
  const missing = []

  addCoverage(Boolean(platform.match?.id || platform.match?.fixtureId), 'fixture', available, missing)
  addCoverage(Boolean(platform.teams?.home?.name && platform.teams?.away?.name), 'teams', available, missing)
  addCoverage(Boolean(platform.league?.name), 'league', available, missing)
  addCoverage(Boolean(platform.analysis?.breakdown && Object.keys(platform.analysis.breakdown).length), 'analysis', available, missing)
  addCoverage(Boolean(platform.intelligence && Object.keys(platform.intelligence).length), 'football intelligence', available, missing)
  addCoverage(Boolean(platform.dataIntelligence && Object.keys(platform.dataIntelligence).length), 'data intelligence', available, missing)
  addCoverage(Boolean(platform.result?.status === 'finished'), 'result', available, missing)
  addCoverage(Boolean(platform.evaluation?.status && platform.evaluation.status !== 'pending'), 'evaluation', available, missing)
  addCoverage(Boolean(raw.odds || raw.market || raw.bookmakers), 'odds', available, missing)
  addCoverage(Boolean(raw.lineup || raw.lineups), 'lineup', available, missing)
  addCoverage(Boolean(raw.injuries || raw.squadData?.injuries), 'injuries', available, missing)

  const score = Math.round((available.length / Math.max(available.length + missing.length, 1)) * 100)
  const level = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low'
  return {
    score,
    level,
    available,
    missing,
    reason: `Data coverage ${score}% (${available.length}/${available.length + missing.length})`,
  }
}

function addCoverage(hasData, label, available, missing) {
  if (hasData) available.push(label)
  else missing.push(label)
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}
