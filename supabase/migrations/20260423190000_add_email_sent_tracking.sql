-- Track whether the confirmation email was successfully sent via Resend.
--
-- A NULL email_sent_at means the email has not (yet) been accepted by
-- Resend — either because RESEND_API_KEY isn't configured, or the send
-- failed (sandbox recipient mismatch, rate limit, network error, etc.).
-- When the send succeeds, server.js updates the row with the accepted
-- timestamp and the Resend message id so we can cross-reference the
-- Resend dashboard from a single query.

alter table public.contact_submissions
  add column if not exists email_sent_at    timestamptz,
  add column if not exists resend_message_id text;

comment on column public.contact_submissions.email_sent_at is
  'When Resend accepted the confirmation email. NULL = not sent (or send failed — check server logs).';
comment on column public.contact_submissions.resend_message_id is
  'Resend message id returned by /emails — look it up at https://resend.com/emails/<id>.';

-- Queue index for "who still needs a confirmation retry?"
create index if not exists contact_submissions_unsent_idx
  on public.contact_submissions (created_at)
  where email_sent_at is null;
