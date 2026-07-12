alter table public.daily_top10_selections
  drop constraint if exists daily_top10_selections_rank_range;

alter table public.daily_top10_selections
  add column if not exists selection_status text,
  add column if not exists market_ready boolean,
  add column if not exists pipeline_version text,
  add column if not exists selection_algorithm_version text,
  add column if not exists decision_reason text,
  add column if not exists decision_audit jsonb default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_top10_selections_rank_positive'
      and conrelid = 'public.daily_top10_selections'::regclass
  ) then
    alter table public.daily_top10_selections
      add constraint daily_top10_selections_rank_positive check (rank > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_top10_selections_status_valid'
      and conrelid = 'public.daily_top10_selections'::regclass
  ) then
    alter table public.daily_top10_selections
      add constraint daily_top10_selections_status_valid
      check (selection_status is null or selection_status in ('READY', 'WATCH', 'WAITING_MARKET', 'REJECTED', 'FINAL_LOCKED', 'FINISHED'));
  end if;
end $$;

create index if not exists daily_top10_selections_status_idx
  on public.daily_top10_selections(selection_date, selection_status, rank);

create index if not exists daily_top10_selections_market_ready_idx
  on public.daily_top10_selections(selection_date, market_ready, rank);
