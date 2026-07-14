create table if not exists public.football_bookmakers (
  id uuid primary key default gen_random_uuid(),
  api_bookmaker_id bigint not null,
  name text not null,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (api_bookmaker_id)
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
  constraint football_match_odds_market_focus_valid check (market_focus in ('AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE'))
);

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
  constraint football_ai_final_picks_signal_valid check (signal in ('STRONG_SIGNAL', 'WATCH', 'SKIP')),
  constraint football_ai_final_picks_market_focus_valid check (market_focus in ('AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE')),
  constraint football_ai_final_picks_risk_level_valid check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  constraint football_ai_final_picks_confidence_range check (confidence_score is null or confidence_score between 0 and 100)
);

create unique index if not exists football_ai_final_picks_match_id_uidx on public.football_ai_final_picks(match_id);
create index if not exists football_ai_final_picks_fixture_idx on public.football_ai_final_picks(api_fixture_id);
create index if not exists football_ai_final_picks_signal_idx on public.football_ai_final_picks(signal);
create index if not exists football_match_odds_match_id_idx on public.football_match_odds(match_id);
create index if not exists football_match_odds_fixture_idx on public.football_match_odds(api_fixture_id);
create index if not exists football_match_odds_market_idx on public.football_match_odds(market_focus);
create index if not exists football_match_odds_latest_idx on public.football_match_odds(match_id, market_focus, is_latest);

alter table public.football_bookmakers enable row level security;
alter table public.football_match_odds enable row level security;
alter table public.football_ai_final_picks enable row level security;

drop policy if exists "public read football_bookmakers" on public.football_bookmakers;
drop policy if exists "public read football_match_odds" on public.football_match_odds;
drop policy if exists "public read football_ai_final_picks" on public.football_ai_final_picks;

create policy "public read football_bookmakers" on public.football_bookmakers for select using (true);
create policy "public read football_match_odds" on public.football_match_odds for select using (true);
create policy "public read football_ai_final_picks" on public.football_ai_final_picks for select using (true);
