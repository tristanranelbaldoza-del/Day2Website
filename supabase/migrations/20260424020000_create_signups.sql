-- ══════════════════════════════════════════════════════════════════
-- signups — daily briefing source
-- ══════════════════════════════════════════════════════════════════
-- Populated by your signup form (or the seed script); read by
-- morning-briefing/signup-briefing.js every morning at 7 AM.

create table if not exists public.signups (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  name          text not null,
  email         text not null,
  company       text,
  -- Rough categorization. The AI summary uses this to say things like
  -- "2 from SaaS companies." Values I'm using:
  --   saas | ecommerce | agency | enterprise | personal | other
  company_type  text,
  source        text,                         -- e.g., 'landing-page', 'podcast'
  notes         text
);

create index if not exists signups_created_at_idx on public.signups (created_at desc);
create index if not exists signups_company_type_idx on public.signups (company_type);

comment on table  public.signups              is 'Daily signups — read by morning-briefing workflow';
comment on column public.signups.company_type is 'Rough category: saas | ecommerce | agency | enterprise | personal | other';
