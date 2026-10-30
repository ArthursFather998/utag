CORRECTION 2026-10-29: utag-control already has an update-by-id action, `correct` (entity_type, entity_id, field, new_value, admin-gated, corrections row, repo sync). The fixer does NOT need a new fixer_correct action; it calls `correct` per field, with a note naming the fixer confidence. The original draft claim that no update-by-id action exists was wrong.

# SSDB fixer integration — DRAFT, not live, not run in the cloud

Status: investigation + draft only, 2026-10-29. No workflow run, no Mega
move/link/apply, no commit, no push. Skyler's rule that triggered this:
anything uploaded into the SSDB folder must go through the UTAG fixer
to fix the tags, so DATUM, UTAG, and Splotify stay in sync.

## 1. The gap, with file paths

Today a file landing in SSDB gets a Mega link and a `track_audio` row,
but its tags are never run through the fixer, and its UTAG metadata is
never verified or corrected from the file:

- `backend/datum/mega_organize.py` (288 lines): `main()` lists Mega
  files with `rclone lsjson`, matches each file to a UTAG track with
  `utag_lookup(title, album_folder)` (title from the filename, album
  from the parent folder), moves it to `dest_path()` =
  `SSDB/<Artist>/<Album>/<Song>.mp3`, then `link_and_insert()` creates
  the public Mega link and the `track_audio` row (`source="backup"`).
  Nothing in that file reads ID3 tags, calls any catalog, or writes
  any `tracks`/`releases`/`artwork` row.
- `backend/datum/datum.py`, `process_track()` (line ~1121): for a DATUM
  rip it downloads with yt-dlp, then `upload_to_mega()` /
  `upload_to_central_memory()` links it. The only "fixer" touch is
  `ensure_utag_track_via_fixer()` (line ~720), which calls utag-control
  `fixer_save` to *create* a missing library entry from the job's
  artist/title/album/year — it does not audit or correct tags, and
  it is only used when the song is not already in UTAG.
- The UTAG fixer engine itself is browser-only:
  `~/workspace/utag-site/fixer.js` (685 lines, `window.UtagFixer`).
  Chain, in order: library roster → Apple Music → Deezer →
  MusicBrainz (1 req/sec, 503 backoff) → AcoustID fingerprint (only
  if an AcoustID key is present, and never for Skyler Green songs,
  `looksLikeHis()`). Artwork: Apple → Deezer → Cover Art Archive →
  fanart.tv. Lyrics: embedded tags first, then LRCLIB. Tag reading is
  in-browser via vendored music-metadata (`parseFile()`). The caller
  (site `app.js` fixer UI, and Splotify's `utag.js` pass 2) reviews
  proposals and only then calls utag-control `fixer_save`.
- `backend/supabase/functions/utag-control/index.ts`:
  `fixer_save` (line ~439) ensures artist → release → track by name,
  adds canonical artwork only if the release has none, upserts lyrics,
  and syncs touched rows to the repo. `fixer_log` (line ~617) writes
  `hermes_jobs`/`hermes_events` rows for the Activity tab. There is
  NO server-side fixer action and NO update-by-track-id action.

Two latent bugs this design must not paper over:

1. `fixer_save` is an upsert-by-corrected-name, not an update-by-id.
   For a backup file whose UTAG track already exists, calling
   `fixer_save` with a *corrected* title/artist/album would create a
   second track under the corrected release and leave the old track —
   and its `track_audio` row — orphaned. So a fixer pass over existing
   tracks needs a new utag-control action, `fixer_correct`
   (update `tracks`/`releases` by id, with old/new values, confidence,
   and repo sync), or it must not write UTAG rows at all. The draft
   below takes the second option until `fixer_correct` exists.
2. `track_audio.source` has a CHECK constraint
   (`20261029_datum_track_audio.sql`: `source in
   ('datum', 'datum_recovery', 'manual')`). `mega_organize.py` and
   `datum.py:link_mega_existing()` insert `source="backup"`, which
   that constraint rejects (400, not 409). The draft uses
   `source="manual"` for any row it would insert, and the proposed
   migration in §6 adds `'backup'` — it is not applied here.

## 2. Architecture rule, and how this design respects it

The fixer engine lives ONLY in UTAG. Splotify must NOT get its own
engine. Splotify already honours this: `~/workspace/splotify/js/utag.js`
`fixTrack()` does pass 1 (UTAG DB lookup, `applyHit()` for
verified/high_confidence hits, review queue otherwise) and pass 2
(loads the UTAG site's `fixer.js` live, never a copy).

This draft therefore lives in the UTAG repo only
(`backend/datum/ssdb_fixer.py`), writes UTAG rows only through
utag-control (`fixer_save` for new entries, `fixer_correct` once it
exists), and changes no Splotify code. Splotify picks up corrected
metadata on its next UTAG import via `applyHit()` — no Splotify
engine, no Splotify tag writer.

The one honest exception: `fixer.js` itself cannot run unchanged on a
GitHub runner. It is browser-coupled (`window`, `localStorage` for
AcoustID/fanart keys, `File`/`Blob`, vendored music-metadata and a
chromaprint shim). Running it headless would need a Node/browser
shim layer and is fragile. The draft is therefore a UTAG-backend
Python port of the same chain, same order, same confidence caps, and
same guards — not a Splotify copy, and not a second source of truth:
UTAG DB remains the authority, and the browser fixer stays the
reference for proposal wording/confidence. If Skyler wants
byte-identical proposals, the alternative is a Node shim around
`fixer.js` (see §7); it is not the recommended first step for a
416-file bulk pass.

## 3. Proposed flow

Two entry points, same audit functions. The standalone post-pass is
the recommended first run, because a fixer failure must never block
a move or a link.

### A. Standalone post-pass (recommended first)
`python backend/datum/ssdb_fixer.py --mode utag-only --dry-run`
(then `--apply` only after Skyler has seen the report), run after
`mega_organize.py --apply`, over files already in
`DATUM/SSDB/<Artist>/<Album>/<Song>.mp3`, keyed by `track_audio`
`storage_path`.

### B. Later hook (not wired in this draft)
In `mega_organize.py:main()`, after `link_and_insert()` succeeds,
call `ssdb_fixer.audit_file(...)` with the dry-run flag passed
through, and merge its counts into the organizer summary. In
`datum.py:process_track()`, for a fresh rip the file is local before
`upload_to_mega()`, so the same audit can run on the local file and
its corrected artist/album/title can feed `mega_path_for()` — that
is the "anything uploaded into SSDB goes through the fixer" rule
applied to new rips, not just to the backup. Both hooks are sketched
in `ssdb_fixer.py`'s docstring; neither is wired here.

Per file, in order:

1. **List / identify (already exists, reused, never guessed).**
   `rclone lsjson --recursive` (mega_organize) or `track_audio`
   rows (post-pass). UTAG lookup by normalized filename title +
   album folder, exactly as `mega_organize.utag_lookup()`. No match
   or ambiguous → left in place, status `unmatched`, no fixer call.
2. **Roster pass (no download, no external API).** Compare the
   file's artist (filename/folder, or embedded tag if already
   downloaded) to the UTAG artist roster with the same normalized
   Levenshtein similarity as `fixer.js:strSim()`. A near-match
   (≥0.80, <1.0) proposes the roster name, confidence
   `0.5 + sim * 0.45`, source `library roster`. This is the
   cheapest correction and the one most backup files need.
3. **UTAG DB pass (no download).** Fetch the matched track +
   release + artist via the anon PostgREST read. If that track's
   confidence is `verified` or `high_confidence`, UTAG itself is
   the corrected metadata: propose UTAG title/artist/album/year
   where they differ from the file's filename/folder values, and
   treat the file as `fixed` once those values are recorded
   (see §4 for what "recorded" means before `fixer_correct`
   exists). If the UTAG track is `needs_review`/`conflicting`,
   do NOT auto-correct from it; fall through to the catalog audit
   and queue any UTAG difference for human review.
4. **Catalog audit (only with `--mode catalog`; downloads the file
   once with `rclone copyto` to a temp dir).** Read embedded tags
   (mutagen if installed, else filename/folder fallback — same
   precedence as `fixer.js:parseFile()`: embedded artist/title,
   else filename candidates, else "Unknown"). Then, in fixer.js
   order: Apple iTunes Search, then Deezer only if not verified,
   then MusicBrainz (1 req/sec, 503 backoff, score ≥60, title
   similarity gate as in `mbPick()`), then AcoustID only if
   `ACOUSTID_KEY` is set AND the artist is not Skyler Green
   (`looksLikeHis` guard, carried over verbatim). Artwork chain
   Apple → Deezer → Cover Art Archive → fanart.tv (only if
   `FANART_KEY` is set). Lyrics: embedded first, then LRCLIB.
   One proposal per field; highest confidence wins, with the
   fixer.js caps (Apple title 0.92, artist 0.90, album/year/
   trackNo 0.85; Deezer/MusicBrainz equivalents in the draft).
5. **Decide (confidence-gated auto-apply, mirroring Splotify's
   `fixTrack()`).** Apply only if the audit is `verified`, or
   every applied proposal has confidence ≥0.90 with an exact
   normalized title+artist match. Anything else → status
   `review`, proposals written to the report and to `fixer_log`,
   file still linked and still organized, but NOT marked fixed.
   No proposal is ever applied on a guess, and no file is ever
   deleted or moved because its fixer pass failed.
6. **Write (see §4 for the decision Skyler still has to make).**
   Default: UTAG metadata only, file bytes untouched — exactly
   the current browser fixer's semantics ("Saving writes the
   corrected metadata to your library. The audio files are
   discarded.", `app.js` fixer review screen). Optional
   `--write-tags`: rewrite ID3 in the temp copy (title, artist,
   album, year, track number, genre; embedded art only from a
   canonical artwork URL that actually downloads), re-upload
   with `rclone copyto` to the SAME Mega path, re-run `rclone
   link`, and update the `track_audio` row's `mega_url` (the
   link can change when the file node is replaced). This mode is
   off by default and is refused in dry-run.
7. **Log.** Per-file row in `ssdb_fixer_report.jsonl`
   (same append-only pattern as `failed_links/failed.jsonl`):
   mega_path, track_id, embedded tags, UTAG before-values,
   proposals, applied fields, status, and any error. If
   `UTAG_SITE_PASSWORD` is present, also `fixer_log` start/event/
   done via utag-control, so the Activity tab shows the run;
   a logging failure never fails the file.

## 4. The decision Skyler still has to make (do not decide for him)

"Fix the tags" means two different things, and they have different
costs:

- **(a) UTAG metadata only (recommended default).** Splotify's
  normal import path is UTAG-lookup-first (`utag.js:fixTrack()` /
  `applyHit()`): a verified/high_confidence UTAG hit corrects the
  on-device title/artist/album/year/art even if the file's own
  ID3 tags are wrong. For that path, fixing UTAG is sufficient,
  it costs no Mega re-upload, and it cannot break a cached Mega
  link. This matches what the browser fixer already does.
- **(b) Embedded ID3 tags in the Mega file as well.** This is
  only needed if Splotify v10's direct Mega-folder import reads
  file tags and does NOT do a UTAG lookup first. That is a
  question for the separate v10 work, not something this draft
  assumes. If the answer is "direct import bypasses UTAG", then
  either `--write-tags` must be on, or v10 must be changed to
  UTAG-lookup-first (the same rule Splotify already follows for
  its other imports). Until that is answered, the draft defaults
  to (a) and treats (b) as an explicit opt-in.

Related decisions, also not made here: (i) whether
`fixer_correct` (update-by-id) should be added to utag-control,
or whether corrected existing tracks should instead go through
the existing human-review queue in the UTAG site; (ii) whether
the catalog audit's external APIs need any new secret beyond
optional `ACOUSTID_KEY` / `FANART_KEY` (Apple, Deezer,
MusicBrainz, CAA, LRCLIB need none); (iii) whether the first
cloud run should be `utag-only` (no downloads, no external
calls, ~minutes for 416 files) or `catalog` (one ~5 GB Mega
download pass, plus one request per file per catalog).

## 5. Failure handling, rate limits, and cost

- Per-file `try/except`: a failed audit, a failed artwork fetch,
  or a failed `fixer_log` call marks that file `failed` in the
  report and moves on. Nothing is retried in a loop, and a
  circuit breaker (3 consecutive failures, same pattern as
  DATUM's drip) stops the run early with partial progress kept.
- MusicBrainz: 1 req/sec, 503 backoff doubling from 2s, never
  cache failures (mirrors `fixer.js`).
- Mega transfer: `utag-only` mode downloads nothing. `catalog`
  mode downloads each file once (~5 GB for the 416-song backup;
  well inside a 200 GB/mo transfer budget, but the full ~170 GB
  library would be a different story and should be batched).
  `--write-tags` doubles that (download + re-upload) and can
  change the Mega link, so it is never on by default.
- No file is ever deleted. A `rclone move` failure in the
  organizer (a separate step) leaves the file where it was;
  a fixer failure leaves both the file and its `track_audio`
  row exactly as they were.

## 6. Proposed migration snippet (NOT applied here)

```sql
-- Run in the Supabase dashboard SQL editor, only if Skyler wants
-- a distinct 'backup' source instead of reusing 'manual'.
alter table public.track_audio
  drop constraint track_audio_source_check;
alter table public.track_audio
  add constraint track_audio_source_check
  check (source in ('datum', 'datum_recovery', 'manual', 'backup'));
```

## 7. Alternative considered and not recommended first

A Node/browser shim that runs `fixer.js` itself headlessly on the
runner. It preserves byte-identical proposals and the single-engine
rule in the strictest sense, but `fixer.js` reads keys from
`localStorage`, reads tags via `window.mm.parseBlob`, fingerprints
via `window.SplotifyFingerprint`, and expects `File`/`Blob`
objects — every one of those needs a shim, and the shim would
itself be a second implementation surface. Revisit only if the
Python port's proposals diverge from the browser fixer's on a
real sample, and then only for the audit step, never by copying
any engine code into Splotify.

## 8. UPDATE 2026-10-29 — verified backup shape and folder-link access (correction)

The backup was verified via the folder link (link key is NOT recorded
anywhere in this repo or in this document). Verified facts:

- Root folder in the link is SSDB: **416 audio files, 3 other files,
  ~6,111 MB total, 295 top-level album folders.**
- Actual format is **Album / "Artist - Title.mp3"**, NOT
  Artist/Album/Song. Example: album folder `AM`, file
  `Arctic Monkeys - I Wanna Be Yours.mp3`. There are ~1.4 songs per
  album folder on average, so most album folders are single-song
  releases/singles — the folder name is the release title, not a
  guarantee of a multi-track album.
- The GitHub runner's Mega login sees DATUM/SSDB empty (diagnostic
  runs #1–#4, including a DATUM-recursive listing that was also
  empty, and an "Imported" folder that rclone reports as
  "directory not found" despite appearing in the root listing),
  while the folder link lists all 416 songs. The folder-link path
  is therefore REQUIRED, not a fallback, for this backup — unless
  and until the runner's account and the web account are proven to
  be the same account with the same folder visible.

Consequences, all reflected in `ssdb_fixer.py` and its tests:

1. **Parsing rule (mandatory).** Split every backup filename on
   the FIRST `" - "` into artist and title; the parent folder is
   the album. Titles containing `" - "` later keep it
   (`"Artist - Song - Live.mp3"` → title `"Song - Live"`). A name
   with no `" - "` yields artist="" and title=stem — the artist
   is never invented from the folder. `ssdb_fixer.py` implements
   this as `parse_backup_filename()` and
   `parse_mega_link_listing()`; `read_tags()` uses the same rule
   for its filename fallback.
2. **Organizer bug this exposes (flagged, not fixed here).**
   `mega_organize.py:main()` currently passes the whole stem to
   `utag_lookup()` as the title (`stem = parts[-1][:-4]`). For a
   backup file that stem is `"Arctic Monkeys - I Wanna Be Yours"`,
   which will never normalize-equal the UTAG title
   `"I Wanna Be Yours"` — so the organizer would mark almost all
   416 backup files `UNMATCHED` even once it can see them. The
   fixer draft's `main()` parses first and looks up by parsed
   title + album folder, and records any filename-artist vs
   UTAG-artist mismatch for review. `mega_organize.py` needs the
   same parse step before any `--apply` run against this backup.
3. **Access paths (both, in this order for this backup).**
   - (a) Folder link (works now): draft Node helper
     `ssdb_mega_link.mjs` (megajs, same library Splotify v9.5
     uses) lists the linked folder to JSON `[{path, size}]` and
     downloads one file at a time. The link is supplied only via
     the `MEGA_FOLDER_LINK` env var / GitHub secret at runtime,
     is never printed, logged, or stored, and the helper prints
     only paths and sizes. `parse_mega_link_listing()` consumes
     that JSON and never sees the link.
   - (b) Account login via rclone (works for DATUM rips and for
     any folder the runner's account can actually see): the
     existing `rclone lsjson` / `copyto` / `link` path in
     `mega_organize.py` and in the draft's `main()`. A listing
     that returns 0 files for a folder the user says is full is
     a hard stop, not a "nothing to do" result: the draft logs
     the count, and the operator must check the account/folder
     match before proceeding. Do NOT let a 0-file listing
     silently pass as a successful empty run.
4. **Counts and cost for this backup.** 416 audio files, 3 other
   files (skipped, counted, never treated as songs), ~6,111 MB
   (~14.7 MB per song on average). A `catalog`-mode fixer pass
   downloads each file once (~6 GB, one pass); a `utag-only`
   pass downloads nothing and should be the first cloud run.
   `--write-tags` would double the transfer and can change Mega
   links, so it stays off by default (see §4).
