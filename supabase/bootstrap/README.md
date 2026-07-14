# Football Schema Bootstrap

`canonical_football_base.sql` is the clean-clone prerequisite for a new local,
test, disaster-recovery, or isolated preview database. It is intentionally
outside `supabase/migrations/` so it can never become a backdated Production
migration.

The bootstrap contains schema objects only. It does not contain row data,
schedulers, repair RPCs, or fixed-count selection behavior.

Use `npm run bootstrap:football:dry-run` to inspect the object plan. Local
application requires `npm run bootstrap:football:local`, a local `psql`
installation, and local `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE` environment
configuration. The script rejects the linked Production project and any
Production Supabase URL before starting `psql`.

This bootstrap must not be referenced by deployment workflows, Edge Functions,
Vercel builds, or normal `supabase db push` operations.
