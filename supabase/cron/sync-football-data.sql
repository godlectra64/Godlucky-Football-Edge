-- Run this in the Supabase SQL Editor for project fzjbnxomflqopwhzxfog.
-- Times below are scheduled in UTC because pg_cron runs on UTC:
-- 00:05 Thailand = 17:05 UTC
-- 06:00 Thailand = 23:00 UTC
-- 12:00 Thailand = 05:00 UTC
-- 18:00 Thailand = 11:00 UTC
--
-- Required before scheduling:
--   alter database postgres set app.supabase_service_role_key = '<your service role key>';

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname)
from cron.job
where jobname in (
  'sync-football-data-hourly',
  'sync-football-data-prime-th',
  'sync-football-data-0005-th',
  'sync-football-data-0600-1200-1800-th'
);

select cron.schedule(
  'sync-football-data-0005-th',
  '5 17 * * *',
  $$
  select net.http_post(
    url := 'https://fzjbnxomflqopwhzxfog.functions.supabase.co/sync-football-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
      'apikey', current_setting('app.supabase_service_role_key')
    ),
    body := jsonb_build_object('mode', 'cron-0005-th-today-tomorrow')
  );
  $$
);

select cron.schedule(
  'sync-football-data-0600-1200-1800-th',
  '0 23,5,11 * * *',
  $$
  select net.http_post(
    url := 'https://fzjbnxomflqopwhzxfog.functions.supabase.co/sync-football-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
      'apikey', current_setting('app.supabase_service_role_key')
    ),
    body := jsonb_build_object('mode', 'cron-0600-1200-1800-th-today-tomorrow')
  );
  $$
);
