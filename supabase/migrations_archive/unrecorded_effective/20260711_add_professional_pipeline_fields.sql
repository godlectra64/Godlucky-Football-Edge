alter table if exists public.match_analysis
  add column if not exists professional_score numeric,
  add column if not exists data_quality_score numeric,
  add column if not exists market_quality_score numeric,
  add column if not exists statistical_edge_score numeric,
  add column if not exists tactical_edge_score numeric,
  add column if not exists motivation_score numeric,
  add column if not exists risk_control_score numeric,
  add column if not exists value_edge_score numeric,
  add column if not exists pipeline_stage text,
  add column if not exists pipeline_reasons jsonb default '[]'::jsonb,
  add column if not exists pipeline_warnings jsonb default '[]'::jsonb;
