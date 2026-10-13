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


def main():
    print(f"Exporting UTAG library -> {DATA_DIR}")
    counts = {}
    for table in TABLES:
        rows = fetch_all(table)
        tdir = os.path.join(DATA_DIR, table)
        os.makedirs(tdir, exist_ok=True)
        for row in rows:
            rid = row.get("id")
            if not rid:
                print(f"  !! {table}: row without id, skipping", file=sys.stderr)
                continue
            with open(os.path.join(tdir, f"{rid}.json"), "w") as f:
                json.dump(row, f, indent=2, sort_keys=True, ensure_ascii=False)
                f.write("\n")
        counts[table] = len(rows)
        print(f"  {table}: {len(rows)} rows -> {tdir}")

    # Verification: server-side counts vs files written.
    ok = True
    for table in TABLES:
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
