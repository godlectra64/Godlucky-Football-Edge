alter table match_analysis
  add column if not exists home_advantage_score numeric default 0,
  add column if not exists away_weakness_score numeric default 0,
  add column if not exists goal_scoring_score numeric default 0,
  add column if not exists defensive_stability_score numeric default 0,
  add column if not exists market_risk_score numeric default 0,
  add column if not exists analysis_summary text;

create index if not exists match_analysis_recommendation_idx on match_analysis(recommendation);
