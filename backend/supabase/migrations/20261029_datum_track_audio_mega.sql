-- DATUM Mega holding tank (2026-10-29, temporary until the physical server).
-- track_audio gains a Mega public link column. Supabase rows keep
-- mega_url NULL and keep using the signed-URL path. Mega rows store
-- storage_path as "mega:<Mega folder>/<track_id>/<file>" and the
-- public link here. The link does not expire, so it is only handed
-- out through the admin-gated utag-control audio_url action, never
-- published on the site or listed in the public track_audio read.
alter table public.track_audio
  add column if not exists mega_url text;
