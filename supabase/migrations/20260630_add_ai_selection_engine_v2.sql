alter table public.match_analysis
  add column if not exists data_validation_status text,
  add column if not exists data_validation_notes text,
  add column if not exists league_quality_score numeric,
  add column if not exists match_quality_score numeric,
  add column if not exists tactical_matchup_score numeric,
  add column if not exists market_reading_score numeric,
  add column if not exists edge_score numeric,
  add column if not exists ai_score numeric,
  add column if not exists ranking_score numeric,
  add column if not exists final_rank integer,
  add column if not exists recommendation_tier text,
  add column if not exists final_pick_note text,
  add column if not exists is_top_pick boolean default false,
  add column if not exists is_final_pick boolean default false;

alter table public.match_analysis
  add column if not exists team_strength_score numeric,
  add column if not exists form_score numeric,
  add column if not exists goal_scoring_score numeric,
  add column if not exists defensive_stability_score numeric,
  add column if not exists motivation_score numeric,
  add column if not exists home_away_score numeric,
  add column if not exists risk_score numeric,
  add column if not exists confidence_score numeric,
  add column if not exists recommendation text,
  add column if not exists analysis_summary text;

alter table public.match_analysis
  drop constraint if exists match_analysis_recommendation_valid;

alter table public.match_analysis
  add constraint match_analysis_recommendation_valid
  check (recommendation is null or recommendation in ('BET', 'LEAN', 'WATCH', 'NO BET'));

create index if not exists idx_match_analysis_match_id
  on public.match_analysis(match_id);

create index if not exists idx_match_analysis_is_top_pick
  on public.match_analysis(is_top_pick);

create index if not exists idx_match_analysis_final_rank
  on public.match_analysis(final_rank);

create index if not exists idx_match_analysis_recommendation
  on public.match_analysis(recommendation);

create index if not exists idx_match_analysis_confidence_score
  on public.match_analysis(confidence_score);
