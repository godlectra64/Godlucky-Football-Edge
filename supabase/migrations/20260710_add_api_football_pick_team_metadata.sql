alter table public.match_analysis
  add column if not exists pick_team text,
  add column if not exists pick_team_id bigint,
  add column if not exists pick_side text,
  add column if not exists pick_source text,
  add column if not exists pick_market text,
  add column if not exists pick_market_id text,
  add column if not exists pick_selection text,
  add column if not exists pick_price numeric,
  add column if not exists pick_confidence numeric;

alter table public.football_ai_final_picks
  add column if not exists pick_team text,
  add column if not exists pick_team_id bigint,
  add column if not exists pick_side text,
  add column if not exists pick_source text,
  add column if not exists pick_market text,
  add column if not exists pick_market_id text,
  add column if not exists pick_selection text,
  add column if not exists pick_price numeric,
  add column if not exists pick_confidence numeric;

alter table public.daily_top10_selections
  add column if not exists pick_team text,
  add column if not exists pick_team_id bigint,
  add column if not exists pick_side text,
  add column if not exists pick_source text,
  add column if not exists pick_market text,
  add column if not exists pick_market_id text,
  add column if not exists pick_selection text,
  add column if not exists pick_price numeric,
  add column if not exists pick_confidence numeric,
  add column if not exists market_data_used boolean default false,
  add column if not exists analysis_status text;

create index if not exists match_analysis_pick_source_idx on public.match_analysis(pick_source);
create index if not exists football_ai_final_picks_pick_source_idx on public.football_ai_final_picks(pick_source);
create index if not exists daily_top10_selections_pick_source_idx on public.daily_top10_selections(pick_source);
