-- ══════════════════════════════════════════════════════════════════
-- Contact form submissions table
-- ══════════════════════════════════════════════════════════════════
-- Captures every submission from the Tester.io contact form, including
-- workflow state (reply status) and newsletter opt-in. Browser inserts
-- are allowed via RLS + anon role; reads/updates/deletes flow through
-- the service_role key from your server (which bypasses RLS).

-- ── 1. Reply workflow as a typed enum ────────────────────────────
create type public.reply_status as enum (
  'pending',    -- new submission, nobody has looked at it
  'replied',    -- a human has sent a reply
  'archived',   -- handled, archived for records
  'spam'        -- flagged as spam
);

-- ── 2. The table ─────────────────────────────────────────────────
create table public.contact_submissions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  name          text not null check (
                  length(trim(name)) > 0 and length(name) <= 200
                ),
  email         text not null check (
                  email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200
                ),
  message       text not null check (
                  length(trim(message)) > 0 and length(message) <= 5000
                ),

  reply_status  public.reply_status not null default 'pending',
  newsletter    boolean not null default false
);

-- ── 3. Indexes for the queries you'll actually run ───────────────
-- Newest-first listing (most common dashboard view)
create index contact_submissions_created_at_idx
  on public.contact_submissions (created_at desc);

-- Find all submissions from a given email (dedupe / conversation history)
create index contact_submissions_email_idx
  on public.contact_submissions (email);

-- Partial index: fast "what's in my inbox?" query
create index contact_submissions_pending_idx
  on public.contact_submissions (created_at desc)
  where reply_status = 'pending';

-- ── 4. Auto-update `updated_at` on every UPDATE ──────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contact_submissions_set_updated_at
  before update on public.contact_submissions
  for each row execute function public.set_updated_at();

-- ── 5. Row-Level Security ────────────────────────────────────────
-- Lock the table down, then explicitly allow anonymous inserts so
-- the contact form (which uses the anon/public key) can write.
alter table public.contact_submissions enable row level security;

create policy "Anon may insert submissions"
  on public.contact_submissions
  for insert to anon
  with check (true);

-- Reads / updates / deletes happen from your Node server with the
-- service_role key, which bypasses RLS — so no policy needed for
-- those actions. Do NOT grant select/update/delete to the anon role,
-- or anyone with the public anon key (i.e. any visitor) could dump
-- every submission.

-- ── 6. Documentation for the Supabase dashboard ──────────────────
comment on table  public.contact_submissions        is 'Contact form submissions from the Tester.io site';
comment on column public.contact_submissions.name         is 'Submitter full name';
comment on column public.contact_submissions.email        is 'Submitter email (validated against a permissive pattern)';
comment on column public.contact_submissions.message      is 'Message body / submission details';
comment on column public.contact_submissions.reply_status is 'Workflow state: pending, replied, archived, or spam';
comment on column public.contact_submissions.newsletter   is 'Whether the submitter opted into the newsletter';
