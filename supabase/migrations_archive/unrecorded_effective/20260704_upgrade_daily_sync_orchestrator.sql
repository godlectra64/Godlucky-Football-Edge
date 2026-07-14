alter table api_football_daily_sync_steps
  add column if not exists attempt_count int default 0,
  add column if not exists max_attempts int default 3,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_retry_at timestamptz;

alter table api_football_daily_sync_steps
  drop constraint if exists api_football_daily_sync_steps_status_check;

alter table api_football_daily_sync_steps
  add constraint api_football_daily_sync_steps_status_check
  check (status in ('pending', 'running', 'success', 'partial', 'pending_retry', 'skipped', 'failed'));

create index if not exists api_football_daily_sync_steps_retry_idx
  on api_football_daily_sync_steps(run_id, status, next_retry_at);
