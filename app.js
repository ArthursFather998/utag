"use strict";

/* UTAG: wiki-style public front end over the UTAG database.
   Reads go through PostgREST with the public anon key.
   The Hermes chat tab posts through the utag-control function. */

const cfg = window.UTAG_CONFIG || {};
const BASE = (cfg.SUPABASE_URL || "").replace(/\/$/, "") + "/rest/v1";
const FN = (cfg.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/utag-control";
const KEY = cfg.ANON_KEY || "";
const view = document.getElementById("view");
let chatTimer = null;

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

function chip(conf) {
  const c = CONF_LABEL[conf] ? conf : "unknown";
  return `<span class="chip chip-${c}">${esc(CONF_LABEL[c])}</span>`;
}

function editionChip(ed) {
  if (!ed || ed === "original") return "";
  return `<span class="chip chip-edition">${esc(ed)}</span>`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? esc(iso) : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDur(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function artUrl(a) {
  if (!a) return "";
  if (a.stored_path) return `${cfg.SUPABASE_URL}/storage/v1/object/public/artwork/${a.stored_path}`;
  if (a.source_url) return a.source_url;
  return "";
}

async function api(path, opts = {}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" };
  if (opts.count) {
    headers.Prefer = "count=exact";
    headers.Range = "0-0";
    headers["Range-Unit"] = "items";
  }
  const res = await fetch(`${BASE}/${path}`, { headers });
  if (!res.ok) throw new Error(`Database read failed (${res.status})`);
  if (opts.count) {
    const total = parseInt((res.headers.get("content-range") || "").split("/")[1], 10);
    return isNaN(total) ? 0 : total;
  }
  return res.json();
}

const count = (table, filter = "") => api(`${table}?select=id${filter}`, { count: true });

function setNav(name) {
  document.querySelectorAll("[data-nav]").forEach(a => {
    a.classList.toggle("active", a.dataset.nav === name);
  });
}

document.getElementById("search-form").addEventListener("submit", e => {
  e.preventDefault();
  const q = document.getElementById("search-input").value.trim();
  if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
});

/* ------------------------------------------------------------- fragments */

function releaseCard(r) {
  const a = (r.artwork || [])[0];
  const u = artUrl(a);
  const artist = (r.artists && r.artists.canonical_name) || "";
  return `<a class="card" href="#/release/${esc(r.id)}">
    ${u ? `<img class="art" src="${esc(u)}" alt="" loading="lazy">` : `<span class="art-empty">No art yet</span>`}
    <div class="t">${esc(r.title)}</div>
    <div class="s">${esc(artist)}${r.release_year ? ` · ${esc(r.release_year)}` : ""}</div>
    <div class="m">${editionChip(r.edition)}${chip(r.confidence)}</div>
  </a>`;
}

function releaseRow(r) {
  const a = (r.artwork || [])[0];
  const u = artUrl(a);
  const artist = (r.artists && r.artists.canonical_name) || "";
  return `<a class="row" href="#/release/${esc(r.id)}">
    ${u ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy">` : `<span class="thumb-empty"></span>`}
    <span class="grow">
      <span class="t">${esc(r.title)}</span>
      <span class="s">${esc(artist)}${r.release_year ? ` · ${esc(r.release_year)}` : ""}${r.label ? ` · ${esc(r.label)}` : ""}</span>
    </span>
    <span class="end">${editionChip(r.edition)}${chip(r.confidence)}</span>
  </a>`;
}

function refList(rows, kind) {
  if (!rows || !rows.length) return `<p class="empty-note">Nothing on record yet.</p>`;
  return `<div class="refs">` + rows.map(v => `
    <div class="ref">
      <div class="rh">${chip(v.overall_confidence || v.confidence || "unknown")}
        <span>${esc(v.model || v.source || "")}</span>
        <span>${fmtDate(v.created_at)}</span></div>
      <div class="rb">${esc(v.rationale || (v.field ? `${v.field}: ${v.old_value || "∅"} → ${v.new_value}` : "") || "")}</div>
    </div>`).join("") + `</div>`;
}

function footer() {
  return `<footer class="sitefoot">
    <span>UTAG: verified music metadata.</span>
    <a href="privacy.html">Privacy</a>
    <a href="terms.html">Terms</a>
  </footer>`;
}

/* --------------------------------------------------------------- editing */
/* Manual edits go through the utag-control function (site password). Every
   field change lands as a corrections row: a human ruling that outranks AI. */

const CONF_OPTS = ["verified", "high_confidence", "needs_review", "conflicting", "unknown"];

function fnPw() { return sessionStorage.getItem("utag_pw") || ""; }

async function fnCall(payload) {
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
    body: JSON.stringify({ password: fnPw(), ...payload })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function pwFieldHTML() {
  return fnPw() ? "" : `<label class="ef-field ef-wide"><span>Site password (needed to save)</span><input type="password" data-pw autocomplete="current-password"></label>`;
}

function grabPw(root) {
  const el = root.querySelector("[data-pw]");
  if (el && el.value.trim()) sessionStorage.setItem("utag_pw", el.value.trim());
}

async function saveEdits(root, entityType, entityId, fields, conf) {
  const status = root.querySelector("[data-status]");
  grabPw(root);
  if (status) status.textContent = "Saving…";
  try {
    let n = 0;
    for (const f of fields) {
      await fnCall({ action: "correct", entity_type: entityType, entity_id: entityId, field: f.name, new_value: f.value });
      n++;
    }
    if (conf && conf.value !== conf.current) {
      await fnCall({ action: "set_confidence", entity_type: entityType, entity_id: entityId, confidence: conf.value });
      n++;
    }
    if (status) status.textContent = n ? `Saved ${n} change${n === 1 ? "" : "s"}. It is on record as your ruling.` : "Nothing changed.";
    return true;
  } catch (err) {
    if (status) status.textContent = err.message === "Wrong password"
      ? "That password was refused. Fix it above and save again."
      : `Save failed: ${err.message}`;
    if (err.message === "Wrong password") sessionStorage.removeItem("utag_pw");
    return false;
  }
}

function numOrNull(v) { const t = String(v ?? "").trim(); if (!t) return null; const n = Number(t); return Number.isNaN(n) ? null : n; }
function durToMs(v) {
  const t = String(v || "").trim(); if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const m = t.match(/^(\d+):([0-5]?\d)$/); return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
}

function collectFields(panel) {
  return [...panel.querySelectorAll("[data-f]")].map(el => {
    const kind = el.dataset.kind || "text";
    let value;
    if (kind === "num") value = numOrNull(el.value);
    else if (kind === "ms") value = durToMs(el.value);
    else if (kind === "array") value = el.value.split(",").map(s => s.trim()).filter(Boolean);
    else if (kind === "nulltext") value = el.value.trim() ? el.value.trim() : null;
    else value = el.value;
    const norm = value === null || value === undefined ? "" : Array.isArray(value) ? JSON.stringify(value) : String(value);
    return { name: el.dataset.f, value, changed: norm !== (el.dataset.cur || "") };
  }).filter(f => f.changed);
}

function wireEditor(panel, entityType, entityId, onSaved) {
  if (!panel) return;
  const btn = panel.querySelector("[data-save]");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const confEl = panel.querySelector("[data-conf]");
    const ok = await saveEdits(panel, entityType, entityId, collectFields(panel),
      confEl ? { value: confEl.value, current: confEl.dataset.cur } : null);
    if (ok && onSaved) setTimeout(onSaved, 400);
  });
}

function wireToggles() {
  document.querySelectorAll("[data-toggle]").forEach(b => {
    b.addEventListener("click", () => {
      const t = document.getElementById(b.dataset.toggle);
      if (t) t.hidden = !t.hidden;
    });
  });
}

function efInput(label, name, value, kind, wide) {
  const norm = value === null || value === undefined ? "" : Array.isArray(value) ? JSON.stringify(value) : String(value);
  const disp = Array.isArray(value) ? value.join(", ") : (value ?? "");
  return `<label class="ef-field${wide ? " ef-wide" : ""}"><span>${esc(label)}</span><input data-f="${name}" data-kind="${kind || "text"}" data-cur="${esc(norm)}" value="${esc(disp)}"></label>`;
}
function efSelect(label, name, value, opts) {
  return `<label class="ef-field"><span>${esc(label)}</span><select data-f="${name}" data-kind="text" data-cur="${esc(value ?? "")}">${opts.map(o => `<option value="${esc(o)}"${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
}
function efConf(current) {
  return `<label class="ef-field"><span>Confidence</span><select data-conf data-cur="${esc(current || "unknown")}">${CONF_OPTS.map(c => `<option value="${c}"${c === current ? " selected" : ""}>${c.replace(/_/g, " ")}</option>`).join("")}</select></label>`;
}
function efSave() {
  return `<div class="ef-actions"><button class="btn" type="button" data-save>Save changes</button><p class="empty-note" data-status></p></div>`;
}

/* ------------------------------------------------------------------ home */

async function vHome() {
  setNav("home");
  const [cArtists, cReleases, cTracks, cArtwork, cVerified] = await Promise.all([
    count("artists"), count("releases"), count("tracks"), count("artwork"),
    count("releases", "&confidence=eq.verified")
  ]);
  const [recent, review, verifs] = await Promise.all([
    api("releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&order=created_at.desc&limit=12"),
    api("releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&confidence=in.(needs_review,conflicting)&order=created_at.desc&limit=6"),
    api("verifications?select=id,entity_type,overall_confidence,model,created_by,created_at,rationale&order=created_at.desc&limit=5")
  ]);
  view.innerHTML = `
    <h1>UTAG</h1>
    <p class="sub">A wiki of music metadata that only marks a record verified after independent sources agree.</p>
    <div class="statline">
      <div class="stat"><div class="n">${cArtists}</div><div class="l">Artists</div></div>
      <div class="stat"><div class="n">${cReleases}</div><div class="l">Releases</div></div>
      <div class="stat"><div class="n">${cTracks}</div><div class="l">Tracks</div></div>
      <div class="stat"><div class="n">${cArtwork}</div><div class="l">Artwork</div></div>
      <div class="stat"><div class="n">${cVerified}</div><div class="l">Verified releases</div></div>
    </div>
    <h2>Latest additions</h2>
    <div class="grid">${(recent || []).map(releaseCard).join("")}</div>
    <h2>Waiting on review</h2>
    ${review && review.length ? `<div class="rows">${review.map(releaseRow).join("")}</div>` : `<p class="empty-note">Nothing is waiting on review.</p>`}
    <h2>Recent verification work</h2>
    ${refList(verifs)}
    ${footer()}`;
}

/* --------------------------------------------------------------- catalog */

async function vCatalog() {
  setNav("catalog");
  const rows = await api("releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&order=created_at.desc&limit=300");
  view.innerHTML = `<h1>Catalog</h1>
    <p class="sub">${(rows || []).length} releases on record, every edition kept separate.</p>
    <div class="grid">${(rows || []).map(releaseCard).join("")}</div>${footer()}`;
}

async function vArtists() {
  setNav("artists");
  const [artists, rels] = await Promise.all([
    api("artists?select=id,canonical_name,genres,confidence&order=canonical_name.asc&limit=500"),
    api("releases?select=artist_id")
  ]);
  const counts = {};
  (rels || []).forEach(r => { counts[r.artist_id] = (counts[r.artist_id] || 0) + 1; });
  const rowsHtml = (artists || []).map(a => `
    <a class="row" href="#/artist/${esc(a.id)}">
      <span class="grow">
        <span class="t">${esc(a.canonical_name)}</span>
        <span class="s">${esc((a.genres || []).join(", "))}</span>
      </span>
      <span class="end"><span class="chip chip-edition">${counts[a.id] || 0} releases</span>${chip(a.confidence)}</span>
    </a>`).join("");
  view.innerHTML = `<h1>Artists</h1><div class="rows">${rowsHtml}</div>${footer()}`;
}

/* ---------------------------------------------------------------- artist */

async function vArtist(id) {
  setNav("artists");
  const eid = encodeURIComponent(id);
  const rows = await api(`artists?select=*&id=eq.${eid}`);
  const a = rows && rows[0];
  if (!a) { view.innerHTML = `<h1>Artist not found</h1>${footer()}`; return; }
  const [releases, verifs, corrections] = await Promise.all([
    api(`releases?select=id,title,edition,release_year,release_type,confidence,artwork(source_url,stored_path,role)&artwork.role=eq.canonical&artist_id=eq.${eid}&order=release_year.asc`),
    api(`verifications?select=*&entity_type=eq.artist&entity_id=eq.${eid}&order=created_at.desc&limit=10`),
    api(`corrections?select=*&entity_type=eq.artist&entity_id=eq.${eid}&order=created_at.desc&limit=10`)
  ]);
  const facts = [
    ["Aliases", (a.aliases || []).join(", ")], ["Genres", (a.genres || []).join(", ")],
    ["Spotify", a.spotify_id], ["Apple", a.apple_id], ["Deezer", a.deezer_id],
    ["Discogs", a.discogs_id], ["MusicBrainz", a.mbid]
  ].filter(([, v]) => v);
  const groups = [["album", "Albums"], ["ep", "EPs"], ["single", "Singles"], ["compilation", "Compilations"], ["soundtrack", "Soundtracks"], ["other", "Other releases"]];
  const sections = groups.map(([type, label]) => {
    const g = (releases || []).filter(r => r.release_type === type);
    if (!g.length) return "";
    return `<h2>${label}</h2><div class="grid">${g.map(releaseCard).join("")}</div>`;
  }).join("");
  view.innerHTML = `
    <h1>${esc(a.canonical_name)}</h1>
    <div class="chips" style="display:flex;gap:6px;margin-top:8px">${chip(a.confidence)}</div>
    <div class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>
    <div class="edit-zone">
      <button class="mini-btn" type="button" data-toggle="artist-editor">Edit artist</button>
      <div class="edit-panel" id="artist-editor" hidden>
        <div class="ef-grid">
          ${efInput("Canonical name", "canonical_name", a.canonical_name, "text", true)}
          ${efInput("Aliases (comma separated)", "aliases", a.aliases || [], "array")}
          ${efInput("Genres (comma separated)", "genres", a.genres || [], "array")}
          ${efInput("Image URL", "image_url", a.image_url, "nulltext")}
          ${efInput("Spotify ID", "spotify_id", a.spotify_id, "nulltext")}
          ${efInput("Apple ID", "apple_id", a.apple_id, "nulltext")}
          ${efInput("Deezer ID", "deezer_id", a.deezer_id, "nulltext")}
          ${efInput("Discogs ID", "discogs_id", a.discogs_id, "nulltext")}
          ${efInput("MusicBrainz ID", "mbid", a.mbid, "nulltext")}
          ${efConf(a.confidence)}
          ${pwFieldHTML()}
        </div>
        ${efSave()}
      </div>
    </div>
    ${sections || `<p class="empty-note">No releases on record yet.</p>`}
    <h2>Verification history</h2>
    ${refList(verifs)}
    ${corrections && corrections.length ? `<h2>Human rulings</h2>${refList(corrections)}` : ""}
    ${footer()}`;

  wireToggles();
  wireEditor(document.getElementById("artist-editor"), "artist", a.id, () => vArtist(id));
}

/* --------------------------------------------------------------- release */

async function vRelease(id) {
  setNav("catalog");
  const eid = encodeURIComponent(id);
  const rows = await api(`releases?select=*,artists(id,canonical_name)&id=eq.${eid}`);
  const r = rows && rows[0];
  if (!r) { view.innerHTML = `<h1>Release not found</h1>${footer()}`; return; }
  const [art, tracks, verifs, corrections, editions] = await Promise.all([
    api(`artwork?select=*&release_id=eq.${eid}&order=created_at.asc`),
    api(`tracks?select=*&release_id=eq.${eid}&order=disc_number.asc,track_number.asc`),
    api(`verifications?select=*&entity_type=eq.release&entity_id=eq.${eid}&order=created_at.desc&limit=15`),
    api(`corrections?select=*&entity_type=eq.release&entity_id=eq.${eid}&order=created_at.desc&limit=15`),
    r.artist_id ? api(`releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&artist_id=eq.${encodeURIComponent(r.artist_id)}&id=neq.${eid}`) : Promise.resolve([])
  ]);
  const canonical = (art || []).find(x => x.role === "canonical");
  const others = (art || []).filter(x => x.role !== "canonical");
  const cover = artUrl(canonical);
  const artistName = (r.artists && r.artists.canonical_name) || "";
  const facts = [
    ["Artist", artistName], ["Type", r.release_type], ["Edition", r.edition],
    ["Released", r.release_date || r.release_year], ["Label", r.label],
    ["Catalog no.", r.catalog_number], ["Barcode", r.barcode], ["Country", r.country],
    ["Spotify", r.spotify_id], ["Apple", r.apple_id], ["Deezer", r.deezer_id],
    ["Discogs", r.discogs_id], ["MusicBrainz", r.mbid]
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  const trackRows = (tracks || []).map(t => `
    <tr><td class="num">${t.disc_number > 1 ? `${t.disc_number}.` : ""}${esc(t.track_number || "")}</td>
    <td>${esc(t.title)}</td><td class="num">${fmtDur(t.duration_ms)}</td>
    <td>${chip(t.confidence)}</td>
    <td class="num"><button class="mini-btn" type="button" data-toggle="te-${esc(t.id)}">Edit</button></td></tr>
    <tr class="tedit-row" id="te-${esc(t.id)}" hidden><td colspan="5">
      <div class="ef-grid" data-track-panel="${esc(t.id)}">
        ${efInput("Title", "title", t.title)}
        ${efInput("Track no.", "track_number", t.track_number, "num")}
        ${efInput("Disc no.", "disc_number", t.disc_number, "num")}
        ${efInput("Length (m:ss)", "duration_ms", fmtDur(t.duration_ms), "ms")}
        ${efInput("ISRC", "isrc", t.isrc, "nulltext")}
        ${efInput("Spotify ID", "spotify_id", t.spotify_id, "nulltext")}
        ${efInput("Apple ID", "apple_id", t.apple_id, "nulltext")}
        ${efInput("Deezer ID", "deezer_id", t.deezer_id, "nulltext")}
        ${efInput("MusicBrainz ID", "mbid", t.mbid, "nulltext")}
        ${efConf(t.confidence)}
        ${pwFieldHTML()}
      </div>
      ${efSave()}
    </td></tr>`).join("");
  const gallery = (others || []).map(x => {
    const u = artUrl(x);
    return `<div class="gitem">
      ${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : `<span class="art-empty" style="height:148px">No art</span>`}
      <div class="gm"><span>${esc(x.role)}${x.edition_label ? `: ${esc(x.edition_label)}` : ""}</span>
      <span>${esc(x.source || "")}</span>${chip(x.confidence)}</div></div>`;
  }).join("");
  const sameTitle = (editions || []).filter(x => x.title.toLowerCase() === r.title.toLowerCase());

  view.innerHTML = `
    <div class="wiki-head">
      <div class="wiki-art">
        ${cover ? `<img src="${esc(cover)}" alt="Cover art for ${esc(r.title)}">` : `<span class="art-empty" style="aspect-ratio:1">No canonical art yet</span>`}
      </div>
      <div class="wiki-title">
        <h1>${esc(r.title)}</h1>
        <p class="sub">${r.artists ? `<a href="#/artist/${esc(r.artists.id)}">${esc(artistName)}</a>` : ""}${r.release_year ? ` · ${esc(r.release_year)}` : ""}${r.label ? ` · ${esc(r.label)}` : ""}</p>
        <div class="chips">${editionChip(r.edition) || `<span class="chip chip-edition">Original</span>`}${chip(r.confidence)}</div>
        <div class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>
      </div>
    </div>

    <div class="edit-zone">
      <button class="mini-btn" type="button" data-toggle="rel-editor">Edit release</button>
      <div class="edit-panel" id="rel-editor" hidden>
        <div class="ef-grid">
          ${efInput("Title", "title", r.title, "text", true)}
          ${efSelect("Type", "release_type", r.release_type, ["album", "ep", "single", "compilation", "soundtrack", "other"])}
          ${efSelect("Edition", "edition", r.edition, ["original", "remaster", "deluxe", "reissue", "regional", "anniversary", "other"])}
          ${efInput("Release date (YYYY-MM-DD)", "release_date", r.release_date, "nulltext")}
          ${efInput("Release year", "release_year", r.release_year, "num")}
          ${efInput("Label", "label", r.label, "nulltext")}
          ${efInput("Catalog no.", "catalog_number", r.catalog_number, "nulltext")}
          ${efInput("Barcode", "barcode", r.barcode, "nulltext")}
          ${efInput("Country", "country", r.country, "nulltext")}
          ${efInput("Spotify ID", "spotify_id", r.spotify_id, "nulltext")}
          ${efInput("Apple ID", "apple_id", r.apple_id, "nulltext")}
          ${efInput("Deezer ID", "deezer_id", r.deezer_id, "nulltext")}
          ${efInput("Discogs ID", "discogs_id", r.discogs_id, "nulltext")}
          ${efInput("MusicBrainz ID", "mbid", r.mbid, "nulltext")}
          ${efConf(r.confidence)}
          ${pwFieldHTML()}
        </div>
        ${efSave()}
      </div>
    </div>

    <h2>Tracklist</h2>
    ${tracks && tracks.length ? `<table class="tracks"><thead><tr><th>No.</th><th>Title</th><th>Length</th><th>Confidence</th><th></th></tr></thead><tbody>${trackRows}</tbody></table>` : `<p class="empty-note">No tracks recorded for this release yet.</p>`}

    <h2>Cover art</h2>
    <div class="artman" id="artman">
      ${(art || []).length ? (art || []).map(x => { const u = artUrl(x); return `
      <div class="artrow">
        ${u ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy">` : `<span class="thumb-empty"></span>`}
        <span class="grow"><span class="t">${esc(x.role)}${x.edition_label ? `: ${esc(x.edition_label)}` : ""}</span>
        <span class="s">${esc(x.source || "")}</span></span>
        <span class="end">${chip(x.confidence)}</span>
        ${x.role !== "canonical" ? `<button class="mini-btn" type="button" data-canonical="${esc(x.id)}">Make canonical</button>` : ""}
        ${x.role !== "rejected" ? `<button class="mini-btn" type="button" data-reject="${esc(x.id)}">Reject</button>` : ""}
      </div>`; }).join("") : `<p class="empty-note">No artwork on record for this release yet.</p>`}
      <div class="ef-grid">
        ${pwFieldHTML()}
        <label class="ef-field ef-wide"><span>New artwork image URL</span><input id="art-url" placeholder="https://…"></label>
        <label class="ef-field"><span>Edition label</span><input id="art-edlabel" placeholder="e.g. 2016 original pressing"></label>
        <label class="ef-field"><span>Add as</span><select id="art-role"><option value="canonical">Canonical cover</option><option value="candidate">Candidate</option><option value="alternate">Alternate</option></select></label>
      </div>
      <div class="ef-actions"><button class="btn" type="button" id="art-add">Add artwork</button><p class="empty-note" id="art-status"></p></div>
    </div>

    ${sameTitle.length ? `<h2>Other editions of this release</h2><div class="rows">${sameTitle.map(releaseRow).join("")}</div>` : ""}

    <h2>Sources and verification</h2>
    ${refList(verifs)}
    ${corrections && corrections.length ? `<h2>Human rulings</h2>${refList(corrections)}` : ""}
    ${footer()}`;

  wireToggles();
  wireEditor(document.getElementById("rel-editor"), "release", r.id, () => vRelease(id));
  document.querySelectorAll("[data-track-panel]").forEach(p =>
    wireEditor(p.closest("td"), "track", p.dataset.trackPanel, () => vRelease(id)));

  const artman = document.getElementById("artman");
  if (artman) {
    const artStatus = document.getElementById("art-status");
    const artAction = async (btn, fn) => {
      grabPw(artman);
      btn.disabled = true;
      try { await fn(); vRelease(id); }
      catch (e) {
        artStatus.textContent = e.message === "Wrong password" ? "That password was refused." : `Failed: ${e.message}`;
        btn.disabled = false;
      }
    };
    artman.querySelectorAll("[data-canonical]").forEach(b => b.addEventListener("click", () =>
      artAction(b, () => fnCall({ action: "correct", entity_type: "artwork", entity_id: b.dataset.canonical, field: "role", new_value: "canonical" }))));
    artman.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", () =>
      artAction(b, () => fnCall({ action: "correct", entity_type: "artwork", entity_id: b.dataset.reject, field: "role", new_value: "rejected" }))));
    document.getElementById("art-add").addEventListener("click", async (e) => {
      const url = document.getElementById("art-url").value.trim();
      if (!url) { artStatus.textContent = "Paste an image URL first."; return; }
      await artAction(e.currentTarget, async () => {
        await fnCall({ action: "add_artwork", release_id: r.id, source_url: url,
          role: document.getElementById("art-role").value,
          edition_label: document.getElementById("art-edlabel").value.trim() || undefined });
      });
    });
  }
}

/* ---------------------------------------------------------------- review */

async function vReview() {
  setNav("review");
  const [rels, arts, verifs] = await Promise.all([
    api("releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&confidence=in.(needs_review,conflicting)&order=created_at.desc&limit=100"),
    api("artists?select=id,canonical_name,confidence&confidence=in.(needs_review,conflicting)&order=canonical_name.asc&limit=100"),
    api("verifications?select=*&status=eq.needs_review&order=created_at.desc&limit=25")
  ]);
  const qcBtns = (entity, eid, cur) => ["verified", "high_confidence", "conflicting"]
    .filter(c => c !== cur)
    .map(c => `<button class="mini-btn" type="button" data-qe="${entity}" data-qid="${esc(eid)}" data-qc="${c}">${c === "verified" ? "Verify" : c === "high_confidence" ? "High conf." : "Conflict"}</button>`).join("");
  const relRowsQ = (rels || []).map(r => {
    const a = (r.artwork || [])[0];
    const u = artUrl(a);
    const artist = (r.artists && r.artists.canonical_name) || "";
    return `<div class="row review-row">
      ${u ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy">` : `<span class="thumb-empty"></span>`}
      <a class="grow" href="#/release/${esc(r.id)}"><span class="t">${esc(r.title)}</span>
      <span class="s">${esc(artist)}${r.release_year ? ` · ${esc(r.release_year)}` : ""}${r.label ? ` · ${esc(r.label)}` : ""}</span></a>
      <span class="end">${editionChip(r.edition)}${chip(r.confidence)}</span>
      <span class="qc">${qcBtns("release", r.id, r.confidence)}</span>
    </div>`;
  }).join("");
  const artRowsQ = (arts || []).map(a => `
    <div class="row review-row">
      <a class="grow" href="#/artist/${esc(a.id)}"><span class="t">${esc(a.canonical_name)}</span></a>
      <span class="end">${chip(a.confidence)}</span>
      <span class="qc">${qcBtns("artist", a.id, a.confidence)}</span>
    </div>`).join("");
  view.innerHTML = `
    <h1>Review queue</h1>
    <p class="sub">Records Hermes would not mark verified on the evidence he found.</p>
    <p class="empty-note" id="review-status"></p>
    <h2>Releases</h2>
    ${rels && rels.length ? `<div class="rows">${relRowsQ}</div>` : `<p class="empty-note">No releases are waiting on review.</p>`}
    <h2>Artists</h2>
    ${arts && arts.length ? `<div class="rows">${artRowsQ}</div>` : `<p class="empty-note">No artists are waiting on review.</p>`}
    <h2>Open verification runs</h2>
    ${refList(verifs)}
    ${footer()}`;

  document.querySelectorAll("[data-qc]").forEach(b => b.addEventListener("click", async () => {
    const st = document.getElementById("review-status");
    if (!fnPw()) { st.textContent = "Unlock with the site password in the Hermes tab first, then set confidence here."; return; }
    b.disabled = true;
    try {
      await fnCall({ action: "set_confidence", entity_type: b.dataset.qe, entity_id: b.dataset.qid, confidence: b.dataset.qc });
      vReview();
    } catch (e) {
      st.textContent = e.message === "Wrong password" ? "That password was refused." : `Failed: ${e.message}`;
      b.disabled = false;
    }
  }));
}

/* ---------------------------------------------------------------- search */

async function vSearch(q) {
  setNav("");
  const like = encodeURIComponent(`*${q}*`);
  const [artists, releases] = await Promise.all([
    api(`artists?select=id,canonical_name,confidence&canonical_name=ilike.${like}&order=canonical_name.asc&limit=50`),
    api(`releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&title=ilike.${like}&order=created_at.desc&limit=50`)
  ]);
  const artistRows = (artists || []).map(a => `
    <a class="row" href="#/artist/${esc(a.id)}">
      <span class="grow"><span class="t">${esc(a.canonical_name)}</span></span>
      <span class="end">${chip(a.confidence)}</span></a>`).join("");
  view.innerHTML = `
    <h1>Search: ${esc(q)}</h1>
    <h2>Artists</h2>
    ${artists && artists.length ? `<div class="rows">${artistRows}</div>` : `<p class="empty-note">No matching artists.</p>`}
    <h2>Releases</h2>
    ${releases && releases.length ? `<div class="grid">${releases.map(releaseCard).join("")}</div>` : `<p class="empty-note">No matching releases.</p>`}
    ${footer()}`;
}

/* ----------------------------------------------------------------- hermes */

async function vHermes() {
  setNav("hermes");
  const pw = sessionStorage.getItem("utag_pw") || "";
  view.innerHTML = `
    <div class="chat-shell" id="chat-shell">
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-hero" id="chat-hero">
        <h1 class="chat-title">Good to see you.</h1>
      </div>
      ${pw ? "" : `
      <div class="ref chat-gate">
        <div class="rb">This tab talks to Hermes through the UTAG control function. Enter the site password once per visit.</div>
        <form class="pw-row" id="pw-form" style="margin-top:10px">
          <input type="password" id="pw-input" placeholder="Site password" autocomplete="current-password">
          <button class="btn" type="submit">Unlock</button>
        </form>
      </div>`}
      <form class="chat-form" id="chat-form">
        <button class="chat-plus" type="button" id="chat-upload" title="Upload an audio file to UTAG" ${pw ? "" : "disabled"}>+</button>
        <input type="file" id="chat-file" accept="audio/*" hidden>
        <input type="text" id="chat-input" placeholder="Ask Hermes…" autocomplete="off" ${pw ? "" : "disabled"}>
        <button class="chat-send" type="submit" id="chat-send" ${pw ? "" : "disabled"} aria-label="Send">&uarr;</button>
      </form>
      <div class="chat-pills">
        <button class="pill" type="button" data-prompt="What is in the UTAG database right now?">What&rsquo;s in the database?</button>
        <button class="pill" type="button" data-prompt="What in the database still needs review?">What needs review?</button>
        <button class="pill" type="button" data-prefill="Verify this song: ">Verify a song</button>
      </div>
      <p class="empty-note chat-status" id="chat-status"></p>
    </div>`;

  const pwForm = document.getElementById("pw-form");
  if (pwForm) {
    pwForm.addEventListener("submit", e => {
      e.preventDefault();
      const v = document.getElementById("pw-input").value.trim();
      if (v) { sessionStorage.setItem("utag_pw", v); vHermes(); }
    });
    return;
  }

  const log = document.getElementById("chat-log");
  const status = document.getElementById("chat-status");
  const shell = document.getElementById("chat-shell");
  const sessionId = localStorage.getItem("utag_chat_session") || "";

  function renderMessages(msgs) {
    const list = msgs || [];
    shell.classList.toggle("has-msgs", list.length > 0);
    log.innerHTML = list.map(m => `<div class="msg msg-${m.role === "user" ? "user" : "assistant"}">${esc(m.content)}</div>`).join("");
    log.lastElementChild && log.lastElementChild.scrollIntoView({ block: "end" });
  }

  async function refresh() {
    if (!sessionId) { renderMessages([]); return; }
    try {
      const msgs = await api(`chat_messages?select=role,content,created_at&session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc&limit=200`);
      renderMessages(msgs);
    } catch (err) {
      status.textContent = "Could not load the conversation.";
    }
  }

  await refresh();
  clearInterval(chatTimer);
  chatTimer = setInterval(refresh, 4000);

  /* ------------------------------------------------------------ uploads */
  const fileInput = document.getElementById("chat-file");
  const uploadBtn = document.getElementById("chat-upload");
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { status.textContent = "That file is over the 50 MB upload limit."; return; }
    status.textContent = `Uploading ${file.name}…`;
    uploadBtn.disabled = true;
    try {
      const path = `site/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
      const up = await fetch(`${BASEURL}/storage/v1/object/uploads/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": file.type || "audio/mpeg", "x-upsert": "false" },
        body: file
      });
      if (!up.ok) throw new Error(`storage ${up.status}`);
      const meta = await api("uploads", {
        method: "POST",
        body: { storage_path: path, file_name: file.name, file_size: file.size, content_type: file.type || null, status: "queued" }
      }).catch(err => { throw new Error("meta"); });
      if (meta && meta.error) throw new Error("meta");
      status.textContent = `Uploaded ${file.name}. Hermes will pick it up from the queue.`;
    } catch (err) {
      status.textContent = err.message === "meta"
        ? "The file went up but the queue entry failed. Tell Muse and he will sort it."
        : "Upload failed. The uploads bucket may not be set up yet.";
    } finally {
      uploadBtn.disabled = false;
    }
  });

  /* --------------------------------------------------------------- pills */
  document.querySelectorAll(".chat-pills .pill").forEach(p => {
    p.addEventListener("click", () => {
      const formEl = document.getElementById("chat-form");
      const inputEl = document.getElementById("chat-input");
      if (p.dataset.prompt) { inputEl.value = p.dataset.prompt; formEl.requestSubmit(); }
      else if (p.dataset.prefill) { inputEl.value = p.dataset.prefill; inputEl.focus(); }
    });
  });

  document.getElementById("chat-form").addEventListener("submit", async e => {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const send = document.getElementById("chat-send");
    const content = input.value.trim();
    if (!content) return;
    send.disabled = true;
    status.textContent = "Sending…";
    try {
      const res = await fetch(FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
        body: JSON.stringify({ password: pw, action: "chat_send", session_id: sessionId || undefined, content })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.session_id) localStorage.setItem("utag_chat_session", data.session_id);
      input.value = "";
      status.textContent = "Sent. Hermes answers here as soon as he has worked the question.";
      await refresh();
      clearInterval(chatTimer);
      chatTimer = setInterval(refresh, 4000);
    } catch (err) {
      status.textContent = err.message === "Wrong password"
        ? "That password was refused. Reload the tab to try again."
        : "Hermes chat is not switched on yet (the control function still needs deploying).";
      if (err.message === "Wrong password") sessionStorage.removeItem("utag_pw");
    } finally {
      send.disabled = false;
    }
  });
}

/* ----------------------------------------------------------------- router */

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { parts: path.split("/").filter(Boolean), params: new URLSearchParams(qs || "") };
}

async function route() {
  clearInterval(chatTimer);
  chatTimer = null;
  if (!KEY || KEY === "PASTE_ANON_KEY_HERE") {
    view.innerHTML = `<h1>Setup</h1><p class="error-note">The public read key is not configured yet.</p>`;
    return;
  }
  view.innerHTML = `<p class="loading-note">Loading…</p>`;
  const { parts, params } = parseHash();
  try {
    if (parts.length === 0) await vHome();
    else if (parts[0] === "catalog") await vCatalog();
    else if (parts[0] === "artists") await vArtists();
    else if (parts[0] === "artist" && parts[1]) await vArtist(parts[1]);
    else if (parts[0] === "release" && parts[1]) await vRelease(parts[1]);
    else if (parts[0] === "review") await vReview();
    else if (parts[0] === "search") await vSearch(params.get("q") || "");
    else if (parts[0] === "hermes") await vHermes();
    else view.innerHTML = `<h1>Not found</h1><p class="empty-note">That page is not in UTAG.</p>${footer()}`;
  } catch (err) {
    view.innerHTML = `<h1>Read error</h1><p class="error-note">${esc(err.message || err)}</p>${footer()}`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
