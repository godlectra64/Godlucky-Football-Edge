alter table public.api_football_enrichment_sync_log
  drop constraint if exists api_football_enrichment_sync_log_status_check;

alter table public.api_football_enrichment_sync_log
  add constraint api_football_enrichment_sync_log_status_check
  check (status in ('started', 'success', 'partial_success', 'empty', 'skipped_no_coverage', 'skipped_not_due', 'error', 'finished'));
