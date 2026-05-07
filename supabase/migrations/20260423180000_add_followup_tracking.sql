-- ══════════════════════════════════════════════════════════════════
-- Follow-up sequence tracking
-- ══════════════════════════════════════════════════════════════════
-- Adds two columns so scripts/send-followups.mjs can tell who's due
-- for their next automated email.
--
--   followup_step      how many follow-ups they've already received (0..N)
--   last_followup_at   when the last follow-up left our server (null = none)
--
-- The script considers a contact "due" when:
--   newsletter = true
--   AND reply_status <> 'spam'
--   AND followup_step < <sequence length>
--   AND (last_followup_at IS NULL OR last_followup_at <= now() - 5 days)

alter table public.contact_submissions
  add column followup_step    integer     not null default 0,
  add column last_followup_at timestamptz;

-- Fast queue lookup for the scheduled job. NULLS FIRST so brand-new
-- opt-ins (last_followup_at = null) are at the front of the line.
create index contact_submissions_followup_queue_idx
  on public.contact_submissions (last_followup_at nulls first);

comment on column public.contact_submissions.followup_step
  is 'Number of follow-up emails already sent (0 = none yet)';
comment on column public.contact_submissions.last_followup_at
  is 'Timestamp the last follow-up email was sent (null = never)';
