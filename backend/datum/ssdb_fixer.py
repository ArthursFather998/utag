"""SSDB fixer audit — DRAFT, not wired into any workflow, not live.

Purpose: the UTAG-backend counterpart of the browser fixer
(`~/workspace/utag-site/fixer.js`) for files already in the SSDB
folder on Mega. It audits a file's metadata and proposes (never
guesses) corrections, in the same chain and order as fixer.js:
library roster -> UTAG DB -> Apple Music -> Deezer -> MusicBrainz
-> AcoustID (only with a key, never for Skyler Green songs).
Artwork: Apple -> Deezer -> Cover Art Archive -> fanart.tv.
Lyrics: embedded first, then LRCLIB.

What this draft deliberately does NOT do:
- It does not write UTAG rows for an *existing* track. utag-control
  `fixer_save` is an upsert-by-corrected-name: calling it with a
  corrected title would create a second track and orphan the old
  track's track_audio row. Existing-track corrections need a new
  utag-control action, `fixer_correct` (update by track id), which
  does not exist yet. Until then, --apply only *reports* what
  fixer_correct would send, and only sends fixer_save for tracks
  that do not exist yet in UTAG (the same case as DATUM's
  ensure_utag_track_via_fixer). See SSDB_FIXER_DESIGN.md §1 and §4.
- It does not rewrite Mega file bytes by default. --write-tags is
  refused in dry-run and off by default; see SSDB_FIXER_DESIGN.md §4
  for the UTAG-only vs embedded-tags decision Skyler still has to
  make.
- It does not touch Splotify, and it does not duplicate the fixer
  into Splotify. Splotify keeps loading fixer.js live from the
  UTAG site and applying UTAG hits via utag.js:fixTrack/applyHit.

Usage (local, no Mega secrets needed for the pure audit functions):
    python ssdb_fixer.py --mode utag-only --dry-run --limit 10
    python ssdb_fixer.py --mode catalog --dry-run --limit 10
Access paths (see SSDB_FIXER_DESIGN.md §8): the draft works from
BOTH an rclone account login (list_mega_files, as in mega_organize)
AND a Mega folder link. The account path is unusable for this
backup: the runner's login sees DATUM/SSDB empty while the folder
link lists all 416 songs, so the folder-link path is required, not
optional. For a folder link, the caller obtains the listing with
the draft Node helper ssdb_mega_link.mjs (megajs, same library
Splotify v9.5 uses; the link itself is supplied via the
MEGA_FOLDER_LINK env var at runtime, never in code, logs, or this
repo) and feeds the resulting [{path, size}] JSON to
parse_mega_link_listing(). The listing function never sees the
link, and this module never prints, logs, or stores it.

Env: UTAG_SUPABASE_URL, UTAG_SUPABASE_ANON_KEY (reads),
SUPABASE_SERVICE_KEY (only for track_audio inserts, not used by
the audit path), UTAG_SITE_PASSWORD (utag-control fixer_save /
fixer_log; absent = report-only), ACOUSTID_KEY (optional),
FANART_KEY (optional), MEGA_REMOTE, MEGA_ROOT.
"""

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import time

import requests

SUPABASE_URL = (os.environ.get("UTAG_SUPABASE_URL") or "https://akusfgoeplfqwrrrywfl.supabase.co").rstrip("/")
MEGA_REMOTE = os.environ.get("MEGA_REMOTE", "mega-remote").strip() or "mega-remote"
MEGA_ROOT = os.environ.get("MEGA_ROOT", "DATUM/SSDB").strip() or "DATUM/SSDB"
AUTO_CONFIDENCE = 0.90


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def compact(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def str_sim(a, b):
    """Normalized Levenshtein similarity, mirroring fixer.js:strSim()."""
    a, b = compact(a), compact(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


AUDIO_EXTS = {".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wav", ".aac"}


def parse_backup_filename(file_name, album_folder=""):
    """Verified backup format (folder link, 2026-10-29): the file lives
    under an album folder, and its name is "Artist - Title.<ext>".
    Split on the FIRST " - " only: titles themselves may contain
    " - " later (e.g. "Artist - Song - Live.mp3" -> title
    "Song - Live"). Parent folder is the album/release title.
    Example from the verified backup: album folder "AM", file
    "Arctic Monkeys - I Wanna Be Yours.mp3" -> artist
    "Arctic Monkeys", title "I Wanna Be Yours", album "AM".
    A name with no " - " yields artist="" and title=stem; the
    UTAG title lookup may still match, but the artist is never
    invented from the folder name.
    """
    name = str(file_name or "").strip()
    stem = name
    for ext in AUDIO_EXTS:
        if stem.lower().endswith(ext):
            stem = stem[: -len(ext)]
            break
    else:
        if "." in stem.rsplit("/", 1)[-1]:
            stem = stem.rsplit(".", 1)[0]
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        artist, title = artist.strip(), title.strip()
    else:
        artist, title = "", stem.strip()
    return {"file_name": name, "artist": artist, "title": title,
            "album": (album_folder or "").strip()}


def parse_mega_link_listing(entries):
    """Turn a Mega folder-link listing into parsed backup files.

    Input entries: [{path, size, is_dir}] where path is relative to
    the link root, e.g. "AM/Arctic Monkeys - I Wanna Be Yours.mp3".
    This is the format the draft Node helper (ssdb_mega_link.mjs)
    prints, and the format Splotify's megajs folder walk produces.
    Output: (parsed_files, other_count) where parsed_files are
    parse_backup_filename() results plus path/size, and other_count
    counts non-audio / non-file entries (the verified backup has
    3 such files, e.g. artwork or notes — they are skipped, never
    treated as songs). No link key, URL, or credential is ever
    accepted or stored by this function: it only parses a listing
    that the caller obtained.
    """
    parsed, other = [], 0
    for e in entries or []:
        path = str((e or {}).get("path") or "")
        if (e or {}).get("is_dir") or not path:
            other += 1
            continue
        base = path.rsplit("/", 1)[-1]
        ext = "." + base.rsplit(".", 1)[-1].lower() if "." in base else ""
        if ext not in AUDIO_EXTS:
            other += 1
            continue
        parts = path.split("/")
        album_folder = parts[-2] if len(parts) >= 2 else ""
        item = parse_backup_filename(base, album_folder)
        item["path"] = path
        item["size"] = (e or {}).get("size")
        parsed.append(item)
    return parsed, other


def _headers():
    anon = os.environ.get("UTAG_SUPABASE_ANON_KEY", "").strip()
    if not anon:
        raise RuntimeError("UTAG_SUPABASE_ANON_KEY not set")
    return {"apikey": anon, "Authorization": f"Bearer {anon}"}


def roster_proposal(artist, roster):
    """Mirror fixer.js:rosterProposal(). roster: list of UTAG artist names."""
    ta = (artist or "").strip()
    if not ta or ta == "Unknown Artist":
        return None
    if any(compact(r) == compact(ta) for r in roster):
        return None
    best, best_sim = None, 0.0
    for r in roster:
        s = str_sim(r, ta)
        if s > best_sim:
            best_sim, best = s, r
    if best and best_sim >= 0.8 and best_sim < 1.0:
        return {"field": "artist", "from": ta, "to": best,
                "confidence": round(0.5 + best_sim * 0.45, 3), "source": "library roster"}
    return None


def read_tags(path, album_folder=""):
    """Embedded tags if mutagen is installed, else filename/folder fallback.

    Precedence mirrors fixer.js:parseFile(): embedded artist/title
    first, then filename candidates, then Unknown. Returns a dict
    with title, artist, album, genre, year, track_no, disc_no.
    """
    info = {"title": "", "artist": "", "album": album_folder or "",
            "genre": "", "year": "", "track_no": 0, "disc_no": 0}
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(str(path), easy=True)
        if audio is not None and audio.tags:
            tags = audio.tags
            info["title"] = str(tags.get("title", [""])[0] or "")
            info["artist"] = str(tags.get("artist", [""])[0] or "")
            info["album"] = str(tags.get("album", [""])[0] or "") or info["album"]
            info["genre"] = str(tags.get("genre", [""])[0] or "")
            info["year"] = str(tags.get("date", [""])[0] or "")[:4]
            try:
                info["track_no"] = int(str(tags.get("tracknumber", ["0"])[0]).split("/")[0] or 0)
            except ValueError:
                info["track_no"] = 0
    except ImportError:
        pass
    except Exception:
        pass
    if not info["title"] or not info["artist"]:
        # Same verified backup rule as parse_backup_filename():
        # split on the FIRST " - " into artist/title.
        parsed = parse_backup_filename(os.path.basename(str(path)))
        info["artist"] = info["artist"] or parsed["artist"]
        info["title"] = info["title"] or parsed["title"]
    return info


def fetch_utag_track(track_id):
    """Return {track, release, artist} for a UTAG track id, or None."""
    h = _headers()
    tr = requests.get(f"{SUPABASE_URL}/rest/v1/tracks",
                      params={"select": "id,title,artist_id,release_id,confidence,track_number,disc_number",
                              "id": f"eq.{track_id}"}, headers=h, timeout=30)
    if not tr.ok or not tr.json():
        return None
    track = tr.json()[0]
    release, artist = {}, {}
    if track.get("release_id"):
        rr = requests.get(f"{SUPABASE_URL}/rest/v1/releases",
                          params={"select": "id,title,release_year", "id": f"eq.{track['release_id']}"},
                          headers=h, timeout=30)
        if rr.ok and rr.json():
            release = rr.json()[0]
    if track.get("artist_id"):
        ar = requests.get(f"{SUPABASE_URL}/rest/v1/artists",
                          params={"select": "id,canonical_name", "id": f"eq.{track['artist_id']}"},
                          headers=h, timeout=30)
        if ar.ok and ar.json():
            artist = ar.json()[0]
    return {"track": track, "release": release, "artist": artist}


def utag_proposals(embedded, utag):
    """Proposals from UTAG itself. Only trusted when the UTAG track is
    verified or high_confidence — mirroring splotify utag.js:fixTrack
    pass 1. needs_review/conflicting tracks propose nothing here;
    they fall through to the catalog audit and the review queue."""
    if not utag:
        return [], False
    conf = str(utag["track"].get("confidence") or "")
    if conf not in ("verified", "high_confidence"):
        return [], False
    out = []
    want = [
        ("title", utag["track"].get("title", "")),
        ("artist", utag["artist"].get("canonical_name", "")),
        ("album", utag["release"].get("title", "")),
        ("year", str(utag["release"].get("release_year") or "")),
    ]
    have = {"title": embedded.get("title", ""), "artist": embedded.get("artist", ""),
            "album": embedded.get("album", ""), "year": embedded.get("year", "")}
    for field, to in want:
        if to and str(have.get(field) or "") != str(to):
            out.append({"field": field, "from": have.get(field) or "", "to": str(to),
                        "confidence": 1.0 if conf == "verified" else 0.95, "source": "UTAG"})
    return out, True


def _exact_match(candidate_title, candidate_artist, title, artist):
    return norm(candidate_title) == norm(title) and (not artist or norm(candidate_artist) == norm(artist))


def apple_audit(title, artist):
    """iTunes Search API, mirroring fixer.js:appleAudit() caps."""
    try:
        r = requests.get("https://itunes.apple.com/search",
                         params={"term": f"{artist} {title}".strip(), "entity": "song", "limit": 10},
                         timeout=15)
        if not r.ok:
            return []
        for hit in r.json().get("results", []):
            if _exact_match(hit.get("trackName", ""), hit.get("artistName", ""), title, artist):
                out = [
                    {"field": "title", "from": title, "to": hit["trackName"], "confidence": 0.92, "source": "Apple Music"},
                    {"field": "artist", "from": artist, "to": hit["artistName"], "confidence": 0.90, "source": "Apple Music"},
                ]
                if hit.get("collectionName"):
                    out.append({"field": "album", "from": "", "to": hit["collectionName"], "confidence": 0.85, "source": "Apple Music"})
                if hit.get("releaseDate"):
                    out.append({"field": "year", "from": "", "to": hit["releaseDate"][:4], "confidence": 0.85, "source": "Apple Music"})
                if hit.get("trackNumber"):
                    out.append({"field": "trackNo", "from": "", "to": str(hit["trackNumber"]), "confidence": 0.85, "source": "Apple Music"})
                art = (hit.get("artworkUrl100") or "").replace("100x100bb", "1200x1200bb") or None
                return {"proposals": out, "verified": True, "art_url": art, "art_source": "Apple Music" if art else None}
        return {"proposals": [], "verified": False, "art_url": None, "art_source": None}
    except Exception:
        return {"proposals": [], "verified": False, "art_url": None, "art_source": None}


def deezer_audit(title, artist):
    try:
        r = requests.get("https://api.deezer.com/search",
                         params={"q": f"{artist} {title}".strip()}, timeout=15)
        if not r.ok:
            return {"proposals": [], "verified": False, "art_url": None, "art_source": None}
        for hit in r.json().get("data", []):
            ht = hit.get("title", "")
            ha = (hit.get("artist") or {}).get("name", "")
            if _exact_match(ht, ha, title, artist):
                out = [
                    {"field": "title", "from": title, "to": ht, "confidence": 0.92, "source": "Deezer"},
                    {"field": "artist", "from": artist, "to": ha, "confidence": 0.90, "source": "Deezer"},
                ]
                alb = (hit.get("album") or {}).get("title")
                if alb:
                    out.append({"field": "album", "from": "", "to": alb, "confidence": 0.85, "source": "Deezer"})
                art = (hit.get("album") or {}).get("cover_xl") or (hit.get("album") or {}).get("cover_big")
                return {"proposals": out, "verified": True, "art_url": art, "art_source": "Deezer" if art else None}
        return {"proposals": [], "verified": False, "art_url": None, "art_source": None}
    except Exception:
        return {"proposals": [], "verified": False, "art_url": None, "art_source": None}


def musicbrainz_audit(title, artist):
    """MusicBrainz recording search, 1 req/sec, 503 backoff, score>=60,
    title-similarity gate — mirroring fixer.js:mbSearchRecordingInner
    and mbPick()."""
    time.sleep(1.0)
    q = f'recording:"{title}"'
    if artist and artist != "Unknown Artist":
        q += f' AND artist:"{artist}"'
    backoff = 2.0
    for _ in range(3):
        try:
            r = requests.get("https://musicbrainz.org/ws/2/recording/",
                             params={"query": q, "fmt": "json", "limit": 8},
                             headers={"User-Agent": "UTAG-ssdb-fixer/1.0 (draft)"}, timeout=15)
            if r.status_code == 503:
                time.sleep(backoff)
                backoff *= 2
                continue
            if not r.ok:
                return {"proposals": [], "verified": False, "art_url": None, "art_source": None}
            recs = [x for x in r.json().get("recordings", []) if (x.get("score") or 0) >= 60]
            best = None
            for rec in recs:
                if norm(rec.get("title", "")) != norm(title) and (rec.get("score") or 0) < 85:
                    continue
                if best is None or (rec.get("score") or 0) > (best.get("score") or 0):
                    best = rec
            if not best:
                return {"proposals": [], "verified": False, "art_url": None, "art_source": None}
            mb_artist = "".join((a.get("name", "") + (a.get("joinphrase", "") or "")) for a in best.get("artist-credit", []))
            conf = round(0.5 + (best.get("score") or 0) / 100.0 * 0.45, 3)
            out = [
                {"field": "title", "from": title, "to": best.get("title", ""), "confidence": conf, "source": "MusicBrainz"},
                {"field": "artist", "from": artist, "to": mb_artist, "confidence": conf, "source": "MusicBrainz"},
            ]
            rels = best.get("releases", [])
            if rels:
                out.append({"field": "album", "from": "", "to": rels[0].get("title", ""), "confidence": round(conf - 0.05, 3), "source": "MusicBrainz"})
            return {"proposals": out, "verified": False, "art_url": None, "art_source": None,
                    "mb_release_id": rels[0].get("id") if rels else None}
        except Exception:
            return {"proposals": [], "verified": False, "art_url": None, "art_source": None}
    return {"proposals": [], "verified": False, "art_url": None, "art_source": None}


def looks_like_skyler(artist):
    return "skyler green" in (artist or "").lower()


def decide(proposals, verified):
    """One proposal per field, highest confidence wins (fixer.js
    auditFile tail). Auto-apply only if verified, or every proposal
    is >= AUTO_CONFIDENCE. Otherwise the file goes to review."""
    by_field = {}
    for p in proposals:
        cur = by_field.get(p["field"])
        if cur is None or p["confidence"] > cur["confidence"]:
            by_field[p["field"]] = p
    chosen = list(by_field.values())
    if verified:
        return chosen, "fixed"
    if chosen and all(p["confidence"] >= AUTO_CONFIDENCE for p in chosen):
        return chosen, "fixed"
    if chosen:
        return chosen, "review"
    return [], "no_change"


def audit_file(embedded, track_id=None, roster=None, mode="utag-only"):
    """Pure audit step, no Mega, no writes. Returns a report dict.

    embedded: read_tags() output. track_id: UTAG track id if known.
    roster: UTAG artist names for the roster pass. mode: 'utag-only'
    (no download, no external catalogs) or 'catalog' (Apple/Deezer/
    MusicBrainz; AcoustID is intentionally NOT implemented here —
    it needs a chromaprint fingerprint of the audio, which the
    browser fixer gets from its shim; a catalog run without a
    fingerprint simply skips that pass, exactly as the browser
    fixer does when no AcoustID key is set).
    """
    proposals, verified, utag = [], False, None
    if roster:
        rp = roster_proposal(embedded.get("artist", ""), roster)
        if rp:
            proposals.append(rp)
    if track_id:
        utag = fetch_utag_track(track_id)
        ups, uverified = utag_proposals(embedded, utag)
        proposals.extend(ups)
        verified = verified or uverified
    if mode == "catalog" and not verified:
        title, artist = embedded.get("title", ""), embedded.get("artist", "")
        if title and title != "Unknown Title":
            ap = apple_audit(title, artist)
            proposals.extend(ap["proposals"])
            verified = verified or ap["verified"]
            art_url, art_source = ap["art_url"], ap["art_source"]
            if not verified:
                dp = deezer_audit(title, artist)
                proposals.extend(dp["proposals"])
                verified = verified or dp["verified"]
                art_url, art_source = dp["art_url"], dp["art_source"]
            if not verified:
                mp = musicbrainz_audit(title, artist)
                proposals.extend(mp["proposals"])
    else:
        art_url, art_source = None, None
    chosen, status = decide(proposals, verified)
    return {"embedded": embedded, "track_id": track_id,
            "utag_confidence": (utag["track"].get("confidence") if utag else None),
            "proposals": chosen, "status": status, "verified": verified,
            "art_url": art_url if mode == "catalog" else None,
            "art_source": art_source if mode == "catalog" else None,
            "acoustid_skipped": looks_like_skyler(embedded.get("artist", "")) or not os.environ.get("ACOUSTID_KEY")}


def fixer_save_payload(final_meta, verified, art_url=None, art_source=None):
    """The payload the browser fixer sends to utag-control fixer_save
    (app.js fixerZipApply). Only safe to send for a track that does
    NOT yet exist in UTAG; for an existing track see fixer_correct
    (not yet implemented in utag-control)."""
    return {
        "action": "fixer_save",
        "artist": final_meta["artist"], "title": final_meta["title"],
        "album": final_meta.get("album", ""), "year": final_meta.get("year", ""),
        "track_no": final_meta.get("track_no"), "disc_no": final_meta.get("disc_no", 1),
        "verified": bool(verified),
        "art_url": art_url or "", "art_source": art_source or "",
    }


def fixer_correct_payload(track_id, before, after, proposals):
    """SPEC for the proposed utag-control action `fixer_correct`
    (update by id, not upsert by name). Not sent anywhere by this
    draft — utag-control does not implement it yet. Included so the
    apply step has an exact contract to implement against."""
    return {
        "action": "fixer_correct",
        "track_id": track_id,
        "before": before,
        "after": after,
        "proposals": proposals,
        "note": "SSDB fixer: update existing track/release by id, sync touched rows to repo, do not create a duplicate track.",
    }


def write_tags(path, final_meta):
    """Rewrite ID3 tags in place. Only called with --write-tags +
    --apply. Raises if mutagen is not installed, so a tag write can
    never silently do nothing."""
    try:
        from mutagen import File as MutagenFile
        from mutagen.easyid3 import EasyID3
    except ImportError as exc:
        raise RuntimeError("mutagen not installed; pip install mutagen before --write-tags") from exc
    audio = MutagenFile(str(path), easy=True)
    if audio is None:
        audio = EasyID3()
    for key, value in [("title", final_meta.get("title")), ("artist", final_meta.get("artist")),
                       ("album", final_meta.get("album")), ("date", final_meta.get("year")),
                       ("genre", final_meta.get("genre"))]:
        if value:
            audio[key] = [str(value)]
    if final_meta.get("track_no"):
        audio["tracknumber"] = [str(final_meta["track_no"])]
    audio.save(str(path))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["utag-only", "catalog"], default="utag-only")
    ap.add_argument("--dry-run", action="store_true", help="print only (default if --apply absent)")
    ap.add_argument("--apply", action="store_true", help="report what fixer_save/fixer_correct would send; does NOT send fixer_correct (unimplemented) and does NOT rewrite Mega files unless --write-tags is also given")
    ap.add_argument("--write-tags", action="store_true", help="also rewrite ID3 in the Mega file (requires --apply; refused in dry-run)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--report", default="ssdb_fixer_report.jsonl")
    ap.add_argument("--listing", default="", help="JSON file [{Path, Size}] from a Mega folder-link listing; if given, rclone is not used")
    args = ap.parse_args()
    dry_run = not args.apply
    if args.write_tags and dry_run:
        print("--write-tags requires --apply; refusing in dry-run.", file=sys.stderr)
        return 2
    if args.write_tags and not args.apply:
        return 2
    # Listing step: a folder-link JSON listing if given, otherwise
    # mega_organize's rclone listing (account login).
    if args.listing:
        with open(args.listing, encoding="utf-8") as f:
            files = json.load(f)
    else:
        try:
            import mega_organize
            files = mega_organize.list_mega_files()
        except Exception as exc:
            print(f"Cannot list Mega files: {exc}", file=sys.stderr)
            return 1
    if args.limit:
        files = files[: args.limit]
    print(f"SSDB fixer: {len(files)} mp3 files under {MEGA_ROOT} (mode={args.mode}, dry_run={dry_run}, write_tags={args.write_tags})")
    print("NOTE: this draft audits and reports only. Existing-track UTAG writes need fixer_correct (see SSDB_FIXER_DESIGN.md); Mega file bytes are untouched unless --write-tags --apply.")
    counts = {"fixed": 0, "no_change": 0, "review": 0, "unmatched": 0, "failed": 0}
    with open(args.report, "a", encoding="utf-8") as report:
        for entry in files:
            src_rel = entry["Path"]
            parts = src_rel.split("/")
            album_folder = parts[-2] if len(parts) >= 2 else ""
            # Verified backup format: file name is "Artist - Title",
            # NOT the title alone. mega_organize.py as written treats
            # the stem as the title, which would miss almost every
            # backup file; the fixer draft parses first, then looks
            # up by parsed title + album folder, and records any
            # filename-artist vs UTAG-artist mismatch for review.
            parsed = parse_backup_filename(parts[-1], album_folder)
            try:
                import mega_organize as mo
                found = mo.utag_lookup(parsed["title"], album_folder)
            except Exception as exc:
                print(f"SKIP {src_rel}: lookup error {exc}")
                counts["failed"] += 1
                continue
            if found is None or found == "ambiguous":
                print(f"UNMATCHED (left in place): {src_rel}")
                counts["unmatched"] += 1
                report.write(json.dumps({"mega_path": f"{MEGA_ROOT}/{src_rel}", "status": "unmatched",
                                         "parsed": parsed}) + "\n")
                continue
            track_id, artist, album_title, title = found
            artist_mismatch = bool(parsed["artist"] and norm(parsed["artist"]) != norm(artist))
            embedded = {"title": title, "artist": artist, "album": album_title,
                        "genre": "", "year": "", "track_no": 0, "disc_no": 0}
            # utag-only mode needs no download: filename/folder + UTAG DB.
            result = audit_file(embedded, track_id=track_id, mode=args.mode)
            counts[result["status"]] = counts.get(result["status"], 0) + 1
            print(f"{result['status'].upper()}: {artist} - {title} [{track_id}] parsed_artist={parsed['artist']!r} artist_mismatch={artist_mismatch} proposals={result['proposals']}")
            report.write(json.dumps({"mega_path": f"{MEGA_ROOT}/{src_rel}", "track_id": track_id,
                                     "parsed": parsed, "artist_mismatch": artist_mismatch, **result}) + "\n")
    print(f"Done: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
