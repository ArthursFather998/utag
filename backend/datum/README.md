# DATUM

DATUM is the official name for the friend-built song ripper, and it
lives here, inside UTAG, at `backend/datum/`. This folder holds the
fixed, UTAG-aware version. It does not rebuild the ripper: the
original search, download, and Gemma discovery functions are kept,
with the fixes listed below.

## Run it

```bash
cd backend/datum
pip install yt-dlp requests
# one specific song, linked to UTAG when it is found there
python datum.py --artist "Artist Name" --title "Song Title"
# one specific URL
python datum.py --artist "Artist Name" --title "Song Title" --url "https://www.youtube.com/watch?v=..."
# a list of UTAG entries (JSON: [{artist, title, utag_track_id}])
python datum.py --utag-list my-songs.json
# original discovery mode (Gemma invents artists, then rips them)
python datum.py --discover
# local only, no bucket upload
python datum.py --artist "A" --title "T" --no-upload
# chain the recovery pass after ripping
python datum.py --discover --recover
```

## Environment (never put keys in code or git)

- `UTAG_SUPABASE_URL` - UTAG Supabase project URL
- `UTAG_SUPABASE_ANON_KEY` - public anon key, UTAG lookups only
- `SUPABASE_SERVICE_KEY` - service role key, bucket upload + track_audio
  inserts only. Without it, DATUM runs local-only and still records
  the rip in `downloads_manifest.jsonl` as unlinked.
- `DATUM_BUCKET` - default `central-memory-bank`

## The 404 pipeline (see the final explanation in chat after the fix)

1. `datum.py` writes every failure to `failed_links/failed.jsonl`,
   appended and deduped by URL. That file is the queue.
2. `recovery.py` is the second script. By default it retries only
   404 entries, at most 3 attempts total, then marks them exhausted
   without deleting them.
3. A recovered file goes to the same bucket, links the same UTAG
   track id when known, and is appended to `downloads_manifest.jsonl`
   with `source: datum_recovery`.

```bash
python recovery.py --dry-run   # list what would be retried
python recovery.py             # retry pending 404s once
python recovery.py --watch 300 # poll the queue every 5 minutes
```

A separate third-party converter app was evaluated and not built.
yt-dlp with alternate clients covers the retry, and a converter
site can be plugged in per-link with `recovery.py --converter-url`
using a template containing `{url}`. No converter site is hardcoded
or endorsed here.

## UTAG setup (already live)

1. `backend/supabase/migrations/20261029_datum_track_audio.sql`
   was run in the Supabase dashboard on the UTAG database. It
   created the private `central-memory-bank` bucket and the
   `track_audio` table.
2. utag-control already has the `audio_url` action (signed URLs,
   site-password gated) for Splotify Import from UTAG.

## Files

- `datum.py` - fixed ripper + UTAG adapter
- `recovery.py` - 404 recovery script
- `failed_links/failed.jsonl` - recoverable failure queue (created on first failure)
- `failed_links/search_failures.jsonl` - searches that returned no URL to recover
- `downloads_manifest.jsonl` - every successful rip, with local path,
  storage path, UTAG track id, size, and sha256
- `failed_downloads.md` - human-readable report of the latest run only
