alter table public.match_analysis
  add column if not exists market_type text,
  add column if not exists market_line text,
  add column if not exists fair_line text,
  add column if not exists model_probability integer,
  add column if not exists value_status text,
  add column if not exists value_reason text;

alter table public.match_analysis
  drop constraint if exists match_analysis_value_status_valid;

alter table public.match_analysis
  add constraint match_analysis_value_status_valid
  check (
    value_status is null
    or value_status in ('YES', 'NO', 'WAITING_DATA', 'NOT_APPLICABLE')
  );

update public.match_analysis
set
  market_type = nullif(coalesce(market_type, raw->>'market_type', raw->>'bet_market', raw->>'recommended_market'), ''),
  market_line = nullif(coalesce(market_line, raw->>'market_line', raw->>'odds_line', raw->>'handicap_line', raw->>'current_line'), ''),
  fair_line = nullif(coalesce(fair_line, raw->>'fair_line'), ''),
  model_probability = greatest(0, least(100, coalesce(model_probability, confidence_score, 0))),
  value_status = case
    when recommendation = 'NO BET' or coalesce(pick_side, 'NONE') = 'NONE' then 'NOT_APPLICABLE'
    when nullif(coalesce(market_line, raw->>'market_line', raw->>'odds_line', raw->>'handicap_line', raw->>'current_line'), '') is null then 'WAITING_DATA'
    when nullif(coalesce(fair_line, raw->>'fair_line'), '') is null then 'WAITING_DATA'
    when nullif(coalesce(market_line, raw->>'market_line', raw->>'odds_line', raw->>'handicap_line', raw->>'current_line'), '') ~ '-?[0-9]+(\.[0-9]+)?'
      and nullif(coalesce(fair_line, raw->>'fair_line'), '') ~ '-?[0-9]+(\.[0-9]+)?'
      and substring(nullif(coalesce(market_line, raw->>'market_line', raw->>'odds_line', raw->>'handicap_line', raw->>'current_line'), '') from '-?[0-9]+(\.[0-9]+)?')::numeric
        > substring(nullif(coalesce(fair_line, raw->>'fair_line'), '') from '-?[0-9]+(\.[0-9]+)?')::numeric then 'YES'
    else 'NO'
  end,
  value_reason = case
    when recommendation = 'NO BET' or coalesce(pick_side, 'NONE') = 'NONE' then coalesce(value_reason, 'ไม่ใช่จังหวะเดิมพัน จึงไม่ประเมิน Value เชิงรุก')
    when nullif(coalesce(market_line, raw->>'market_line', raw->>'odds_line', raw->>'handicap_line', raw->>'current_line'), '') is null
      or nullif(coalesce(fair_line, raw->>'fair_line'), '') is null then coalesce(value_reason, 'ยังไม่มีราคาตลาดหรือ Fair Line เพียงพอสำหรับประเมิน Value')
    else coalesce(value_reason, 'ประเมิน Value จากราคาตลาดและ Fair Line ที่มีอยู่')
  end;
