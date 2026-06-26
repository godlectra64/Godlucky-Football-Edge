create table if not exists ai_prediction_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references football_matches(id) on delete cascade,
  fixture_id text not null,
  home_team text,
  away_team text,
  league text,
  kickoff timestamptz,
  recommendation text,
  confidence_score numeric,
  ranking_score numeric,
  risk_level text,
  analysis_version text not null default 'unknown',
  predicted_outcome text,
  raw jsonb,
  created_at timestamptz default now(),
  unique(match_id, analysis_version)
);

create table if not exists ai_prediction_results (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references ai_prediction_snapshots(id) on delete cascade unique,
  match_id uuid references football_matches(id) on delete cascade,
  status text not null default 'pending',
  home_goals integer,
  away_goals integer,
  result text,
  finished_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists ai_prediction_evaluations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references ai_prediction_snapshots(id) on delete cascade unique,
  match_id uuid references football_matches(id) on delete cascade,
  evaluation_status text not null default 'pending',
  evaluation_reason text,
  evaluated_at timestamptz,
  raw jsonb,
  updated_at timestamptz default now()
);

drop trigger if exists ai_prediction_results_set_updated_at on ai_prediction_results;
create trigger ai_prediction_results_set_updated_at
before update on ai_prediction_results
for each row execute function set_updated_at();

drop trigger if exists ai_prediction_evaluations_set_updated_at on ai_prediction_evaluations;
create trigger ai_prediction_evaluations_set_updated_at
before update on ai_prediction_evaluations
for each row execute function set_updated_at();

create index if not exists ai_prediction_snapshots_match_idx on ai_prediction_snapshots(match_id);
create index if not exists ai_prediction_snapshots_created_at_idx on ai_prediction_snapshots(created_at desc);
create index if not exists ai_prediction_snapshots_league_idx on ai_prediction_snapshots(league);
create index if not exists ai_prediction_snapshots_recommendation_idx on ai_prediction_snapshots(recommendation);
create index if not exists ai_prediction_snapshots_version_idx on ai_prediction_snapshots(analysis_version);
create index if not exists ai_prediction_results_status_idx on ai_prediction_results(status);
create index if not exists ai_prediction_evaluations_status_idx on ai_prediction_evaluations(evaluation_status);

alter table ai_prediction_snapshots enable row level security;
alter table ai_prediction_results enable row level security;
alter table ai_prediction_evaluations enable row level security;

create policy "public read ai_prediction_snapshots" on ai_prediction_snapshots for select using (true);
create policy "public read ai_prediction_results" on ai_prediction_results for select using (true);
create policy "public read ai_prediction_evaluations" on ai_prediction_evaluations for select using (true);
