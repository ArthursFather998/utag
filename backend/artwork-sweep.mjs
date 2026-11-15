// Artwork sweep: keeps every release covered, always running.
//
// Each run takes the next batch of releases with no artwork rows and
// tries the same chain my in-app fixer uses, in the same order:
// Apple Music, Deezer, Cover Art Archive (via MusicBrainz), then
// Wikipedia last. A cover that passes the title and artist checks is
// written as the release's canonical artwork row. A release nothing
// finds is recorded and left alone for a week before it is retried,
// so the sweep never hammers the same dead ends every hour.
//
// Runs on GitHub Actions, hourly. State lives in
// backend/artwork-sweep-state.json in this repo, committed by the
// workflow after each run. New rows also get their
// data/splotify_artwork/<id>.json file, the same shape my export
// writes, so the library views rebuild from them.
//
// Usage: node backend/artwork-sweep.mjs [--batch 100] [--limit 5]
//        [--dry-run] [--only <release-id>]
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Dry runs only read, so a
// read-only key works for those; writes need the service key.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_PATH = resolve(ROOT, "backend", "artwork-sweep-state.json");
const DATA_DIR = resolve(ROOT, "data", "splotify_artwork");
const UA = "SplotifyArtworkSweep/1.0 (personal catalog; contact skylergreenbusiness@gmail.com)";
const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://akusfgoeplfqwrrrywfl.supabase.co").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const READ_KEY = SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const BATCH = parseInt(opt("--batch", "100"), 10);
const LIMIT = opt("--limit", null) ? parseInt(opt("--limit"), 10) : null;
const DRY_RUN = args.includes("--dry-run");
const ONLY = opt("--only", null);

/* ---------------- small helpers, mirroring my fixer ---------------- */
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const compact = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function titleMatches(a, b) {
  const nt = norm(a), rt = norm(b);
  if (!nt || !rt) return false;
  if (rt === nt || rt.indexOf(nt) !== -1 || nt.indexOf(rt) !== -1) return true;
  const cn = compact(a), ct = compact(b);
  if (!cn || !ct || cn.length < 6 || ct.length < 6) return false;
  return ct === cn || ct.indexOf(cn) !== -1 || cn.indexOf(ct) !== -1;
}
function artistMatches(artist, hay) {
  const a = norm(artist);
  if (!a) return false;
  const h = norm(hay);
  if (h.indexOf(a) !== -1) return true;
  const first = a.split(" ").filter((w) => w.length >= 4 && w !== "with" && w !== "feat")[0] || "";
  return !!first && h.indexOf(first) !== -1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, ms = 12000, extraHeaders = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: { "User-Agent": UA, ...extraHeaders },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
async function fetchImageOk(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 8000);
    const r = await fetch(url, { signal: c.signal, headers: { "User-Agent": UA } });
    clearTimeout(t);
    if (!r.ok) return false;
    const b = await r.arrayBuffer();
    return b.byteLength > 1000;
  } catch {
    return false;
  }
}

/* ---------------- Supabase ---------------- */
const restHeaders = (key) => ({
  apikey: key,
  Authorization: "Bearer " + key,
  "Content-Type": "application/json",
});
async function restGet(path) {
  const out = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const rows = await fetchJSON(
      SUPABASE_URL + "/rest/v1/" + path + sep + "limit=1000&offset=" + offset,
      30000,
      restHeaders(READ_KEY),
    );
    if (!Array.isArray(rows)) throw new Error("Read failed: " + path);
    out.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return out;
}
async function insertArtwork(releaseId, sourceUrl, source) {
  const body = {
    release_id: releaseId,
    source_url: sourceUrl,
    source,
    role: "canonical",
    confidence: "high_confidence",
    status: "high_confidence",
  };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/splotify_artwork", {
      method: "POST",
      signal: c.signal,
      headers: { ...restHeaders(SERVICE_KEY), Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    clearTimeout(t);
    if (r.status === 409) return { duplicate: true };
    if (!r.ok) return { error: "HTTP " + r.status };
    const rows = await r.json();
    return { row: rows && rows[0] };
  } catch (e) {
    clearTimeout(t);
    return { error: String(e && e.message ? e.message : e) };
  }
}
function writeDataFile(row) {
  mkdirSync(DATA_DIR, { recursive: true });
  const sorted = {};
  for (const k of Object.keys(row).sort()) sorted[k] = row[k];
  writeFileSync(
    resolve(DATA_DIR, row.id + ".json"),
    JSON.stringify(sorted, null, 2) + "\n",
  );
}

/* ---------------- lookup chain ---------------- */
async function appleArt(title, artist) {
  const q = encodeURIComponent(artist + " " + title);
  // Albums, EPs and singles as collections: the collection name must
  // be the release title.
  const albums = await fetchJSON(
    "https://itunes.apple.com/search?term=" + q + "&media=music&entity=album&limit=8",
    12000,
  );
  for (const hit of (albums && albums.results) || []) {
    if (!titleMatches(title, hit.collectionName || "")) continue;
    if (!artistMatches(artist, hit.artistName || "")) continue;
    const url = (hit.artworkUrl100 || "").replace("100x100bb", "1200x1200bb");
    if (url && (await fetchImageOk(url))) return { url, source: "Apple Music" };
  }
  // Singles via their track: the track name must be the release title,
  // and the track's collection art is the single's art.
  const songs = await fetchJSON(
    "https://itunes.apple.com/search?term=" + q + "&media=music&entity=song&limit=8",
    12000,
  );
  for (const hit of (songs && songs.results) || []) {
    if (!titleMatches(title, hit.trackName || "")) continue;
    if (!artistMatches(artist, hit.artistName || "")) continue;
    const url = (hit.artworkUrl100 || "").replace("100x100bb", "1200x1200bb");
    if (url && (await fetchImageOk(url))) return { url, source: "Apple Music" };
  }
  return null;
}
async function deezerArt(title, artist) {
  const q = encodeURIComponent(artist + " " + title);
  const d = await fetchJSON("https://api.deezer.com/search/album?q=" + q + "&limit=5", 12000);
  for (const hit of (d && d.data) || []) {
    if (!titleMatches(title, hit.title || "")) continue;
    if (!artistMatches(artist, (hit.artist && hit.artist.name) || "")) continue;
    const url = hit.cover_xl || hit.cover_big || hit.cover;
    if (url && (await fetchImageOk(url))) return { url, source: "Deezer" };
  }
  return null;
}
let lastMbAt = 0;
async function mbThrottled(url) {
  const wait = 1100 - (Date.now() - lastMbAt);
  if (wait > 0) await sleep(wait);
  lastMbAt = Date.now();
  return fetchJSON(url, 12000);
}
async function caaArt(title, artist) {
  const q = encodeURIComponent(
    'release:"' + title.replace(/"/g, "") + '" AND artist:"' + artist.replace(/"/g, "") + '"',
  );
  const d = await mbThrottled(
    "https://musicbrainz.org/ws/2/release/?query=" + q + "&fmt=json&limit=5",
  );
  for (const rel of (d && d.releases) || []) {
    if (!titleMatches(title, rel.title || "")) continue;
    const credit = (rel["artist-credit"] || []).map((a) => (a.artist && a.artist.name) || "").join(" ");
    if (!artistMatches(artist, credit)) continue;
    const url = "https://coverartarchive.org/release/" + rel.id + "/front";
    if (await fetchImageOk(url)) return { url, source: "Cover Art Archive" };
  }
  return null;
}
/* Wikipedia, same guards as my fixer: the page title must start with
   the release title, the page must read as a music release, and its
   text must name the artist. */
async function wikiArt(title, artist) {
  const s = await fetchJSON(
    "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
      encodeURIComponent(title + " " + artist) +
      "&srnamespace=0&srlimit=3&format=json&origin=*",
    8000,
  );
  const hits = (s && s.query && s.query.search) || [];
  const hayArtist = norm(artist);
  const firstToken =
    hayArtist.split(" ").filter((w) => w.length >= 4 && w !== "with" && w !== "feat")[0] || "";
  for (const h of hits) {
    const pt = norm(h.title), at = norm(title);
    if (pt !== at && pt.indexOf(at + " ") !== 0) continue;
    const sum = await fetchJSON(
      "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(h.title.replace(/ /g, "_")),
      6000,
    );
    if (!sum || !sum.thumbnail || !sum.thumbnail.source) continue;
    if (sum.type === "disambiguation") continue;
    const hay = norm((sum.description || "") + " " + (sum.extract || ""));
    const descWords = norm(sum.description || "").split(" ").filter(Boolean);
    const releaseWords = ["album", "ep", "single", "song", "mixtape", "soundtrack", "compilation"];
    const isRelease =
      releaseWords.some((w) => descWords.indexOf(w) !== -1) ||
      hay.indexOf("album by") !== -1 ||
      hay.indexOf("single by") !== -1 ||
      hay.indexOf("song by") !== -1 ||
      hay.indexOf("ep by") !== -1;
    if (!isRelease) continue;
    if (hay.indexOf(hayArtist) === -1 && (!firstToken || hay.indexOf(firstToken) === -1)) continue;
    const url = sum.thumbnail.source.split("?")[0];
    if (await fetchImageOk(url)) return { url, source: "Wikipedia" };
  }
  return null;
}
async function findCover(title, artist) {
  for (const step of [appleArt, deezerArt, caaArt, wikiArt]) {
    try {
      const hit = await step(title, artist);
      if (hit) return hit;
    } catch {
      // one source failing never stops the chain
    }
  }
  return null;
}

/* ---------------- state ---------------- */
function loadState() {
  try {
    if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {}
  return { version: 1, failed: {}, stats: { found: 0, missed: 0 }, updated_at: null };
}
function saveState(state) {
  state.updated_at = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

/* ---------------- run ---------------- */
async function main() {
  if (!READ_KEY) {
    console.error("No read key: set SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY.");
    process.exit(1);
  }
  const state = loadState();
  const now = Date.now();
  const releases = await restGet(
    "splotify_releases?select=id,title,release_type,artists:splotify_artists(canonical_name),artwork:splotify_artwork(id)&order=title",
  );
  let candidates = releases.filter((r) => !(r.artwork && r.artwork.length));
  if (ONLY) candidates = candidates.filter((r) => r.id === ONLY);
  candidates = candidates.filter((r) => {
    const title = (r.title || "").trim();
    const artist = (r.artists && r.artists.canonical_name) || "";
    if (!title || /^unknown album$/i.test(title)) return false;
    if (!artist || /^unknown artist$/i.test(artist)) return false;
    const f = state.failed[r.id];
    if (f && now - new Date(f.at).getTime() < RETRY_AFTER_MS) return false;
    return true;
  });
  const batch = candidates.slice(0, LIMIT || BATCH);
  console.log("Artless releases: " + candidates.length + ", this run: " + batch.length + (DRY_RUN ? " (dry run)" : ""));
  const counts = { found: 0, missed: 0, bySource: {} };
  for (const rel of batch) {
    const title = rel.title.trim();
    const artist = rel.artists.canonical_name;
    const hit = await findCover(title, artist);
    if (!hit) {
      counts.missed++;
      state.stats.missed++;
      state.failed[rel.id] = { title, artist, at: new Date().toISOString(), attempts: (state.failed[rel.id]?.attempts || 0) + 1 };
      console.log("MISS " + title + " | " + artist);
      continue;
    }
    if (DRY_RUN) {
      counts.found++;
      counts.bySource[hit.source] = (counts.bySource[hit.source] || 0) + 1;
      console.log("WOULD " + title + " | " + artist + " | " + hit.source + " | " + hit.url);
      continue;
    }
    if (!SERVICE_KEY) {
      console.error("No service key, cannot write.");
      process.exit(1);
    }
    const res = await insertArtwork(rel.id, hit.url, hit.source);
    if (res.error) {
      console.log("WRITE-FAIL " + title + " | " + artist + " | " + res.error);
      continue;
    }
    if (res.duplicate) {
      console.log("DUP " + title + " | " + artist + " | already has art now");
      delete state.failed[rel.id];
      continue;
    }
    counts.found++;
    counts.bySource[hit.source] = (counts.bySource[hit.source] || 0) + 1;
    state.stats.found++;
    delete state.failed[rel.id];
    if (res.row) writeDataFile(res.row);
    console.log("OK " + title + " | " + artist + " | " + hit.source);
    await sleep(200);
  }
  console.log(JSON.stringify({ run: counts, artless_remaining: candidates.length - batch.length, state_stats: state.stats }));
  if (!DRY_RUN) saveState(state);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error("Sweep failed: " + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
export { findCover, appleArt, deezerArt, caaArt, wikiArt, titleMatches, artistMatches, norm };
