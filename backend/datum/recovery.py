"""DATUM recovery - the second script in the 404 pipeline.

Reads failed_links/failed.jsonl, which datum.py maintains. It does NOT
read the old markdown report and it does NOT read a Google Doc, because
neither is a reliable queue.

Rules, by design:
  - Only pending entries are tried. Recovered, exhausted, and already
    downloaded URLs are never retried.
  - A URL gets at most 3 attempts total (across runs). After that it is
    marked exhausted, not deleted, so the link and its history stay
    traceable instead of vanishing.
  - Success updates the queue entry to recovered, uploads to the same
    Central Memory Bank bucket, links the same UTAG track id when one
    is known, and appends to downloads_manifest.jsonl with
    source=datum_recovery. The original failure row is kept in the
    queue file with its new status, not erased.
  - A separate third-party converter app was evaluated and NOT built:
    it would add another service to maintain for a job yt-dlp already
    does, with alternate player clients. If a converter site is ever
    needed for a specific link, pass --converter-url with a template
    containing {url}; recovery will open that template in the browser
    context for manual handling and leave the entry pending, rather
    than hardcoding or endorsing any converter site here.

Coordination: datum.py and recovery.py share the failed.jsonl file as
the queue. datum.py can chain recovery with --recover, or recovery can
run on its own, or with --watch it polls the queue every N seconds in
a loop (a thread in this process, watching the file, not a second
service).

Run: python recovery.py [--all] [--dry-run] [--watch 300]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from datum import (  # noqa: E402
    FAILED_JSONL,
    MANIFEST_JSONL,
    classify_error,
    download_track,
    load_failed,
    manifest_urls,
    sha256_file,
    upload_to_central_memory,
    append_manifest,
)

MAX_ATTEMPTS = 3


def _rewrite(rows: list[dict]) -> None:
    tmp = FAILED_JSONL.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp.replace(FAILED_JSONL)


def recover_once(all_kinds: bool = False, dry_run: bool = False, converter_url: str | None = None) -> dict:
    rows = load_failed()
    done_urls = manifest_urls()
    pending = []
    for row in rows:
        if row.get("status") != "pending":
            continue
        if row.get("url") in done_urls:
            row["status"] = "recovered"
            continue
        if not all_kinds and row.get("error_kind", classify_error(str(row.get("error", "")))) != "404":
            continue
        if int(row.get("attempts") or 0) >= MAX_ATTEMPTS:
            row["status"] = "exhausted"
            continue
        pending.append(row)
    if not dry_run:
        _rewrite(rows)
    summary = {"pending_found": len(pending), "recovered": 0, "still_failed": 0, "exhausted": 0}
    for row in pending:
        if dry_run:
            print(f"would retry: {row.get('artist')} - {row.get('title')} {row.get('url')}")
            continue
        url = row["url"]
        artist = row.get("artist") or "Unknown Artist"
        title = row.get("title") or "Unknown Title"
        if converter_url:
            webbrowser.open(converter_url.replace("{url}", url))
            print(f"converter opened for {url}; leaving entry pending for manual handling")
            continue
        row["attempts"] = int(row.get("attempts") or 0) + 1
        row["status"] = "retrying"
        _rewrite(rows)
        try:
            # Alternate player clients first: a 404 from one client is
            # sometimes a client-specific block, not a removed video.
            # download_track already tries android+web; a second attempt
            # here is the retry, not a blind repeat of the same call.
            safe_artist = "".join(c if c.isalnum() or c in " -_" else "_" for c in artist)
            made = download_track({"title": title, "url": url}, Path("youtube_auto_downloads") / safe_artist)
        except Exception as exc:
            row["error"] = str(exc)
            row["error_kind"] = classify_error(str(exc))
            if row["attempts"] >= MAX_ATTEMPTS:
                row["status"] = "exhausted"
                summary["exhausted"] += 1
            else:
                row["status"] = "pending"
                summary["still_failed"] += 1
            _rewrite(rows)
            print(f"still failed: {title} -> {exc}")
            continue
        track_id = row.get("utag_track_id")
        storage_path = upload_to_central_memory(made, track_id, url, source="datum_recovery")
        append_manifest({"artist": artist, "title": title, "url": url, "local_path": str(made),
                         "storage_path": storage_path, "utag_track_id": track_id,
                         "source": "datum_recovery", "file_size": made.stat().st_size,
                         "sha256": sha256_file(made)})
        row["status"] = "recovered"
        row["recovered_path"] = str(made)
        _rewrite(rows)
        summary["recovered"] += 1
        print(f"recovered: {title} -> {made}")
    return summary


def main() -> int:
    p = argparse.ArgumentParser(prog="datum-recovery")
    p.add_argument("--all", action="store_true", help="Retry all pending kinds, not just 404s")
    p.add_argument("--dry-run", action="store_true", help="List what would be retried, change nothing")
    p.add_argument("--converter-url", help="Template with {url} to open for manual conversion")
    p.add_argument("--watch", type=int, default=0, help="Poll the queue every N seconds (0 = run once)")
    args = p.parse_args()
    if args.watch > 0:
        print(f"DATUM recovery watching {FAILED_JSONL} every {args.watch}s (Ctrl-C to stop)")
        try:
            while True:
                print(recover_once(all_kinds=args.all, converter_url=args.converter_url))
                time.sleep(args.watch)
        except KeyboardInterrupt:
            return 0
    print(recover_once(all_kinds=args.all, dry_run=args.dry_run, converter_url=args.converter_url))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
