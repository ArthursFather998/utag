"use strict";

/* UTAG control center — read-only public front end over the UTAG database.
   All reads go through PostgREST with the public anon key. */

const cfg = window.UTAG_CONFIG || {};
const BASE = (cfg.SUPABASE_URL || "").replace(/\/$/, "") + "/rest/v1";
const KEY = cfg.ANON_KEY || "";
const view = document.getElementById("view");

const CONF_LABEL = {
  verified: "Verified",
  high_confidence: "Highly confident",
  needs_review: "Needs review",
  conflicting: "Conflicting sources",
  unknown: "Unknown"
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function stamp(conf) {
  const c = CONF_LABEL[conf] ? conf : "unknown";
  return `<span class="stamp stamp-${c}">${esc(CONF_LABEL[c])}</span>`;
}

function editionStamp(ed) {
  return `<span class="stamp stamp-edition">${esc(ed || "original")}</span>`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? esc(iso) : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function artUrl(a) {
  if (!a) return "";
  if (a.source_url) return a.source_url;
  if (a.stored_path) return `${cfg.SUPABASE_URL}/storage/v1/object/public/artwork/${a.stored_path}`;
  return "";
}

async function api(path, opts = {}) {
  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    Accept: "application/json"
  };
  if (opts.count) {
    headers.Prefer = "count=exact";
    headers.Range = "0-0";
    headers["Range-Unit"] = "items";
  }
  const res = await fetch(`${BASE}/${path}`, { headers });
  if (!res.ok) throw new Error(`Database read failed (${res.status})`);
  if (opts.count) {
    const cr = res.headers.get("content-range") || "";
    const total = parseInt(cr.split("/")[1], 10);
    return isNaN(total) ? 0 : total;
  }
  return res.json();
}

const count = (table, filter = "") => api(`${table}?select=id${filter}`, { count: true });

/* ------------------------------------------------------------------ nav */

function setNav(name) {
  document.querySelectorAll(".mainnav a").forEach(a => {
    a.classList.toggle("active", a.dataset.nav === name);
  });
}

document.getElementById("search-form").addEventListener("submit", e => {
  e.preventDefault();
  const q = document.getElementById("search-input").value.trim();
  if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
});

/* -------------------------------------------------------------- dashboard */

async function vDashboard() {
  setNav("dashboard");
  const [cArtists, cReleases, cTracks, cArtwork, cVerifs] = await Promise.all([
    count("artists"), count("releases"), count("tracks"), count("artwork"), count("verifications")
  ]);
  const confs = ["verified", "high_confidence", "needs_review", "conflicting", "unknown"];
  const confCounts = await Promise.all(confs.map(c => count("releases", `&confidence=eq.${c}`)));
  const [recent, recentVerifs, review] = await Promise.all([
    api("releases?select=id,title,edition,release_year,label,confidence,created_at,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&order=created_at.desc&limit=8"),
    api("verifications?select=id,entity_type,overall_confidence,status,model,created_by,created_at,rationale&order=created_at.desc&limit=6"),
    api("releases?select=id,title,edition,release_year,confidence,artists(canonical_name)&confidence=in.(needs_review,conflicting)&order=created_at.desc&limit=6")
  ]);

  const confRows = confs.map((c, i) =>
    `<div class="ledger-row"><span class="k">${stamp(c)}</span><span class="v">${confCounts[i]}</span></div>`).join("");

  view.innerHTML = `
    <h1>The Ledger</h1>
    <div class="ledger">
      <div class="ledger-row"><span class="k">Artists</span><span class="v">${cArtists}</span></div>
      <div class="ledger-row"><span class="k">Releases</span><span class="v">${cReleases}</span></div>
      <div class="ledger-row"><span class="k">Tracks</span><span class="v">${cTracks}</span></div>
      <div class="ledger-row"><span class="k">Artwork records</span><span class="v">${cArtwork}</span></div>
      <div class="ledger-row"><span class="k">Verification runs</span><span class="v">${cVerifs}</span></div>
    </div>

    <h2>Releases by confidence</h2>
    <div class="ledger">${confRows}</div>

    <h2>Latest additions</h2>
    ${releaseTable(recent)}

    <h2>Waiting on review</h2>
    ${review.length ? releaseTable(review) : `<p class="empty-note">Nothing is waiting on review.</p>`}

    <h2>Recent verification runs</h2>
    ${verifList(recentVerifs)}
  `;
  wireRowLinks();
}

/* ---------------------------------------------------------------- tables */

function thumbCell(r) {
  const a = (r.artwork || [])[0];
  const u = artUrl(a);
  return u
    ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy">`
    : `<span class="thumb-empty">No art</span>`;
}

function releaseTable(rows) {
  if (!rows || !rows.length) return `<p class="empty-note">No releases recorded yet.</p>`;
  const body = rows.map(r => `
    <tr class="rowlink" data-href="#/release/${esc(r.id)}">
      <td>${thumbCell(r)}</td>
      <td><span class="cell-title">${esc(r.title)}</span><br>
          <span class="cell-sub">${esc((r.artists && r.artists.canonical_name) || "")}</span></td>
      <td>${editionStamp(r.edition)}</td>
      <td class="cell-num">${esc(r.release_year || "")}</td>
      <td class="cell-sub">${esc(r.label || "")}</td>
      <td>${stamp(r.confidence)}</td>
    </tr>`).join("");
  return `<table class="index">
    <thead><tr><th></th><th>Release</th><th>Edition</th><th>Year</th><th>Label</th><th>Confidence</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

function wireRowLinks() {
  view.querySelectorAll("tr.rowlink").forEach(tr => {
    tr.addEventListener("click", () => { location.hash = tr.dataset.href; });
  });
}

function verifList(rows) {
  if (!rows || !rows.length) return `<p class="empty-note">No verification runs recorded yet.</p>`;
  return `<div class="timeline">` + rows.map(v => `
    <div class="timeline-item">
      <div class="t-head">
        ${stamp(v.overall_confidence)}
        <span>${esc(v.entity_type)}</span>
        <span>${esc(v.model || "")}</span>
        <span>by ${esc(v.created_by || "system")}</span>
        <span>${fmtDate(v.created_at)}</span>
      </div>
      ${v.rationale ? `<div class="rationale">${esc(v.rationale)}</div>` : ""}
    </div>`).join("") + `</div>`;
}

/* ---------------------------------------------------------------- catalog */

async function vCatalog() {
  setNav("catalog");
  const rows = await api("releases?select=id,title,edition,release_year,label,confidence,created_at,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&order=created_at.desc&limit=300");
  view.innerHTML = `<h1>Catalog</h1>${releaseTable(rows)}`;
  wireRowLinks();
}

async function vArtists() {
  setNav("artists");
  const [artists, rels] = await Promise.all([
    api("artists?select=id,canonical_name,genres,confidence,created_at&order=canonical_name.asc&limit=500"),
    api("releases?select=artist_id")
  ]);
  const counts = {};
  (rels || []).forEach(r => { counts[r.artist_id] = (counts[r.artist_id] || 0) + 1; });
  const body = (artists || []).map(a => `
    <tr class="rowlink" data-href="#/artist/${esc(a.id)}">
      <td><span class="cell-title">${esc(a.canonical_name)}</span></td>
      <td class="cell-sub">${esc((a.genres || []).join(", "))}</td>
      <td class="cell-num">${counts[a.id] || 0} release${(counts[a.id] || 0) === 1 ? "" : "s"}</td>
      <td>${stamp(a.confidence)}</td>
    </tr>`).join("");
  view.innerHTML = `<h1>Artists</h1>
    ${artists && artists.length ? `<table class="index">
      <thead><tr><th>Artist</th><th>Genres</th><th></th><th>Confidence</th></tr></thead>
      <tbody>${body}</tbody></table>` : `<p class="empty-note">No artists recorded yet.</p>`}`;
  wireRowLinks();
}

async function vArtist(id) {
  setNav("artists");
  const rows = await api(`artists?select=*&id=eq.${encodeURIComponent(id)}`);
  const a = rows && rows[0];
  if (!a) { view.innerHTML = `<h1>Artist not found</h1>`; return; }
  const [releases, verifs, corrections] = await Promise.all([
    api(`releases?select=id,title,edition,release_year,label,confidence,artwork(source_url,stored_path,role)&artwork.role=eq.canonical&artist_id=eq.${encodeURIComponent(id)}&order=release_year.asc`),
    api(`verifications?select=*&entity_type=eq.artist&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=10`),
    api(`corrections?select=*&entity_type=eq.artist&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=10`)
  ]);
  const kv = [
    ["Aliases", (a.aliases || []).join(", ")],
    ["Genres", (a.genres || []).join(", ")],
    ["Spotify", a.spotify_id], ["Apple", a.apple_id], ["Deezer", a.deezer_id],
    ["Discogs", a.discogs_id], ["MusicBrainz", a.mbid]
  ].filter(([, v]) => v).map(([k, v]) => `<div class="k">${esc(k)}</div><div>${esc(v)}</div>`).join("");

  view.innerHTML = `
    <h1>${esc(a.canonical_name)}</h1>
    <p>${stamp(a.confidence)}</p>
    ${kv ? `<div class="kv">${kv}</div>` : ""}
    <h2>Releases</h2>
    ${releaseTable(releases)}
    <h2>Verification history</h2>
    ${verifList(verifs)}
    ${corrections && corrections.length ? `<h2>Human rulings</h2>${correctionList(corrections)}` : ""}
  `;
  wireRowLinks();
}

function correctionList(rows) {
  return `<div class="timeline">` + rows.map(c => `
    <div class="timeline-item">
      <div class="t-head"><span>${esc(c.field)}</span><span>${fmtDate(c.created_at)}</span><span>via ${esc(c.source)}</span></div>
      <div class="rationale">${esc(c.old_value || "∅")} → ${esc(c.new_value)}${c.note ? ` — ${esc(c.note)}` : ""}</div>
    </div>`).join("") + `</div>`;
}

/* ---------------------------------------------------------------- release */

async function vRelease(id) {
  setNav("catalog");
  const rows = await api(`releases?select=*,artists(canonical_name)&id=eq.${encodeURIComponent(id)}`);
  const r = rows && rows[0];
  if (!r) { view.innerHTML = `<h1>Release not found</h1>`; return; }
  const eid = encodeURIComponent(id);
  const [art, tracks, verifs, corrections] = await Promise.all([
    api(`artwork?select=*&release_id=eq.${eid}&order=created_at.asc`),
    api(`tracks?select=*&release_id=eq.${eid}&order=disc_number.asc,track_number.asc`),
    api(`verifications?select=*&entity_type=eq.release&entity_id=eq.${eid}&order=created_at.desc&limit=15`),
    api(`corrections?select=*&entity_type=eq.release&entity_id=eq.${eid}&order=created_at.desc&limit=15`)
  ]);

  const canonical = (art || []).find(a => a.role === "canonical");
  const others = (art || []).filter(a => a.role !== "canonical");
  const coverUrl = artUrl(canonical);

  const kv = [
    ["Artist", r.artists ? r.artists.canonical_name : ""],
    ["Type", r.release_type],
    ["Edition", r.edition],
    ["Released", r.release_date || r.release_year],
    ["Label", r.label],
    ["Catalog no.", r.catalog_number],
    ["Barcode", r.barcode],
    ["Country", r.country],
    ["Spotify", r.spotify_id], ["Apple", r.apple_id], ["Deezer", r.deezer_id],
    ["Discogs", r.discogs_id], ["MusicBrainz", r.mbid]
  ].filter(([, v]) => v !== null && v !== undefined && v !== "")
   .map(([k, v]) => `<div class="k">${esc(k)}</div><div>${esc(v)}</div>`).join("");

  const trackRows = (tracks || []).map(t => `
    <tr>
      <td class="cell-num">${t.disc_number > 1 ? `${t.disc_number}.` : ""}${esc(t.track_number || "")}</td>
      <td>${esc(t.title)}</td>
      <td class="cell-num">${t.duration_ms ? `${Math.floor(t.duration_ms / 60000)}:${String(Math.floor(t.duration_ms / 1000) % 60).padStart(2, "0")}` : ""}</td>
      <td class="cell-sub">${esc(t.isrc || "")}</td>
      <td>${stamp(t.confidence)}</td>
    </tr>`).join("");

  const artCards = (others || []).map(a => {
    const u = artUrl(a);
    return `<div class="artcard">
      ${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : `<span class="thumb-empty">No art</span>`}
      <div class="artmeta">
        <span>${esc(a.role)}${a.edition_label ? ` — ${esc(a.edition_label)}` : ""}</span>
        <span>${esc(a.source || "")}</span>
        ${stamp(a.confidence)}
      </div>
    </div>`;
  }).join("");

  view.innerHTML = `
    <div class="detail-head">
      <div class="cover-lg">
        ${coverUrl ? `<img src="${esc(coverUrl)}" alt="Canonical artwork for ${esc(r.title)}">` : `<span class="thumb-empty" style="width:100%;height:280px">No canonical art yet</span>`}
        <div class="cover-caption"><span>Canonical artwork</span>${canonical ? stamp(canonical.confidence) : ""}</div>
      </div>
      <div class="detail-main">
        <h1>${esc(r.title)}</h1>
        <p>${editionStamp(r.edition)} ${stamp(r.confidence)}</p>
        <div class="kv">${kv}</div>
      </div>
    </div>

    ${others.length ? `<hr class="section-rule"><h2>Other artwork on record</h2><div class="artstrip">${artCards}</div>` : ""}

    <hr class="section-rule">
    <h2>Tracklist</h2>
    ${tracks && tracks.length ? `<table class="index">
      <thead><tr><th>No.</th><th>Title</th><th>Length</th><th>ISRC</th><th>Confidence</th></tr></thead>
      <tbody>${trackRows}</tbody></table>` : `<p class="empty-note">No tracks recorded for this release yet.</p>`}

    <hr class="section-rule">
    <h2>Verification history</h2>
    ${verifList(verifs)}
    ${corrections && corrections.length ? `<h2>Human rulings</h2>${correctionList(corrections)}` : ""}
  `;
}

/* ----------------------------------------------------------------- review */

async function vReview() {
  setNav("review");
  const [rels, arts, verifs] = await Promise.all([
    api("releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&confidence=in.(needs_review,conflicting)&order=created_at.desc&limit=100"),
    api("artists?select=id,canonical_name,confidence&confidence=in.(needs_review,conflicting)&order=canonical_name.asc&limit=100"),
    api("verifications?select=id,entity_type,entity_id,overall_confidence,status,model,created_by,created_at,rationale&status=eq.needs_review&order=created_at.desc&limit=25")
  ]);
  const artistRows = (arts || []).map(a => `
    <tr class="rowlink" data-href="#/artist/${esc(a.id)}">
      <td><span class="cell-title">${esc(a.canonical_name)}</span></td>
      <td>${stamp(a.confidence)}</td>
    </tr>`).join("");

  view.innerHTML = `
    <h1>Review Queue</h1>
    <h2>Releases</h2>
    ${releaseTable(rels)}
    <h2>Artists</h2>
    ${arts && arts.length ? `<table class="index"><thead><tr><th>Artist</th><th>Confidence</th></tr></thead><tbody>${artistRows}</tbody></table>` : `<p class="empty-note">No artists are waiting on review.</p>`}
    <h2>Open verification runs</h2>
    ${verifList(verifs)}
  `;
  wireRowLinks();
}

/* ----------------------------------------------------------------- search */

async function vSearch(q) {
  setNav("");
  const like = encodeURIComponent(`*${q}*`);
  const [artists, releases] = await Promise.all([
    api(`artists?select=id,canonical_name,confidence&canonical_name=ilike.${like}&order=canonical_name.asc&limit=50`),
    api(`releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&title=ilike.${like}&order=created_at.desc&limit=50`)
  ]);
  const artistRows = (artists || []).map(a => `
    <tr class="rowlink" data-href="#/artist/${esc(a.id)}">
      <td><span class="cell-title">${esc(a.canonical_name)}</span></td>
      <td>${stamp(a.confidence)}</td>
    </tr>`).join("");
  view.innerHTML = `
    <h1>Search: ${esc(q)}</h1>
    <h2>Artists</h2>
    ${artists && artists.length ? `<table class="index"><thead><tr><th>Artist</th><th>Confidence</th></tr></thead><tbody>${artistRows}</tbody></table>` : `<p class="empty-note">No matching artists.</p>`}
    <h2>Releases</h2>
    ${releaseTable(releases)}
  `;
  wireRowLinks();
}

/* ----------------------------------------------------------------- router */

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { parts, params: new URLSearchParams(qs || "") };
}

async function route() {
  if (!KEY || KEY === "PASTE_ANON_KEY_HERE") {
    view.innerHTML = `<h1>Setup</h1><p class="error-note">The public read key is not configured yet. Once it is in config.js, the ledger opens.</p>`;
    return;
  }
  view.innerHTML = `<p class="loading-note">Loading…</p>`;
  const { parts, params } = parseHash();
  try {
    if (parts.length === 0) await vDashboard();
    else if (parts[0] === "catalog") await vCatalog();
    else if (parts[0] === "artists") await vArtists();
    else if (parts[0] === "artist" && parts[1]) await vArtist(parts[1]);
    else if (parts[0] === "release" && parts[1]) await vRelease(parts[1]);
    else if (parts[0] === "review") await vReview();
    else if (parts[0] === "search") await vSearch(params.get("q") || "");
    else view.innerHTML = `<h1>Not found</h1><p class="empty-note">That page is not in the ledger.</p>`;
  } catch (err) {
    view.innerHTML = `<h1>Read error</h1><p class="error-note">${esc(err.message || err)}</p>`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
