# Migration Archive

This directory contains audited historical SQL that must not be discovered or
executed by the Supabase migration runner. The files remain in Git for forensic
traceability only.

Categories:

- `unrecorded_effective`: schema-only effects already present in Production but
  absent from remote migration history. Their required forward schema is rebuilt
  by `20260715000000_reconcile_unrecorded_schema.sql`.
- `data_effect_unknown`: historical data mutations whose Production execution
  cannot be proven. They must never be replayed or marked applied.
- `obsolete_fixed_top10`: executable fixed-count behavior removed from the
  Market-Ready First path.
- `superseded`: an earlier schema change fully superseded by the canonical
  reconciliation contract.

`manifest.json` is the authoritative inventory. Moving a file back into
`supabase/migrations/` requires a new forensic review; the archive itself is not
a migration source.
