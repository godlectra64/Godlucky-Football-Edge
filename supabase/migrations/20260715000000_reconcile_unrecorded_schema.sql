-- Forward-only reconciliation for schema effects that exist in Production but
-- were never recorded in remote migration history. This file is schema-only:
-- it intentionally excludes the two archived 20260705 data migrations and all
-- fixed-count selection behavior.

create extension if not exists pgcrypto;

create table if not exists public.api_football_league_coverage (
  id uuid primary key default gen_random_uuid(),
  api_league_id bigint not null,
  season integer not null,
  league_name text,
  country_name text,
  coverage jsonb not null default '{}'::jsonb,
  has_events boolean,
  has_lineups boolean,
  has_fixture_statistics boolean,
  has_player_statistics boolean,
  has_standings boolean,
  has_players boolean,
  has_top_scorers boolean,
  has_top_assists boolean,
  has_top_cards boolean,
  has_injuries boolean,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_league_id, season)
);

create table if not exists public.api_football_fixture_statistics (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint not null,
  api_team_id bigint not null,
  team_name text,
  shots_on_goal numeric,
  shots_off_goal numeric,
  total_shots numeric,
  blocked_shots numeric,
  shots_insidebox numeric,
  shots_outsidebox numeric,
  fouls numeric,
  corner_kicks numeric,
  offsides numeric,
  ball_possession numeric,
  yellow_cards numeric,
  red_cards numeric,
  goalkeeper_saves numeric,
  total_passes numeric,
  passes_accurate numeric,
  passes_percentage numeric,
  raw_statistics jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_fixture_id, api_team_id)
);

create table if not exists public.api_football_fixture_events (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint not null,
  api_team_id bigint,
  team_name text,
  api_player_id bigint,
  player_name text,
  api_assist_player_id bigint,
  assist_player_name text,
  elapsed integer,
  extra integer,
  event_type text,
  event_detail text,
  comments text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists public.api_football_fixture_lineups (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint not null,
  api_team_id bigint not null,
  team_name text,
  formation text,
  coach_id bigint,
  coach_name text,
  start_xi jsonb not null default '[]'::jsonb,
  substitutes jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_fixture_id, api_team_id)
);

create table if not exists public.api_football_fixture_players (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint not null,
  api_team_id bigint not null,
  team_name text,
  api_player_id bigint not null,
  player_name text,
  player_photo text,
  minutes integer,
  number integer,
  position text,
  rating numeric,
  captain boolean,
  substitute boolean,
  shots_total numeric,
  shots_on numeric,
  goals_total numeric,
  goals_conceded numeric,
  assists numeric,
  saves numeric,
  passes_total numeric,
  passes_key numeric,
  passes_accuracy numeric,
  tackles_total numeric,
  tackles_blocks numeric,
  tackles_interceptions numeric,
  duels_total numeric,
  duels_won numeric,
  dribbles_attempts numeric,
  dribbles_success numeric,
  fouls_drawn numeric,
  fouls_committed numeric,
  yellow_cards numeric,
  red_cards numeric,
  penalty_won numeric,
  penalty_committed numeric,
  penalty_scored numeric,
  penalty_missed numeric,
  penalty_saved numeric,
  raw_statistics jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_fixture_id, api_team_id, api_player_id)
);

create table if not exists public.api_football_injuries (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint,
  api_league_id bigint,
  season integer,
  api_team_id bigint,
  team_name text,
  api_player_id bigint,
  player_name text,
  player_photo text,
  player_type text,
  reason text,
  fixture_date timestamptz,
  timezone text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.api_football_squads (
  id uuid primary key default gen_random_uuid(),
  api_team_id bigint not null,
  team_name text,
  api_player_id bigint not null,
  player_name text,
  age integer,
  number integer,
  position text,
  photo text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_team_id, api_player_id)
);

create table if not exists public.api_football_coaches (
  id uuid primary key default gen_random_uuid(),
  api_coach_id bigint not null,
  api_team_id bigint,
  coach_name text,
  firstname text,
  lastname text,
  age integer,
  birth_date date,
  birth_place text,
  birth_country text,
  nationality text,
  height text,
  weight text,
  photo text,
  career jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_coach_id, api_team_id)
);

create table if not exists public.api_football_venues (
  id uuid primary key default gen_random_uuid(),
  api_venue_id bigint not null unique,
  venue_name text,
  address text,
  city text,
  country text,
  capacity integer,
  surface text,
  image text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.api_football_top_players (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  api_league_id bigint not null,
  season integer not null,
  rank integer,
  api_team_id bigint,
  team_name text,
  team_logo text,
  api_player_id bigint not null,
  player_name text,
  player_photo text,
  nationality text,
  age integer,
  position text,
  goals_total numeric,
  assists numeric,
  yellow_cards numeric,
  red_cards numeric,
  appearances integer,
  minutes integer,
  rating numeric,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint api_football_top_players_category_check
    check (category in ('top_scorers', 'top_assists', 'top_yellow_cards', 'top_red_cards')),
  unique(category, api_league_id, season, api_player_id)
);

create table if not exists public.api_football_rounds (
  id uuid primary key default gen_random_uuid(),
  api_league_id bigint not null,
  season integer not null,
  round_name text not null,
  is_current boolean default false,
  round_order integer,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_league_id, season, round_name)
);

create table if not exists public.api_football_enrichment_sync_log (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  api_fixture_id bigint,
  api_league_id bigint,
  api_team_id bigint,
  season integer,
  endpoint text not null,
  status text not null,
  results_count integer default 0,
  error_message text,
  started_at timestamptz default now(),
  finished_at timestamptz,
  created_at timestamptz default now(),
  constraint api_football_enrichment_sync_log_status_check
    check (status in ('started', 'success', 'partial_success', 'empty', 'skipped_no_coverage', 'skipped_not_due', 'error', 'finished'))
);

create table if not exists public.api_football_daily_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  mode text not null default 'daily-full-sync-safe',
  status text not null default 'started',
  current_phase text,
  current_step integer default 0,
  total_steps integer default 5,
  limit_value integer default 50,
  enrichment_limit integer default 20,
  started_at timestamptz default now(),
  finished_at timestamptz,
  last_error text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint api_football_daily_sync_runs_status_check
    check (status in ('started', 'running', 'partial', 'success', 'failed')),
  unique(run_date, mode)
);

comment on column public.api_football_daily_sync_runs.limit_value is
  'Provider batch size retained for compatibility; it is not a final selection-count limit.';

create table if not exists public.api_football_daily_sync_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.api_football_daily_sync_runs(id) on delete cascade,
  step_order integer not null,
  phase text not null,
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  processed integer default 0,
  total_candidates integer default 0,
  rows_saved integer default 0,
  failed integer default 0,
  skipped integer default 0,
  rate_limited boolean default false,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  attempt_count integer default 0,
  max_attempts integer default 3,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint api_football_daily_sync_steps_status_check
    check (status in ('pending', 'running', 'success', 'partial', 'pending_retry', 'skipped', 'failed')),
  unique(run_id, step_order)
);

create table if not exists public.football_bookmakers (
  id uuid primary key default gen_random_uuid(),
  api_bookmaker_id bigint not null unique,
  name text not null,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.football_match_odds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.football_matches(id) on delete cascade,
  api_fixture_id bigint,
  api_bookmaker_id bigint,
  bookmaker_name text,
  market_focus text not null,
  market_name text,
  selection text,
  line text,
  price numeric,
  odd_text text,
  is_opening boolean default false,
  is_latest boolean default true,
  snapshot_at timestamptz default now(),
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint football_match_odds_market_focus_valid
    check (market_focus in ('AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE'))
);

alter table public.football_ai_final_picks
  add column if not exists analysis_status text,
  add column if not exists recommendation_reason text,
  add column if not exists market_data_used boolean default false,
  add column if not exists odds_rows_used integer default 0,
  add column if not exists recalculated_at timestamptz,
  add column if not exists analysis_version text;

alter table public.football_matches
  add column if not exists status_short text,
  add column if not exists status_long text,
  add column if not exists match_status text,
  add column if not exists elapsed integer,
  add column if not exists home_score integer,
  add column if not exists away_score integer,
  add column if not exists halftime_home_score integer,
  add column if not exists halftime_away_score integer,
  add column if not exists fulltime_home_score integer,
  add column if not exists fulltime_away_score integer,
  add column if not exists extra_home_score integer,
  add column if not exists extra_away_score integer,
  add column if not exists penalty_home_score integer,
  add column if not exists penalty_away_score integer,
  add column if not exists finished_at timestamptz,
  add column if not exists score_synced_at timestamptz,
  add column if not exists api_fixture_last_checked_at timestamptz,
  add column if not exists api_fixture_payload jsonb,
  add column if not exists enrichment_attempt_count integer default 0,
  add column if not exists enrichment_last_attempt_at timestamptz,
  add column if not exists enrichment_next_retry_at timestamptz,
  add column if not exists enrichment_error text,
  add column if not exists enrichment_breakdown jsonb default '{}'::jsonb,
  add column if not exists has_market_data boolean default false,
  add column if not exists has_fixture_detail boolean default false,
  add column if not exists data_readiness_score numeric default 0,
  add column if not exists data_readiness_status text default 'PENDING';

create table if not exists public.football_ai_pick_results (
  id uuid primary key default gen_random_uuid(),
  selection_date date,
  match_id uuid references public.football_matches(id) on delete cascade,
  api_fixture_id bigint,
  ai_final_pick_id uuid references public.football_ai_final_picks(id) on delete set null,
  signal text,
  market_focus text,
  direction text,
  confidence_score numeric,
  risk_level text,
  home_score integer,
  away_score integer,
  status_short text,
  status_long text,
  settlement_status text default 'PENDING',
  simulation_outcome text default 'PENDING',
  settlement_reason text,
  settled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint football_ai_pick_results_settlement_status_valid
    check (settlement_status in ('PENDING', 'SETTLED', 'VOID')),
  constraint football_ai_pick_results_simulation_outcome_valid
    check (simulation_outcome in ('HIT', 'MISS', 'PUSH', 'PENDING', 'VOID'))
);

alter table public.match_analysis
  add column if not exists analysis_status text,
  add column if not exists recommendation_reason text,
  add column if not exists market_data_used boolean default false,
  add column if not exists odds_rows_used integer default 0,
  add column if not exists recalculated_at timestamptz,
  add column if not exists analysis_version text,
  add column if not exists professional_score numeric,
  add column if not exists data_quality_score numeric,
  add column if not exists market_quality_score numeric,
  add column if not exists statistical_edge_score numeric,
  add column if not exists tactical_edge_score numeric,
  add column if not exists motivation_score numeric,
  add column if not exists risk_control_score numeric,
  add column if not exists value_edge_score numeric,
  add column if not exists pipeline_stage text,
  add column if not exists pipeline_reasons jsonb default '[]'::jsonb,
  add column if not exists pipeline_warnings jsonb default '[]'::jsonb;

do $$
declare
  constraint_definition text;
begin
  select pg_get_constraintdef(oid)
    into constraint_definition
  from pg_constraint
  where conrelid = 'public.api_football_enrichment_sync_log'::regclass
    and conname = 'api_football_enrichment_sync_log_status_check';

  if constraint_definition is null then
    alter table public.api_football_enrichment_sync_log
      add constraint api_football_enrichment_sync_log_status_check
      check (status in ('started', 'success', 'partial_success', 'empty', 'skipped_no_coverage', 'skipped_not_due', 'error', 'finished'));
  elsif constraint_definition !~ 'partial_success'
    or constraint_definition !~ 'skipped_no_coverage'
    or constraint_definition !~ 'finished'
  then
    raise exception 'api_football_enrichment_sync_log_status_check has a non-canonical definition: %', constraint_definition;
  end if;

  select pg_get_constraintdef(oid)
    into constraint_definition
  from pg_constraint
  where conrelid = 'public.api_football_daily_sync_steps'::regclass
    and conname = 'api_football_daily_sync_steps_status_check';

  if constraint_definition is null then
    alter table public.api_football_daily_sync_steps
      add constraint api_football_daily_sync_steps_status_check
      check (status in ('pending', 'running', 'success', 'partial', 'pending_retry', 'skipped', 'failed'));
  elsif constraint_definition !~ 'pending_retry'
    or constraint_definition !~ 'partial'
    or constraint_definition !~ 'failed'
  then
    raise exception 'api_football_daily_sync_steps_status_check has a non-canonical definition: %', constraint_definition;
  end if;

  select pg_get_constraintdef(oid)
    into constraint_definition
  from pg_constraint
  where conrelid = 'public.football_matches'::regclass
    and conname = 'football_matches_data_readiness_status_check';

  if constraint_definition is null then
    alter table public.football_matches
      add constraint football_matches_data_readiness_status_check
      check (data_readiness_status in ('READY', 'PARTIAL', 'NO_MARKET_DATA', 'PENDING', 'FAILED', 'SKIPPED_NO_COVERAGE'));
  elsif constraint_definition !~ 'NO_MARKET_DATA'
    or constraint_definition !~ 'SKIPPED_NO_COVERAGE'
    or constraint_definition !~ 'PARTIAL'
  then
    raise exception 'football_matches_data_readiness_status_check has a non-canonical definition: %', constraint_definition;
  end if;
end
$$;

do $$
declare
  expected record;
  actual_type text;
begin
  for expected in
    select *
    from (values
      ('api_football_league_coverage', 'api_league_id', 'int8'),
      ('api_football_fixture_statistics', 'api_fixture_id', 'int8'),
      ('api_football_fixture_events', 'raw_payload', 'jsonb'),
      ('api_football_fixture_lineups', 'start_xi', 'jsonb'),
      ('api_football_fixture_players', 'api_player_id', 'int8'),
      ('api_football_injuries', 'fixture_date', 'timestamptz'),
      ('api_football_squads', 'api_team_id', 'int8'),
      ('api_football_coaches', 'api_coach_id', 'int8'),
      ('api_football_venues', 'api_venue_id', 'int8'),
      ('api_football_top_players', 'category', 'text'),
      ('api_football_rounds', 'round_name', 'text'),
      ('api_football_enrichment_sync_log', 'status', 'text'),
      ('api_football_daily_sync_runs', 'run_date', 'date'),
      ('api_football_daily_sync_steps', 'next_retry_at', 'timestamptz'),
      ('football_match_odds', 'market_focus', 'text'),
      ('football_ai_pick_results', 'settlement_status', 'text'),
      ('football_matches', 'data_readiness_status', 'text'),
      ('match_analysis', 'pipeline_reasons', 'jsonb')
    ) as contract(table_name, column_name, udt_name)
  loop
    select columns.udt_name
      into actual_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = expected.table_name
      and column_name = expected.column_name;

    if actual_type is null then
      raise exception 'Unrecorded schema mismatch: %.% is missing', expected.table_name, expected.column_name;
    end if;
    if actual_type <> expected.udt_name then
      raise exception 'Unrecorded schema mismatch: %.% expected type %, found %',
        expected.table_name, expected.column_name, expected.udt_name, actual_type;
    end if;
  end loop;
end
$$;

create index if not exists api_football_fixture_events_fixture_idx on public.api_football_fixture_events(api_fixture_id);
create index if not exists api_football_fixture_events_team_idx on public.api_football_fixture_events(api_team_id);
create index if not exists api_football_fixture_events_type_idx on public.api_football_fixture_events(event_type);
create index if not exists api_football_fixture_events_elapsed_idx on public.api_football_fixture_events(elapsed);
create index if not exists api_football_injuries_fixture_idx on public.api_football_injuries(api_fixture_id);
create index if not exists api_football_injuries_team_idx on public.api_football_injuries(api_team_id);
create index if not exists api_football_injuries_player_idx on public.api_football_injuries(api_player_id);
create index if not exists api_football_injuries_fixture_date_idx on public.api_football_injuries(fixture_date);
create index if not exists api_football_enrichment_sync_log_started_idx on public.api_football_enrichment_sync_log(started_at desc);
create index if not exists api_football_top_players_league_idx on public.api_football_top_players(api_league_id, season, category);
create index if not exists api_football_daily_sync_runs_date_idx on public.api_football_daily_sync_runs(run_date desc);
create index if not exists api_football_daily_sync_runs_status_idx on public.api_football_daily_sync_runs(status);
create index if not exists api_football_daily_sync_steps_run_idx on public.api_football_daily_sync_steps(run_id, step_order);
create index if not exists api_football_daily_sync_steps_status_idx on public.api_football_daily_sync_steps(status);
create index if not exists api_football_daily_sync_steps_retry_idx on public.api_football_daily_sync_steps(run_id, status, next_retry_at);
create index if not exists football_ai_final_picks_fixture_idx on public.football_ai_final_picks(api_fixture_id);
create index if not exists football_ai_final_picks_signal_idx on public.football_ai_final_picks(signal);
create index if not exists football_match_odds_match_id_idx on public.football_match_odds(match_id);
create index if not exists football_match_odds_fixture_idx on public.football_match_odds(api_fixture_id);
create index if not exists football_match_odds_market_idx on public.football_match_odds(market_focus);
create index if not exists football_match_odds_latest_idx on public.football_match_odds(match_id, market_focus, is_latest);
create index if not exists football_matches_api_fixture_id_idx on public.football_matches(api_fixture_id);
create index if not exists football_matches_kickoff_at_result_idx on public.football_matches(kickoff_at);
create index if not exists football_matches_status_short_idx on public.football_matches(status_short);
create index if not exists football_matches_data_readiness_status_idx on public.football_matches(data_readiness_status);
create index if not exists football_matches_has_market_data_idx on public.football_matches(has_market_data);
create index if not exists football_ai_pick_results_match_id_idx on public.football_ai_pick_results(match_id);
create index if not exists football_ai_pick_results_fixture_idx on public.football_ai_pick_results(api_fixture_id);
create index if not exists football_ai_pick_results_selection_date_idx on public.football_ai_pick_results(selection_date);
create index if not exists football_ai_pick_results_settlement_status_idx on public.football_ai_pick_results(settlement_status);
create unique index if not exists football_ai_pick_results_match_selection_uidx on public.football_ai_pick_results(match_id, selection_date);
create unique index if not exists football_ai_pick_results_ai_final_pick_uidx on public.football_ai_pick_results(ai_final_pick_id);
create index if not exists match_analysis_analysis_status_idx on public.match_analysis(analysis_status);
create index if not exists match_analysis_market_data_used_idx on public.match_analysis(market_data_used);
create index if not exists football_ai_final_picks_analysis_status_idx on public.football_ai_final_picks(analysis_status);

do $$
declare
  trigger_contract record;
  trigger_definition text;
begin
  for trigger_contract in
    select *
    from (values
      ('api_football_league_coverage', 'api_football_league_coverage_set_updated_at'),
      ('api_football_fixture_statistics', 'api_football_fixture_statistics_set_updated_at'),
      ('api_football_fixture_lineups', 'api_football_fixture_lineups_set_updated_at'),
      ('api_football_fixture_players', 'api_football_fixture_players_set_updated_at'),
      ('api_football_injuries', 'api_football_injuries_set_updated_at'),
      ('api_football_squads', 'api_football_squads_set_updated_at'),
      ('api_football_coaches', 'api_football_coaches_set_updated_at'),
      ('api_football_venues', 'api_football_venues_set_updated_at'),
      ('api_football_top_players', 'api_football_top_players_set_updated_at'),
      ('api_football_rounds', 'api_football_rounds_set_updated_at'),
      ('api_football_daily_sync_runs', 'api_football_daily_sync_runs_set_updated_at'),
      ('api_football_daily_sync_steps', 'api_football_daily_sync_steps_set_updated_at'),
      ('football_ai_pick_results', 'football_ai_pick_results_set_updated_at')
    ) as contract(table_name, trigger_name)
  loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', trigger_contract.table_name)::regclass
        and tgname = trigger_contract.trigger_name
        and not tgisinternal
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        trigger_contract.trigger_name,
        trigger_contract.table_name
      );
    else
      select pg_get_triggerdef(oid)
        into trigger_definition
      from pg_trigger
      where tgrelid = format('public.%I', trigger_contract.table_name)::regclass
        and tgname = trigger_contract.trigger_name
        and not tgisinternal;

      if trigger_definition !~* 'BEFORE UPDATE'
        or trigger_definition !~* 'EXECUTE FUNCTION public\.set_updated_at\(\)'
      then
        raise exception 'Trigger % on % has a non-canonical definition',
          trigger_contract.trigger_name, trigger_contract.table_name;
      end if;
    end if;
  end loop;
end
$$;

alter table public.api_football_league_coverage enable row level security;
alter table public.api_football_fixture_statistics enable row level security;
alter table public.api_football_fixture_events enable row level security;
alter table public.api_football_fixture_lineups enable row level security;
alter table public.api_football_fixture_players enable row level security;
alter table public.api_football_injuries enable row level security;
alter table public.api_football_squads enable row level security;
alter table public.api_football_coaches enable row level security;
alter table public.api_football_venues enable row level security;
alter table public.api_football_top_players enable row level security;
alter table public.api_football_rounds enable row level security;
alter table public.api_football_enrichment_sync_log enable row level security;
alter table public.api_football_daily_sync_runs enable row level security;
alter table public.api_football_daily_sync_steps enable row level security;
alter table public.football_bookmakers enable row level security;
alter table public.football_match_odds enable row level security;
alter table public.football_ai_pick_results enable row level security;

do $$
declare
  policy_contract record;
  existing_command text;
  existing_qual text;
begin
  for policy_contract in
    select *
    from (values
      ('api_football_league_coverage', 'public read api football league coverage'),
      ('api_football_fixture_statistics', 'public read api football fixture statistics'),
      ('api_football_fixture_events', 'public read api football fixture events'),
      ('api_football_fixture_lineups', 'public read api football fixture lineups'),
      ('api_football_fixture_players', 'public read api football fixture players'),
      ('api_football_injuries', 'public read api football injuries'),
      ('api_football_squads', 'public read api football squads'),
      ('api_football_coaches', 'public read api football coaches'),
      ('api_football_venues', 'public read api football venues'),
      ('api_football_top_players', 'public read api football top players'),
      ('api_football_rounds', 'public read api football rounds'),
      ('api_football_enrichment_sync_log', 'public read api football enrichment sync log'),
      ('api_football_daily_sync_runs', 'public read api football daily sync runs'),
      ('api_football_daily_sync_steps', 'public read api football daily sync steps'),
      ('football_bookmakers', 'public read football_bookmakers'),
      ('football_match_odds', 'public read football_match_odds'),
      ('football_ai_pick_results', 'public read football_ai_pick_results')
    ) as contract(table_name, policy_name)
  loop
    select cmd, qual
      into existing_command, existing_qual
    from pg_policies
    where schemaname = 'public'
      and tablename = policy_contract.table_name
      and policyname = policy_contract.policy_name;

    if existing_command is null then
      execute format(
        'create policy %I on public.%I for select using (true)',
        policy_contract.policy_name,
        policy_contract.table_name
      );
    elsif existing_command <> 'SELECT' or existing_qual <> 'true' then
      raise exception 'Policy % on % has a non-canonical definition',
        policy_contract.policy_name, policy_contract.table_name;
    end if;
  end loop;
end
$$;

comment on table public.api_football_daily_sync_runs is
  'Canonical Market-Ready First daily pipeline state; result counts are dynamic.';
comment on table public.football_match_odds is
  'Provider market snapshots; canonical normalization and provenance fields are added by the core recovery migration.';
