-- Run manually in the Supabase SQL Editor for project fzjbnxomflqopwhzxfog.
-- Do not commit a real service role key to this repository.
-- This database setting lets pg_cron/pg_net call the sync-football-data Edge Function.

alter database postgres set app.supabase_service_role_key = '<paste service role key here>';

-- Open a new SQL Editor session after running ALTER DATABASE, then verify:
select current_setting('app.supabase_service_role_key', true) <> '' as service_role_setting_present;

-- Manual end-to-end cron-path test:
select net.http_post(
  url := 'https://fzjbnxomflqopwhzxfog.functions.supabase.co/sync-football-data',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
    'apikey', current_setting('app.supabase_service_role_key')
  ),
  body := jsonb_build_object('mode', 'manual-pg-net-test')
);

-- Check the result after a few seconds:
select status, message, started_at, finished_at
from public.sync_logs
order by started_at desc
limit 5;
