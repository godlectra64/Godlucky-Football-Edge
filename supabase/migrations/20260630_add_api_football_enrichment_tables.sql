create extension if not exists pgcrypto;

create table if not exists api_football_league_coverage (
  id uuid primary key default gen_random_uuid(),
  api_league_id bigint not null,
  season int not null,
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

create table if not exists api_football_fixture_statistics (
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

create table if not exists api_football_fixture_events (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint not null,
  api_team_id bigint,
  team_name text,
  api_player_id bigint,
  player_name text,
  api_assist_player_id bigint,
  assist_player_name text,
  elapsed int,
  extra int,
  event_type text,
  event_detail text,
  comments text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists api_football_fixture_lineups (
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

create table if not exists api_football_fixture_players (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint not null,
  api_team_id bigint not null,
  team_name text,
  api_player_id bigint not null,
  player_name text,
  player_photo text,
  minutes int,
  number int,
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

create table if not exists api_football_injuries (
  id uuid primary key default gen_random_uuid(),
  api_fixture_id bigint,
  api_league_id bigint,
  season int,
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

create table if not exists api_football_squads (
  id uuid primary key default gen_random_uuid(),
  api_team_id bigint not null,
  team_name text,
  api_player_id bigint not null,
  player_name text,
  age int,
  number int,
  position text,
  photo text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_team_id, api_player_id)
);

create table if not exists api_football_coaches (
  id uuid primary key default gen_random_uuid(),
  api_coach_id bigint not null,
  api_team_id bigint,
  coach_name text,
  firstname text,
  lastname text,
  age int,
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

create table if not exists api_football_venues (
  id uuid primary key default gen_random_uuid(),
  api_venue_id bigint not null,
  venue_name text,
  address text,
  city text,
  country text,
  capacity int,
  surface text,
  image text,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_venue_id)
);

create table if not exists api_football_top_players (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  api_league_id bigint not null,
  season int not null,
  rank int,
  api_team_id bigint,
  team_name text,
  team_logo text,
  api_player_id bigint not null,
  player_name text,
  player_photo text,
  nationality text,
  age int,
  position text,
  goals_total numeric,
  assists numeric,
  yellow_cards numeric,
  red_cards numeric,
  appearances int,
  minutes int,
  rating numeric,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint api_football_top_players_category_check check (category in ('top_scorers', 'top_assists', 'top_yellow_cards', 'top_red_cards')),
  unique(category, api_league_id, season, api_player_id)
);

create table if not exists api_football_rounds (
  id uuid primary key default gen_random_uuid(),
  api_league_id bigint not null,
  season int not null,
  round_name text not null,
  is_current boolean default false,
  round_order int,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(api_league_id, season, round_name)
);

create table if not exists api_football_enrichment_sync_log (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  api_fixture_id bigint,
  api_league_id bigint,
  api_team_id bigint,
  season int,
  endpoint text not null,
  status text not null,
  results_count int default 0,
  error_message text,
  started_at timestamptz default now(),
  finished_at timestamptz,
  created_at timestamptz default now(),
  constraint api_football_enrichment_sync_log_status_check check (status in ('success', 'empty', 'skipped_no_coverage', 'skipped_not_due', 'error'))
);

create index if not exists api_football_fixture_events_fixture_idx on api_football_fixture_events(api_fixture_id);
create index if not exists api_football_fixture_events_team_idx on api_football_fixture_events(api_team_id);
create index if not exists api_football_fixture_events_type_idx on api_football_fixture_events(event_type);
create index if not exists api_football_fixture_events_elapsed_idx on api_football_fixture_events(elapsed);
create index if not exists api_football_injuries_fixture_idx on api_football_injuries(api_fixture_id);
create index if not exists api_football_injuries_team_idx on api_football_injuries(api_team_id);
create index if not exists api_football_injuries_player_idx on api_football_injuries(api_player_id);
create index if not exists api_football_injuries_fixture_date_idx on api_football_injuries(fixture_date);
create index if not exists api_football_enrichment_sync_log_started_idx on api_football_enrichment_sync_log(started_at desc);
create index if not exists api_football_top_players_league_idx on api_football_top_players(api_league_id, season, category);

drop trigger if exists api_football_league_coverage_set_updated_at on api_football_league_coverage;
create trigger api_football_league_coverage_set_updated_at before update on api_football_league_coverage for each row execute function set_updated_at();
drop trigger if exists api_football_fixture_statistics_set_updated_at on api_football_fixture_statistics;
create trigger api_football_fixture_statistics_set_updated_at before update on api_football_fixture_statistics for each row execute function set_updated_at();
drop trigger if exists api_football_fixture_lineups_set_updated_at on api_football_fixture_lineups;
create trigger api_football_fixture_lineups_set_updated_at before update on api_football_fixture_lineups for each row execute function set_updated_at();
drop trigger if exists api_football_fixture_players_set_updated_at on api_football_fixture_players;
create trigger api_football_fixture_players_set_updated_at before update on api_football_fixture_players for each row execute function set_updated_at();
drop trigger if exists api_football_injuries_set_updated_at on api_football_injuries;
create trigger api_football_injuries_set_updated_at before update on api_football_injuries for each row execute function set_updated_at();
drop trigger if exists api_football_squads_set_updated_at on api_football_squads;
create trigger api_football_squads_set_updated_at before update on api_football_squads for each row execute function set_updated_at();
drop trigger if exists api_football_coaches_set_updated_at on api_football_coaches;
create trigger api_football_coaches_set_updated_at before update on api_football_coaches for each row execute function set_updated_at();
drop trigger if exists api_football_venues_set_updated_at on api_football_venues;
create trigger api_football_venues_set_updated_at before update on api_football_venues for each row execute function set_updated_at();
drop trigger if exists api_football_top_players_set_updated_at on api_football_top_players;
create trigger api_football_top_players_set_updated_at before update on api_football_top_players for each row execute function set_updated_at();
drop trigger if exists api_football_rounds_set_updated_at on api_football_rounds;
create trigger api_football_rounds_set_updated_at before update on api_football_rounds for each row execute function set_updated_at();

alter table api_football_league_coverage enable row level security;
alter table api_football_fixture_statistics enable row level security;
alter table api_football_fixture_events enable row level security;
alter table api_football_fixture_lineups enable row level security;
alter table api_football_fixture_players enable row level security;
alter table api_football_injuries enable row level security;
alter table api_football_squads enable row level security;
alter table api_football_coaches enable row level security;
alter table api_football_venues enable row level security;
alter table api_football_top_players enable row level security;
alter table api_football_rounds enable row level security;
alter table api_football_enrichment_sync_log enable row level security;

create policy "public read api football league coverage" on api_football_league_coverage for select using (true);
create policy "public read api football fixture statistics" on api_football_fixture_statistics for select using (true);
create policy "public read api football fixture events" on api_football_fixture_events for select using (true);
create policy "public read api football fixture lineups" on api_football_fixture_lineups for select using (true);
create policy "public read api football fixture players" on api_football_fixture_players for select using (true);
create policy "public read api football injuries" on api_football_injuries for select using (true);
create policy "public read api football squads" on api_football_squads for select using (true);
create policy "public read api football coaches" on api_football_coaches for select using (true);
create policy "public read api football venues" on api_football_venues for select using (true);
create policy "public read api football top players" on api_football_top_players for select using (true);
create policy "public read api football rounds" on api_football_rounds for select using (true);
create policy "public read api football enrichment sync log" on api_football_enrichment_sync_log for select using (true);
