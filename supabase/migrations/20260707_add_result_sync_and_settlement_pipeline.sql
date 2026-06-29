create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.football_matches add column if not exists status_short text;
alter table public.football_matches add column if not exists status_long text;
alter table public.football_matches add column if not exists match_status text;
alter table public.football_matches add column if not exists elapsed integer;
alter table public.football_matches add column if not exists home_score integer;
alter table public.football_matches add column if not exists away_score integer;
alter table public.football_matches add column if not exists halftime_home_score integer;
alter table public.football_matches add column if not exists halftime_away_score integer;
alter table public.football_matches add column if not exists fulltime_home_score integer;
alter table public.football_matches add column if not exists fulltime_away_score integer;
alter table public.football_matches add column if not exists extra_home_score integer;
alter table public.football_matches add column if not exists extra_away_score integer;
alter table public.football_matches add column if not exists penalty_home_score integer;
alter table public.football_matches add column if not exists penalty_away_score integer;
alter table public.football_matches add column if not exists finished_at timestamptz;
alter table public.football_matches add column if not exists score_synced_at timestamptz;
alter table public.football_matches add column if not exists api_fixture_last_checked_at timestamptz;
alter table public.football_matches add column if not exists api_fixture_payload jsonb;

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
  constraint football_ai_pick_results_settlement_status_valid check (settlement_status in ('PENDING', 'SETTLED', 'VOID')),
  constraint football_ai_pick_results_simulation_outcome_valid check (simulation_outcome in ('HIT', 'MISS', 'PUSH', 'PENDING', 'VOID'))
);

alter table public.football_ai_pick_results add column if not exists selection_date date;
alter table public.football_ai_pick_results add column if not exists match_id uuid references public.football_matches(id) on delete cascade;
alter table public.football_ai_pick_results add column if not exists api_fixture_id bigint;
alter table public.football_ai_pick_results add column if not exists ai_final_pick_id uuid references public.football_ai_final_picks(id) on delete set null;
alter table public.football_ai_pick_results add column if not exists signal text;
alter table public.football_ai_pick_results add column if not exists market_focus text;
alter table public.football_ai_pick_results add column if not exists direction text;
alter table public.football_ai_pick_results add column if not exists confidence_score numeric;
alter table public.football_ai_pick_results add column if not exists risk_level text;
alter table public.football_ai_pick_results add column if not exists home_score integer;
alter table public.football_ai_pick_results add column if not exists away_score integer;
alter table public.football_ai_pick_results add column if not exists status_short text;
alter table public.football_ai_pick_results add column if not exists status_long text;
alter table public.football_ai_pick_results add column if not exists settlement_status text default 'PENDING';
alter table public.football_ai_pick_results add column if not exists simulation_outcome text default 'PENDING';
alter table public.football_ai_pick_results add column if not exists settlement_reason text;
alter table public.football_ai_pick_results add column if not exists settled_at timestamptz;
alter table public.football_ai_pick_results add column if not exists created_at timestamptz default now();
alter table public.football_ai_pick_results add column if not exists updated_at timestamptz default now();

create index if not exists football_matches_api_fixture_id_idx on public.football_matches(api_fixture_id);
create index if not exists football_matches_kickoff_at_result_idx on public.football_matches(kickoff_at);
create index if not exists football_matches_status_short_idx on public.football_matches(status_short);
create index if not exists football_ai_pick_results_match_id_idx on public.football_ai_pick_results(match_id);
create index if not exists football_ai_pick_results_fixture_idx on public.football_ai_pick_results(api_fixture_id);
create index if not exists football_ai_pick_results_selection_date_idx on public.football_ai_pick_results(selection_date);
create index if not exists football_ai_pick_results_settlement_status_idx on public.football_ai_pick_results(settlement_status);
create unique index if not exists football_ai_pick_results_ai_final_pick_uidx
on public.football_ai_pick_results(ai_final_pick_id)
where ai_final_pick_id is not null;
create unique index if not exists football_ai_pick_results_match_date_uidx
on public.football_ai_pick_results(match_id, selection_date)
where match_id is not null and selection_date is not null;

drop trigger if exists football_ai_pick_results_set_updated_at on public.football_ai_pick_results;
create trigger football_ai_pick_results_set_updated_at
before update on public.football_ai_pick_results
for each row execute function public.set_updated_at();

alter table public.football_ai_pick_results enable row level security;

drop policy if exists "public read football_ai_pick_results" on public.football_ai_pick_results;
create policy "public read football_ai_pick_results"
on public.football_ai_pick_results
for select
using (true);
