create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

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
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/sync-football-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_football_secret_key')
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
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/sync-football-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_football_secret_key')
    ),
    body := jsonb_build_object('mode', 'cron-1200-th-today-tomorrow')
  );
  $$
);
