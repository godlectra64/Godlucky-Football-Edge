create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname)
from cron.job
where jobname in (
  'sync-football-data-hourly',
  'sync-football-data-prime-th',
  'sync-football-data-0005-th',
  'sync-football-data-0600-1200-1800-th',
  'sync-football-data-0030-th',
  'sync-football-data-1200-th'
);

select cron.schedule(
  'sync-football-data-0030-th',
  '30 17 * * *',
  $$
  select net.http_post(
    url := 'https://fzjbnxomflqopwhzxfog.functions.supabase.co/sync-football-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
      'apikey', current_setting('app.supabase_service_role_key')
    ),
    body := jsonb_build_object('mode', 'cron-0030-th-today-tomorrow')
  );
  $$
);

select cron.schedule(
  'sync-football-data-1200-th',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://fzjbnxomflqopwhzxfog.functions.supabase.co/sync-football-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
      'apikey', current_setting('app.supabase_service_role_key')
    ),
    body := jsonb_build_object('mode', 'cron-1200-th-today-tomorrow')
  );
  $$
);
