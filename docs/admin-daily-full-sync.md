# Admin Daily Full Sync

`daily-full-sync` runs the daily football data pipeline end to end. It is admin-only and must be called from a trusted server, scheduled job, or secured admin tool.

Do not call this mode with a publishable/anon key. Publishable/anon requests return `401 ADMIN_AUTH_REQUIRED`.

## Flow

1. Sync daily fixtures from API-FOOTBALL.
2. Sync coverage flags.
3. Sync fixture rounds.
4. Sync fixture enrichment:
   - fixture statistics
   - events
   - lineups
   - fixture players
5. Sync injuries.
6. Sync squads.
7. Sync coaches.
8. Sync venues.
9. Sync league top players:
   - top scorers
   - top assists
   - top yellow cards
   - top red cards
10. Run the existing AI analysis ranking update for the daily Top 10.

The enrichment steps respect API-FOOTBALL coverage flags. Unsupported endpoints are logged as `skipped_no_coverage`, empty API responses are logged as `empty`, and a single endpoint failure is reported in the step summary without stopping the whole pipeline.

## Limits

Default limits:

- `limit`: `10` for fixture-level enrichment.
- `enrichmentLimit`: `20` for coverage, rounds, injuries, squads, coaches, venues, and top players.
- `matchLimit`: `50` for daily fixture ingestion.

Example body:

```json
{
  "mode": "daily-full-sync",
  "date": "2026-06-28",
  "limit": 10,
  "enrichmentLimit": 20
}
```

## curl Example

```bash
curl -X POST "https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data" \
  -H "Authorization: Bearer <SERVICE_OR_SECRET_KEY>" \
  -H "Content-Type: application/json" \
  -d "{\"mode\":\"daily-full-sync\",\"limit\":10,\"enrichmentLimit\":20}"
```

Use the Supabase service role key, a configured `SUPABASE_SECRET_KEYS` admin key, or a valid admin JWT. Never expose these credentials in frontend code.

## Response Shape

The response includes a `steps` array. Each step reports:

- `processed`
- `totalCandidates`
- `rowsSaved`
- `failed`
- `durationMs`
- `status`

The final response also includes cumulative `endpointCoverage`, `skippedEndpoints`, and active `limits`.
