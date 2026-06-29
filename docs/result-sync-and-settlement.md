# Result Sync and AI Result Settlement

## Flow

API-FOOTBALL fixture result updates `football_matches` with `status_short`, score fields, and compact fixture payload. `football_ai_pick_results` is then backfilled from locked Top 10 selections plus `football_ai_final_picks`, settled from the real score, and displayed by Result Tracker. AI Performance can fall back to `football_ai_pick_results` when the older performance tables have no rows.

## Edge Function modes

Call `sync-football-data` with one of these modes:

- `result-refresh`: runs backfill, completed fixture sync, settlement, and performance recompute gracefully.
- `sync-completed-fixtures`: fetches completed fixture scores from API-FOOTBALL and updates `football_matches`.
- `backfill-ai-pick-results`: creates or safely updates result rows from locked Top 10 and AI final picks.
- `settle-ai-pick-results`: settles pending result rows in the selected date window.
- `settle-ai-pick-results-date`: same as settlement, scoped by `selectionDate`.
- `recompute-performance-daily`: graceful no-op unless a daily performance table is added later.

All result modes default to limit `10` and are hard capped at `20`.

## Windows CMD examples

Do not paste real keys into docs or logs. Use environment variables:

```bat
curl -X POST "%SUPABASE_FUNCTION_URL%/sync-football-data" ^
  -H "Content-Type: application/json" ^
  -H "apikey: %SUPABASE_SERVICE_ROLE_KEY%" ^
  -H "Authorization: Bearer %SUPABASE_SERVICE_ROLE_KEY%" ^
  -d "{\"mode\":\"result-refresh\",\"selectionDate\":\"2026-06-29\",\"limit\":10}"
```

```bat
npm.cmd run verify:results
```

## Recommended schedule

Run `result-refresh` every 30-60 minutes during active match windows. Run it again after many matches finish. After midnight Bangkok time, run it for yesterday and today so late fixtures are caught.

## Troubleshooting

If a finished match still shows `ยังไม่จบ`, run `result-refresh` and check that the match has `api_fixture_id` or `api_sports_fixture_id`. If score is null, run `sync-completed-fixtures` for the date window and inspect API limits/errors. If a result row remains `PENDING` while the match is `FT/AET/PEN` with score, run `settle-ai-pick-results`. Postponed, cancelled, abandoned, awarded, and walkover statuses become `ไม่นับผล`.
