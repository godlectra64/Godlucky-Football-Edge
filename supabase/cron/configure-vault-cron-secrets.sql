-- Run manually in the Supabase SQL Editor for project fzjbnxomflqopwhzxfog.
-- Do not commit a real secret key to this repository.
-- API Keys v2 secret keys must be sent on the apikey header, not Authorization.

create extension if not exists supabase_vault with schema vault;

select vault.create_secret(
  'https://fzjbnxomflqopwhzxfog.functions.supabase.co',
  'project_url',
  'Base URL for scheduled Edge Function calls'
)
where not exists (
  select 1 from vault.decrypted_secrets where name = 'project_url'
);

select vault.create_secret(
  '<paste Supabase secret key here>',
  'sync_football_secret_key',
  'Supabase API Keys v2 secret key for sync-football-data cron'
)
where not exists (
  select 1 from vault.decrypted_secrets where name = 'sync_football_secret_key'
);

-- Verify secret presence without exposing values:
select
  name,
  decrypted_secret is not null as configured
from vault.decrypted_secrets
where name in ('project_url', 'sync_football_secret_key')
order by name;

-- Manual end-to-end cron-path test:
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/sync-football-data',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_football_secret_key')
  ),
  body := jsonb_build_object('mode', 'manual-pg-net-vault-test')
);

-- Check the result after a few seconds:
select status, message, started_at, finished_at
from public.sync_logs
order by started_at desc
limit 5;
