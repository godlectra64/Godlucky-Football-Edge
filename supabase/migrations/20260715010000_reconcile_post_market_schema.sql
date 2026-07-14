-- Bridge the exact remote 20260712/13/14 history to the canonical
-- Market-Ready First status contract. This migration performs no row updates.

do $$
declare
  unknown_statuses text[];
  existing_definition text;
begin
  if to_regclass('public.daily_top10_selections') is null then
    raise exception 'Required compatibility table public.daily_top10_selections is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'daily_top10_selections'
      and column_name = 'selection_status'
      and udt_name = 'text'
  ) then
    raise exception 'Required text column daily_top10_selections.selection_status is missing or incompatible';
  end if;

  select array_agg(distinct selection_status order by selection_status)
    into unknown_statuses
  from public.daily_top10_selections
  where selection_status is not null
    and selection_status not in (
      'READY',
      'WATCH',
      'WAIT',
      'WAITING_MARKET',
      'REJECTED',
      'FINAL_LOCKED',
      'FINISHED'
    );

  if coalesce(array_length(unknown_statuses, 1), 0) > 0 then
    raise exception 'Unknown daily decision statuses block reconciliation: %', unknown_statuses;
  end if;

  select pg_get_constraintdef(oid)
    into existing_definition
  from pg_constraint
  where conrelid = 'public.daily_top10_selections'::regclass
    and conname = 'daily_top10_selections_status_valid';

  if existing_definition is not null
    and (
      existing_definition !~ 'READY'
      or existing_definition !~ 'WATCH'
      or existing_definition !~ 'WAITING_MARKET'
      or existing_definition !~ 'REJECTED'
    )
  then
    raise exception 'daily_top10_selections_status_valid has an unrecognized historical definition: %', existing_definition;
  end if;

  alter table public.daily_top10_selections
    drop constraint if exists daily_top10_selections_status_valid;

  alter table public.daily_top10_selections
    add constraint daily_top10_selections_status_valid
    check (
      selection_status is null
      or selection_status in (
        'READY',
        'WATCH',
        'WAIT',
        'WAITING_MARKET',
        'REJECTED',
        'FINAL_LOCKED',
        'FINISHED'
      )
    ) not valid;

  alter table public.daily_top10_selections
    validate constraint daily_top10_selections_status_valid;
end
$$;

comment on column public.daily_top10_selections.selection_status is
  'Canonical writes use READY, WATCH, WAIT, or REJECTED. WAITING_MARKET, FINAL_LOCKED, and FINISHED are accepted only for backward-compatible reads.';

comment on function public.repair_stale_market_first_top10(date, uuid[], jsonb, jsonb) is
  'DEPRECATED historical service-role RPC. Canonical Market-Ready First workflow and repair commands must not invoke this fixed-count function.';
