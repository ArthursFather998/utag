-- UTAG track lyrics (2026-10-29)
-- Paste into the Supabase dashboard SQL editor. Do NOT run against a live
-- database from the sandbox; this file is the migration, not an applied one.
-- One row per track. Lyrics are stored separately from tracks so a lyrics
-- fetch never rewrites the track's metadata, and so an export before this
-- migration still works (the exporter treats the table as optional).

create table if not exists public.track_lyrics (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid not null unique references public.tracks(id) on delete cascade,
  plain_text text,
  synced_text text,
  source     text,
  status     text not null default 'missing'
    check (status in ('found','instrumental','missing','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists track_lyrics_track_idx
  on public.track_lyrics (track_id);

-- Reuse the core schema's updated_at trigger function if it exists.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where p.proname = 'touch_updated_at' and n.nspname = 'public') then
    execute 'drop trigger if exists trg_touch_updated_at on public.track_lyrics';
    execute 'create trigger trg_touch_updated_at before update on public.track_lyrics
             for each row execute function public.touch_updated_at()';
  end if;
end $$;

-- Public read, same pattern as tracks. Writes go through utag-control only.
alter table public.track_lyrics enable row level security;
drop policy if exists "public read" on public.track_lyrics;
create policy "public read" on public.track_lyrics for select using (true);
