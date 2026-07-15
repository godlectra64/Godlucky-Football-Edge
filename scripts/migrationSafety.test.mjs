import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assessDecisionStatusConstraint,
  assessTriggerContract,
  canonicalDecisionStatuses,
  duplicateVersions,
  expectedRemoteFiles,
  forbiddenBackdatedFiles,
  migrationVersion,
  normalizeSql,
  pendingFiles,
  productionLegacyDecisionStatuses,
  replacementDecisionStatuses,
  temporaryLegacyDecisionStatuses,
  unknownDataFiles,
  verifyMigrationHistory,
} from './verifyMigrationHistory.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = (filename) => readFileSync(path.join(root, 'supabase', 'migrations', filename), 'utf8')

function hasLineEndingEquivalentHash(filename, expectedHash) {
  const raw = readFileSync(path.join(root, 'supabase', 'migrations', filename))
  const text = raw.toString('utf8')
  return [
    raw,
    text.replace(/\r\n/g, '\n'),
    text.replace(/\r?\n/g, '\r\n'),
  ].some((value) => createHash('sha256').update(value).digest('hex') === expectedHash)
}

const summary = verifyMigrationHistory()
assert.equal(summary.duplicateVersions, 0)
assert.equal(summary.restoredRemoteFiles, Object.keys(expectedRemoteFiles).length)

const orderedVersions = [
  '20260712_add_daily_market_candidates.sql',
  '20260713_add_atomic_market_first_top10_repair.sql',
  '20260714_market_ready_dynamic_decision_board.sql',
  '20260715000000_reconcile_unrecorded_schema.sql',
  '20260715010000_reconcile_post_market_schema.sql',
  '20260715020000_market_ready_core_recovery.sql',
].map(migrationVersion)
assert.deepEqual(orderedVersions, [...orderedVersions].sort((left, right) => left.localeCompare(right)))

assert.equal(duplicateVersions(['20260705_one.sql', '20260705_two.sql']).length, 1)
assert.deepEqual(duplicateVersions(['20260705000000_one.sql', '20260705000001_two.sql']), [])

const activeText = pendingFiles.map((filename) => migration(filename)).join('\n')
for (const filename of unknownDataFiles) assert(!activeText.includes(filename))
for (const filename of forbiddenBackdatedFiles) assert(!pendingFiles.includes(filename))

const bridge = migration('20260715010000_reconcile_post_market_schema.sql')
for (const status of ['WAIT', 'WAITING_MARKET']) assert(bridge.includes(`'${status}'`))
assert(bridge.includes('Unknown daily decision statuses block reconciliation'))

const legacyConstraint = {
  tableSchema: 'public',
  tableName: 'daily_top10_selections',
  constraintName: 'daily_top10_selections_status_valid',
  constraintType: 'c',
  columns: ['selection_status'],
  columnNullable: true,
  nullAllowed: true,
  expectedExpressionShape: true,
  validated: true,
  noInherit: false,
  allowedValues: productionLegacyDecisionStatuses,
  storedValues: [null, 'READY'],
}
assert(!productionLegacyDecisionStatuses.includes('WATCH'), 'Legacy fixture must prove WATCH is not required in the starting constraint')
assert.equal(assessDecisionStatusConstraint(legacyConstraint).action, 'REPLACE')
assert.equal(assessDecisionStatusConstraint({ ...legacyConstraint, storedValues: ['READY'] }).action, 'REPLACE')
assert.equal(assessDecisionStatusConstraint({ ...legacyConstraint, storedValues: [null] }).action, 'REPLACE')
for (const status of canonicalDecisionStatuses) assert(replacementDecisionStatuses.includes(status), `${status} must be canonical`)
assert(replacementDecisionStatuses.includes('WAITING_MARKET'))
for (const status of temporaryLegacyDecisionStatuses) assert(replacementDecisionStatuses.includes(status), `${status} must remain temporarily compatible`)
assert.equal(assessDecisionStatusConstraint({ ...legacyConstraint, storedValues: ['UNREVIEWED_STATUS'] }).action, 'REJECT')
assert.equal(assessDecisionStatusConstraint({ ...legacyConstraint, unrelatedStoredValues: ['UNREVIEWED_STATUS'] }).action, 'REPLACE')
assert.equal(assessDecisionStatusConstraint({ ...legacyConstraint, tableName: 'unrelated_table' }).action, 'REJECT')
assert.equal(assessDecisionStatusConstraint({ ...legacyConstraint, columns: ['analysis_status'] }).action, 'REJECT')
assert.equal(assessDecisionStatusConstraint({ ...legacyConstraint, allowedValues: replacementDecisionStatuses }).action, 'NOOP')
assert.equal(assessDecisionStatusConstraint({ ...legacyConstraint, allowedValues: ['READY', 'WAIT'] }).action, 'REJECT')
assert.doesNotMatch(normalizeSql(bridge), /(?:^|;)\s*update\s+public\.daily_top10_selections\b/i)
assert.doesNotMatch(normalizeSql(bridge), /\b(?:delete\s+from|truncate|drop\s+(?:table|schema|type|column))\b/i)
assert.doesNotMatch(bridge, /drop\s+constraint\s+if\s+exists\s+daily_top10_selections_status_valid/i)
assert.match(bridge, /replacement_is_current[\s\S]*return;/i)

const target = migration('20260715020000_market_ready_core_recovery.sql')
assert(!/provider_source_at\s*=\s*fetched_at/i.test(normalizeSql(target)))
assert(target.includes("where phase = 'fixture-enrichment'"))
assert(target.includes("where phase in ('core', 'fixture-enrichment')"))

for (const filename of pendingFiles.slice(0, 2)) {
  const sql = normalizeSql(migration(filename))
  assert(!/(?:^|;)\s*(?:insert\s+into|update\s+|delete\s+from|truncate\s+)/i.test(sql), `${filename} must be schema-only`)
}

const targetUpdates = normalizeSql(target).split(';').filter((statement) => /^\s*update\s+/i.test(statement))
assert.equal(targetUpdates.length, 2, 'Core recovery must retain exactly two bounded metadata updates')
for (const statement of targetUpdates) assert(/\bwhere\b/i.test(statement), 'Core recovery UPDATE must include WHERE')

assert(!/rank\s+between\s+1\s+and\s+10/i.test(normalizeSql(activeText)))
assert(!/perform\s+public\.repair_stale_market_first_top10/i.test(normalizeSql(activeText)))
assert(target.includes("'sync-football-data-hourly'"))
assert(!target.includes("'daily-football-sync'"))

const expectedFunctionOid = 'expected-function-oid'
const canonicalTrigger = {
  functionOid: expectedFunctionOid,
  functionSchema: 'public',
  functionName: 'set_updated_at',
  functionArguments: '',
  isBefore: true,
  includesUpdate: true,
  includesOtherEvents: false,
  isRowLevel: true,
}
assert.equal(assessTriggerContract({ ...canonicalTrigger, triggerDefinition: 'EXECUTE FUNCTION set_updated_at()' }, expectedFunctionOid).action, 'KEEP')
assert.equal(assessTriggerContract({ ...canonicalTrigger, triggerDefinition: 'EXECUTE FUNCTION public.set_updated_at()' }, expectedFunctionOid).action, 'KEEP')
assert.equal(assessTriggerContract({ ...canonicalTrigger, functionSchema: 'shadow' }, expectedFunctionOid).action, 'REJECT')
assert.equal(assessTriggerContract({ ...canonicalTrigger, isBefore: false }, expectedFunctionOid).action, 'REJECT')
assert.equal(assessTriggerContract({ ...canonicalTrigger, isRowLevel: false }, expectedFunctionOid).action, 'REJECT')
assert.equal(assessTriggerContract({ ...canonicalTrigger, includesUpdate: false }, expectedFunctionOid).action, 'REJECT')
assert.equal(assessTriggerContract({ ...canonicalTrigger, functionArguments: 'integer' }, expectedFunctionOid).action, 'REJECT')
assert.deepEqual(assessTriggerContract(null, expectedFunctionOid), { valid: true, action: 'CREATE', reasons: [] })

const reconciliation = migration('20260715000000_reconcile_unrecorded_schema.sql')
assert(
  hasLineEndingEquivalentHash('20260715000000_reconcile_unrecorded_schema.sql',
  '73d89b8ab89b91af3236ddd1ea1ea4462a8674c8ea4eabf55cb5999cdd84625f',
  ),
  'Applied 20260715000000 migration changed',
)
assert(
  hasLineEndingEquivalentHash('20260715020000_market_ready_core_recovery.sql',
  '3679fa759522cfccfa40883817f5483fce94df911ae5e776d78de905a119a4a7',
  ),
  'Pending core recovery migration changed',
)
assert.match(reconciliation, /if not found then[\s\S]*create trigger/i)
assert.match(reconciliation, /actual_function_oid\s*<>\s*expected_function_oid/i)
assert.doesNotMatch(reconciliation, /trigger_definition\s*!~\*/i)

console.log('migration safety tests: legacy status reconciliation checks passed')
