create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
  constraint daily_top10_selections_rank_range check (rank between 1 and 10),
  constraint daily_top10_selections_signal_valid check (signal is null or signal in ('STRONG_SIGNAL', 'WATCH', 'SKIP')),
  constraint daily_top10_selections_market_focus_valid check (market_focus is null or market_focus in ('AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE')),
  constraint daily_top10_selections_risk_level_valid check (risk_level is null or risk_level in ('LOW', 'MEDIUM', 'HIGH'))
);

create index if not exists daily_top10_selections_date_idx on public.daily_top10_selections(selection_date);
create index if not exists daily_top10_selections_match_idx on public.daily_top10_selections(match_id);
create index if not exists daily_top10_selections_fixture_idx on public.daily_top10_selections(api_fixture_id);
create index if not exists daily_top10_selections_rank_idx on public.daily_top10_selections(rank);

drop trigger if exists daily_top10_selections_set_updated_at on public.daily_top10_selections;
create trigger daily_top10_selections_set_updated_at
before update on public.daily_top10_selections
for each row execute function public.set_updated_at();

alter table public.daily_top10_selections enable row level security;

drop policy if exists "public read daily_top10_selections" on public.daily_top10_selections;
create policy "public read daily_top10_selections"
on public.daily_top10_selections
for select
using (true);
