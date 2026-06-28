import { getBangkokToday } from '../utils/bangkokDate.js'
import { fetchMatchesByKickoffRange } from './matchesRepository.js'

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
  return {
    data: rows.map((row) => normalizeLockedMatch(byId.get(row.match_id), row)).filter((row) => row.id),
    error: null,
    status: buildStatus(date, rows),
  }
}

function normalizeLockedMatch(match = {}, lock = {}) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
  return {
    ...match,
    kickoffAt: match.kickoffAt ?? match.kickoff_at,
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
    dailyTop10Lock: lock,
  }
}

export async function getTodayTop10OrFallback(fallback = []) {
  const date = getBangkokToday()
  const locked = await getLockedTop10(date)
  if (!locked.error && locked.data.length) return { matches: locked.data, status: locked.status, locked: true }
  const statusResult = await getDailyTop10Status(date)
  return { matches: fallback, status: statusResult.data ?? emptyStatus(date).data, locked: false }
}

function buildStatus(date, rows) {
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
