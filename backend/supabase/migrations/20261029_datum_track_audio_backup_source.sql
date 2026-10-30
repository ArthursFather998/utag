-- DATUM / SSDB backup source for track_audio.
-- The original track_audio migration only allowed
-- datum / datum_recovery / manual, so organizer and fixer rows
-- with source='backup' were rejected with a CHECK violation.
-- Run this in the Supabase dashboard SQL editor, then the
-- organizer/fixer 'backup' inserts work. Safe to re-run: the
-- constraint is dropped first, then re-added with 'backup'.
alter table public.track_audio
  drop constraint if exists track_audio_source_check;
alter table public.track_audio
  add constraint track_audio_source_check
  check (source in ('datum', 'datum_recovery', 'manual', 'backup'));
