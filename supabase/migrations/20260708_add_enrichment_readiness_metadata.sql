alter table public.football_matches add column if not exists enrichment_attempt_count integer default 0;
alter table public.football_matches add column if not exists enrichment_last_attempt_at timestamptz;
alter table public.football_matches add column if not exists enrichment_next_retry_at timestamptz;
alter table public.football_matches add column if not exists enrichment_error text;
alter table public.football_matches add column if not exists enrichment_breakdown jsonb default '{}'::jsonb;
alter table public.football_matches add column if not exists has_market_data boolean default false;
alter table public.football_matches add column if not exists has_fixture_detail boolean default false;
alter table public.football_matches add column if not exists data_readiness_score numeric default 0;
alter table public.football_matches add column if not exists data_readiness_status text default 'PENDING';

alter table public.football_matches
  drop constraint if exists football_matches_data_readiness_status_check;

alter table public.football_matches
  add constraint football_matches_data_readiness_status_check
  check (data_readiness_status in ('READY', 'PARTIAL', 'NO_MARKET_DATA', 'PENDING', 'FAILED', 'SKIPPED_NO_COVERAGE'));

create index if not exists football_matches_data_readiness_status_idx
  on public.football_matches(data_readiness_status);

create index if not exists football_matches_has_market_data_idx
  on public.football_matches(has_market_data);
