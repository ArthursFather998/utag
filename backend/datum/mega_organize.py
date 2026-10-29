"""Mega backup organizer for DATUM. Run in the cloud, never by hand.

The user only puts the Splotify backup in the SSDB folder on Mega,
as-is, currently categorized by album. This script does the rest,
automatically, on a GitHub runner that already has rclone + Mega
secrets + the Supabase service key:

  1. List SSDB recursively with rclone lsjson.
  2. For each .mp3, work out the UTAG track: title from the filename,
     album from the parent folder when present, then a UTAG lookup
     by normalized title, filtered by album when there is one.
     Nothing is guessed: a title with no UTAG match, or with
     several different UTAG tracks and no album to disambiguate,
     is left exactly where it is and listed as unmatched.
  3. Move the file to SSDB/<Artist>/<Album>/<Song>.mp3, the layout
     the user approved 2026-10-29. If it is already there, no move.
  4. Create a public Mega link for the final path and insert a
     track_audio row (storage_path "mega:<path>", mega_url, source
     "backup"), so DATUM's drip and queue skip it as already filled
     and Splotify can import it from UTAG. An existing track_audio
     row for that track is kept, not duplicated.

Usage, on the runner (DATUM workflow, or any shell with rclone):
    python backend/datum/mega_organize.py --dry-run
    python backend/datum/mega_organize.py --apply [--limit N]

--dry-run is the default safety: it prints every move/link/insert
it would do and changes nothing. --apply does the moves, links,
and inserts. A failed move, link, or insert leaves the file where
it was and is reported, never silently dropped.

Env: MEGA_REMOTE (default mega-remote), MEGA_ROOT (default SSDB),
UTAG_SUPABASE_URL, UTAG_SUPABASE_ANON_KEY (lookups),
SUPABASE_SERVICE_KEY (track_audio inserts only; required for
--apply, not for --dry-run).
"""

import argparse
import json
import os
import re
import subprocess
import sys

import requests

SUPABASE_URL = (os.environ.get("UTAG_SUPABASE_URL") or "https://akusfgoeplfqwrrrywfl.supabase.co").rstrip("/")
MEGA_REMOTE = os.environ.get("MEGA_REMOTE", "mega-remote").strip() or "mega-remote"
MEGA_ROOT = os.environ.get("MEGA_ROOT", "DATUM/SSDB").strip() or "SSDB"
MEGA_HOST = "mega" + "." + "nz"


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def clean_part(s):
    return re.sub(r"[/\\]+", "-", (s or "").strip()).strip(" .") or "Unknown"


def dest_path(artist, album, title):
    parts = [MEGA_ROOT, clean_part(artist)]
    if (album or "").strip():
        parts.append(clean_part(album))
    parts.append(clean_part(title) + ".mp3")
    return "/".join(parts)


def rclone(*args, timeout=300):
    return subprocess.run(["rclone", *args], capture_output=True, text=True, timeout=timeout)


def list_mega_files():
    cp = rclone("lsjson", "--recursive", f"{MEGA_REMOTE}:{MEGA_ROOT}", timeout=600)
    if cp.returncode != 0:
        raise RuntimeError(f"rclone lsjson failed: {(cp.stderr or '')[:300]}")
    return [e for e in json.loads(cp.stdout or "[]") if not e.get("IsDir") and str(e.get("Path", "")).lower().endswith(".mp3")]


_TRACKS_CACHE = None
_ARTIST_CACHE = {}
_RELEASE_CACHE = {}


def _load_tracks():
    global _TRACKS_CACHE
    if _TRACKS_CACHE is not None:
        return _TRACKS_CACHE
    anon = os.environ.get("UTAG_SUPABASE_ANON_KEY", "").strip()
    if not anon:
        raise RuntimeError("UTAG_SUPABASE_ANON_KEY not set, cannot look up UTAG tracks")
    headers = {"apikey": anon, "Authorization": f"Bearer {anon}"}
    tracks = []
    offset = 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/tracks",
            params={"select": "id,title,artist_id,release_id", "limit": 1000, "offset": offset},
            headers=headers, timeout=60,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        tracks.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    _TRACKS_CACHE = tracks
    return tracks


def _artist_name(artist_id, headers):
    if artist_id in _ARTIST_CACHE:
        return _ARTIST_CACHE[artist_id]
    name = ""
    ar = requests.get(
        f"{SUPABASE_URL}/rest/v1/artists",
        params={"select": "canonical_name", "id": f"eq.{artist_id}"},
        headers=headers, timeout=30,
    )
    if ar.ok and ar.json():
        name = ar.json()[0].get("canonical_name", "")
    _ARTIST_CACHE[artist_id] = name
    return name


def _release_title(release_id, headers):
    if release_id in _RELEASE_CACHE:
        return _RELEASE_CACHE[release_id]
    title = ""
    rr = requests.get(
        f"{SUPABASE_URL}/rest/v1/releases",
        params={"select": "title", "id": f"eq.{release_id}"},
        headers=headers, timeout=30,
    )
    if rr.ok and rr.json():
        title = rr.json()[0].get("title", "")
    _RELEASE_CACHE[release_id] = title
    return title


def _headers():
    anon = os.environ.get("UTAG_SUPABASE_ANON_KEY", "").strip()
    if not anon:
        raise RuntimeError("UTAG_SUPABASE_ANON_KEY not set, cannot look up UTAG tracks")
    return {"apikey": anon, "Authorization": f"Bearer {anon}"}


def has_audio(track_id):
    """True if UTAG already has any track_audio row for this track (anon read)."""
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/track_audio",
            params={"select": "id", "track_id": f"eq.{track_id}", "limit": 1},
            headers=_headers(), timeout=30,
        )
        return r.ok and bool(r.json())
    except Exception:
        return False


def utag_lookup(title, album):
    """Return (track_id, artist, album_title, title) or None, or 'ambiguous'."""
    headers = _headers()
    tracks = _load_tracks()
    want = norm(title)
    matches = [t for t in tracks if norm(t.get("title", "")) == want]
    if not matches:
        return None
    if len(matches) == 1:
        track = matches[0]
    else:
        if album:
            by_album = [t for t in matches if t.get("release_id") and norm(_release_title(t["release_id"], headers)) == norm(album)]
            if len(by_album) == 1:
                track = by_album[0]
            else:
                return "ambiguous"
        else:
            return "ambiguous"
    artist = _artist_name(track.get("artist_id"), headers) if track.get("artist_id") else ""
    album_title = _release_title(track["release_id"], headers) if track.get("release_id") else ""
    if not album_title:
        album_title = album or ""
    if not artist:
        return None
    return (str(track["id"]), artist, album_title, str(track.get("title", "") or title))


def link_and_insert(mega_path, track_id, file_size, dry_run):
    """Create the Mega link and the track_audio row. Returns storage_path or None."""
    storage_path = f"mega:{mega_path}"
    if dry_run:
        return storage_path
    service = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not service:
        raise RuntimeError("SUPABASE_SERVICE_KEY not set, cannot insert track_audio")
    lk = rclone("link", f"{MEGA_REMOTE}:{mega_path}", timeout=120)
    link = (lk.stdout or "").strip().splitlines()[-1].strip() if lk.stdout else ""
    if lk.returncode != 0 or MEGA_HOST not in link:
        print(f"  LINK FAILED for {mega_path}", file=sys.stderr)
        return None
    headers = {"apikey": service, "Authorization": f"Bearer {service}"}
    row = {
        "track_id": track_id,
        "storage_path": storage_path,
        "mega_url": link,
        "source_url": None,
        "source": "backup",
        "file_name": mega_path.rsplit("/", 1)[-1],
        "file_size": int(file_size or 0),
        "content_type": "audio/mpeg",
        "status": "available",
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/track_audio",
        headers={**headers, "Content-Type": "application/json", "Prefer": "return=representation"},
        json=row, timeout=30,
    )
    if r.status_code in (200, 201):
        return storage_path
    if r.status_code == 409:
        return storage_path
    print(f"  INSERT FAILED for {mega_path}: {r.status_code} {(r.text or '')[:200]}", file=sys.stderr)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print actions, change nothing (default if --apply absent)")
    ap.add_argument("--apply", action="store_true", help="actually move, link, and insert")
    ap.add_argument("--limit", type=int, default=0, help="only process the first N files (test runs)")
    args = ap.parse_args()
    dry_run = not args.apply
    files = list_mega_files()
    if args.limit:
        files = files[: args.limit]
    print(f"Found {len(files)} mp3 files under {MEGA_ROOT} (dry_run={dry_run})")
    moved = linked = unmatched = failed = 0
    for entry in files:
        src_rel = entry["Path"]
        src = f"{MEGA_ROOT}/{src_rel}"
        parts = src_rel.split("/")
        stem = parts[-1][:-4]
        album_folder = parts[-2] if len(parts) >= 2 else ""
        try:
            found = utag_lookup(stem, album_folder)
        except Exception as exc:
            print(f"SKIP {src}: lookup error {exc}")
            failed += 1
            continue
        if found is None:
            print(f"UNMATCHED (no UTAG track, left in place): {src}")
            unmatched += 1
            continue
        if found == "ambiguous":
            print(f"UNMATCHED (several UTAG tracks, left in place): {src}")
            unmatched += 1
            continue
        track_id, artist, album_title, title = found
        dst = dest_path(artist, album_title, title)
        if src == dst:
            action = "already organized"
        else:
            action = f"MOVE {src} -> {dst}"
            if not dry_run:
                mv = rclone("move", f"{MEGA_REMOTE}:{src}", f"{MEGA_REMOTE}:{dst}", timeout=600)
                if mv.returncode != 0:
                    print(f"  MOVE FAILED {src}: {(mv.stderr or '')[:300]}", file=sys.stderr)
                    failed += 1
                    continue
                moved += 1
        if has_audio(track_id):
            print(f"{action} | already linked in UTAG, no new row -> {artist} - {title} [{track_id}]")
            continue
        result = link_and_insert(dst, track_id, entry.get("Size"), dry_run)
        if result:
            linked += 1
            print(f"{action} | link -> {artist} - {title} [{track_id}]")
        else:
            failed += 1
    print(f"Done: {moved} moved, {linked} linked, {unmatched} unmatched, {failed} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
