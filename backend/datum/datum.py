"""DATUM - the official name for the friend-built song ripper.

What this file is: the pasted ripper, fixed in place, not rebuilt.
What changed, in short:
  - download_track now returns the actual file it made, and fails loudly
    if yt-dlp finishes without producing one. The old version returned
    nothing, so nothing downstream could link, upload, or verify a rip.
  - Failures are no longer only a markdown file that each run overwrote.
    Every failure goes to failed_links/failed.jsonl (append, deduped by
    URL), which recovery.py can actually read. Markdown is now just a
    human-readable report of the current run, not the record itself.
  - 404s are classified, not lumped in with every other error. See
    classify_error() and the 404 note in README.md.
  - Google Docs is no longer the default failure sink. It is kept for
    compatibility but only runs with --google-doc.
  - Ollama token budget scales with the number of artists requested.
    The old code asked for 100 artists with num_predict=400, which
    truncates the JSON list and forces the messy manual parse fallback.
  - New UTAG modes: rip one specific song (--artist/--title or --url),
    or a list of UTAG entries (--utag-list). UTAG lookup is public-read
    over PostgREST, so no database password is needed for the lookup.
    Upload to the Central Memory Bank (a Supabase Storage bucket) and
    the track_audio link row only happen when a service key is supplied
    through the environment, never hardcoded here.

Secrets: read only from the environment.
  UTAG_SUPABASE_URL        e.g. https://akusfgoeplfqwrrrywfl.supabase.co
  UTAG_SUPABASE_ANON_KEY   public anon key, for UTAG lookups
  SUPABASE_SERVICE_KEY     service role key, only for bucket upload +
                           track_audio inserts. Keep it out of git.
  DATUM_BUCKET             bucket id, default central-memory-bank

Run: python datum.py --help
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
import yt_dlp
from yt_dlp.utils import DownloadError

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("datum")

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "gemma3"
BASE_DOWNLOAD_DIR = "youtube_auto_downloads"
NUM_ARTISTS = 100
TRACKS_PER_ARTIST = 5
AUDIO_FORMAT = "mp3"
DELAY_BETWEEN_ARTISTS = 2.0
FAILED_LOCAL_FILE = "failed_downloads.md"
FAILED_DIR = Path(__file__).resolve().parent / "failed_links"
FAILED_JSONL = FAILED_DIR / "failed.jsonl"
MANIFEST_JSONL = Path(__file__).resolve().parent / "downloads_manifest.jsonl"
DEFAULT_BUCKET = os.environ.get("DATUM_BUCKET", "central-memory-bank")

GOOGLE_CREDENTIALS_FILE = "credentials.json"
GOOGLE_TOKEN_FILE = "token.json"
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _check_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "ffmpeg is required but was not found on PATH.\n"
            "Install it and make sure the bin folder is in your system PATH."
        )


def classify_error(err: str) -> str:
    """Classify a download error so 404s are not mixed with other failures.

    yt-dlp does not raise a special 404 exception type, so the old code
    could not tell a removed video from a network blip, a private video,
    or a format problem. Classification is by message, and it is kept
    deliberately narrow: only a real 404 signal counts as a 404.
    """
    e = (err or "").lower()
    if "404" in e or "http error 404" in e:
        return "404"
    if "video unavailable" in e or "this video is no longer available" in e:
        return "unavailable"
    if "private video" in e:
        return "private"
    if "age" in e and "confirm" in e:
        return "age_gated"
    if "sign in" in e and "bot" in e:
        return "bot_check"
    if "too many requests" in e or "429" in e:
        return "rate_limited"
    if "timed out" in e or "connection" in e:
        return "network"
    return "other"


def norm_text(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def normalize_youtube_url(raw: str) -> str:
    """Turn a yt-dlp flat-playlist entry into a real watch URL.

    With extract_flat, entry['url'] is often just the 11-character video
    id, not a URL. The old code passed that through as 'url', so a
    failure record could hold an id that no recovery script could open.
    """
    raw = (raw or "").strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
        return f"https://www.youtube.com/watch?v={raw}"
    return raw


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- failures --
def load_failed(path: Path = FAILED_JSONL) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def record_failed(entry: dict[str, Any], path: Path = FAILED_JSONL) -> bool:
    """Append one failure, unless this URL is already pending.

    Returns True when a new record was written, False when it was a
    duplicate. Dedup is what stops the recovery loop from processing
    the same link over and over. Entries with no URL (a search that
    returned nothing) cannot be recovered by URL, so they go to a
    separate search-failures file instead of this queue.
    """
    entry = dict(entry)
    url = (entry.get("url") or "").strip()
    if not url:
        FAILED_DIR.mkdir(parents=True, exist_ok=True)
        search_path = FAILED_DIR / "search_failures.jsonl"
        with search_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({**entry, "recorded_at": _now()}, ensure_ascii=False) + "\n")
        return True
    FAILED_DIR.mkdir(parents=True, exist_ok=True)
    existing = load_failed(path)
    for old in existing:
        if old.get("url") == url and old.get("status") in ("pending", "retrying"):
            return False
    entry.setdefault("status", "pending")
    entry.setdefault("attempts", 0)
    entry.setdefault("error_kind", classify_error(str(entry.get("error", ""))))
    entry["recorded_at"] = _now()
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return True


def update_failed_status(url: str, status: str, path: Path = FAILED_JSONL) -> None:
    """Rewrite the queue with one entry's status changed, atomically."""
    rows = load_failed(path)
    changed = False
    for row in rows:
        if row.get("url") == url:
            row["status"] = status
            if status in ("pending", "retrying"):
                row["attempts"] = int(row.get("attempts") or 0) + 1
            changed = True
    if not changed:
        return
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp.replace(path)


def append_manifest(row: dict[str, Any], path: Path = MANIFEST_JSONL) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps({**row, "recorded_at": _now()}, ensure_ascii=False) + "\n")


def manifest_urls(path: Path = MANIFEST_JSONL) -> set[str]:
    if not path.exists():
        return set()
    urls = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("url"):
            urls.add(row["url"])
    return urls


# ------------------------------------------------------------ artist ideas --
def ask_gemma_for_artists(num_artists: int = NUM_ARTISTS) -> list[str]:
    """Ask Ollama/Gemma3 to invent a list of interesting artists."""
    prompt = f"""
You are a music discovery expert.
Suggest exactly {num_artists} interesting, real or plausible artists
that someone who likes emotional, indie, lo-fi, alternative, and cinematic music might enjoy.

Rules:
- Return ONLY a clean JSON array of strings.
- No numbering, no explanations, no extra text.
- Example format: ["Artist One", "Artist Two", "Artist Three"]

Return the JSON array now:
""".strip()
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        # Fix: the old code always used 400 tokens, which truncates a
        # 100-artist JSON list and forces the manual-parse fallback.
        # Roughly 25 tokens per name, with a floor, scales with the ask.
        "options": {"temperature": 0.85, "num_predict": max(400, num_artists * 25)},
    }
    logger.info("Asking Gemma3 for %d artists...", num_artists)
    try:
        response = requests.post(OLLAMA_URL, json=payload, timeout=120)
        response.raise_for_status()
        raw_text = response.json().get("response", "").strip()
    except Exception as e:
        raise RuntimeError(f"Failed to talk to Ollama: {e}") from e
    artists = []
    try:
        match = re.search(r"\[.*\]", raw_text, re.DOTALL)
        artists = json.loads(match.group(0) if match else raw_text)
    except json.JSONDecodeError:
        logger.warning("Gemma3 did not return clean JSON, trying to parse manually...")
        for line in raw_text.splitlines():
            cleaned = re.sub(r'^[\d\.\-\*\s"]+|["\s,]+$', "", line).strip()
            if cleaned and len(cleaned) > 1:
                artists.append(cleaned)
    artists = [a.strip() for a in artists if isinstance(a, str) and len(a.strip()) > 1]
    artists = list(dict.fromkeys(artists))
    if not artists:
        raise RuntimeError("Gemma3 returned no usable artists.")
    logger.info("Gemma3 suggested %d artists:", len(artists))
    for i, name in enumerate(artists, 1):
        print(f"  {i}. {name}")
    return artists[:num_artists]


# ------------------------------------------------------------------ youtube --
def search_youtube_tracks(search_term: str, num_results: int = 5) -> list[dict[str, str]]:
    """Search YouTube and return track metadata with real watch URLs."""
    if not search_term.strip():
        raise ValueError("search_term must not be empty")
    query = f"ytsearch{num_results}:{search_term.strip()} audio"
    options = {
        "extract_flat": "in_playlist",
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(query, download=False)
    tracks: list[dict[str, str]] = []
    for entry in (info or {}).get("entries") or []:
        if not entry:
            continue
        url = normalize_youtube_url(entry.get("webpage_url") or entry.get("url") or "")
        if not url:
            continue
        title = entry.get("title") or entry.get("fulltitle") or "Unknown title"
        tracks.append({"title": title, "url": url})
        if len(tracks) >= num_results:
            break
    return tracks


def download_track(
    track: dict[str, str],
    download_dir: Path,
    audio_format: str = "mp3",
) -> Path:
    """Download one track and return the file it produced.

    Old behaviour returned None, so the caller could never know what
    was made. This snapshots the folder before and after, and raises
    if yt-dlp exits cleanly but leaves no new audio file behind.
    """
    url = track.get("url")
    if not url:
        raise ValueError("Track does not contain a URL")
    download_dir.mkdir(parents=True, exist_ok=True)
    before = {p.name for p in download_dir.iterdir() if p.is_file()}
    outtmpl = str(download_dir / "%(title)s [%(id)s].%(ext)s")
    options = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "restrictfilenames": True,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
        "sleep_interval": 1,
        "max_sleep_interval": 3,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": audio_format, "preferredquality": "192"}
        ],
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([url])
    after = [p for p in download_dir.iterdir() if p.is_file() and p.name not in before]
    candidates = [p for p in after if p.suffix.lower() == f".{audio_format.lower()}"]
    if not candidates:
        raise RuntimeError(f"yt-dlp finished but produced no .{audio_format} file for {url}")
    made = max(candidates, key=lambda p: p.stat().st_mtime)
    if made.stat().st_size == 0:
        raise RuntimeError(f"Download produced an empty file for {url}")
    return made


# --------------------------------------------------------------------- UTAG --
def supabase_base() -> str:
    return (os.environ.get("UTAG_SUPABASE_URL") or "https://akusfgoeplfqwrrrywfl.supabase.co").rstrip("/")


def lookup_utag_track(artist: str, title: str) -> str | None:
    """Return the UTAG track id for (artist, title), or None.

    Public read only. If the anon key is not set, this warns and
    returns None instead of crashing the rip; the file is still
    recorded as unlinked so it can be linked later, never silently
    attached to a guessed entry.
    """
    anon = os.environ.get("UTAG_SUPABASE_ANON_KEY", "").strip()
    if not anon:
        logger.warning("UTAG_SUPABASE_ANON_KEY not set, skipping UTAG lookup for %s - %s", artist, title)
        return None
    headers = {"apikey": anon, "Authorization": f"Bearer {anon}"}
    try:
        r = requests.get(
            f"{supabase_base()}/rest/v1/artists",
            params={"select": "id,canonical_name", "canonical_name": f"ilike.{artist}"},
            headers=headers, timeout=15,
        )
        r.raise_for_status()
        artists = r.json()
        if not artists:
            return None
        aid = artists[0]["id"]
        r = requests.get(
            f"{supabase_base()}/rest/v1/tracks",
            params={"select": "id,title", "artist_id": f"eq.{aid}", "limit": 500},
            headers=headers, timeout=15,
        )
        r.raise_for_status()
        want = norm_text(title)
        for tr in r.json():
            if norm_text(tr.get("title", "")) == want:
                return tr["id"]
    except Exception as e:
        logger.warning("UTAG lookup failed for %s - %s: %s", artist, title, e)
    return None


def upload_to_central_memory(
    local_path: Path, track_id: str | None, source_url: str, source: str = "datum"
) -> str | None:
    """Upload a ripped file to the Central Memory Bank bucket and link it.

    Returns the storage path, or None when no service key is configured
    (local-only mode). A duplicate storage path or a duplicate
    (track_id, source_url) link is treated as 'already linked', not as
    an error, so re-running DATUM never creates a second audio record
    for the same song.
    """
    service = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not service:
        logger.info("SUPABASE_SERVICE_KEY not set, keeping %s local only", local_path.name)
        return None
    bucket = DEFAULT_BUCKET
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", local_path.name)
    storage_path = f"{track_id or 'unlinked'}/{safe_name}"
    headers = {"apikey": service, "Authorization": f"Bearer {service}"}
    data = local_path.read_bytes()
    r = requests.post(
        f"{supabase_base()}/storage/v1/object/{bucket}/{storage_path}",
        headers={**headers, "Content-Type": "audio/mpeg", "x-upsert": "true"},
        data=data, timeout=120,
    )
    if r.status_code not in (200, 201):
        logger.error("Bucket upload failed (%s): %s", r.status_code, r.text[:300])
        return None
    if not track_id:
        logger.info("Uploaded to %s/%s but no UTAG track to link it to", bucket, storage_path)
        return storage_path
    row = {
        "track_id": track_id,
        "storage_path": storage_path,
        "source_url": source_url,
        "source": source,
        "file_name": local_path.name,
        "file_size": local_path.stat().st_size,
        "content_type": "audio/mpeg",
        "status": "available",
    }
    r = requests.post(
        f"{supabase_base()}/rest/v1/track_audio",
        headers={**headers, "Content-Type": "application/json", "Prefer": "return=representation"},
        json=row, timeout=30,
    )
    if r.status_code in (200, 201):
        return storage_path
    # 23505 / 409: this exact link already exists. Fetch it and move on.
    if r.status_code in (409,):
        got = requests.get(
            f"{supabase_base()}/rest/v1/track_audio",
            params={"select": "storage_path", "storage_path": f"eq.{storage_path}"},
            headers=headers, timeout=15,
        )
        if got.ok and got.json():
            logger.info("Audio already linked for this song, keeping the existing record")
            return storage_path
    logger.error("track_audio insert failed (%s): %s", r.status_code, r.text[:300])
    return storage_path


# -------------------------------------------------------------- google docs --
# Kept for compatibility. No longer called by default: a Google Doc is
# not machine-readable, so it cannot feed a recovery script, and it
# created a brand new document on every run instead of appending.
def get_google_docs_service():
    if not os.path.exists(GOOGLE_CREDENTIALS_FILE):
        return None
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError:
        logger.warning("Google libraries not installed.")
        return None
    creds = None
    if os.path.exists(GOOGLE_TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(GOOGLE_TOKEN_FILE, GOOGLE_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(GOOGLE_CREDENTIALS_FILE, GOOGLE_SCOPES)
            creds = flow.run_local_server(port=0)
        with open(GOOGLE_TOKEN_FILE, "w") as token:
            token.write(creds.to_json())
    return build("docs", "v1", credentials=creds)


def write_failures_to_google_doc(failed: list[dict[str, Any]]) -> str | None:
    if not failed:
        return None
    service = get_google_docs_service()
    if service is None:
        return None
    title = f"Failed YouTube Downloads - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    try:
        doc = service.documents().create(body={"title": title}).execute()
        doc_id = doc.get("documentId")
    except Exception as e:
        logger.error("Could not create Google Doc: %s", e)
        return None
    lines = [f"Failed downloads from DATUM\n", f"Generated: {datetime.now().isoformat(timespec='seconds')}\n",
             f"Total failures: {len(failed)}\n\n", "=" * 60 + "\n\n"]
    for i, item in enumerate(failed, 1):
        lines.append(f"{i}. Artist : {item['artist']}\n")
        lines.append(f"   Title  : {item['title']}\n")
        lines.append(f"   URL    : {item['url']}\n")
        lines.append(f"   Error  : {item['error']}\n\n")
    try:
        service.documents().batchUpdate(
            documentId=doc_id,
            body={"requests": [{"insertText": {"endOfSegmentLocation": {}, "text": "".join(lines)}}]},
        ).execute()
        url = f"https://docs.google.com/document/d/{doc_id}/edit"
        logger.info("Google Doc created: %s", url)
        return url
    except Exception as e:
        logger.error("Could not write to Google Doc: %s", e)
        return None


def write_failures_local(failed: list[dict[str, Any]], path: str | Path = FAILED_LOCAL_FILE) -> None:
    """Human-readable report of THIS run only. The JSONL queue is the record."""
    if not failed:
        return
    path = Path(path)
    with path.open("w", encoding="utf-8") as f:
        f.write("# Failed YouTube Downloads (this run)\n\n")
        f.write(f"Generated: {datetime.now().isoformat(timespec='seconds')}\n\n")
        f.write("The recoverable record is failed_links/failed.jsonl, not this file.\n\n")
        for i, item in enumerate(failed, 1):
            f.write(f"### {i}. {item['title']}\n")
            f.write(f"- **Artist**: {item['artist']}\n")
            f.write(f"- **URL**: {item['url']}\n")
            f.write(f"- **Kind**: {item.get('error_kind', classify_error(str(item.get('error', ''))))}\n")
            f.write(f"- **Error**: `{item['error']}`\n\n")
    logger.info("Failed links report written to: %s", path.resolve())


# --------------------------------------------------------------------- flows --
def process_track(artist: str, title: str, url: str, base_dir: Path, track_id: str | None,
                  upload: bool, source: str = "datum", force: bool = False) -> dict[str, Any]:
    """Rip one URL, record success or a recoverable failure. Never raises
    for a single-track failure; the caller decides whether to continue."""
    if not force and url in manifest_urls():
        return {"status": "skipped_already_done", "url": url}
    safe_artist = "".join(c if c.isalnum() or c in " -_" else "_" for c in artist)
    try:
        made = download_track({"title": title, "url": url}, base_dir / safe_artist)
    except Exception as exc:
        err = str(exc)
        record_failed({"artist": artist, "title": title, "url": url, "error": err,
                       "utag_track_id": track_id, "source": source})
        return {"status": "failed", "url": url, "error": err, "error_kind": classify_error(err)}
    storage_path = upload_to_central_memory(made, track_id, url, source) if upload else None
    append_manifest({"artist": artist, "title": title, "url": url, "local_path": str(made),
                     "storage_path": storage_path, "utag_track_id": track_id, "source": source,
                     "file_size": made.stat().st_size, "sha256": sha256_file(made)})
    return {"status": "ok", "url": url, "local_path": str(made), "storage_path": storage_path}


def run_discover(num_artists: int, tracks_per_artist: int, base_dir: Path, upload: bool,
                 google_doc: bool, force: bool) -> None:
    artists = ask_gemma_for_artists(num_artists)
    total_success = total_attempted = 0
    failed: list[dict[str, Any]] = []
    for i, artist in enumerate(artists, start=1):
        print(f"\n{'='*60}\n[{i}/{len(artists)}] Artist: {artist}\n{'='*60}")
        try:
            tracks = search_youtube_tracks(artist, tracks_per_artist)
        except Exception as exc:
            logger.error("Search failed for %r: %s", artist, exc)
            record_failed({"artist": artist, "title": "", "url": "", "error": str(exc), "source": "search"})
            continue
        if not tracks:
            logger.info("No tracks found for %r", artist)
            record_failed({"artist": artist, "title": "", "url": "", "error": "search returned no tracks", "source": "search"})
            continue
        for track in tracks:
            total_attempted += 1
            track_id = lookup_utag_track(artist, track["title"])
            res = process_track(artist, track["title"], track["url"], base_dir, track_id, upload, force=force)
            if res["status"] == "ok":
                total_success += 1
                logger.info("Downloaded: %s", track["title"])
            elif res["status"] == "failed":
                failed.append({"artist": artist, "title": track["title"], "url": track["url"], "error": res["error"]})
                logger.error("Failed: %s -> %s", track["title"], res["error"])
        if i < len(artists):
            time.sleep(DELAY_BETWEEN_ARTISTS)
    print(f"\n{'='*60}")
    logger.info("Done! %d/%d tracks downloaded.", total_success, total_attempted)
    print(f"Files saved in: {base_dir.resolve()}")
    if failed:
        write_failures_local(failed)
        if google_doc:
            doc_url = write_failures_to_google_doc(failed)
            if doc_url:
                print(f"\nGoogle Doc with failed links: {doc_url}")
    else:
        logger.info("No failures - nothing to write.")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="datum", description="DATUM song ripper, UTAG-aware.")
    p.add_argument("--discover", action="store_true", help="Original Gemma artist-discovery mode")
    p.add_argument("--num-artists", type=int, default=NUM_ARTISTS)
    p.add_argument("--tracks-per-artist", type=int, default=TRACKS_PER_ARTIST)
    p.add_argument("--artist", help="Rip one specific artist")
    p.add_argument("--title", help="Rip one specific title (with --artist)")
    p.add_argument("--url", help="Rip one specific YouTube URL (with --artist/--title for naming)")
    p.add_argument("--utag-list", help="JSON file: [{artist, title, utag_track_id?}] to rip in order")
    p.add_argument("--base-dir", default=BASE_DOWNLOAD_DIR)
    p.add_argument("--format", default=AUDIO_FORMAT)
    p.add_argument("--no-upload", action="store_true", help="Keep files local, do not upload to the bucket")
    p.add_argument("--force", action="store_true", help="Re-rip URLs already in the manifest")
    p.add_argument("--google-doc", action="store_true", help="Also write failures to a Google Doc (opt-in only)")
    p.add_argument("--recover", action="store_true", help="After ripping, run recovery.py on pending failures")
    args = p.parse_args(argv)
    try:
        _check_ffmpeg()
    except RuntimeError as exc:
        logger.error("%s", exc)
        return 1
    base_dir = Path(args.base_dir)
    upload = not args.no_upload
    if args.discover:
        run_discover(args.num_artists, args.tracks_per_artist, base_dir, upload, args.google_doc, args.force)
    elif args.utag_list:
        items = json.loads(Path(args.utag_list).read_text(encoding="utf-8"))
        for item in items:
            artist, title = item["artist"], item["title"]
            track_id = item.get("utag_track_id") or lookup_utag_track(artist, title)
            if args.url:
                url = args.url
            else:
                found = search_youtube_tracks(f"{artist} {title}", 5)
                if not found:
                    record_failed({"artist": artist, "title": title, "url": "", "error": "search returned no tracks", "utag_track_id": track_id})
                    continue
                url = found[0]["url"]
            print(process_track(artist, title, url, base_dir, track_id, upload, force=args.force))
    elif args.artist and args.title:
        track_id = lookup_utag_track(args.artist, args.title)
        if args.url:
            url = args.url
        else:
            found = search_youtube_tracks(f"{args.artist} {args.title}", 5)
            if not found:
                logger.error("No YouTube result for %s - %s", args.artist, args.title)
                return 1
            url = found[0]["url"]
        print(process_track(args.artist, args.title, url, base_dir, track_id, upload, force=args.force))
    else:
        p.print_help()
        return 2
    if args.recover:
        rec = Path(__file__).with_name("recovery.py")
        if rec.exists():
            subprocess.run([sys.executable, str(rec)], check=False)
        else:
            logger.warning("recovery.py not found next to datum.py, skipping recovery")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
