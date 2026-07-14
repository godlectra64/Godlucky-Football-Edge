-- Canonical clean-clone baseline for the football application.
-- This migration is intentionally schema-only and idempotent on the existing
-- Production schema. It contains no scheduler, data repair, or fixed-count rule.

create extension if not exists pgcrypto;

do $$
declare
  function_definition text;
begin
  if to_regprocedure('public.set_updated_at()') is null then
    execute $create_function$
      create function public.set_updated_at()
      returns trigger
      language plpgsql
      as $function$
      begin
        new.updated_at = now();
        return new;
      end;
      $function$
    $create_function$;
  else
    select pg_get_functiondef('public.set_updated_at()'::regprocedure)
      into function_definition;

    if function_definition !~* 'returns[[:space:]]+trigger'
      or function_definition !~* 'new\.updated_at[[:space:]]*:=[[:space:]]*now\(\)'
    then
      raise exception 'public.set_updated_at() exists with a non-canonical definition';
    end if;
  end if;
end
$$;

create table if not exists public.football_leagues (
  id uuid primary key default gen_random_uuid(),
  api_league_id integer unique,
  name text not null,
  country text,
  logo text,
  enabled boolean default true,
  priority integer default 50,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.football_teams (
  id uuid primary key default gen_random_uuid(),
  api_team_id integer unique,
  name text not null,
  logo text,
  country text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.football_matches (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id integer unique,
  league_id uuid references public.football_leagues(id) on delete set null,
  home_team_id uuid references public.football_teams(id) on delete set null,
  away_team_id uuid references public.football_teams(id) on delete set null,
  kickoff_at timestamptz,
  status text,
  venue text,
  round text,
  home_goals integer,
  away_goals integer,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.team_recent_form (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.football_teams(id) on delete cascade,
  form_window integer default 5,
  wins integer default 0,
  draws integer default 0,
  losses integer default 0,
  goals_for integer default 0,
  goals_against integer default 0,
  clean_sheets integer default 0,
  failed_to_score integer default 0,
  raw jsonb,
  updated_at timestamptz default now(),
  unique(team_id, form_window)
);

create table if not exists public.team_statistics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.football_teams(id) on delete cascade,
  league_id uuid references public.football_leagues(id) on delete cascade,
  season integer,
  played integer default 0,
  wins integer default 0,
  draws integer default 0,
  losses integer default 0,
  goals_for integer default 0,
  goals_against integer default 0,
  home_strength numeric default 0,
  away_strength numeric default 0,
  raw jsonb,
  updated_at timestamptz default now(),
  unique(team_id, league_id, season)
);

create table if not exists public.match_analysis (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.football_matches(id) on delete cascade unique,
  team_strength_score numeric default 0,
  form_score numeric default 0,
  home_advantage_score numeric default 0,
  away_weakness_score numeric default 0,
  goal_scoring_score numeric default 0,
  defensive_stability_score numeric default 0,
  goal_quality_score numeric default 0,
  tactical_score numeric default 0,
  home_away_score numeric default 0,
  motivation_score numeric default 0,
  market_context_score numeric default 0,
  market_risk_score numeric default 0,
  risk_score numeric default 0,
  confidence_score numeric default 0,
  recommendation text,
  risk_level text,
  analysis_summary text,
  thai_reason text,
  raw jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  sync_type text,
  status text,
  message text,
  started_at timestamptz default now(),
  finished_at timestamptz,
  raw jsonb
);

-- Prerequisite for the historical 20260710 migration. The full current
-- contract is completed by 20260715000000_reconcile_unrecorded_schema.sql.
create table if not exists public.football_ai_final_picks (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.football_matches(id) on delete cascade,
  api_fixture_id bigint,
  signal text not null,
  market_focus text not null,
  direction text,
  confidence_score numeric,
  risk_level text not null,
  key_reasons jsonb default '[]'::jsonb,
  warning_signs jsonb default '[]'::jsonb,
  market_signal text,
  final_summary text,
  ah_analysis jsonb default '{}'::jsonb,
  ou_analysis jsonb default '{}'::jsonb,
  primary_bookmaker text,
  latest_odds text,
  raw jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint football_ai_final_picks_signal_valid
    check (signal in ('STRONG_SIGNAL', 'WATCH', 'SKIP')),
  constraint football_ai_final_picks_market_focus_valid
    check (market_focus in ('AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE')),
  constraint football_ai_final_picks_risk_level_valid
    check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  constraint football_ai_final_picks_confidence_range
    check (confidence_score is null or confidence_score between 0 and 100)
);

-- Legacy table name retained only as a dynamic-count compatibility adapter.
-- There is deliberately no minimum/maximum result count and no rank <= 10 rule.
create table if not exists public.daily_top10_selections (
  id uuid primary key default gen_random_uuid(),
  selection_date date not null,
  match_id uuid not null references public.football_matches(id) on delete cascade,
  api_fixture_id integer,
  rank integer not null,
  selection_score numeric,
  ai_final_pick_id uuid references public.football_ai_final_picks(id) on delete set null,
  signal text,
  market_focus text,
  confidence_score numeric,
  risk_level text,
  locked_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint daily_top10_selections_unique_match unique (selection_date, match_id),
  constraint daily_top10_selections_unique_rank unique (selection_date, rank),
  constraint daily_top10_selections_rank_positive check (rank > 0),
  constraint daily_top10_selections_signal_valid
    check (signal is null or signal in ('STRONG_SIGNAL', 'WATCH', 'SKIP')),
  constraint daily_top10_selections_market_focus_valid
    check (market_focus is null or market_focus in ('AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE')),
  constraint daily_top10_selections_risk_level_valid
    check (risk_level is null or risk_level in ('LOW', 'MEDIUM', 'HIGH'))
);

do $$
declare
  expected record;
  actual_type text;
begin
  for expected in
    select *
    from (values
      ('football_leagues', 'id', 'uuid'),
      ('football_leagues', 'api_league_id', 'int4'),
      ('football_teams', 'id', 'uuid'),
      ('football_teams', 'api_team_id', 'int4'),
      ('football_matches', 'id', 'uuid'),
      ('football_matches', 'api_fixture_id', 'int4'),
      ('football_matches', 'kickoff_at', 'timestamptz'),
      ('match_analysis', 'id', 'uuid'),
      ('match_analysis', 'match_id', 'uuid'),
      ('match_analysis', 'raw', 'jsonb'),
      ('football_ai_final_picks', 'id', 'uuid'),
      ('football_ai_final_picks', 'match_id', 'uuid'),
      ('football_ai_final_picks', 'api_fixture_id', 'int8'),
      ('daily_top10_selections', 'id', 'uuid'),
      ('daily_top10_selections', 'selection_date', 'date'),
      ('daily_top10_selections', 'match_id', 'uuid'),
      ('daily_top10_selections', 'rank', 'int4')
    ) as contract(table_name, column_name, udt_name)
  loop
    select columns.udt_name
      into actual_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = expected.table_name
      and column_name = expected.column_name;

    if actual_type is null then
      raise exception 'Canonical base mismatch: %.% is missing',
        expected.table_name, expected.column_name;
    end if;
    if actual_type <> expected.udt_name then
      raise exception 'Canonical base mismatch: %.% expected type %, found %',
        expected.table_name, expected.column_name, expected.udt_name, actual_type;
    end if;
  end loop;
end
$$;

create unique index if not exists football_ai_final_picks_match_id_uidx
  on public.football_ai_final_picks(match_id);
create index if not exists football_matches_kickoff_at_idx
  on public.football_matches(kickoff_at);
create index if not exists football_matches_status_idx
  on public.football_matches(status);
create index if not exists football_leagues_enabled_priority_idx
  on public.football_leagues(enabled, priority);
create index if not exists match_analysis_confidence_idx
  on public.match_analysis(confidence_score desc);
create index if not exists sync_logs_started_at_idx
  on public.sync_logs(started_at desc);
create index if not exists daily_top10_selections_date_idx
  on public.daily_top10_selections(selection_date);
create index if not exists daily_top10_selections_match_idx
  on public.daily_top10_selections(match_id);
create index if not exists daily_top10_selections_fixture_idx
  on public.daily_top10_selections(api_fixture_id);
create index if not exists daily_top10_selections_rank_idx
  on public.daily_top10_selections(rank);

do $$
declare
  trigger_contract record;
  trigger_definition text;
begin
  for trigger_contract in
    select *
    from (values
      ('football_leagues', 'football_leagues_set_updated_at'),
      ('football_teams', 'football_teams_set_updated_at'),
      ('football_matches', 'football_matches_set_updated_at'),
      ('daily_top10_selections', 'daily_top10_selections_set_updated_at')
    ) as contract(table_name, trigger_name)
  loop
    if not exists (
      select 1
      from pg_trigger
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

alter table public.football_leagues enable row level security;
alter table public.football_teams enable row level security;
alter table public.football_matches enable row level security;
alter table public.team_recent_form enable row level security;
alter table public.team_statistics enable row level security;
alter table public.match_analysis enable row level security;
alter table public.sync_logs enable row level security;
alter table public.football_ai_final_picks enable row level security;
alter table public.daily_top10_selections enable row level security;

do $$
declare
  policy_contract record;
  existing_command text;
  existing_qual text;
begin
  for policy_contract in
    select *
    from (values
      ('football_leagues', 'public read football_leagues'),
      ('football_teams', 'public read football_teams'),
      ('football_matches', 'public read football_matches'),
      ('team_recent_form', 'public read team_recent_form'),
      ('team_statistics', 'public read team_statistics'),
      ('match_analysis', 'public read match_analysis'),
      ('sync_logs', 'public read sync_logs'),
      ('football_ai_final_picks', 'public read football_ai_final_picks'),
      ('daily_top10_selections', 'public read daily_top10_selections')
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

  select cmd, qual
    into existing_command, existing_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'football_leagues'
    and policyname = 'anon update league controls';

  if existing_command is null then
    create policy "anon update league controls"
      on public.football_leagues
      for update
      using (true)
      with check (true);
  elsif existing_command <> 'UPDATE' or existing_qual <> 'true' then
    raise exception 'Policy anon update league controls has a non-canonical definition';
  end if;
end
$$;

comment on table public.daily_top10_selections is
  'Legacy compatibility adapter only; canonical Market-Ready First decisions are dynamic and not count-limited.';
comment on table public.football_ai_final_picks is
  'Canonical actionable final-pick persistence; only READY decisions may expose an actionable pick.';
