export async function fetchOddsByMatchIds(matchIds = []) {
  const ids = [...new Set(matchIds.filter(Boolean))]
  if (!ids.length) return emptyResult()
  const client = await getSupabaseClient()
  return fetchPaginatedOddsRows(client, ids)
}

export async function fetchOddsByMatchId(matchId) {
  if (!matchId) return emptyResult()
  const client = await getSupabaseClient()
  return fetchPaginatedOddsRows(client, [matchId])
}

export async function fetchPaginatedOddsRows(client, matchIds = [], options = {}) {
  const ids = [...new Set(matchIds.filter(Boolean))]
  if (!ids.length) return emptyResult()
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 1000), 1000))
  const idChunkSize = Math.max(1, Math.min(Number(options.idChunkSize ?? 100), 200))
  const maxPages = Math.max(1, Number(options.maxPages ?? 10_000))
  const rows = []
  let pageCount = 0
  let error = null
  let partial = false

  for (let index = 0; index < ids.length && !error; index += idChunkSize) {
    const idChunk = ids.slice(index, index + idChunkSize)
    for (let page = 0; page < maxPages; page += 1) {
      if (options.signal?.aborted) {
        error = new DOMException('Odds fetch aborted', 'AbortError')
        partial = rows.length > 0
        break
      }
      const from = page * pageSize
      const result = await client
        .from('football_match_odds')
        .select('*')
        .in('match_id', idChunk)
        .order('match_id', { ascending: true })
        .order('is_latest', { ascending: false })
        .order('snapshot_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1)
      pageCount += 1
      if (result.error) {
        error = result.error
        partial = rows.length > 0 || Boolean(result.data?.length)
        break
      }
      const pageRows = result.data ?? []
      rows.push(...pageRows)
      if (pageRows.length < pageSize) break
      if (page === maxPages - 1) {
        error = new Error(`Odds pagination exceeded ${maxPages} pages`)
        partial = true
      }
    }
  }

  const seen = new Set()
  const data = []
  let duplicateRows = 0
  let invalidRows = 0
  for (const row of rows) {
    const key = oddsRowKey(row)
    if (!row?.match_id) invalidRows += 1
    if (seen.has(key)) duplicateRows += 1
    else {
      seen.add(key)
      data.push(row)
    }
  }
  return {
    data,
    error,
    diagnostics: { fetchedRows: data.length, rawRows: rows.length, pageCount, duplicateRows, invalidRows, partial },
  }
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}

function oddsRowKey(row = {}) {
  if (row.id) return `id:${row.id}`
  return [row.match_id, row.api_fixture_id, row.api_bookmaker_id ?? row.bookmaker_name, row.market_focus ?? row.market_name, row.selection, row.line, row.price, row.snapshot_at].join('|')
}

function emptyResult() {
  return { data: [], error: null, diagnostics: { fetchedRows: 0, rawRows: 0, pageCount: 0, duplicateRows: 0, invalidRows: 0, partial: false } }
}
