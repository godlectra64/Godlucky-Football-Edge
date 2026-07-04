import { getBangkokToday } from '../utils/bangkokDate.js'
import { fetchMatchesByKickoffRange } from './matchesRepository.js'
import { compareMarketReadyMatches, isMarketReadyForDisplay } from '../utils/analysisEngine.js'
import { getStatusCodeFromMatch } from '../utils/matchStatus.js'
import { buildUsableDailySelection } from '../utils/selectionEngineV2.js'

export async function getDailyTop10Status(date = getBangkokToday()) {
  const client = await getSupabaseClient()
  const result = await client
    .from('daily_top10_selections')
    .select('*')
    .eq('selection_date', date)
    .order('rank', { ascending: true })
  if (isMissingTable(result.error)) return emptyStatus(date)
  if (result.error) return result
  const rows = result.data ?? []
  const lockedAt = rows.map((row) => row.locked_at).filter(Boolean).sort()[0] ?? null
  const lastUpdated = rows.map((row) => row.updated_at ?? row.created_at).filter(Boolean).sort().at(-1) ?? null
  return {
    data: {
      selectionDate: date,
      locked: rows.length > 0,
      lockedCount: rows.length,
      lockedAt,
      lastUpdated,
      strongSignalCount: rows.filter((row) => row.signal === 'STRONG_SIGNAL').length,
      watchCount: rows.filter((row) => row.signal === 'WATCH').length,
      skipCount: rows.filter((row) => row.signal === 'SKIP').length,
    },
    error: null,
  }
}

export async function getLockedTop10(date = getBangkokToday()) {
  const client = await getSupabaseClient()
  const locked = await client
    .from('daily_top10_selections')
    .select('*')
    .eq('selection_date', date)
    .order('rank', { ascending: true })
  if (isMissingTable(locked.error)) return { data: [], error: null, status: emptyStatus(date).data }
  if (locked.error) return { data: [], error: locked.error, status: emptyStatus(date).data }
  const rows = locked.data ?? []
  if (!rows.length) return { data: [], error: null, status: emptyStatus(date).data }

  const firstDay = new Date(`${date}T00:00:00+07:00`)
  const nextDay = new Date(firstDay.getTime() + 24 * 60 * 60 * 1000)
  const matchesResult = await fetchMatchesByKickoffRange(firstDay.toISOString(), nextDay.toISOString())
  if (matchesResult.error) return { data: [], error: matchesResult.error, status: buildStatus(date, rows) }

  const byId = new Map((matchesResult.data ?? []).map((match) => [match.id, match]))
  const normalized = rows.map((row) => normalizeLockedMatch(byId.get(row.match_id), row)).filter((row) => row.id)
  const sorted = sortMarketReadyTop10(normalized)
  return {
    data: sorted,
    error: null,
    status: buildStatus(date, rows, sorted),
  }
}

function normalizeLockedMatch(match = {}, lock = {}) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
  const waitingMarketData = deriveWaitingMarketData(match, analysis, match.aiFinalPick ?? match.ai_final_pick, lock)
  const statusShort = getStatusCodeFromMatch(match)
  return {
    ...match,
    kickoffAt: match.kickoffAt ?? match.kickoff_at,
    status: statusShort,
    statusShort,
    status_short: statusShort,
    finalRank: lock.rank,
    final_rank: lock.rank,
    rank: lock.rank,
    aiPickRank: lock.rank,
    ai_pick_rank: lock.rank,
    aiPickLabel: `AI PICK #${lock.rank}`,
    ai_pick_label: `AI PICK #${lock.rank}`,
    isTopPick: true,
    is_top_pick: true,
    recommendation: match.recommendation ?? analysis?.recommendation,
    confidence: match.confidence ?? analysis?.calibrated_confidence_score ?? analysis?.confidence_score,
    riskLevel: match.riskLevel ?? analysis?.risk_level,
    rankingScore: match.rankingScore ?? analysis?.ranking_score ?? analysis?.calibrated_confidence_score,
    waitingMarketData,
    waiting_market_data: waitingMarketData,
    dailyTop10Lock: lock,
  }
}

function deriveWaitingMarketData(match = {}, analysis = {}, aiFinalPick = {}, lock = {}) {
  const odds = match.odds ?? match.matchOdds ?? match.match_odds ?? []
  const oddsRows = Array.isArray(odds) ? odds : []
  const oddsRowsUsed = Number(analysis?.odds_rows_used ?? analysis?.raw?.odds_rows_used ?? aiFinalPick?.odds_rows_used ?? aiFinalPick?.oddsRowsUsed ?? 0)
  const hasOdds = oddsRows.length > 0 || oddsRowsUsed > 0
  const readiness = String(match?.data_readiness_status ?? analysis?.raw?.data_readiness_status ?? '').toUpperCase()
  const analysisStatus = String(analysis?.analysis_status ?? analysis?.raw?.analysis_status ?? aiFinalPick?.analysis_status ?? aiFinalPick?.analysisStatus ?? '').toUpperCase()
  const signal = String(aiFinalPick?.signal ?? lock?.signal ?? '').toUpperCase()
  const reason = String(analysis?.recommendation_reason ?? analysis?.raw?.recommendation_reason ?? aiFinalPick?.market_signal ?? aiFinalPick?.marketSignal ?? '').toLowerCase()
  const marketDataUsed = Boolean(analysis?.market_data_used ?? analysis?.raw?.market_data_used ?? aiFinalPick?.market_data_used ?? aiFinalPick?.marketDataUsed)

  return !hasOdds && (
    ['NO_MARKET_DATA', 'PENDING'].includes(readiness) ||
    analysisStatus === 'INSUFFICIENT_MARKET_DATA' ||
    (signal === 'SKIP' && /market|odds|ราคา|ตลาด/.test(reason)) ||
    marketDataUsed === false
  )
}

function sortMarketReadyTop10(matches = []) {
  return [...matches]
    .sort((a, b) => compareMarketReadyMatches(a, b) || Number(a.rank ?? 999) - Number(b.rank ?? 999))
    .map((match, index) => ({
      ...match,
      displayRank: index + 1,
      display_rank: index + 1,
      finalRank: index + 1,
      final_rank: index + 1,
      rank: index + 1,
      aiPickRank: index + 1,
      ai_pick_rank: index + 1,
      aiPickLabel: `AI PICK #${index + 1}`,
      ai_pick_label: `AI PICK #${index + 1}`,
    }))
}

export async function getTodayTop10OrFallback(fallback = []) {
  const date = getBangkokToday()
  const usable = await getUsableRollingTop10(date)
  if (!usable.error && (usable.data.length || usable.status?.finishedExcludedCount)) {
    return { matches: usable.data, status: usable.status, locked: Boolean(usable.locked), selection: usable.selection }
  }

  const locked = await getLockedTop10(date)
  if (!locked.error && locked.data.length) {
    const selection = buildUsableDailySelection(locked.data)
    return {
      matches: selection.selected,
      status: {
        ...locked.status,
        ...selection,
        selectionDate: date,
        locked: true,
        lockedCount: locked.status?.lockedCount ?? locked.data.length,
      },
      locked: true,
      selection,
    }
  }

  const statusResult = await getDailyTop10Status(date)
  const fallbackSelection = buildUsableDailySelection(fallback)
  return {
    matches: fallbackSelection.selected,
    status: {
      ...(statusResult.data ?? emptyStatus(date).data),
      ...fallbackSelection,
      selectionDate: date,
      locked: false,
    },
    locked: false,
    selection: fallbackSelection,
  }
}

async function getUsableRollingTop10(date) {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000)
  const [matchesResult, statusResult] = await Promise.all([
    fetchMatchesByKickoffRange(now.toISOString(), windowEnd.toISOString()),
    getDailyTop10Status(date),
  ])
  if (matchesResult.error) return { data: [], error: matchesResult.error, status: statusResult.data ?? emptyStatus(date).data }

  const selection = buildUsableDailySelection(matchesResult.data ?? [], { now })
  return {
    data: selection.selected,
    error: null,
    locked: Boolean(statusResult.data?.locked),
    selection,
    status: {
      ...(statusResult.data ?? emptyStatus(date).data),
      ...selection,
      selectionDate: date,
      locked: Boolean(statusResult.data?.locked),
      lockedCount: statusResult.data?.lockedCount ?? 0,
      displayedMarketReadyCount: selection.readySelectedCount,
    },
  }
}

function buildStatus(date, rows, displayRows = []) {
  const lockedAt = rows.map((row) => row.locked_at).filter(Boolean).sort()[0] ?? null
  const lastUpdated = rows.map((row) => row.updated_at ?? row.created_at).filter(Boolean).sort().at(-1) ?? null
  return {
    selectionDate: date,
    locked: rows.length > 0,
    lockedCount: rows.length,
    lockedAt,
    lastUpdated,
    strongSignalCount: rows.filter((row) => row.signal === 'STRONG_SIGNAL').length,
    watchCount: rows.filter((row) => row.signal === 'WATCH').length,
    skipCount: rows.filter((row) => row.signal === 'SKIP').length,
    displayedMarketReadyCount: displayRows.filter(isMarketReadyForDisplay).length,
  }
}

function emptyStatus(date) {
  return {
    data: {
      selectionDate: date,
      locked: false,
      lockedCount: 0,
      lockedAt: null,
      lastUpdated: null,
      strongSignalCount: 0,
      watchCount: 0,
      skipCount: 0,
    },
    error: null,
  }
}

function isMissingTable(error) {
  if (!error) return false
  const message = String(error.message ?? error.details ?? '')
  return error.code === 'PGRST205' || /Could not find the table/i.test(message)
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}
