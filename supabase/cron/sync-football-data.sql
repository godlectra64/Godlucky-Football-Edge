-- GitHub Actions (.github/workflows/daily-football-sync.yml) is the only canonical scheduler.
-- This SQL intentionally creates no jobs. Apply only when retiring legacy pg_cron jobs.
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'sync-football-data-hourly',
  'sync-football-data-prime-th',
  'sync-football-data-0005-th',
  'sync-football-data-0600-1200-1800-th',
  'sync-football-data-0030-th',
  'sync-football-data-1200-th'
);
