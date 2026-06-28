insert into public.football_ai_final_picks (
  match_id,
  api_fixture_id,
  signal,
  market_focus,
  direction,
  confidence_score,
  risk_level,
  key_reasons,
  warning_signs,
  market_signal,
  final_summary,
  ah_analysis,
  ou_analysis,
  raw,
  updated_at
)
select
  ma.match_id,
  fm.api_sports_fixture_id,
  'SKIP',
  'NONE',
  'No market direction',
  least(54, greatest(0, coalesce(ma.calibrated_confidence_score, ma.confidence_score, 50))),
  case
    when ma.risk_level in ('LOW', 'MEDIUM', 'HIGH') then ma.risk_level
    else 'MEDIUM'
  end,
  jsonb_build_array('Top 10 match is available', 'AI Final Pick awaits market confirmation', 'API-FOOTBALL team data is available'),
  jsonb_build_array('No market data yet'),
  'No market data yet',
  'AI Final Pick is limited because market data is not available yet. Highest signal is capped at Watch.',
  jsonb_build_object('marketFocus', 'AH', 'direction', 'No market direction', 'confidenceScore', 0, 'reasons', jsonb_build_array(), 'warnings', jsonb_build_array('No AH market data yet')),
  jsonb_build_object('marketFocus', 'OU', 'direction', 'No market direction', 'confidenceScore', 0, 'reasons', jsonb_build_array(), 'warnings', jsonb_build_array('No OU market data yet')),
  jsonb_build_object('source', 'top10_backfill', 'final_rank', ma.final_rank),
  now()
from public.match_analysis ma
join public.football_matches fm on fm.id = ma.match_id
where ma.is_top_pick is true
  and ma.final_rank is not null
  and not exists (
    select 1
    from public.football_ai_final_picks existing
    where existing.match_id = ma.match_id
  )
order by ma.final_rank asc
limit 10;
