alter table football_matches add column if not exists api_provider text;
alter table football_matches add column if not exists api_sports_fixture_id bigint;
alter table football_matches add column if not exists api_sports_league_id bigint;
alter table football_matches add column if not exists api_sports_home_team_id bigint;
alter table football_matches add column if not exists api_sports_away_team_id bigint;
alter table football_matches add column if not exists enrichment_status text default 'PENDING';
alter table football_matches add column if not exists enrichment_updated_at timestamptz;
alter table football_matches add column if not exists odds_updated_at timestamptz;
alter table football_matches add column if not exists stats_updated_at timestamptz;
alter table football_matches add column if not exists injuries_updated_at timestamptz;
alter table football_matches add column if not exists lineups_updated_at timestamptz;

alter table match_analysis add column if not exists market_edge_score numeric;
alter table match_analysis add column if not exists odds_confidence_score numeric;
alter table match_analysis add column if not exists odds_movement_score numeric;
alter table match_analysis add column if not exists team_stats_score numeric;
alter table match_analysis add column if not exists injuries_score numeric;
alter table match_analysis add column if not exists lineups_score numeric;
alter table match_analysis add column if not exists data_depth_score numeric;
alter table match_analysis add column if not exists learning_adjustment_score numeric;
alter table match_analysis add column if not exists calibrated_confidence_score numeric;
alter table match_analysis add column if not exists historical_accuracy_score numeric;
alter table match_analysis add column if not exists model_version text default 'v4';
alter table match_analysis add column if not exists value_side text;
alter table match_analysis add column if not exists value_market text;
alter table match_analysis add column if not exists value_line text;
alter table match_analysis add column if not exists opening_line text;
alter table match_analysis add column if not exists latest_line text;
alter table match_analysis add column if not exists opening_odds text;
alter table match_analysis add column if not exists latest_odds text;
alter table match_analysis add column if not exists odds_movement_summary text;
alter table match_analysis add column if not exists enriched_summary text;
alter table match_analysis add column if not exists learning_summary text;

create table if not exists football_odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references football_matches(id) on delete cascade,
  fixture_id bigint,
  bookmaker text,
  market text,
  selection text,
  line text,
  price numeric,
  odd_text text,
  is_opening boolean default false,
  is_latest boolean default true,
  snapshot_at timestamptz default now(),
  raw jsonb,
  created_at timestamptz default now()
);

create table if not exists football_team_statistics (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references football_matches(id) on delete cascade,
  fixture_id bigint,
  team_id bigint,
  team_name text,
  is_home boolean,
  shots_on_goal numeric,
  shots_off_goal numeric,
  total_shots numeric,
  blocked_shots numeric,
  shots_inside_box numeric,
  shots_outside_box numeric,
  fouls numeric,
  corner_kicks numeric,
  offsides numeric,
  ball_possession numeric,
  yellow_cards numeric,
  red_cards numeric,
  goalkeeper_saves numeric,
  total_passes numeric,
  passes_accurate numeric,
  passes_percent numeric,
  expected_goals numeric,
  raw jsonb,
  updated_at timestamptz default now()
);

create table if not exists football_injuries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references football_matches(id) on delete cascade,
  fixture_id bigint,
  team_id bigint,
  team_name text,
  player_id bigint,
  player_name text,
  player_type text,
  reason text,
  raw jsonb,
  updated_at timestamptz default now()
);

create table if not exists football_lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references football_matches(id) on delete cascade,
  fixture_id bigint,
  team_id bigint,
  team_name text,
  formation text,
  coach_name text,
  start_xi jsonb,
  substitutes jsonb,
  raw jsonb,
  updated_at timestamptz default now()
);

create table if not exists football_prediction_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references football_matches(id) on delete cascade,
  fixture_id bigint,
  match_date date,
  recommendation text,
  value_market text,
  value_side text,
  value_line text,
  confidence_score numeric,
  calibrated_confidence_score numeric,
  home_score integer,
  away_score integer,
  result_status text,
  prediction_result text,
  is_success boolean,
  profit_unit numeric,
  model_version text,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists football_odds_snapshots_match_id_idx on football_odds_snapshots(match_id);
create index if not exists football_odds_snapshots_fixture_id_idx on football_odds_snapshots(fixture_id);
create index if not exists football_odds_snapshots_market_idx on football_odds_snapshots(market);
create index if not exists football_team_statistics_match_id_idx on football_team_statistics(match_id);
create index if not exists football_injuries_match_id_idx on football_injuries(match_id);
create index if not exists football_lineups_match_id_idx on football_lineups(match_id);
create index if not exists football_prediction_results_match_id_idx on football_prediction_results(match_id);
create index if not exists football_prediction_results_match_date_idx on football_prediction_results(match_date);
create index if not exists football_prediction_results_recommendation_idx on football_prediction_results(recommendation);
create index if not exists football_prediction_results_model_version_idx on football_prediction_results(model_version);
create unique index if not exists football_prediction_results_match_model_uidx on football_prediction_results(match_id, model_version);
