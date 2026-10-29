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

## The DATUM tab and the cloud worker

The UTAG site has a DATUM tab (owner-only, admin sign-in). It
queues songs into `datum_jobs` (migration
`20261029_datum_jobs.sql`, run in the dashboard) through
utag-control actions `datum_queue`, `datum_list`, `datum_retry`,
and `datum_run`. `datum_run` sends a repository dispatch that
starts `.github/workflows/datum.yml`, the GitHub Actions worker.

The worker runs this script with `--queue`:

```bash
python datum.py --queue
```

It works pending jobs oldest first. For each job it looks the
song up in UTAG; if it is there, the rip links to that track;
if it is not, it creates the entry as `needs_review` through
utag-control `fixer_save` (needs `UTAG_SITE_PASSWORD`) and links
to the new track. A failure marks the job failed with its error
and error_kind, and the link stays in `failed_links/failed.jsonl`
for recovery. A job is never deleted.

GitHub Actions secrets (repo Settings > Secrets and variables >
Actions, never in code): `UTAG_SUPABASE_URL`,
`UTAG_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`,
`UTAG_SITE_PASSWORD`, plus `YOUTUBE_COOKIES` for the drip worker
below (cookies.txt content, pasted as the secret value, never in
chat or code).

## The cycling drip pipeline (every artist, every song)

`--drip` replaces the original Google Sheet with the UTAG artists
table. It is not a manual queue and it does not invent artists.

```bash
# one runner, 50 tracks
python datum.py --drip 50
# runner 1 of 3 in the GitHub matrix
python datum.py --drip 50 --shard 1 --shards 3
```

Selection: artists are sorted by lowest percentage filled first
(audio count / total tracks), then by name. Runner `shard` takes
artist positions shard, shard+shards, shard+2*shards, so parallel
runners never pick the same artist in the same run. Each runner
cycles its artists, one random unfilled track per artist per
cycle, until its batch is full.

Fast and slow, by design:
- Fast mode: 20 runners, 50 tracks per runner, every hour.
  Fast mode only picks tracks with no audio and no datum_job at
  all. A track that fails is saved for last, not retried next
  hour, and not on a cooldown timer.
- Slow mode (`--slow`): the retry pass, failed tracks only,
  with a much longer delay between tracks. If fast mode fails
  at scale, slow mode is how it retries, slower.
- Circuit breaker: 3 consecutive failures stop that runner's
  batch, with partial progress kept. It exits clean, it does not
  keep hammering YouTube or burn through cookies.
- Stale running jobs (running over 2 hours, i.e. a killed
  runner) are reset to failed at the start of a drip run, so
  they go to the slow pool instead of stranding.
- An upload or track_audio failure marks the job failed, never
  done, so a full bucket cannot fake progress. Proven in the
  sandbox test 2026-10-29: a track whose converted mp3 exceeded
  the bucket's 100 MB limit was correctly marked failed, and
  slow mode correctly picked it up as a failed-only track.
- Cookies: if `cookies.txt` exists in the working directory,
  yt-dlp uses it for search and download. The GitHub workflow
  writes it from the `YOUTUBE_COOKIES` secret when present and
  the runner is wiped after the run. Without cookies, GitHub
  runners get bot-checked (proven 2026-10-29); the sandbox does
  not, which is why the first drip tests ran there.

The workflow has the fast drip job on an hourly schedule and
on `workflow_dispatch`, and a slow retry job on
`workflow_dispatch` only. The schedule only does useful work
once `YOUTUBE_COOKIES` is set and the audio bucket is replaced
with a cloud storage provider with room for the full library;
until then, hourly runs will fail tracks into the slow pool
instead of linking them.

Storage note: at about 6 MB per track, the full library
(28,560 tracks) is roughly 170 GB. The current Supabase Free
bucket quota is 1 GB, so it fills after roughly 170 songs.
See the storage comparison in chat before turning the drip
loose; the pipeline code is storage-agnostic, but the bucket
is not.

## Files

- `datum.py` - fixed ripper + UTAG adapter
- `recovery.py` - 404 recovery script
- `failed_links/failed.jsonl` - recoverable failure queue (created on first failure)
- `failed_links/search_failures.jsonl` - searches that returned no URL to recover
- `downloads_manifest.jsonl` - every successful rip, with local path,
  storage path, UTAG track id, size, and sha256
- `failed_downloads.md` - human-readable report of the latest run only
