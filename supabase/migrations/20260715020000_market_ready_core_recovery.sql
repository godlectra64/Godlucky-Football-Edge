-- Additive metadata for resumable Market-Ready First pipeline execution.
-- The explicit dependency guard prevents this recovery migration from being
-- applied on a divergent or partially reconciled history.
do $$
declare
  required_table text;
  status_definition text;
begin
  foreach required_table in array array[
    'api_football_daily_sync_runs',
    'api_football_daily_sync_steps',
    'football_matches',
    'football_match_odds',
    'football_ai_final_picks',
    'football_ai_pick_results',
    'daily_top10_selections',
    'daily_market_candidates'
  ]
  loop
    if to_regclass(format('public.%I', required_table)) is null then
      raise exception 'Market-ready core dependency public.% is missing', required_table;
    end if;
  end loop;

  select pg_get_constraintdef(oid)
    into status_definition
  from pg_constraint
  where conrelid = 'public.daily_top10_selections'::regclass
    and conname = 'daily_top10_selections_status_valid';

  if status_definition is null or status_definition !~ '''WAIT''' then
    raise exception 'Canonical WAIT status reconciliation must run before market-ready core recovery';
  end if;
end
$$;

create table if not exists public.production_repair_audits (
  id uuid primary key default gen_random_uuid(),
  repair_type text not null,
  status text not null,
  release_commit text,
  plan_signature text not null,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.production_repair_audits enable row level security;

comment on table public.production_repair_audits is
  'Service-role-only audit records for explicit production repair commands; dry-runs never insert rows.';

alter table if exists public.api_football_daily_sync_runs
  add column if not exists pipeline_version text,
  add column if not exists selection_algorithm_version text,
  add column if not exists decision_gate_version text,
  add column if not exists decision_model_version text,
  add column if not exists market_quality_version text,
  add column if not exists analysis_engine_version text,
  add column if not exists repair_audit_id uuid;

alter table if exists public.api_football_daily_sync_steps
  add column if not exists provider_page integer not null default 1,
  add column if not exists fixture_offset integer not null default 0,
  add column if not exists odds_offset integer not null default 0,
  add column if not exists processed_fixture_count integer not null default 0,
  add column if not exists last_processed_fixture_id bigint,
  add column if not exists batch_signature text,
  add column if not exists continuation_state jsonb not null default '{}'::jsonb,
  add column if not exists pipeline_version text,
  add column if not exists selection_algorithm_version text,
  add column if not exists decision_gate_version text,
  add column if not exists decision_model_version text,
  add column if not exists market_quality_version text,
  add column if not exists analysis_engine_version text,
  add column if not exists repair_audit_id uuid;

-- Resume legacy incomplete fixture-enrichment steps from their audited attempt counts.
-- This is intentionally bounded to rows with an empty new cursor and numeric legacy summary fields.
update public.api_football_daily_sync_steps
set
  fixture_offset = case
    when summary #>> '{details,fixtureDetailAttempted}' ~ '^[0-9]+$'
      then (summary #>> '{details,fixtureDetailAttempted}')::integer
    else fixture_offset
  end,
  odds_offset = case
    when summary #>> '{details,oddsAttempted}' ~ '^[0-9]+$'
      then (summary #>> '{details,oddsAttempted}')::integer
    else odds_offset
  end,
  processed_fixture_count = greatest(
    processed_fixture_count,
    case when summary #>> '{details,fixtureDetailAttempted}' ~ '^[0-9]+$' then (summary #>> '{details,fixtureDetailAttempted}')::integer else 0 end,
    case when summary #>> '{details,oddsAttempted}' ~ '^[0-9]+$' then (summary #>> '{details,oddsAttempted}')::integer else 0 end
  ),
  continuation_state = jsonb_build_object(
    'providerPage', provider_page,
    'fixtureOffset', case when summary #>> '{details,fixtureDetailAttempted}' ~ '^[0-9]+$' then (summary #>> '{details,fixtureDetailAttempted}')::integer else fixture_offset end,
    'oddsOffset', case when summary #>> '{details,oddsAttempted}' ~ '^[0-9]+$' then (summary #>> '{details,oddsAttempted}')::integer else odds_offset end,
    'processedFixtureCount', greatest(
      processed_fixture_count,
      case when summary #>> '{details,fixtureDetailAttempted}' ~ '^[0-9]+$' then (summary #>> '{details,fixtureDetailAttempted}')::integer else 0 end,
      case when summary #>> '{details,oddsAttempted}' ~ '^[0-9]+$' then (summary #>> '{details,oddsAttempted}')::integer else 0 end
    ),
    'lastProcessedFixtureId', last_processed_fixture_id,
    'batchSignature', batch_signature,
    'completedBatchSignatures', '[]'::jsonb,
    'coreAuxiliaryComplete', false
  )
where phase = 'fixture-enrichment'
  and status in ('pending', 'running', 'partial', 'pending_retry')
  and fixture_offset = 0
  and odds_offset = 0
  and continuation_state = '{}'::jsonb
  and (
    summary #>> '{details,fixtureDetailAttempted}' ~ '^[0-9]+$'
    or summary #>> '{details,oddsAttempted}' ~ '^[0-9]+$'
  );

update public.api_football_daily_sync_steps
set max_attempts = 20
where phase in ('core', 'fixture-enrichment')
  and status <> 'success'
  and max_attempts < 20;

alter table if exists public.football_ai_final_picks
  add column if not exists selection_status text,
  add column if not exists market_ready boolean not null default false,
  add column if not exists primary_reason_code text,
  add column if not exists reason_codes text[] not null default '{}'::text[],
  add column if not exists decision_reason_th text,
  add column if not exists decision_readiness_score numeric,
  add column if not exists last_market_refresh_at timestamptz,
  add column if not exists last_analysis_at timestamptz,
  add column if not exists pipeline_version text,
  add column if not exists selection_algorithm_version text,
  add column if not exists decision_gate_version text,
  add column if not exists decision_model_version text,
  add column if not exists market_quality_version text,
  add column if not exists analysis_engine_version text;

do $$
declare
  unknown_statuses text[];
  status_definition text;
begin
  select array_agg(distinct selection_status order by selection_status)
    into unknown_statuses
  from public.football_ai_final_picks
  where selection_status is not null
    and selection_status not in ('READY', 'WATCH', 'WAIT', 'REJECTED');

  if coalesce(array_length(unknown_statuses, 1), 0) > 0 then
    raise exception 'Unknown football_ai_final_picks selection statuses: %', unknown_statuses;
  end if;

  select pg_get_constraintdef(oid)
    into status_definition
  from pg_constraint
  where conrelid = 'public.football_ai_final_picks'::regclass
    and conname = 'football_ai_final_picks_selection_status_valid';

  if status_definition is null then
    alter table public.football_ai_final_picks
      add constraint football_ai_final_picks_selection_status_valid
      check (selection_status is null or selection_status in ('READY', 'WATCH', 'WAIT', 'REJECTED'))
      not valid;
  elsif status_definition !~ '''READY'''
    or status_definition !~ '''WATCH'''
    or status_definition !~ '''WAIT'''
    or status_definition !~ '''REJECTED'''
  then
    raise exception 'football_ai_final_picks_selection_status_valid has a non-canonical definition: %', status_definition;
  end if;

  alter table public.football_ai_final_picks
    validate constraint football_ai_final_picks_selection_status_valid;
end
$$;

alter table if exists public.football_ai_pick_results
  add column if not exists repair_audit_id uuid;

alter table if exists public.daily_top10_selections
  add column if not exists selection_status text,
  add column if not exists market_ready boolean not null default false,
  add column if not exists primary_reason_code text,
  add column if not exists reason_codes text[] not null default '{}'::text[],
  add column if not exists pipeline_version text,
  add column if not exists selection_algorithm_version text,
  add column if not exists decision_gate_version text,
  add column if not exists decision_model_version text,
  add column if not exists market_quality_version text,
  add column if not exists analysis_engine_version text;

alter table if exists public.football_match_odds
  add column if not exists provider_source_at timestamptz,
  add column if not exists fetched_at timestamptz,
  add column if not exists normalized_at timestamptz,
  add column if not exists normalized_market_type text,
  add column if not exists normalized_selection text,
  add column if not exists integrity_status text default 'ACTIVE',
  add column if not exists integrity_reason text,
  add column if not exists superseded_by uuid,
  add column if not exists repair_audit_id uuid;

create index if not exists api_football_daily_sync_steps_cursor_idx
  on public.api_football_daily_sync_steps(run_id, step_order, fixture_offset, odds_offset);
create index if not exists api_football_daily_sync_steps_stale_idx
  on public.api_football_daily_sync_steps(status, updated_at)
  where status = 'running';
create index if not exists football_match_odds_provenance_idx
  on public.football_match_odds(match_id, market_focus, fetched_at desc);
create index if not exists football_ai_final_picks_status_idx
  on public.football_ai_final_picks(selection_status, market_ready);
create index if not exists football_match_odds_integrity_idx
  on public.football_match_odds(is_latest, integrity_status);
create index if not exists football_match_odds_repair_audit_idx
  on public.football_match_odds(repair_audit_id)
  where repair_audit_id is not null;

comment on column public.api_football_daily_sync_steps.continuation_state is
  'Resumable provider and fixture cursor state; checkpointed after successful progress and marks a batch complete only after all rows succeed.';
comment on column public.football_match_odds.provider_source_at is
  'Timestamp supplied by the provider; null when the provider supplies no source timestamp.';
comment on column public.football_match_odds.fetched_at is
  'Timestamp when the provider payload was fetched; never substituted for provider_source_at.';
comment on column public.football_match_odds.normalized_market_type is
  'Canonical market type. This additive field preserves DOUBLE_CHANCE and CORRECT_SCORE without changing the legacy market_focus constraint.';
comment on column public.football_match_odds.integrity_status is
  'ACTIVE, HISTORICAL, INVALID, or SUPERSEDED state assigned by deterministic repair; is_latest remains the active-row compatibility flag.';
comment on column public.football_match_odds.superseded_by is
  'Deterministically selected canonical football_match_odds row; intentionally not a foreign key to keep repair batches resumable.';
comment on column public.football_match_odds.repair_audit_id is
  'production_repair_audits identifier for the explicit repair that last changed integrity state.';
comment on column public.football_ai_final_picks.selection_status is
  'Canonical decision status: READY, WATCH, WAIT, or REJECTED. Only READY may expose an actionable final pick.';
comment on table public.daily_top10_selections is
  'Legacy compatibility adapter only. Canonical Market-Ready First classification is stored on football_ai_final_picks and is not count-limited by this table.';

-- GitHub Actions is the canonical scheduler. Remove the obsolete pg_cron paths if present.
do $$
declare
  legacy_job record;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  for legacy_job in
    select jobid
    from cron.job
    where jobname in (
      'sync-football-data-hourly',
      'sync-football-data-prime-th',
      'sync-football-data-0005-th',
      'sync-football-data-0600-1200-1800-th',
      'sync-football-data-0030-th',
      'sync-football-data-1200-th'
    )
  loop
    perform cron.unschedule(legacy_job.jobid);
  end loop;
end
$$;
