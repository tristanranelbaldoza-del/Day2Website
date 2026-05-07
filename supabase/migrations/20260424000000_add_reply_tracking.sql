-- ══════════════════════════════════════════════════════════════════
-- Track inbound replies from Gmail
-- ══════════════════════════════════════════════════════════════════
-- scripts/check-replies.mjs polls Gmail over IMAP and, when it finds
-- a message whose From: address matches a contact_submissions row,
-- stamps these columns so the Supabase table becomes a full record
-- of the conversation — not just what we sent.

alter table public.contact_submissions
  add column if not exists reply_received_at timestamptz,
  add column if not exists reply_subject     text,
  add column if not exists reply_snippet     text,
  add column if not exists reply_message_id  text;

comment on column public.contact_submissions.reply_received_at is
  'When the person wrote back (Gmail Date: header). NULL = no reply yet.';
comment on column public.contact_submissions.reply_subject is
  'Subject line of their most recent reply.';
comment on column public.contact_submissions.reply_snippet is
  'First ~300 chars of the reply body — enough to triage without opening Gmail.';
comment on column public.contact_submissions.reply_message_id is
  'RFC-822 Message-ID of the reply, used to dedupe across polling runs.';

-- Fast "who wrote back and I haven't handled yet?" query
create index if not exists contact_submissions_unhandled_replies_idx
  on public.contact_submissions (reply_received_at desc)
  where reply_received_at is not null and reply_status = 'pending';
