-- Run this in Supabase SQL editor after deploying the Edge Function.
-- It schedules sync-football-data every 60 minutes and at important Thai-time windows.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('sync-football-data-hourly')
where exists (select 1 from cron.job where jobname = 'sync-football-data-hourly');

select cron.schedule(
  'sync-football-data-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/sync-football-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    ),
    body := jsonb_build_object('mode', 'cron-hourly')
  );
  $$
);

select cron.unschedule('sync-football-data-prime-th')
where exists (select 1 from cron.job where jobname = 'sync-football-data-prime-th');

select cron.schedule(
  'sync-football-data-prime-th',
  '0 1,5,9,13,16 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/sync-football-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    ),
    body := jsonb_build_object('mode', 'cron-prime-th')
  );
  $$
);
