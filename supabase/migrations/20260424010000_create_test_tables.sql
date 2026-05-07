-- ══════════════════════════════════════════════════════════════════
-- Playwright test-run tracking
-- ══════════════════════════════════════════════════════════════════
-- Populated by tests/supabase-reporter.mjs on every `npm test` run.
-- Two tables:
--   · test_runs      — one row per invocation (counts + duration + status)
--   · test_results   — one row per individual test (per browser project)

create table if not exists public.test_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,
  total         integer,
  passed        integer default 0,
  failed        integer default 0,
  skipped       integer default 0,
  status        text check (status in ('running', 'passed', 'failed')) default 'running',
  git_sha       text,
  git_branch    text
);

create table if not exists public.test_results (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.test_runs(id) on delete cascade,
  title         text not null,
  file          text,
  project       text,
  status        text not null,
  duration_ms   integer,
  error_message text,
  created_at    timestamptz not null default now()
);

create index if not exists test_results_run_idx    on public.test_results (run_id);
create index if not exists test_runs_started_idx   on public.test_runs (started_at desc);
create index if not exists test_results_failed_idx on public.test_results (run_id, status) where status = 'failed';

comment on table  public.test_runs    is 'One row per `npm test` invocation';
comment on table  public.test_results is 'One row per individual Playwright test, per browser project';
