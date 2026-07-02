alter table public.match_analysis
  add column if not exists analysis_status text,
  add column if not exists recommendation_reason text,
  add column if not exists market_data_used boolean default false,
  add column if not exists odds_rows_used integer default 0,
  add column if not exists recalculated_at timestamptz,
  add column if not exists analysis_version text;

alter table public.football_ai_final_picks
  add column if not exists analysis_status text,
  add column if not exists recommendation_reason text,
  add column if not exists market_data_used boolean default false,
  add column if not exists odds_rows_used integer default 0,
  add column if not exists recalculated_at timestamptz,
  add column if not exists analysis_version text;

create index if not exists match_analysis_analysis_status_idx on public.match_analysis(analysis_status);
create index if not exists match_analysis_market_data_used_idx on public.match_analysis(market_data_used);
create index if not exists football_ai_final_picks_analysis_status_idx on public.football_ai_final_picks(analysis_status);
