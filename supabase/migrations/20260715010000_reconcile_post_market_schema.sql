-- Bridge the exact remote 20260712/13/14 history to the canonical
-- Market-Ready First status contract. This migration performs no row updates.

do $$
declare
  status_column_attnum smallint;
  status_column_nullable boolean;
  existing_constraint_oid oid;
  existing_constraint_type "char";
  existing_constraint_columns text[];
  existing_constraint_validated boolean;
  existing_constraint_noinherit boolean;
  unknown_statuses text[];
  existing_definition text;
  existing_allowed_statuses text[];
  replacement_statuses constant text[] := array[
    'READY',
    'WATCH',
    'WAIT',
    'REJECTED',
    'WAITING_MARKET',
    'READY_PRIMARY',
    'READY_ALTERNATIVE',
    'INSUFFICIENT_DATA',
    'FINAL_LOCKED',
    'FINISHED'
  ];
  production_legacy_statuses constant text[] := array[
    'READY',
    'READY_PRIMARY',
    'READY_ALTERNATIVE',
    'WAITING_MARKET',
    'WAITING_DATA',
    'INSUFFICIENT_DATA',
    'REJECTED',
    'NO_DECISION',
    'FINAL_LOCKED',
    'LOCKED',
    'FINISHED',
    'SETTLED'
  ];
  analytics_legacy_statuses constant text[] := array[
    'READY_PRIMARY',
    'READY_ALTERNATIVE',
    'WAITING_MARKET',
    'INSUFFICIENT_DATA',
    'REJECTED',
    'FINAL_LOCKED',
    'FINISHED'
  ];
  dynamic_legacy_statuses constant text[] := array[
    'READY',
    'WATCH',
    'WAITING_MARKET',
    'REJECTED',
    'FINAL_LOCKED',
    'FINISHED'
  ];
  replacement_is_current boolean;
  recognized_legacy_definition boolean;
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

  select attribute.attnum, not attribute.attnotnull
    into status_column_attnum, status_column_nullable
  from pg_attribute as attribute
  where attribute.attrelid = 'public.daily_top10_selections'::regclass
    and attribute.attname = 'selection_status'
    and not attribute.attisdropped;

  select array_agg(distinct selection_status order by selection_status)
    into unknown_statuses
  from public.daily_top10_selections
  where selection_status is not null
    and not (selection_status = any(replacement_statuses));

  if coalesce(array_length(unknown_statuses, 1), 0) > 0 then
    raise exception 'Unknown daily decision statuses block reconciliation: %', unknown_statuses;
  end if;

  select constraint_row.oid,
    constraint_row.contype,
    constraint_row.convalidated,
    constraint_row.connoinherit,
    pg_get_constraintdef(constraint_row.oid, true),
    array_agg(attribute.attname order by constraint_column.ordinality)
    into existing_constraint_oid,
      existing_constraint_type,
      existing_constraint_validated,
      existing_constraint_noinherit,
      existing_definition,
      existing_constraint_columns
  from pg_constraint as constraint_row
  left join lateral unnest(constraint_row.conkey) with ordinality
    as constraint_column(attnum, ordinality) on true
  left join pg_attribute as attribute
    on attribute.attrelid = constraint_row.conrelid
   and attribute.attnum = constraint_column.attnum
  where constraint_row.conrelid = 'public.daily_top10_selections'::regclass
    and constraint_row.conname = 'daily_top10_selections_status_valid'
  group by constraint_row.oid, constraint_row.contype,
    constraint_row.convalidated, constraint_row.connoinherit;

  if existing_constraint_oid is null then
    raise exception 'Expected constraint public.daily_top10_selections.daily_top10_selections_status_valid is missing';
  end if;

  if existing_constraint_type <> 'c'
    or existing_constraint_columns is distinct from array['selection_status']::text[]
    or existing_constraint_columns[1] is null
    or status_column_attnum is null
    or status_column_nullable is not true
  then
    raise exception 'daily_top10_selections_status_valid is not the expected CHECK constraint on nullable selection_status: type %, columns %, nullable %',
      existing_constraint_type, existing_constraint_columns, status_column_nullable;
  end if;

  if existing_definition !~* 'selection_status\s+IS\s+NULL'
    or existing_definition !~* 'selection_status\s*=\s*ANY\s*\(ARRAY\['
  then
    raise exception 'daily_top10_selections_status_valid has an unsupported CHECK expression: %', existing_definition;
  end if;

  select coalesce(array_agg(distinct captured[1] order by captured[1]), '{}'::text[])
    into existing_allowed_statuses
  from regexp_matches(existing_definition, '''([^'']+)''::text', 'g') as captured;

  replacement_is_current := existing_allowed_statuses @> replacement_statuses
    and replacement_statuses @> existing_allowed_statuses;

  if existing_constraint_validated is not true or existing_constraint_noinherit is true then
    raise exception 'daily_top10_selections_status_valid has unexpected validation/inheritance flags: validated %, noinherit %',
      existing_constraint_validated, existing_constraint_noinherit;
  end if;

  recognized_legacy_definition := (
      existing_allowed_statuses @> production_legacy_statuses
      and production_legacy_statuses @> existing_allowed_statuses
    ) or (
      existing_allowed_statuses @> analytics_legacy_statuses
      and analytics_legacy_statuses @> existing_allowed_statuses
    ) or (
      existing_allowed_statuses @> dynamic_legacy_statuses
      and dynamic_legacy_statuses @> existing_allowed_statuses
    );

  if replacement_is_current then
    return;
  end if;

  if not recognized_legacy_definition then
    raise exception 'daily_top10_selections_status_valid has an unrecognized allowed-value set: %', existing_allowed_statuses;
  end if;

  alter table public.daily_top10_selections
    drop constraint daily_top10_selections_status_valid;

  alter table public.daily_top10_selections
    add constraint daily_top10_selections_status_valid
    check (
      selection_status is null
      or selection_status in (
        'READY',
        'WATCH',
        'WAIT',
        'REJECTED',
        'WAITING_MARKET',
        'READY_PRIMARY',
        'READY_ALTERNATIVE',
        'INSUFFICIENT_DATA',
        'FINAL_LOCKED',
        'FINISHED'
      )
    ) not valid;

  alter table public.daily_top10_selections
    validate constraint daily_top10_selections_status_valid;
end
$$;

comment on constraint daily_top10_selections_status_valid on public.daily_top10_selections is
  'Canonical writes: READY, WATCH, WAIT, REJECTED. Deprecated rollout compatibility only: WAITING_MARKET, READY_PRIMARY, READY_ALTERNATIVE, INSUFFICIENT_DATA, FINAL_LOCKED, FINISHED.';

comment on column public.daily_top10_selections.selection_status is
  'Canonical writes use READY, WATCH, WAIT, or REJECTED. Other allowed values are deprecated rollout compatibility and must not be used by new writes.';

comment on function public.repair_stale_market_first_top10(date, uuid[], jsonb, jsonb) is
  'DEPRECATED historical service-role RPC. Canonical Market-Ready First workflow and repair commands must not invoke this fixed-count function.';
