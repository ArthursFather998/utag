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
let activityTimer = null;

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

function releaseRow(r, acts) {
  const a = (r.artwork || [])[0];
  const u = artUrl(a);
  const artist = (r.artists && r.artists.canonical_name) || "";
  return `<a class="drow" href="#/release/${esc(r.id)}">
    ${u ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy">` : `<span class="thumb-empty" aria-hidden="true"></span>`}
    <span class="grow">
      <span class="t">${esc(r.title)}</span>
      <span class="s">${esc(artist)}${r.release_year ? ` · ${esc(r.release_year)}` : ""}${r.label ? ` · ${esc(r.label)}` : ""}</span>
    </span>
    <span class="end">${editionChip(r.edition)}${chip(r.confidence)}</span>
    ${acts ? `<span class="acts">${acts}</span>` : ""}
  </a>`;
}

function crumbs(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb">` + items.map(([label, href], i) =>
    (i ? `<span class="sep">/</span>` : "") +
    (href ? `<a href="${href}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`)
  ).join("") + `</nav>`;
}

function refList(rows) {
  if (!rows || !rows.length) return `<p class="empty-note">Nothing on record yet.</p>`;
  return `<ol class="src-list">` + rows.map(v => `
    <li><div>
      ${chip(v.overall_confidence || v.confidence || "unknown")}
      <div class="src-why">${esc(v.rationale || (v.field ? `${v.field}: ${v.old_value || "∅"} → ${v.new_value}` : "") || "")}</div>
      <div class="src-meta">${esc(v.model || v.source || "")}${v.created_at ? ` · ${fmtDate(v.created_at)}` : ""}</div>
    </div></li>`).join("") + `</ol>`;
}

function footer() {
  return `<footer class="sitefoot">
    <span class="foot-mark">UTAG.</span>
    <span>Verified music metadata. Nothing is marked verified until independent sources agree.</span>
    <span class="foot-note">Hermes researches the open web for every record. Human rulings outrank AI, permanently.</span>
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
  const ico = (inner) => `<span class="reg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg></span>`;
  view.innerHTML = `
    <div class="portal">
      <p class="kicker" style="justify-content:center">The verified music metadata system</p>
      <p class="portal-mark">UTAG<span class="mark-dot">.</span></p>
      <p class="portal-tag">Every record checked against independent sources. Nothing guessed.</p>
      <form class="portal-search" id="portal-search-form" role="search">
        <label class="visually-hidden" for="portal-search-input">Search the database</label>
        <input id="portal-search-input" type="search" placeholder="Search artists, releases, editions" autocomplete="off">
        <button type="submit">Search</button>
      </form>
      <div class="portal-stats">
        <div class="pstat"><div class="n">${cArtists}</div><div class="l">Artists</div></div>
        <div class="pstat"><div class="n">${cReleases}</div><div class="l">Releases</div></div>
        <div class="pstat"><div class="n">${cTracks}</div><div class="l">Tracks</div></div>
        <div class="pstat"><div class="n">${cArtwork}</div><div class="l">Artwork</div></div>
        <div class="pstat"><div class="n">${cVerified}</div><div class="l">Verified</div></div>
      </div>
      <nav class="register" aria-label="Browse the system">
        <a class="reg-item" href="#/catalog">
          ${ico('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/>')}
          <span><span class="reg-name">Catalog</span><span class="reg-desc">Every release on record, each edition kept separate.</span><span class="reg-count">${cReleases} releases</span></span>
        </a>
        <a class="reg-item" href="#/artists">
          ${ico('<circle cx="12" cy="8" r="3.6"/><path d="M5 19.5c1.4-3.6 4-5.2 7-5.2s5.6 1.6 7 5.2"/>')}
          <span><span class="reg-name">Artists</span><span class="reg-desc">Canonical names, aliases, and identifiers.</span><span class="reg-count">${cArtists} artists</span></span>
        </a>
        <a class="reg-item" href="#/review">
          ${ico('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>')}
          <span><span class="reg-name">Review</span><span class="reg-desc">Records Hermes would not verify on the evidence. You decide.</span><span class="reg-count">${(review || []).length} waiting</span></span>
        </a>
        <a class="reg-item" href="#/activity">
          ${ico('<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>')}
          <span><span class="reg-name">Activity</span><span class="reg-desc">The live ledger: jobs, proposals, and everything Hermes does.</span><span class="reg-count">live</span></span>
        </a>
        <a class="reg-item" href="#/hermes">
          ${ico('<path d="M4 5.5h16v10H9.5L4 19.5z"/>')}
          <span><span class="reg-name">Hermes</span><span class="reg-desc">Talk to the researcher directly. Ask, verify, upload.</span><span class="reg-count">direct line</span></span>
        </a>
      </nav>
    </div>
    <div class="portal-section">
      <h2>Latest additions</h2>
      <div class="rows">${(recent || []).map(r => releaseRow(r)).join("")}</div>
    </div>
    <div class="portal-section">
      <h2>Waiting on review</h2>
      ${review && review.length ? `<div class="rows">${review.map(r => releaseRow(r)).join("")}</div>` : `<p class="empty-note">Nothing is waiting on review.</p>`}
    </div>
    <div class="portal-section">
      <h2>Recent verification work</h2>
      ${refList(verifs)}
    </div>
    ${footer()}`;
  document.getElementById("portal-search-form").addEventListener("submit", e => {
    e.preventDefault();
    const q = document.getElementById("portal-search-input").value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
}

/* --------------------------------------------------------------- catalog */

async function vCatalog() {
  setNav("catalog");
  const rows = await api("releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&order=created_at.desc&limit=300");
  view.innerHTML = `
    <p class="kicker">The database</p>
    <h1>Catalog</h1>
    <p class="sub">${(rows || []).length} releases on record, every edition kept separate.</p>
    <div class="rows">${(rows || []).map(r => releaseRow(r)).join("")}</div>${footer()}`;
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
    <a class="drow" href="#/artist/${esc(a.id)}">
      <span class="grow">
        <span class="t">${esc(a.canonical_name)}</span>
        <span class="s">${esc((a.genres || []).join(", "))}</span>
      </span>
      <span class="end"><span class="chip chip-edition">${counts[a.id] || 0} releases</span>${chip(a.confidence)}</span>
    </a>`).join("");
  view.innerHTML = `
    <p class="kicker">The database</p>
    <h1>Artists</h1>
    <p class="sub">${(artists || []).length} artists on record.</p>
    <div class="rows">${rowsHtml}</div>${footer()}`;
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
    return `<h2>${label}</h2><div class="rows">${g.map(r => releaseRow(r)).join("")}</div>`;
  }).join("");
  const idish = k => /id|mbid|barcode|isrc/i.test(k);
  view.innerHTML = `
    ${crumbs([["UTAG", "#/"], ["Artists", "#/artists"], [a.canonical_name, null]])}
    <div class="rec-head">
      <p class="kicker">Artist</p>
      <h1>${esc(a.canonical_name)}</h1>
      <div class="rec-chips">${chip(a.confidence)}</div>
    </div>
    <div class="rec-grid">
      <div class="rec-main">
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
      </div>
      <aside class="infobox" aria-label="Artist facts">
        ${a.image_url ? `<figure class="ib-art"><img src="${esc(a.image_url)}" alt="${esc(a.canonical_name)}" loading="lazy"></figure>` : ""}
        <dl>
          ${facts.length ? facts.map(([k, v]) => `<div class="ib-row"><dt>${esc(k)}</dt><dd${idish(k) ? ` class="mono"` : ""}>${esc(v)}</dd></div>`).join("") : `<div class="ib-row"><dt>Status</dt><dd>On record</dd></div>`}
        </dl>
      </aside>
    </div>
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

  const idish = k => /id|mbid|barcode|isrc/i.test(k);
  const ibRows = [
    ["Artist", r.artists ? `<a href="#/artist/${esc(r.artists.id)}">${esc(artistName)}</a>` : ""],
    ["Type", r.release_type], ["Edition", r.edition],
    ["Released", r.release_date || r.release_year], ["Label", r.label],
    ["Catalog no.", r.catalog_number], ["Barcode", r.barcode], ["Country", r.country],
    ["Spotify", r.spotify_id], ["Apple", r.apple_id], ["Deezer", r.deezer_id],
    ["Discogs", r.discogs_id], ["MusicBrainz", r.mbid]
  ].filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<div class="ib-row"><dt>${esc(k)}</dt><dd${idish(k) ? ` class="mono"` : ""}>${k === "Artist" ? v : esc(v)}</dd></div>`).join("");

  view.innerHTML = `
    ${crumbs([["UTAG", "#/"], ["Catalog", "#/catalog"], ...(r.artists ? [[artistName, `#/artist/${r.artists.id}`]] : []), [r.title, null]])}
    <div class="rec-head">
      <p class="kicker">Release${r.release_type ? ` · ${esc(r.release_type)}` : ""}</p>
      <h1>${esc(r.title)}</h1>
      <p class="rec-byline">${r.artists ? `<a href="#/artist/${esc(r.artists.id)}">${esc(artistName)}</a>` : ""}${r.release_year ? ` · ${esc(r.release_year)}` : ""}${r.label ? ` · ${esc(r.label)}` : ""}</p>
      <div class="rec-chips">${editionChip(r.edition) || `<span class="chip chip-edition">Original</span>`}${chip(r.confidence)}</div>
    </div>

    <div class="rec-grid">
      <div class="rec-main">
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

    ${sameTitle.length ? `<h2>Other editions of this release</h2><div class="rows">${sameTitle.map(x => releaseRow(x)).join("")}</div>` : ""}

    <h2>Sources and verification</h2>
    ${refList(verifs)}
    ${corrections && corrections.length ? `<h2>Human rulings</h2>${refList(corrections)}` : ""}
      </div>
      <aside class="infobox" aria-label="Release facts">
        <figure class="ib-art">
          ${cover ? `<img src="${esc(cover)}" alt="Cover art for ${esc(r.title)}">` : `<span class="art-empty">No canonical art yet</span>`}
        </figure>
        <dl>${ibRows}</dl>
      </aside>
    </div>
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
    return `<div class="drow">
      ${u ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy">` : `<span class="thumb-empty" aria-hidden="true"></span>`}
      <a class="grow" href="#/release/${esc(r.id)}"><span class="t">${esc(r.title)}</span>
      <span class="s">${esc(artist)}${r.release_year ? ` · ${esc(r.release_year)}` : ""}</span></a>
      <span class="end">${editionChip(r.edition)}${chip(r.confidence)}</span>
      <span class="acts qc">${qcBtns("release", r.id, r.confidence)}</span>
    </div>`;
  }).join("");
  const artRowsQ = (arts || []).map(a => `
    <div class="drow">
      <a class="grow" href="#/artist/${esc(a.id)}"><span class="t">${esc(a.canonical_name)}</span><span class="s">Artist record</span></a>
      <span class="end">${chip(a.confidence)}</span>
      <span class="acts qc">${qcBtns("artist", a.id, a.confidence)}</span>
    </div>`).join("");
  view.innerHTML = `
    <p class="kicker">Your call</p>
    <h1>Review queue</h1>
    <p class="sub">Records Hermes would not mark verified on the evidence he found. Hover a row to rule on it.</p>
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
    <a class="drow" href="#/artist/${esc(a.id)}">
      <span class="grow"><span class="t">${esc(a.canonical_name)}</span><span class="s">Artist</span></span>
      <span class="end">${chip(a.confidence)}</span></a>`).join("");
  view.innerHTML = `
    <p class="kicker">Search</p>
    <h1>${esc(q)}</h1>
    <p class="sub">${(artists || []).length + (releases || []).length} matching records.</p>
    <h2>Artists</h2>
    ${artists && artists.length ? `<div class="rows">${artistRows}</div>` : `<p class="empty-note">No matching artists.</p>`}
    <h2>Releases</h2>
    ${releases && releases.length ? `<div class="rows">${releases.map(r => releaseRow(r)).join("")}</div>` : `<p class="empty-note">No matching releases.</p>`}
    ${footer()}`;
}

/* --------------------------------------------------------------- activity */

const JOB_LABEL = { queued: "Queued", running: "Running", awaiting_approval: "Awaiting approval", approved: "Approved", applying: "Applying", done: "Done", failed: "Failed", rejected: "Rejected", skipped: "Skipped" };
const KIND_LABEL = { ruling: "Owner ruling", miss: "Splotify miss", upload: "Upload", artwork: "Cover art", sweep_track: "Track re-check", sweep_release: "Release re-check", chat: "Direct chat", apply: "Apply" };

function jobChip(s) { return `<span class="chip job-${esc(s)}">${esc(JOB_LABEL[s] || s)}</span>`; }
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
function agoText(iso) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

async function vActivity() {
  setNav("activity");
  view.innerHTML = `
    <p class="kicker">Live ledger</p>
    <h1>Hermes activity</h1>
    <p class="sub">Everything Hermes is doing, live. He researches and files proposals. Nothing lands in the catalog until you approve it.</p>
    <p class="empty-note" id="act-status"></p>
    <div class="act-head" id="act-head"></div>
    <div class="statband" id="act-stats"></div>
    <h2>Now working</h2>
    <div id="act-now"><p class="empty-note">Loading…</p></div>
    <h2>Awaiting your approval</h2>
    <div id="act-approvals"><p class="empty-note">Loading…</p></div>
    <h2>Jobs</h2>
    <div id="act-jobs"><p class="empty-note">Loading…</p></div>
    <h2>Live log</h2>
    <div id="act-log"><p class="empty-note">Loading…</p></div>
    ${footer()}`;

  const statusEl = document.getElementById("act-status");
  const setStatus = t => { statusEl.textContent = t || ""; };

  async function actCall(payload, btn) {
    if (!fnPw()) { setStatus("Unlock with the site password in the Hermes tab first, then come back to approve."); return; }
    if (btn) btn.disabled = true;
    try {
      await fnCall(payload);
      await update();
    } catch (e) {
      setStatus(e.message === "Wrong password" ? "That password was refused." : `That did not go through: ${e.message}`);
      if (btn) btn.disabled = false;
    }
  }

  function wireButtons(updateFn) {
    document.querySelectorAll("[data-approve]").forEach(b => { b.onclick = () => actCall({ action: "proposal_approve", proposal_id: b.dataset.approve }, b); });
    document.querySelectorAll("[data-reject]").forEach(b => { b.onclick = () => actCall({ action: "proposal_reject", proposal_id: b.dataset.reject }, b); });
    document.querySelectorAll("[data-retry]").forEach(b => { b.onclick = () => actCall({ action: "job_retry", job_id: b.dataset.retry }, b); });
    document.querySelectorAll("[data-cancel]").forEach(b => { b.onclick = () => actCall({ action: "job_cancel", job_id: b.dataset.cancel }, b); });
    const pauseBtn = document.getElementById("act-pause");
    if (pauseBtn) pauseBtn.onclick = () => actCall({ action: "queue_set_paused", paused: pauseBtn.dataset.paused !== "1" }, pauseBtn);
  }

  function proposalCard(p) {
    const pr = p.proposal || {};
    const art = pr.artwork || {};
    const sources = (pr.sources || []).map(s => s.url
      ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source || "source")}</a>`
      : esc(s.source || "source")).join(" · ");
    const bits = [];
    if ((pr.artist || {}).canonical_name) bits.push(`Artist: ${esc(pr.artist.canonical_name)}`);
    if ((pr.release || {}).title) bits.push(`Release: ${esc(pr.release.title)}`);
    if ((pr.tracks || []).length) bits.push(`${pr.tracks.length} track${pr.tracks.length === 1 ? "" : "s"}`);
    if (art.source_url) bits.push(`Artwork: ${esc(art.role || "candidate")}`);
    return `<div class="ref act-card">
      <div class="rh">${chip(p.confidence || "needs_review")}<span>${esc(p.title)}</span><span>${fmtTime(p.created_at)}</span></div>
      <div class="rb">${esc(p.summary || "")}</div>
      ${bits.length ? `<div class="rb act-bits">${bits.join(" · ")}</div>` : ""}
      ${art.source_url ? `<img class="act-art" src="${esc(art.source_url)}" alt="" loading="lazy">` : ""}
      ${sources ? `<div class="rb act-src">Sources: ${sources}</div>` : ""}
      <details class="act-details"><summary>Full proposal</summary><pre class="act-json">${esc(JSON.stringify(pr, null, 2))}</pre></details>
      <div class="ef-actions">
        <button class="btn" type="button" data-approve="${esc(p.id)}">Approve and apply</button>
        <button class="mini-btn" type="button" data-reject="${esc(p.id)}">Reject</button>
      </div>
    </div>`;
  }

  async function update() {
    if (!document.getElementById("act-log")) { clearInterval(activityTimer); activityTimer = null; return; }
    let control, jobs, props, events;
    try {
      [control, jobs, props, events] = await Promise.all([
        api("hermes_control?select=*&id=eq.queue"),
        api("hermes_jobs?select=*&order=updated_at.desc&limit=80"),
        api("hermes_proposals?select=*&order=created_at.desc&limit=40"),
        api("hermes_events?select=*&order=created_at.desc&limit=80")
      ]);
    } catch (e) {
      document.getElementById("act-now").innerHTML = `<p class="error-note">The activity backend is not installed yet. Run the 20261009_hermes_activity.sql migration in the Supabase SQL editor, and Hermes's work will show up here live.</p>`;
      clearInterval(activityTimer); activityTimer = null;
      return;
    }
    const ctrl = (control || [])[0] || {};
    const stale = !ctrl.heartbeat_at || (Date.now() - new Date(ctrl.heartbeat_at).getTime() > 180000);
    document.getElementById("act-head").innerHTML = `
      <span class="act-dot ${stale ? "down" : "up"}"></span>
      <span>${stale ? "Hermes stack looks down (no heartbeat). His workers may need a restart." : "Hermes is up."}</span>
      <span class="muted-note">Heartbeat ${agoText(ctrl.heartbeat_at)}${ctrl.paused ? " · Queue paused by you" : ""}</span>
      <button class="mini-btn" type="button" id="act-pause" data-paused="${ctrl.paused ? "1" : "0"}">${ctrl.paused ? "Resume queue" : "Pause queue"}</button>
      <a class="mini-btn act-link" href="#/hermes">Talk to Hermes</a>`;

    const pending = (props || []).filter(p => p.status === "pending");
    const failed24 = (jobs || []).filter(j => j.status === "failed" && (Date.now() - new Date(j.updated_at).getTime() < 86400000)).length;
    const doneToday = (jobs || []).filter(j => j.status === "done" && new Date(j.updated_at).toDateString() === new Date().toDateString()).length;
    const queued = (jobs || []).filter(j => j.status === "queued").length;
    document.getElementById("act-stats").innerHTML = `
      <div class="pstat"><div class="n">${pending.length}</div><div class="l">Awaiting approval</div></div>
      <div class="pstat"><div class="n">${queued}</div><div class="l">Queued</div></div>
      <div class="pstat"><div class="n">${doneToday}</div><div class="l">Finished today</div></div>
      <div class="pstat"><div class="n">${failed24}</div><div class="l">Failed in 24h</div></div>`;

    const running = (jobs || []).find(j => j.status === "running" || j.status === "applying");
    document.getElementById("act-now").innerHTML = running
      ? `<div class="ref"><div class="rh">${jobChip(running.status)}<span>${esc(KIND_LABEL[running.kind] || running.kind)}</span><span>started ${agoText(running.started_at || running.updated_at)}</span></div><div class="rb">${esc(running.title)}</div></div>`
      : `<p class="empty-note">Hermes is idle right now.</p>`;

    const failedProps = (props || []).filter(p => p.status === "apply_failed");
    document.getElementById("act-approvals").innerHTML =
      (pending.length ? pending.map(proposalCard).join("") : `<p class="empty-note">Nothing is waiting on you.</p>`) +
      failedProps.map(p => `<div class="ref act-card"><div class="rh"><span class="chip job-failed">Apply failed</span><span>${esc(p.title)}</span></div><div class="rb">You approved this, but the apply did not land. Send it back and Hermes will try again.</div><div class="ef-actions"><button class="btn" type="button" data-retry="${esc(p.job_id)}">Retry apply</button></div></div>`).join("");

    document.getElementById("act-jobs").innerHTML = (jobs || []).length ? `<div class="rows">` + jobs.map(j => `
      <div class="drow act-job">
        <span class="grow"><span class="t">${esc(j.title)}</span>
        <span class="s">${esc(KIND_LABEL[j.kind] || j.kind)} · ${fmtDate(j.created_at)} ${fmtTime(j.created_at)}${j.attempts ? ` · attempt ${esc(j.attempts)}` : ""}</span>
        ${j.error ? `<span class="s act-err">${esc(j.error)}</span>` : j.result ? `<span class="s">${esc(j.result)}</span>` : ""}</span>
        <span class="end">${jobChip(j.status)}</span>
        ${(j.status === "failed" || j.status === "queued") ? `<span class="acts">${j.status === "failed" ? `<button class="mini-btn" type="button" data-retry="${esc(j.id)}">Retry</button>` : ""}${j.status === "queued" ? `<button class="mini-btn danger" type="button" data-cancel="${esc(j.id)}">Cancel</button>` : ""}</span>` : ""}
      </div>`).join("") + `</div>` : `<p class="empty-note">No jobs yet.</p>`;

    document.getElementById("act-log").innerHTML = (events || []).length ? `<div class="act-loglist">` + events.map(e => `
      <div class="act-ev lvl-${esc(e.level)}"><span class="act-ev-dot"></span><span class="act-ev-time">${fmtTime(e.created_at)}</span><span class="act-ev-msg">${esc(e.message)}</span></div>`).join("") + `</div>` : `<p class="empty-note">No events yet.</p>`;

    wireButtons(update);
  }

  await update();
  clearInterval(activityTimer);
  activityTimer = setInterval(update, 4000);
}

/* ----------------------------------------------------------- hermes direct */

async function getRelayTicket(room) {
  try {
    const raw = sessionStorage.getItem("utag_relay");
    if (raw) {
      const b = JSON.parse(raw);
      if (b && b.ticket && b.room === room && (b.exp * 1000 - Date.now() > 60000)) return b;
    }
  } catch (e) { /* refetch below */ }
  const d = await fnCall({ action: "hermes_bridge", room });
  const b = { channel: d.channel, room: d.room || room, ticket: d.ticket, exp: d.exp };
  if (!b.channel || !b.ticket) throw new Error("Direct Hermes is not reporting yet");
  sessionStorage.setItem("utag_relay", JSON.stringify(b));
  return b;
}

async function vHermesDirect() {
  setNav("hermes");
  const pw = fnPw();
  view.innerHTML = `
    <div class="chat-shell" id="chat-shell">
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-hero" id="chat-hero">
        <h1 class="chat-title">Good to see you.</h1>
        <p class="chat-sub">Ask about the database, hand him a song to verify, or upload audio with the + button.</p>
      </div>
      ${pw ? "" : `
      <div class="ref chat-gate">
        <div class="rb">This tab talks straight to Hermes, live. Enter the site password once per visit.</div>
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
        <button class="pill" type="button" id="chat-new">New chat</button>
      </div>
      <p class="empty-note chat-status" id="chat-status"></p>
    </div>`;

  const pwForm = document.getElementById("pw-form");
  if (pwForm) {
    pwForm.addEventListener("submit", e => {
      e.preventDefault();
      const v = document.getElementById("pw-input").value.trim();
      if (v) { sessionStorage.setItem("utag_pw", v); vHermesDirect(); }
    });
    return;
  }

  const log = document.getElementById("chat-log");
  const status = document.getElementById("chat-status");
  const shell = document.getElementById("chat-shell");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");

  let session = localStorage.getItem("utag_direct_session") || "";
  if (!session) {
    session = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("utag_direct_session", session);
  }
  const storeKey = () => `utag_direct_msgs_${session}`;
  let msgs = [];
  try { msgs = JSON.parse(localStorage.getItem(storeKey()) || "[]"); } catch (e) { msgs = []; }

  function msgHTML(m) {
    return `<div class="msg msg-${m.role === "user" ? "user" : "assistant"}">${esc(m.content)}</div>`;
  }
  const typingHTML = `<div class="msg msg-assistant msg-typing" role="status" aria-label="Hermes is typing"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>`;
  function nearBottom() {
    const el = document.documentElement;
    return (window.innerHeight + window.scrollY) >= (el.scrollHeight - 96);
  }
  let scrollQueued = false;
  function stickToBottom() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      if (nearBottom()) window.scrollTo(0, document.documentElement.scrollHeight);
    });
  }
  /* Full rebuild, used only for structural changes (load, message sent,
     message finished, new chat). Streaming updates go through
     upsertDraft/setTyping below so the log does not flicker and the
     user's scroll position is never yanked while reading. */
  function renderAll() {
    shell.classList.toggle("has-msgs", msgs.length > 0);
    log.innerHTML = msgs.map(msgHTML).join("");
    window.scrollTo(0, document.documentElement.scrollHeight);
  }
  function upsertDraft(draft) {
    const t = log.querySelector(":scope > .msg-typing");
    if (t) t.remove();
    let bubble = log.querySelector(":scope > .msg-draft");
    if (draft) {
      if (!bubble) {
        bubble = document.createElement("div");
        bubble.className = "msg msg-assistant msg-draft";
        log.appendChild(bubble);
      }
      if (bubble.textContent !== draft) bubble.textContent = draft;
      shell.classList.add("has-msgs");
      stickToBottom();
    } else if (bubble) {
      bubble.remove();
    }
  }
  function setTyping(on) {
    const t = log.querySelector(":scope > .msg-typing");
    if (on && !t) { log.insertAdjacentHTML("beforeend", typingHTML); stickToBottom(); }
    else if (!on && t) t.remove();
  }
  renderAll();

  /* Direct line: this tab holds a live WebSocket to the UTAG relay and
     Hermes answers through it in real time (no tunnel, no middleman
     queue). The control function hands out a short-lived signed ticket
     per room after the password check. */
  let rtSocket = null;
  let rtTicket = null;
  let activeRun = null;
  async function ensureRelay() {
    if (rtSocket && rtSocket.readyState === 1 && rtTicket && rtTicket.exp * 1000 - Date.now() > 60000) return rtTicket;
    status.textContent = "";
    try {
      const t = await getRelayTicket(session);
      rtTicket = t;
      if (!rtSocket || rtSocket.readyState !== 1) {
        const base = String(t.channel || "").replace(/^http/, "ws").replace(/\/$/, "");
        if (!base.startsWith("ws")) throw new Error("Direct Hermes is not reporting yet");
        rtSocket = new WebSocket(`${base}/ws`);
        rtSocket.onmessage = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (err) { return; }
          if (m && m.room === session && activeRun) activeRun(m.data);
        };
        rtSocket.onclose = () => { rtSocket = null; };
        await new Promise((resolve, reject) => {
          const to = setTimeout(() => reject(new Error("The connection timed out. Try again.")), 15000);
          rtSocket.onopen = () => {
            clearTimeout(to);
            rtSocket.send(JSON.stringify({ type: "auth", room: session, ticket: t.ticket }));
            resolve();
          };
          rtSocket.onerror = () => { clearTimeout(to); reject(new Error("The connection hit an error. Try again.")); };
        });
      }
      status.textContent = "";
      return t;
    } catch (e) {
      status.textContent = /not reporting|404|Unknown action/i.test(e.message || "")
        ? "Direct Hermes is not switched on yet. It needs the one-time backend update (new SQL plus the control function redeploy), then this tab talks to him live with nothing in between."
        : `Could not reach Hermes: ${e.message}. Check the Activity tab for his status.`;
      throw e;
    }
  }

  /* Uploads still go to UTAG; they land in the queue as proposals. */
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
      const up = await fetch(`${(cfg.SUPABASE_URL || "").replace(/\/$/, "")}/storage/v1/object/uploads/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": file.type || "audio/mpeg", "x-upsert": "false" },
        body: file
      });
      if (!up.ok) throw new Error(`storage ${up.status}`);
      const meta = await api("uploads", {
        method: "POST",
        body: { storage_path: path, file_name: file.name, file_size: file.size, content_type: file.type || null, status: "queued" }
      }).catch(() => { throw new Error("meta"); });
      if (meta && meta.error) throw new Error("meta");
      status.textContent = `Uploaded ${file.name}. Hermes will research it and file a proposal in Activity for your approval.`;
    } catch (err) {
      status.textContent = err.message === "meta"
        ? "The file went up but the queue entry failed. Tell Muse and he will sort it."
        : "Upload failed. The uploads bucket may not be set up yet.";
    } finally {
      uploadBtn.disabled = false;
    }
  });

  document.querySelectorAll(".chat-pills .pill[data-prompt], .chat-pills .pill[data-prefill]").forEach(p => {
    p.addEventListener("click", () => {
      if (p.dataset.prompt) { input.value = p.dataset.prompt; document.getElementById("chat-form").requestSubmit(); }
      else if (p.dataset.prefill) { input.value = p.dataset.prefill; input.focus(); }
    });
  });
  document.getElementById("chat-new").addEventListener("click", () => {
    session = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("utag_direct_session", session);
    msgs = [];
    renderAll();
    status.textContent = "Fresh conversation started.";
    input.focus();
  });

  let running = false;
  document.getElementById("chat-form").addEventListener("submit", async e => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content || running) return;
    let ticket;
    try { ticket = await ensureRelay(); } catch (err) { return; }
    running = true;
    send.disabled = true;
    input.value = "";
    msgs.push({ role: "user", content });
    save();
    let draft = "";
    status.textContent = "";
    renderAll();
    setTyping(true);
    clearInterval(chatTimer);
    chatTimer = null;
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          activeRun = null;
          err ? reject(err) : resolve();
        };
        const guard = setTimeout(() => {
          if (!draft) done(new Error("Hermes did not answer. Check the Activity tab for his status."));
        }, 600000);
        activeRun = (m) => {
          if (!m) return;
          if (m.type === "text") { draft += m.text || ""; upsertDraft(draft); }
          else if (m.type === "tool_use") { if (!draft) setTyping(true); }
          else if (m.type === "tool_result" && m.is_error) { if (!draft) setTyping(true); }
          else if (m.type === "error") { draft = draft || m.text || "Hermes hit an error."; done(new Error(m.text || "Hermes hit an error.")); }
          else if (m.type === "result") { if (m.text) draft = m.text; done(); }
        };
        try {
          rtSocket.send(JSON.stringify({ type: "chat_start", text: content, ticket: ticket.ticket }));
        } catch (e) {
          done(new Error(`That message could not send: ${e.message}`));
        }
      });
      msgs.push({ role: "assistant", content: draft || "(no answer)" });
      save();
      renderAll();
      status.textContent = "";
    } catch (err) {
      msgs.push({ role: "assistant", content: draft ? `${draft}\n\n(${err.message})` : `Hermes could not answer: ${err.message}` });
      save();
      renderAll();
      status.textContent = err.message;
    } finally {
      running = false;
      send.disabled = false;
      clearInterval(chatTimer);
      chatTimer = null;
      input.focus();
    }
  });
}

/* ----------------------------------------------------------------- hermes */

async function vHermesLegacy() {
  setNav("hermes");
  const pw = sessionStorage.getItem("utag_pw") || "";
  view.innerHTML = `
    <div class="chat-shell" id="chat-shell">
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-hero" id="chat-hero">
        <h1 class="chat-title">Good to see you.</h1>
        <p class="chat-sub">Ask about the database, hand him a song to verify, or upload audio with the + button.</p>
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
  clearInterval(activityTimer);
  activityTimer = null;
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
    else if (parts[0] === "activity") await vActivity();
    else if (parts[0] === "search") await vSearch(params.get("q") || "");
    else if (parts[0] === "hermes") await vHermesDirect();
    else view.innerHTML = `<h1>Not found</h1><p class="empty-note">That page is not in UTAG.</p>${footer()}`;
  } catch (err) {
    view.innerHTML = `<h1>Read error</h1><p class="error-note">${esc(err.message || err)}</p>${footer()}`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
