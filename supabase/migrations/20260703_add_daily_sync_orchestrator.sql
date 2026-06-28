create table if not exists api_football_daily_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  mode text not null default 'daily-full-sync-safe',
  status text not null default 'started',
  current_phase text,
  current_step int default 0,
  total_steps int default 5,
  limit_value int default 10,
  enrichment_limit int default 20,
  started_at timestamptz default now(),
  finished_at timestamptz,
  last_error text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint api_football_daily_sync_runs_status_check check (status in ('started', 'running', 'partial', 'success', 'failed')),
  unique(run_date, mode)
);

create table if not exists api_football_daily_sync_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references api_football_daily_sync_runs(id) on delete cascade,
  step_order int not null,
  phase text not null,
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  processed int default 0,
  total_candidates int default 0,
  rows_saved int default 0,
  failed int default 0,
  skipped int default 0,
  rate_limited boolean default false,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint api_football_daily_sync_steps_status_check check (status in ('pending', 'running', 'success', 'partial', 'skipped', 'failed')),
  unique(run_id, step_order)
);

drop trigger if exists api_football_daily_sync_runs_set_updated_at on api_football_daily_sync_runs;
create trigger api_football_daily_sync_runs_set_updated_at
before update on api_football_daily_sync_runs
for each row execute function set_updated_at();

drop trigger if exists api_football_daily_sync_steps_set_updated_at on api_football_daily_sync_steps;
create trigger api_football_daily_sync_steps_set_updated_at
before update on api_football_daily_sync_steps
for each row execute function set_updated_at();

create index if not exists api_football_daily_sync_runs_date_idx on api_football_daily_sync_runs(run_date desc);
create index if not exists api_football_daily_sync_runs_status_idx on api_football_daily_sync_runs(status);
create index if not exists api_football_daily_sync_steps_run_idx on api_football_daily_sync_steps(run_id, step_order);
create index if not exists api_football_daily_sync_steps_status_idx on api_football_daily_sync_steps(status);

alter table api_football_daily_sync_runs enable row level security;
alter table api_football_daily_sync_steps enable row level security;

create policy "public read api football daily sync runs" on api_football_daily_sync_runs for select using (true);
create policy "public read api football daily sync steps" on api_football_daily_sync_steps for select using (true);
