create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists football_leagues (
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

create table if not exists football_teams (
  id uuid primary key default gen_random_uuid(),
  api_team_id integer unique,
  name text not null,
  logo text,
  country text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists football_matches (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id integer unique,
  league_id uuid references football_leagues(id) on delete set null,
  home_team_id uuid references football_teams(id) on delete set null,
  away_team_id uuid references football_teams(id) on delete set null,
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

create table if not exists team_recent_form (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references football_teams(id) on delete cascade,
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

create table if not exists team_statistics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references football_teams(id) on delete cascade,
  league_id uuid references football_leagues(id) on delete cascade,
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

create table if not exists match_analysis (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references football_matches(id) on delete cascade unique,
  team_strength_score numeric default 0,
  form_score numeric default 0,
  goal_quality_score numeric default 0,
  tactical_score numeric default 0,
  home_away_score numeric default 0,
  motivation_score numeric default 0,
  market_context_score numeric default 0,
  risk_score numeric default 0,
  confidence_score numeric default 0,
  recommendation text,
  risk_level text,
  thai_reason text,
  raw jsonb,
  updated_at timestamptz default now()
);

create table if not exists sync_logs (
  id uuid primary key default gen_random_uuid(),
  sync_type text,
  status text,
  message text,
  started_at timestamptz default now(),
  finished_at timestamptz,
  raw jsonb
);

drop trigger if exists football_leagues_set_updated_at on football_leagues;
create trigger football_leagues_set_updated_at
before update on football_leagues
for each row execute function set_updated_at();

drop trigger if exists football_teams_set_updated_at on football_teams;
create trigger football_teams_set_updated_at
before update on football_teams
for each row execute function set_updated_at();

drop trigger if exists football_matches_set_updated_at on football_matches;
create trigger football_matches_set_updated_at
before update on football_matches
for each row execute function set_updated_at();

create index if not exists football_matches_kickoff_at_idx on football_matches(kickoff_at);
create index if not exists football_matches_status_idx on football_matches(status);
create index if not exists football_leagues_enabled_priority_idx on football_leagues(enabled, priority);
create index if not exists match_analysis_confidence_idx on match_analysis(confidence_score desc);
create index if not exists sync_logs_started_at_idx on sync_logs(started_at desc);

alter table football_leagues enable row level security;
alter table football_teams enable row level security;
alter table football_matches enable row level security;
alter table team_recent_form enable row level security;
alter table team_statistics enable row level security;
alter table match_analysis enable row level security;
alter table sync_logs enable row level security;

create policy "public read football_leagues" on football_leagues for select using (true);
create policy "public read football_teams" on football_teams for select using (true);
create policy "public read football_matches" on football_matches for select using (true);
create policy "public read team_recent_form" on team_recent_form for select using (true);
create policy "public read team_statistics" on team_statistics for select using (true);
create policy "public read match_analysis" on match_analysis for select using (true);
create policy "public read sync_logs" on sync_logs for select using (true);

create policy "anon update league controls" on football_leagues
for update using (true)
with check (true);
