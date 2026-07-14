update public.football_ai_final_picks
set
  market_signal = 'ยังไม่มีข้อมูลตลาดราคา',
  final_summary = 'ยังไม่มีข้อมูลตลาดราคา AI Final Pick จึงจำกัดสัญญาณสูงสุดไม่ให้เป็น Strong Signal',
  warning_signs = (
    select jsonb_agg(
      case
        when value in ('No market data yet', 'No AH market data yet', 'No OU market data yet') then to_jsonb('ยังไม่มีข้อมูลตลาดราคา'::text)
        else to_jsonb(value)
      end
    )
    from jsonb_array_elements_text(coalesce(warning_signs, '[]'::jsonb)) as items(value)
  ),
  ah_analysis = jsonb_set(
    coalesce(ah_analysis, '{}'::jsonb),
    '{warnings}',
    jsonb_build_array('ยังไม่มีข้อมูลตลาดราคา'),
    true
  ),
  ou_analysis = jsonb_set(
    coalesce(ou_analysis, '{}'::jsonb),
    '{warnings}',
    jsonb_build_array('ยังไม่มีข้อมูลตลาดราคา'),
    true
  ),
  updated_at = now()
where latest_odds is null
  and (
    market_signal in ('No market data yet', 'No AH market data yet', 'No OU market data yet')
    or final_summary = 'AI Final Pick is limited because market data is not available yet. Highest signal is capped at Watch.'
  );
