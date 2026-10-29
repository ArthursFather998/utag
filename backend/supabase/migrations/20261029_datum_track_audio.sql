-- DATUM Central Memory Bank: audio storage + track link.
-- Run in the Supabase dashboard SQL editor, against the UTAG database
-- (the same database that holds public.tracks, not an empty project).
-- Idempotent: safe to run more than once.
--
-- Bucket is PRIVATE. Audio bytes are not served publicly. Splotify
-- Import from UTAG gets a short-lived signed URL from utag-control
-- (action audio_url, gated by the UTAG site password), never a
-- public bucket URL. The track_audio table itself is public-read,
-- like the rest of UTAG metadata: it exposes track ids and storage
-- paths, not audio bytes.

insert into storage.buckets (id, name, public, file_size_limit)
values ('central-memory-bank', 'central-memory-bank', false, 104857600)
on conflict (id) do nothing;

-- No anon/authenticated storage policies are created on purpose:
-- only the service role (utag-control, DATUM with a service key)
-- uploads to or signs URLs for this bucket.

create table if not exists public.track_audio (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  storage_path text not null unique,
  source_url text,
  source text not null default 'datum'
    check (source in ('datum', 'datum_recovery', 'manual')),
  file_name text,
  file_size bigint,
  content_type text not null default 'audio/mpeg',
  status text not null default 'available'
    check (status in ('available', 'missing', 'replaced')),
  created_at timestamptz not null default now()
);

alter table public.track_audio enable row level security;

drop policy if exists "public can read track_audio" on public.track_audio;
create policy "public can read track_audio"
on public.track_audio for select
to anon, authenticated
using (true);

-- One audio record per song per source URL: re-running DATUM on the
-- same song can never create a second conflicting audio record.
create unique index if not exists track_audio_track_source_uidx
on public.track_audio (track_id, source_url)
where source_url is not null;

create index if not exists track_audio_track_idx
on public.track_audio (track_id);
