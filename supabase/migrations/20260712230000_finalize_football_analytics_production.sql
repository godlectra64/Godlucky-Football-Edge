alter table public.football_match_odds
  drop constraint if exists football_match_odds_market_focus_valid;

alter table public.football_match_odds
  add constraint football_match_odds_market_focus_valid
  check (market_focus in ('AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'NONE'));

alter table public.football_ai_final_picks
  drop constraint if exists football_ai_final_picks_market_focus_valid;

alter table public.football_ai_final_picks
  add constraint football_ai_final_picks_market_focus_valid
  check (market_focus in ('AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE', 'BTTS', 'NONE'));

alter table public.daily_top10_selections
  drop constraint if exists daily_top10_selections_market_focus_valid;

alter table public.daily_top10_selections
  add constraint daily_top10_selections_market_focus_valid
  check (market_focus is null or market_focus in ('AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'NONE'));
alter table public.daily_top10_selections
  add column if not exists decision_market text,
  add column if not exists market_tier text,
  add column if not exists primary_market_ready boolean default false,
  add column if not exists alternative_market_ready boolean default false,
  add column if not exists available_markets jsonb default '[]'::jsonb,
  add column if not exists market_quality jsonb default '{}'::jsonb,
  add column if not exists market_snapshot_at timestamptz,
  add column if not exists decision_model_version text,
  add column if not exists market_quality_version text,
  add column if not exists analysis_status text,
  add column if not exists analysis_dimension text,
  add column if not exists model_outlook jsonb default '{}'::jsonb,
  add column if not exists win_draw_loss_probabilities jsonb default '{}'::jsonb,
  add column if not exists expected_goals jsonb default '{}'::jsonb,
  add column if not exists expected_score_predictions jsonb default '[]'::jsonb,
  add column if not exists confidence_breakdown jsonb default '{}'::jsonb,
  add column if not exists data_quality jsonb default '{}'::jsonb,
  add column if not exists analysis_reason_codes jsonb default '[]'::jsonb,
  add column if not exists analysis_model_version text,
  add column if not exists pipeline_version text,
  add column if not exists analysis_generated_at timestamptz;

alter table public.daily_top10_selections
  drop constraint if exists daily_top10_selections_decision_market_valid;

alter table public.daily_top10_selections
  add constraint daily_top10_selections_decision_market_valid
  check (decision_market is null or decision_market in ('ASIAN_HANDICAP', 'OVER_UNDER', 'MATCH_WINNER_1X2', 'DOUBLE_CHANCE'));

alter table public.daily_top10_selections
  drop constraint if exists daily_top10_selections_market_tier_valid;

alter table public.daily_top10_selections
  add constraint daily_top10_selections_market_tier_valid
  check (market_tier is null or market_tier in ('PRIMARY', 'ALTERNATIVE', 'SUPPORTING'));

alter table public.daily_top10_selections
  drop constraint if exists daily_top10_selections_analysis_status_valid;

alter table public.daily_top10_selections
  add constraint daily_top10_selections_analysis_status_valid
  check (analysis_status is null or analysis_status in ('ANALYSIS_READY', 'PARTIAL_ANALYSIS', 'WAITING_DATA', 'INSUFFICIENT_DATA', 'FINAL_LOCKED', 'FINISHED'));

update public.daily_top10_selections
set analysis_status = case
  when selection_status = 'READY_PRIMARY' then 'ANALYSIS_READY'
  when selection_status = 'READY_ALTERNATIVE' then 'PARTIAL_ANALYSIS'
  when selection_status = 'WAITING_MARKET' then 'WAITING_DATA'
  when selection_status = 'INSUFFICIENT_DATA' then 'INSUFFICIENT_DATA'
  when selection_status = 'FINAL_LOCKED' then 'FINAL_LOCKED'
  when selection_status = 'FINISHED' then 'FINISHED'
  else coalesce(analysis_status, 'WAITING_DATA')
end
where analysis_status is null;

alter table public.daily_market_candidates
  add column if not exists has_usable_double_chance boolean default false,
  add column if not exists has_usable_correct_score boolean default false;

create index if not exists daily_top10_selections_decision_market_idx
  on public.daily_top10_selections(selection_date, decision_market, rank);

create index if not exists daily_top10_selections_market_tier_idx
  on public.daily_top10_selections(selection_date, market_tier, rank);

create index if not exists daily_top10_selections_analysis_status_idx
  on public.daily_top10_selections(selection_date, analysis_status, rank);

create or replace view public.daily_analysis_board as
select
  d.id as selection_id,
  d.match_id,
  coalesce(d.api_fixture_id, m.api_sports_fixture_id) as fixture_id,
  d.selection_date,
  d.rank,
  m.kickoff_at,
  l.name as league,
  ht.name as home_team,
  at.name as away_team,
  d.analysis_status,
  d.model_outlook,
  d.win_draw_loss_probabilities,
  d.expected_goals,
  d.expected_score_predictions,
  d.confidence_score as confidence,
  d.confidence_breakdown,
  d.data_quality,
  d.analysis_reason_codes,
  d.analysis_model_version,
  d.pipeline_version,
  d.analysis_generated_at,
  m.status_short as result_status,
  m.home_goals,
  m.away_goals,
  r.simulation_outcome,
  r.settlement_status
from public.daily_top10_selections d
left join public.football_matches m on m.id = d.match_id
left join public.football_leagues l on l.id = m.league_id
left join public.football_teams ht on ht.id = m.home_team_id
left join public.football_teams at on at.id = m.away_team_id
left join public.football_ai_pick_results r on r.match_id = d.match_id;
