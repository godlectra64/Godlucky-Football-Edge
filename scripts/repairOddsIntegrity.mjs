import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildOddsNaturalKey, normalizeMarketRow, normalizeMarketType } from '../supabase/functions/_shared/marketContract.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const expectedProjectRef = 'fzjbnxomflqopwhzxfog'
const apply = process.argv.includes('--apply')
const confirmProject = argumentValue('--confirm-project')
const planFile = argumentValue('--plan-file')
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const readKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const writeKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const key = apply ? writeKey : readKey || writeKey
if (!supabaseUrl || !key) throw new Error(`Missing Supabase environment variables for odds repair ${apply ? 'apply' : 'dry-run'}.`)
if (projectRef(supabaseUrl) !== expectedProjectRef) throw new Error(`Project ref mismatch: expected ${expectedProjectRef}.`)
if (apply && !writeKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required with --apply.')
if (apply && confirmProject !== expectedProjectRef) throw new Error(`Apply requires --confirm-project=${expectedProjectRef}.`)

const supabase = createClient(supabaseUrl, key)
const [matches, odds] = await Promise.all([
  selectAll('football_matches', 'id, has_market_data'),
  selectOdds(),
])
const plan = buildRepairPlan(matches, odds)

console.log(`[repair:odds] project_ref=${expectedProjectRef}`)
console.log(`[repair:odds] mode=${apply ? 'apply' : 'dry-run'}`)
console.log(`plan_signature=${plan.signature}`)
console.log(`odds_rows=${odds.length}`)
console.log(`invalid_rows_before=${plan.summary.invalidRowsBefore}`)
console.log(`invalid_active_before=${plan.summary.invalidActiveBefore}`)
console.log(`invalid_recoverable=${plan.summary.invalidRecoverable}`)
console.log(`invalid_to_deactivate=${plan.summary.invalidToDeactivate}`)
console.log(`duplicate_latest_before=${plan.summary.duplicateLatestBefore}`)
console.log(`rows_to_update=${plan.summary.rowsToUpdate}`)
console.log(`rows_to_supersede=${plan.summary.rowsToSupersede}`)
console.log('rows_to_delete=0')
console.log(`matches_set_true=${plan.summary.matchesSetTrue}`)
console.log(`matches_set_false=${plan.summary.matchesSetFalse}`)
console.log(`invalid_reasons=${JSON.stringify(plan.summary.invalidReasons)}`)
console.log(`market_impact=${JSON.stringify(plan.summary.marketImpact)}`)
console.log(`duplicate_groups=${plan.duplicateGroups.length}`)

if (planFile) {
  const target = resolve(planFile)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  console.log(`plan_file=${target}`)
}

if (!apply) process.exit(0)
if (!plan.actions.length && !plan.matchPatches.length) {
  console.log('[repair:odds] no changes required')
  process.exit(0)
}

const releaseCommit = getReleaseCommit()
const startedAt = new Date().toISOString()
const auditInsert = await supabase
  .from('production_repair_audits')
  .insert({
    repair_type: 'ODDS_INTEGRITY',
    status: 'RUNNING',
    release_commit: releaseCommit,
    plan_signature: plan.signature,
    summary: plan.summary,
    started_at: startedAt,
  })
  .select('id')
  .single()
if (auditInsert.error) throw auditInsert.error
const auditId = auditInsert.data.id
console.log(`audit_id=${auditId}`)

try {
  await applyOddsActions(plan.actions, auditId, startedAt)
  await applyMatchPatches(plan.matchPatches)
  const completed = await supabase
    .from('production_repair_audits')
    .update({ status: 'SUCCESS', completed_at: new Date().toISOString(), summary: { ...plan.summary, applied: true } })
    .eq('id', auditId)
  if (completed.error) throw completed.error
  console.log(`[repair:odds] applied rows=${plan.actions.length} match_flags=${plan.matchPatches.length}`)
} catch (error) {
  await supabase
    .from('production_repair_audits')
    .update({ status: 'FAILED', completed_at: new Date().toISOString(), summary: { ...plan.summary, error: safeError(error) } })
    .eq('id', auditId)
  throw error
}

function buildRepairPlan(matchRows, oddsRows) {
  const actions = new Map()
  const effectiveRows = oddsRows.map((row) => {
    const originalMarket = normalizeMarketRow(row)
    const effectiveMarket = normalizeRepairMarket(row)
    const active = row.is_latest !== false && !['INVALID', 'SUPERSEDED'].includes(String(row.integrity_status ?? '').toUpperCase())
    const effectiveValid = Boolean(row.match_id) && effectiveMarket.valid
    if (!originalMarket.valid && effectiveValid) {
      mergeAction(actions, row, {
        normalized_market_type: effectiveMarket.marketType,
        normalized_selection: effectiveMarket.selection,
        integrity_status: active ? 'ACTIVE' : 'HISTORICAL',
        integrity_reason: 'NORMALIZED_LEGACY_MARKET',
        set_normalized_at: true,
      }, 'NORMALIZE_LEGACY_MARKET')
    } else if (active && !effectiveValid) {
      const reasons = invalidReasons(row, effectiveMarket)
      mergeAction(actions, row, {
        is_latest: false,
        integrity_status: 'INVALID',
        integrity_reason: reasons.join('|'),
        superseded_by: null,
      }, 'DEACTIVATE_INVALID')
    }
    return { row, originalMarket, market: effectiveMarket, active, effectiveValid }
  })

  const duplicateGroups = []
  const validActive = effectiveRows.filter((item) => item.active && item.effectiveValid && actions.get(item.row.id)?.patch?.is_latest !== false)
  for (const [naturalKey, group] of groupBy(validActive, (item) => effectiveNaturalKey(item.row, item.market))) {
    if (group.length < 2) continue
    const ordered = [...group].sort(compareCanonicalRows)
    const canonical = ordered[0]
    const superseded = ordered.slice(1)
    duplicateGroups.push({
      naturalKey,
      canonicalId: canonical.row.id,
      supersededIds: superseded.map((item) => item.row.id),
      fixtureId: canonical.row.api_fixture_id,
      bookmaker: canonical.row.bookmaker_name ?? canonical.row.api_bookmaker_id ?? null,
      marketType: canonical.market.marketType,
      selection: canonical.market.selection,
      line: canonical.market.line,
      fetchedAt: canonical.market.fetchedAt,
    })
    for (const item of superseded) {
      mergeAction(actions, item.row, {
        is_latest: false,
        integrity_status: 'SUPERSEDED',
        integrity_reason: 'DUPLICATE_LATEST_NATURAL_KEY',
        superseded_by: canonical.row.id,
      }, 'SUPERSEDE_DUPLICATE')
    }
  }

  const inactiveIds = new Set([...actions.values()].filter((item) => item.patch.is_latest === false).map((item) => item.id))
  const activeValidMatchIds = new Set(effectiveRows
    .filter((item) => item.active && item.effectiveValid && !inactiveIds.has(item.row.id))
    .map((item) => item.row.match_id))
  const matchPatches = matchRows
    .map((row) => ({ id: row.id, before: Boolean(row.has_market_data), has_market_data: activeValidMatchIds.has(row.id) }))
    .filter((row) => row.before !== row.has_market_data)
    .map(({ id, has_market_data }) => ({ id, has_market_data }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const orderedActions = [...actions.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const invalidReasonCounts = countBy(effectiveRows
    .filter((item) => item.active && !item.effectiveValid)
    .flatMap((item) => invalidReasons(item.row, item.market)))
  const marketImpact = countBy(orderedActions.map((item) => item.marketType))
  const summary = {
    invalidRowsBefore: effectiveRows.filter((item) => !item.originalMarket.valid).length,
    invalidActiveBefore: effectiveRows.filter((item) => item.active && !item.originalMarket.valid).length,
    invalidRecoverable: orderedActions.filter((item) => item.actions.includes('NORMALIZE_LEGACY_MARKET')).length,
    invalidToDeactivate: orderedActions.filter((item) => item.actions.includes('DEACTIVATE_INVALID')).length,
    duplicateLatestBefore: duplicateGroups.reduce((total, group) => total + group.supersededIds.length, 0),
    rowsToUpdate: orderedActions.length,
    rowsToSupersede: orderedActions.filter((item) => item.patch.is_latest === false).length,
    rowsToDelete: 0,
    matchesSetTrue: matchPatches.filter((item) => item.has_market_data).length,
    matchesSetFalse: matchPatches.filter((item) => !item.has_market_data).length,
    invalidReasons: invalidReasonCounts,
    marketImpact,
  }
  const signature = sha256({ actions: orderedActions, matchPatches })
  return { signature, summary, actions: orderedActions, matchPatches, duplicateGroups }
}

function normalizeRepairMarket(row) {
  const legacyType = normalizeMarketType(row.market_focus)
  const inferredType = row.normalized_market_type || (legacyType !== 'NONE' ? row.market_focus : row.market_name)
  return normalizeMarketRow({
    ...row,
    normalized_market_type: inferredType,
    normalized_selection: row.normalized_selection ?? row.selection,
  })
}

function effectiveNaturalKey(row, market) {
  return buildOddsNaturalKey({ ...row, normalized_market_type: market.marketType, normalized_selection: market.selection })
}

function compareCanonicalRows(a, b) {
  const timeDiff = repairTimestamp(b.row) - repairTimestamp(a.row)
  return timeDiff || String(b.row.id).localeCompare(String(a.row.id))
}

function repairTimestamp(row) {
  for (const value of [row.provider_source_at, row.fetched_at, row.snapshot_at, row.updated_at, row.created_at]) {
    const time = new Date(value ?? 0).getTime()
    if (Number.isFinite(time) && time > 0) return time
  }
  return 0
}

function invalidReasons(row, market) {
  const reasons = [...market.reasonCodes]
  if (!row.match_id) reasons.push('MATCH_ID_MISSING')
  return [...new Set(reasons.length ? reasons : ['MARKET_INVALID'])].sort()
}

function mergeAction(actions, row, patch, action) {
  const current = actions.get(row.id) ?? {
    id: row.id,
    matchId: row.match_id,
    fixtureId: row.api_fixture_id,
    bookmaker: row.bookmaker_name ?? row.api_bookmaker_id ?? null,
    marketType: normalizeRepairMarket(row).marketType,
    selection: normalizeRepairMarket(row).selection,
    fetchedAt: row.fetched_at ?? row.snapshot_at ?? null,
    actions: [],
    patch: {},
  }
  current.actions = [...new Set([...current.actions, action])].sort()
  current.patch = { ...current.patch, ...patch }
  actions.set(row.id, current)
}

async function applyOddsActions(actions, auditId, normalizedAt) {
  for (let index = 0; index < actions.length; index += 25) {
    const batch = actions.slice(index, index + 25)
    await Promise.all(batch.map(async (action) => {
      const patch = { ...action.patch, repair_audit_id: auditId }
      if (patch.set_normalized_at) {
        delete patch.set_normalized_at
        patch.normalized_at = normalizedAt
      }
      const { error } = await supabase.from('football_match_odds').update(patch).eq('id', action.id)
      if (error) throw error
    }))
    console.log(`[repair:odds] batch=${Math.floor(index / 25) + 1} updated=${batch.length}`)
  }
}

async function applyMatchPatches(patches) {
  for (const value of [true, false]) {
    const ids = patches.filter((item) => item.has_market_data === value).map((item) => item.id)
    for (let index = 0; index < ids.length; index += 100) {
      const patch = value ? { has_market_data: true } : { has_market_data: false, odds_updated_at: null }
      const { error } = await supabase.from('football_matches').update(patch).in('id', ids.slice(index, index + 100))
      if (error) throw error
    }
  }
}

async function selectOdds() {
  try {
    return await selectAll('football_match_odds', 'id, match_id, api_fixture_id, api_bookmaker_id, bookmaker_name, market_focus, normalized_market_type, market_name, selection, normalized_selection, line, price, is_latest, snapshot_at, provider_source_at, fetched_at, normalized_at, integrity_status, integrity_reason, superseded_by, repair_audit_id, created_at, updated_at')
  } catch (error) {
    if (!isMissingColumn(error)) throw error
    return selectAll('football_match_odds', 'id, match_id, api_fixture_id, api_bookmaker_id, bookmaker_name, market_focus, market_name, selection, line, price, is_latest, snapshot_at, created_at, updated_at')
  }
}

async function selectAll(table, columns) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

function groupBy(rows, keyFn) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return groups
}

function countBy(values) {
  const counts = {}
  for (const value of values) counts[value ?? 'UNKNOWN'] = (counts[value ?? 'UNKNOWN'] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function argumentValue(name) {
  const prefix = `${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? ''
}

function getReleaseCommit() {
  return process.env.RELEASE_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function safeError(error) {
  return String(error?.message ?? error ?? 'repair failed').slice(0, 500)
}

function isMissingColumn(error) {
  return error?.code === '42703' || /column .* does not exist|schema cache/i.test(String(error?.message ?? ''))
}

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
