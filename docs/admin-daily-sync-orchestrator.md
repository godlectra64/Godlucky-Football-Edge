# Admin Daily Sync Orchestrator

`daily-full-sync` used to run the whole API-FOOTBALL enrichment chain inside one Edge Function request. That can hit Supabase `WORKER_RESOURCE_LIMIT` because one worker has to fetch fixtures, coverage, rounds, fixture stats, events, lineups, players, injuries, squads, coaches, venues, top players, and ranking in a single run.

The production path is now the phased orchestrator. It stores a run id and runs one small phase per request.

Do not call these modes with a publishable/anon key. Use only a Supabase service role key, a configured `SUPABASE_SECRET_KEYS` admin key, or an admin JWT.

## Modes

- `daily-sync-start`: create or reset a run and its five steps.
- `daily-sync-next`: run the next pending, partial, or failed step.
- `daily-sync-status`: read run status and all steps.
- `daily-sync-phase`: retry one named phase.
- `daily-full-sync-safe`: start a run and run only the first step by default.

`daily-full-sync` remains accepted, but it routes through the safe phased path and no longer runs every phase in one request.

## Phases

1. `core`: daily fixtures, coverage flags, rounds.
2. `fixture-enrichment`: fixture statistics, events, lineups, fixture players.
3. `team-enrichment`: injuries, squads, coaches, venues.
4. `league-enrichment`: top scorers, top assists, top yellow cards, top red cards.
5. `ranking`: existing Top 10 ranking logic, unchanged.

## Start A Run

Windows CMD:

```cmd
curl -X POST "https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data" ^
  -H "Authorization: Bearer <SERVICE_OR_SECRET_KEY>" ^
  -H "Content-Type: application/json" ^
  -d "{\"mode\":\"daily-sync-start\",\"date\":\"2026-06-28\",\"limit\":10,\"enrichmentLimit\":20}"
```

Response includes `runId`. Keep it for `daily-sync-next`.

## Run The Next Step

```cmd
curl -X POST "https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data" ^
  -H "Authorization: Bearer <SERVICE_OR_SECRET_KEY>" ^
  -H "Content-Type: application/json" ^
  -d "{\"mode\":\"daily-sync-next\",\"runId\":\"<RUN_ID>\"}"
```

Call `daily-sync-next` again until `nextAction` says the run is complete.

## Check Status

```cmd
curl -X POST "https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data" ^
  -H "Authorization: Bearer <SERVICE_OR_SECRET_KEY>" ^
  -H "Content-Type: application/json" ^
  -d "{\"mode\":\"daily-sync-status\",\"runId\":\"<RUN_ID>\"}"
```

The response reports completed, failed, skipped, processed, rows saved, and the next step.

## Retry A Failed Phase

```cmd
curl -X POST "https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data" ^
  -H "Authorization: Bearer <SERVICE_OR_SECRET_KEY>" ^
  -H "Content-Type: application/json" ^
  -d "{\"mode\":\"daily-sync-phase\",\"runId\":\"<RUN_ID>\",\"phase\":\"fixture-enrichment\"}"
```

Valid phases are `core`, `fixture-enrichment`, `team-enrichment`, `league-enrichment`, and `ranking`.

## Safe One-Call Start

`daily-full-sync-safe` starts or reuses a run and runs only one phase by default.

```cmd
curl -X POST "https://fzjbnxomflqopwhzxfog.supabase.co/functions/v1/sync-football-data" ^
  -H "Authorization: Bearer <SERVICE_OR_SECRET_KEY>" ^
  -H "Content-Type: application/json" ^
  -d "{\"mode\":\"daily-full-sync-safe\",\"limit\":10,\"enrichmentLimit\":20,\"autoAdvance\":false}"
```

With `autoAdvance:true`, the function can run at most two steps in that request. It will never loop through all five phases at once.

## Phase Limits

Defaults:

- `core`: `10`
- `fixture-enrichment`: `5`
- `team-enrichment`: `10`
- `league-enrichment`: `10`
- `ranking`: `10`

Override example:

```json
{
  "mode": "daily-full-sync-safe",
  "phaseLimits": {
    "core": 10,
    "fixture-enrichment": 3,
    "team-enrichment": 10,
    "league-enrichment": 10,
    "ranking": 10
  }
}
```

## Response Fields

Every orchestrator response includes:

- `ok`
- `provider`
- `mode`
- `runId`
- `phase`
- `status`
- `processed`
- `rowsSaved`
- `failed`
- `skipped`
- `rateLimited`
- `durationMs`
- `nextAction`
- `nextRequestExample`

Unsupported API-FOOTBALL coverage is logged as `skipped_no_coverage`. Empty endpoint responses are logged as `empty`. A phase failure is stored on the step and does not delete previous data.
