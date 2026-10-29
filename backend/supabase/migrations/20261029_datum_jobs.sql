-- DATUM queue for the UTAG site DATUM tab.
--
-- The tab queues songs here (via utag-control, admin-gated). The DATUM
-- worker, in GitHub Actions or run locally with --queue, picks up
-- pending rows in order, rips the song, uploads it to the private
-- central-memory-bank bucket, links it with a track_audio row, and
-- marks the job done. A job is never deleted: a failure stays on the
-- record with its error, so a 404 is recoverable, not lost.
--
-- RLS is on with no anon policies. Only the service role, through
-- utag-control, reads or writes this table, so the queue is
-- owner-only. The public site never reads it directly.

create table if not exists public.datum_jobs (
  id uuid primary key default gen_random_uuid(),
  artist text not null,
  title text not null,
  album text,
  release_year integer,
  source_url text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  utag_track_id uuid references public.tracks (id) on delete set null,
  storage_path text,
  error text,
  error_kind text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.datum_jobs enable row level security;

create index if not exists datum_jobs_status_created_idx
  on public.datum_jobs (status, created_at);
create index if not exists datum_jobs_track_idx
  on public.datum_jobs (utag_track_id);
