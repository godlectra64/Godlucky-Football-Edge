create table if not exists public.daily_market_candidates (
  id uuid primary key default gen_random_uuid(),
  selection_date date not null,
  match_id uuid not null references public.football_matches(id) on delete cascade,
  api_fixture_id bigint,
  candidate_rank integer not null,
  pre_selection_score numeric,
  market_readiness_status text not null default 'WAITING_MARKET',
  market_readiness_score numeric default 0,
  has_usable_ah boolean not null default false,
  has_usable_ou boolean not null default false,
  has_usable_match_winner boolean not null default false,
  odds_rows_count integer not null default 0,
  odds_synced_at timestamptz,
  odds_sync_status text,
  excluded_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint daily_market_candidates_unique_match unique (selection_date, match_id),
  constraint daily_market_candidates_unique_rank unique (selection_date, candidate_rank),
  constraint daily_market_candidates_rank_positive check (candidate_rank > 0),
  constraint daily_market_candidates_readiness_valid check (market_readiness_status in ('READY', 'PARTIAL', 'WAITING_MARKET', 'NO_MARKET_DATA')),
  constraint daily_market_candidates_odds_sync_status_valid check (odds_sync_status is null or odds_sync_status in ('PENDING', 'READY', 'PARTIAL', 'NO_MARKET_DATA', 'FAILED', 'SKIPPED_ALREADY_READY'))
);

create index if not exists daily_market_candidates_date_idx on public.daily_market_candidates(selection_date);
create index if not exists daily_market_candidates_fixture_idx on public.daily_market_candidates(api_fixture_id);
create index if not exists daily_market_candidates_readiness_idx on public.daily_market_candidates(selection_date, market_readiness_status, candidate_rank);

drop trigger if exists daily_market_candidates_set_updated_at on public.daily_market_candidates;
create trigger daily_market_candidates_set_updated_at
before update on public.daily_market_candidates
for each row execute function public.set_updated_at();

alter table public.daily_market_candidates enable row level security;

drop policy if exists "public read daily_market_candidates" on public.daily_market_candidates;
create policy "public read daily_market_candidates"
on public.daily_market_candidates
for select
using (true);
