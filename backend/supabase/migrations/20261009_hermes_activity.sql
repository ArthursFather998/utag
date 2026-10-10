-- UTAG Hermes activity + approval layer (2026-10-09)
-- Run in the Supabase SQL editor (dashboard), once.
-- Adds: a unified Hermes job ledger, owner-approved proposals, a live
-- event log (including errors), the queue pause switch, and the private
-- direct-Hermes bridge endpoint row. Public read for the console tables;
-- all writes go through the service role or the password-gated function.

create table if not exists public.hermes_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'ruling', 'miss', 'upload', 'artwork', 'sweep_track', 'sweep_release', 'chat', 'apply'
  )),
  source_table text,
  source_id uuid,
  title text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'awaiting_approval', 'approved', 'applying',
    'done', 'failed', 'rejected', 'skipped'
  )),
  attempts integer not null default 0,
  result text,
  error text,
  hermes_session_id text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hermes_jobs_status_idx on public.hermes_jobs (status, created_at);
create index if not exists hermes_jobs_source_idx on public.hermes_jobs (source_table, source_id);

create table if not exists public.hermes_proposals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.hermes_jobs (id) on delete cascade,
  title text not null default '',
  summary text,
  confidence text check (confidence in (
    'verified', 'high_confidence', 'needs_review', 'conflicting', 'unknown'
  )),
  proposal jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'applied', 'apply_failed'
  )),
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz
);
create index if not exists hermes_proposals_status_idx on public.hermes_proposals (status, created_at);

create table if not exists public.hermes_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.hermes_jobs (id) on delete set null,
  level text not null default 'info' check (level in ('info', 'success', 'warn', 'error')),
  event text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists hermes_events_created_idx on public.hermes_events (created_at desc);

create table if not exists public.hermes_control (
  id text primary key,
  paused boolean not null default false,
  heartbeat_at timestamptz,
  current_job_id uuid references public.hermes_jobs (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.hermes_control (id) values ('queue') on conflict (id) do nothing;

-- Direct-Hermes bridge endpoint. NO public policy: only the service role
-- (and the password-gated control function) can read the token.
create table if not exists public.hermes_bridge (
  id text primary key,
  url text,
  token text,
  updated_at timestamptz not null default now()
);

alter table public.hermes_jobs enable row level security;
alter table public.hermes_proposals enable row level security;
alter table public.hermes_events enable row level security;
alter table public.hermes_control enable row level security;
alter table public.hermes_bridge enable row level security;

create policy "public read" on public.hermes_jobs for select using (true);
create policy "public read" on public.hermes_proposals for select using (true);
create policy "public read" on public.hermes_events for select using (true);
create policy "public read" on public.hermes_control for select using (true);

-- Uploads gain the approval-flow states.
alter table public.uploads drop constraint if exists uploads_status_check;
alter table public.uploads add constraint uploads_status_check
  check (status in ('queued', 'processing', 'awaiting_approval', 'done', 'failed', 'rejected'));
