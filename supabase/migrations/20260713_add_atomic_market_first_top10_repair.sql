create or replace function public.repair_stale_market_first_top10(
  p_selection_date date,
  p_expected_previous_match_ids uuid[],
  p_final_picks jsonb,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_match_ids uuid[];
  v_expected_match_ids uuid[];
  v_existing_count integer;
  v_existing_with_odds integer;
  v_ready_count integer;
  v_selected_ready_count integer;
  v_selected_with_required_odds integer;
  v_persisted_count integer;
  v_persisted_pick_count integer;
  v_latest_lock_at timestamptz;
  v_latest_ready_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'repair_stale_market_first_top10 requires service_role';
  end if;

  if p_selection_date is null then
    raise exception 'selection_date is required';
  end if;
  if jsonb_typeof(p_final_picks) <> 'array' or jsonb_array_length(p_final_picks) <> 10 then
    raise exception 'exactly 10 final picks are required';
  end if;
  if jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) <> 10 then
    raise exception 'exactly 10 Top10 selections are required';
  end if;

  perform 1
  from public.daily_top10_selections
  where selection_date = p_selection_date
  for update;

  select
    count(*),
    coalesce(array_agg(match_id order by match_id), '{}'::uuid[]),
    max(locked_at)
  into v_existing_count, v_current_match_ids, v_latest_lock_at
  from public.daily_top10_selections
  where selection_date = p_selection_date;

  select coalesce(array_agg(match_id order by match_id), '{}'::uuid[])
  into v_expected_match_ids
  from unnest(coalesce(p_expected_previous_match_ids, '{}'::uuid[])) as match_id;

  if v_existing_count <> 10 then
    raise exception 'stale lock repair requires exactly 10 existing rows; found %', v_existing_count;
  end if;
  if v_current_match_ids <> v_expected_match_ids then
    raise exception 'locked Top10 changed after repair eligibility was checked';
  end if;

  if (
    select count(*) = 10
      and count(distinct match_id) = 10
      and count(distinct rank) = 10
      and min(rank) = 1
      and max(rank) = 10
    from jsonb_to_recordset(p_selections) as selection_row(match_id uuid, rank integer)
  ) is not true then
    raise exception 'repair payload must contain unique match_id and ranks 1-10';
  end if;

  if (
    select count(*) = 10 and count(distinct match_id) = 10
    from jsonb_to_recordset(p_final_picks) as pick_row(match_id uuid)
  ) is not true then
    raise exception 'final pick payload must contain 10 unique match_id values';
  end if;

  if exists (
    select selection_row.match_id
    from jsonb_to_recordset(p_selections) as selection_row(match_id uuid)
    except
    select pick_row.match_id
    from jsonb_to_recordset(p_final_picks) as pick_row(match_id uuid)
  ) then
    raise exception 'selection and final pick match identities differ';
  end if;

  select count(*)
  into v_ready_count
  from public.daily_market_candidates
  where selection_date = p_selection_date
    and market_readiness_status = 'READY'
    and has_usable_ah
    and has_usable_ou
    and has_usable_match_winner;

  if v_ready_count < 10 then
    raise exception 'stale lock repair requires at least 10 READY candidates; found %', v_ready_count;
  end if;

  select count(*)
  into v_existing_with_odds
  from public.daily_top10_selections locked
  where locked.selection_date = p_selection_date
    and exists (
      select 1
      from public.football_match_odds odds
      where odds.match_id = locked.match_id
        and odds.is_latest = true
        and odds.market_focus in ('AH', 'OU', 'MATCH_WINNER')
        and odds.price is not null
        and odds.price > 0
    );

  if v_existing_with_odds >= 10 then
    return jsonb_build_object(
      'repaired', false,
      'reason', 'VALID_MARKET_READY_LOCK',
      'persistedCount', v_existing_count,
      'top10WithOdds', v_existing_with_odds
    );
  end if;

  select max(odds_synced_at)
  into v_latest_ready_at
  from public.daily_market_candidates
  where selection_date = p_selection_date
    and market_readiness_status = 'READY';

  if v_latest_lock_at is null or v_latest_ready_at is null or v_latest_lock_at >= v_latest_ready_at then
    raise exception 'existing lock is not proven to predate market readiness';
  end if;

  select count(*)
  into v_selected_ready_count
  from jsonb_to_recordset(p_selections) as selection_row(match_id uuid)
  join public.daily_market_candidates candidate
    on candidate.selection_date = p_selection_date
   and candidate.match_id = selection_row.match_id
  where candidate.market_readiness_status = 'READY'
    and candidate.has_usable_ah
    and candidate.has_usable_ou
    and candidate.has_usable_match_winner;

  if v_selected_ready_count <> 10 then
    raise exception 'all repair selections must be READY candidates; found %', v_selected_ready_count;
  end if;

  select count(*)
  into v_selected_with_required_odds
  from (
    select selection_row.match_id
    from jsonb_to_recordset(p_selections) as selection_row(match_id uuid)
    join public.football_match_odds odds
      on odds.match_id = selection_row.match_id
     and odds.is_latest = true
     and odds.market_focus in ('AH', 'OU', 'MATCH_WINNER')
     and odds.price is not null
     and odds.price > 0
    group by selection_row.match_id
    having bool_or(odds.market_focus = 'AH')
       and bool_or(odds.market_focus = 'OU')
       and bool_or(odds.market_focus = 'MATCH_WINNER')
  ) ready_odds;

  if v_selected_with_required_odds <> 10 then
    raise exception 'all repair selections must have latest AH, OU, and MATCH_WINNER odds; found %', v_selected_with_required_odds;
  end if;

  insert into public.football_ai_final_picks (
    match_id, api_fixture_id, signal, market_focus, direction, confidence_score, risk_level,
    key_reasons, warning_signs, market_signal, final_summary, ah_analysis, ou_analysis,
    pick_team, pick_team_id, pick_side, pick_source, pick_market, pick_market_id,
    pick_selection, pick_price, pick_confidence, primary_bookmaker, latest_odds,
    analysis_status, recommendation_reason, market_data_used, odds_rows_used,
    recalculated_at, analysis_version, raw, updated_at
  )
  select
    pick_row.match_id, pick_row.api_fixture_id, pick_row.signal, pick_row.market_focus,
    pick_row.direction, pick_row.confidence_score, pick_row.risk_level,
    coalesce(pick_row.key_reasons, '[]'::jsonb), coalesce(pick_row.warning_signs, '[]'::jsonb),
    pick_row.market_signal, pick_row.final_summary, coalesce(pick_row.ah_analysis, '{}'::jsonb),
    coalesce(pick_row.ou_analysis, '{}'::jsonb), pick_row.pick_team, pick_row.pick_team_id,
    pick_row.pick_side, pick_row.pick_source, pick_row.pick_market, pick_row.pick_market_id,
    pick_row.pick_selection, pick_row.pick_price, pick_row.pick_confidence,
    pick_row.primary_bookmaker, pick_row.latest_odds, pick_row.analysis_status,
    pick_row.recommendation_reason, coalesce(pick_row.market_data_used, false),
    coalesce(pick_row.odds_rows_used, 0), pick_row.recalculated_at,
    pick_row.analysis_version, coalesce(pick_row.raw, '{}'::jsonb), now()
  from jsonb_to_recordset(p_final_picks) as pick_row(
    match_id uuid, api_fixture_id bigint, signal text, market_focus text, direction text,
    confidence_score numeric, risk_level text, key_reasons jsonb, warning_signs jsonb,
    market_signal text, final_summary text, ah_analysis jsonb, ou_analysis jsonb,
    pick_team text, pick_team_id bigint, pick_side text, pick_source text, pick_market text,
    pick_market_id text, pick_selection text, pick_price numeric, pick_confidence numeric,
    primary_bookmaker text, latest_odds text, analysis_status text, recommendation_reason text,
    market_data_used boolean, odds_rows_used integer, recalculated_at timestamptz,
    analysis_version text, raw jsonb
  )
  on conflict (match_id) do update set
    api_fixture_id = excluded.api_fixture_id,
    signal = excluded.signal,
    market_focus = excluded.market_focus,
    direction = excluded.direction,
    confidence_score = excluded.confidence_score,
    risk_level = excluded.risk_level,
    key_reasons = excluded.key_reasons,
    warning_signs = excluded.warning_signs,
    market_signal = excluded.market_signal,
    final_summary = excluded.final_summary,
    ah_analysis = excluded.ah_analysis,
    ou_analysis = excluded.ou_analysis,
    pick_team = excluded.pick_team,
    pick_team_id = excluded.pick_team_id,
    pick_side = excluded.pick_side,
    pick_source = excluded.pick_source,
    pick_market = excluded.pick_market,
    pick_market_id = excluded.pick_market_id,
    pick_selection = excluded.pick_selection,
    pick_price = excluded.pick_price,
    pick_confidence = excluded.pick_confidence,
    primary_bookmaker = excluded.primary_bookmaker,
    latest_odds = excluded.latest_odds,
    analysis_status = excluded.analysis_status,
    recommendation_reason = excluded.recommendation_reason,
    market_data_used = excluded.market_data_used,
    odds_rows_used = excluded.odds_rows_used,
    recalculated_at = excluded.recalculated_at,
    analysis_version = excluded.analysis_version,
    raw = excluded.raw,
    updated_at = now();

  delete from public.daily_top10_selections
  where selection_date = p_selection_date;

  insert into public.daily_top10_selections (
    selection_date, match_id, api_fixture_id, rank, selection_score, ai_final_pick_id,
    signal, market_focus, pick_team, pick_team_id, pick_side, pick_source, pick_market,
    pick_market_id, pick_selection, pick_price, pick_confidence, market_data_used,
    analysis_status, confidence_score, risk_level, locked_at, created_at, updated_at
  )
  select
    p_selection_date, selection_row.match_id, selection_row.api_fixture_id,
    selection_row.rank, selection_row.selection_score, final_pick.id,
    final_pick.signal, final_pick.market_focus, final_pick.pick_team, final_pick.pick_team_id,
    final_pick.pick_side, final_pick.pick_source, final_pick.pick_market,
    final_pick.pick_market_id, final_pick.pick_selection, final_pick.pick_price,
    final_pick.pick_confidence, final_pick.market_data_used, final_pick.analysis_status,
    final_pick.confidence_score, final_pick.risk_level, now(), now(), now()
  from jsonb_to_recordset(p_selections) as selection_row(
    match_id uuid, api_fixture_id integer, rank integer, selection_score numeric
  )
  join public.football_ai_final_picks final_pick
    on final_pick.match_id = selection_row.match_id
  order by selection_row.rank;

  select count(*), count(ai_final_pick_id)
  into v_persisted_count, v_persisted_pick_count
  from public.daily_top10_selections
  where selection_date = p_selection_date;

  if v_persisted_count <> 10 or v_persisted_pick_count <> 10 then
    raise exception 'atomic repair invariant failed: persisted rows %, final picks %', v_persisted_count, v_persisted_pick_count;
  end if;

  return jsonb_build_object(
    'repaired', true,
    'reason', 'STALE_PRE_MARKET_LOCK_REPLACED',
    'persistedCount', v_persisted_count,
    'aiFinalPickCoverage', v_persisted_pick_count,
    'top10WithOdds', v_selected_with_required_odds
  );
end;
$$;

revoke all on function public.repair_stale_market_first_top10(date, uuid[], jsonb, jsonb) from public;
revoke all on function public.repair_stale_market_first_top10(date, uuid[], jsonb, jsonb) from anon;
revoke all on function public.repair_stale_market_first_top10(date, uuid[], jsonb, jsonb) from authenticated;
grant execute on function public.repair_stale_market_first_top10(date, uuid[], jsonb, jsonb) to service_role;
