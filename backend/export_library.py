#!/usr/bin/env python3
"""Export the UTAG metadata library from Supabase to data/ JSON files.

Reads via the public anon key (all library tables have public SELECT policies).
Writes one JSON file per row: data/<table>/<id>.json, plus data/index.json
with per-table counts and the export timestamp.

Idempotent: re-running overwrites the files. Safe to run any time; the live
site keeps reading Supabase until the read path is flipped to these files.
"""
import datetime
import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SUPABASE_URL = "https://akusfgoeplfqwrrrywfl.supabase.co"
# Public anon key (same value shipped in config.js — public by design).
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
    "ImFrdXNmZ29lcGxmcXdycnJ5d2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0Mjg5OT"
    "UsImV4cCI6MjEwNzAwNDk5NX0.Hrgft3FuI5DRZsYe8fFdvCZhiXtRMBDPNUP6aJkShvg"
)

# The metadata library: everything that must survive without Supabase/Render.
TABLES = [
    "artists",
    "releases",
    "tracks",
    "track_lyrics",
    "artwork",
    "source_results",
    "verifications",
    "corrections",
    "canonical_rules",
]

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO_ROOT, "data")
PAGE = 1000


def api_get(table, params, extra_headers=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp), resp.headers.get("Content-Range")
        except (http.client.IncompleteRead, http.client.RemoteDisconnected,
                urllib.error.URLError, ConnectionError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def fetch_all(table):
    rows, offset = [], 0
    while True:
        batch, _ = api_get(
            table,
            {"select": "*", "order": "id", "limit": PAGE, "offset": offset},
        )
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return rows


def table_count(table):
    _, cr = api_get(
        table,
        {"select": "id", "limit": 1},
        {"Prefer": "count=exact"},
    )
    # Content-Range: "0-0/42" — total after the slash.
    try:
        return int(cr.split("/")[-1])
    except (AttributeError, ValueError, IndexError):
        return -1


def art_entry(a):
    return {
        "id": a.get("id"),
        "source_url": a.get("source_url"),
        "stored_path": a.get("stored_path"),
        "role": a.get("role"),
    }


def catalog_release(r, artist_name, canonical_art):
    """Release shaped like the old PostgREST embed so releaseRow() works unchanged."""
    return {
        "id": r["id"],
        "title": r["title"],
        "edition": r.get("edition"),
        "release_type": r.get("release_type"),
        "release_date": r.get("release_date"),
        "release_year": r.get("release_year"),
        "release_status": r.get("release_status"),
        "label": r.get("label"),
        "confidence": r.get("confidence"),
        "created_at": r.get("created_at"),
        "artists": {"id": r.get("artist_id"), "canonical_name": artist_name},
        "artwork": [art_entry(canonical_art)] if canonical_art else [],
    }


NEEDS = ("needs_review", "conflicting")


def build_views(rows, data_dir):
    """Derived view files the site reads instead of PostgREST."""
    vdir = os.path.join(data_dir, "views")
    os.makedirs(vdir, exist_ok=True)

    artists = rows["artists"]
    releases = rows["releases"]
    tracks = rows["tracks"]
    artwork = rows["artwork"]
    verifs = rows["verifications"]
    corrections = rows["corrections"]

    artist_name = {a["id"]: a["canonical_name"] for a in artists}
    canonical_art = {}
    for a in artwork:
        if a.get("role") == "canonical" and a.get("release_id"):
            canonical_art[a["release_id"]] = a

    def rel_verifs(etype, eid, limit):
        vs = [v for v in verifs
              if v.get("entity_type") == etype and v.get("entity_id") == eid]
        vs.sort(key=lambda v: v.get("created_at") or "", reverse=True)
        return vs[:limit]

    def rel_corrections(etype, eid, limit):
        cs = [c for c in corrections
              if c.get("entity_type") == etype and c.get("entity_id") == eid]
        cs.sort(key=lambda c: c.get("created_at") or "", reverse=True)
        return cs[:limit]

    # ---- catalog.json: everything list/search pages need in one fetch ----
    rel_count = {}
    for r in releases:
        aid = r.get("artist_id")
        rel_count[aid] = rel_count.get(aid, 0) + 1
    cat_artists = [
        {
            "id": a["id"],
            "canonical_name": a["canonical_name"],
            "aliases": a.get("aliases") or [],
            "genres": a.get("genres") or [],
            "confidence": a.get("confidence"),
            "image_url": a.get("image_url"),
            "release_count": rel_count.get(a["id"], 0),
        }
        for a in artists
    ]
    cat_artists.sort(key=lambda a: (a["canonical_name"] or "").lower())
    cat_releases = [
        catalog_release(r, artist_name.get(r.get("artist_id"), ""),
                        canonical_art.get(r["id"]))
        for r in releases
    ]
    cat_releases.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with open(os.path.join(vdir, "catalog.json"), "w") as f:
        json.dump({"exported_at": stamp, "artists": cat_artists,
                   "releases": cat_releases}, f,
                  indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    print(f"  views/catalog.json: {len(cat_artists)} artists, {len(cat_releases)} releases")

    # ---- review.json ----
    with open(os.path.join(vdir, "review.json"), "w") as f:
        need_verifs = [v for v in verifs if v.get("status") == "needs_review"]
        need_verifs.sort(key=lambda v: v.get("created_at") or "", reverse=True)
        json.dump({
            "releases": [r for r in cat_releases if r.get("confidence") in NEEDS],
            "artists": [
                {"id": a["id"], "canonical_name": a["canonical_name"],
                 "confidence": a.get("confidence")}
                for a in cat_artists if a.get("confidence") in NEEDS
            ],
            "verifications": need_verifs[:25],
        }, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    print("  views/review.json")

    # ---- per-artist pages ----
    adir = os.path.join(vdir, "artist")
    os.makedirs(adir, exist_ok=True)
    for a in artists:
        arels = [catalog_release(r, a["canonical_name"], canonical_art.get(r["id"]))
                 for r in releases if r.get("artist_id") == a["id"]]
        arels.sort(key=lambda r: r.get("release_year") or 0)
        with open(os.path.join(adir, f'{a["id"]}.json'), "w") as f:
            json.dump({
                "artist": a,
                "releases": arels,
                "verifications": rel_verifs("artist", a["id"], 10),
                "corrections": rel_corrections("artist", a["id"], 10),
            }, f, indent=2, sort_keys=True, ensure_ascii=False)
            f.write("\n")
    print(f"  views/artist/: {len(artists)} files")

    # ---- per-release pages ----
    # Lyrics live in track_lyrics, not on tracks, and are attached to each
    # track here only (never to catalog.json, which has no tracks). An
    # export before the lyrics migration runs still works: rows.get
    # defaults to an empty list.
    lyrics_by_track = {}
    for ly in rows.get("track_lyrics", []):
        if ly.get("track_id"):
            lyrics_by_track[ly["track_id"]] = {
                "plain_text": ly.get("plain_text"),
                "synced_text": ly.get("synced_text"),
                "source": ly.get("source"),
                "status": ly.get("status"),
            }
    rdir = os.path.join(vdir, "release")
    os.makedirs(rdir, exist_ok=True)
    for r in releases:
        rid = r["id"]
        rtracks = []
        for t in tracks:
            if t.get("release_id") != rid:
                continue
            t = dict(t)
            if t.get("id") in lyrics_by_track:
                t["lyrics"] = lyrics_by_track[t["id"]]
            rtracks.append(t)
        rtracks.sort(key=lambda t: (t.get("disc_number") or 1,
                                    t.get("track_number")
                                    if t.get("track_number") is not None else 10**9))
        rart = [x for x in artwork if x.get("release_id") == rid]
        rart.sort(key=lambda x: x.get("created_at") or "")
        aid = r.get("artist_id")
        more = [catalog_release(o, artist_name.get(aid, ""), canonical_art.get(o["id"]))
                for o in releases if o.get("artist_id") == aid and o["id"] != rid]
        with open(os.path.join(rdir, f"{rid}.json"), "w") as f:
            json.dump({
                "release": r,
                "artists": {"id": aid,
                            "canonical_name": artist_name.get(aid, "")},
                "tracks": rtracks,
                "artwork": rart,
                "verifications": rel_verifs("release", rid, 15),
                "corrections": rel_corrections("release", rid, 15),
                "more_from_artist": more,
            }, f, indent=2, sort_keys=True, ensure_ascii=False)
            f.write("\n")
    print(f"  views/release/: {len(releases)} files")


def main():
    print(f"Exporting UTAG library -> {DATA_DIR}")
    rows = {}
    counts = {}
    missing_tables = set()
    for table in TABLES:
        try:
            rows[table] = fetch_all(table)
        except Exception:
            # track_lyrics is optional until its migration has run.
            if table != "track_lyrics":
                raise
            rows[table] = []
            counts[table] = 0
            missing_tables.add(table)
            print(f"  {table}: not present yet (migration not run), skipping")
            continue
        tdir = os.path.join(DATA_DIR, table)
        os.makedirs(tdir, exist_ok=True)
        for row in rows[table]:
            rid = row.get("id")
            if not rid:
                print(f"  !! {table}: row without id, skipping", file=sys.stderr)
                continue
            with open(os.path.join(tdir, f"{rid}.json"), "w") as f:
                json.dump(row, f, indent=2, sort_keys=True, ensure_ascii=False)
                f.write("\n")
        counts[table] = len(rows[table])
        print(f"  {table}: {len(rows[table])} rows -> {tdir}")
        # Prune orphan files left by deleted rows so the file tree converges
        # with the database (the function deletes them too; this is the net).
        live_ids = {row.get("id") for row in rows[table] if row.get("id")}
        for fname in os.listdir(tdir):
            if fname.endswith(".json") and fname[:-5] not in live_ids:
                os.remove(os.path.join(tdir, fname))
                print(f"  {table}: pruned orphan {fname}")

    build_views(rows, DATA_DIR)

    # Verification: server-side counts vs files written.
    ok = True
    for table in TABLES:
        if table in missing_tables:
            print(f"  [SKIP] {table}: table not present yet")
            continue
        server = table_count(table)
        local = counts[table]
        mark = "OK " if server == local else "MISMATCH"
        if server != local:
            ok = False
        print(f"  [{mark}] {table}: server={server} files={local}")

    index = {
        "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": "supabase",
        "counts": counts,
    }
    with open(os.path.join(DATA_DIR, "index.json"), "w") as f:
        json.dump(index, f, indent=2, sort_keys=True)
        f.write("\n")
    print("Wrote data/index.json")

    if not ok:
        print("COUNT MISMATCH — investigate before committing.", file=sys.stderr)
        sys.exit(1)
    print("Export complete and verified.")


if __name__ == "__main__":
    main()
