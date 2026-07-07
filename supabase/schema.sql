-- PlainGL multi-bank edition — Supabase storage table.
-- Run this once in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.plaingl_ledgers (
  id text primary key,
  beancount text not null default '',
  aux jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- The app talks to this table with the service-role key from the server only,
-- so lock the table down for anonymous/authenticated API access.
alter table public.plaingl_ledgers enable row level security;
