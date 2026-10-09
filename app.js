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
    ${sections || `<p class="empty-note">No releases on record yet.</p>`}
    <h2>Verification history</h2>
    ${refList(verifs)}
    ${corrections && corrections.length ? `<h2>Human rulings</h2>${refList(corrections)}` : ""}
    ${footer()}`;
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
    <td>${chip(t.confidence)}</td></tr>`).join("");
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

    <h2>Tracklist</h2>
    ${tracks && tracks.length ? `<table class="tracks"><thead><tr><th>No.</th><th>Title</th><th>Length</th><th>Confidence</th></tr></thead><tbody>${trackRows}</tbody></table>` : `<p class="empty-note">No tracks recorded for this release yet.</p>`}

    ${others.length ? `<h2>Artwork on record</h2><div class="gallery">${gallery}</div>` : ""}

    ${sameTitle.length ? `<h2>Other editions of this release</h2><div class="rows">${sameTitle.map(releaseRow).join("")}</div>` : ""}

    <h2>Sources and verification</h2>
    ${refList(verifs)}
    ${corrections && corrections.length ? `<h2>Human rulings</h2>${refList(corrections)}` : ""}
    ${footer()}`;
}

/* ---------------------------------------------------------------- review */

async function vReview() {
  setNav("review");
  const [rels, arts, verifs] = await Promise.all([
    api("releases?select=id,title,edition,release_year,confidence,artists(canonical_name),artwork(source_url,stored_path,role)&artwork.role=eq.canonical&confidence=in.(needs_review,conflicting)&order=created_at.desc&limit=100"),
    api("artists?select=id,canonical_name,confidence&confidence=in.(needs_review,conflicting)&order=canonical_name.asc&limit=100"),
    api("verifications?select=*&status=eq.needs_review&order=created_at.desc&limit=25")
  ]);
  const artistRows = (arts || []).map(a => `
    <a class="row" href="#/artist/${esc(a.id)}">
      <span class="grow"><span class="t">${esc(a.canonical_name)}</span></span>
      <span class="end">${chip(a.confidence)}</span></a>`).join("");
  view.innerHTML = `
    <h1>Review queue</h1>
    <p class="sub">Records Hermes would not mark verified on the evidence he found.</p>
    <h2>Releases</h2>
    ${rels && rels.length ? `<div class="rows">${rels.map(releaseRow).join("")}</div>` : `<p class="empty-note">No releases are waiting on review.</p>`}
    <h2>Artists</h2>
    ${arts && arts.length ? `<div class="rows">${artistRows}</div>` : `<p class="empty-note">No artists are waiting on review.</p>`}
    <h2>Open verification runs</h2>
    ${refList(verifs)}
    ${footer()}`;
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
    <div class="chat-wrap">
      <h1>Hermes</h1>
      <p class="sub">Ask about anything in the database, or hand him a song to verify.</p>
      ${pw ? "" : `
      <div class="ref" style="margin-bottom:14px">
        <div class="rb">This tab talks to Hermes through the UTAG control function. Enter the site password once per visit.</div>
        <form class="pw-row" id="pw-form" style="margin-top:10px">
          <input type="password" id="pw-input" placeholder="Site password" autocomplete="current-password">
          <button class="btn" type="submit">Unlock</button>
        </form>
      </div>`}
      <div class="chat-log" id="chat-log"></div>
      <form class="chat-form" id="chat-form">
        <input type="text" id="chat-input" placeholder="Ask Hermes…" autocomplete="off" ${pw ? "" : "disabled"}>
        <button class="btn" type="submit" id="chat-send" ${pw ? "" : "disabled"}>Send</button>
      </form>
      <p class="empty-note" id="chat-status"></p>
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
  const sessionId = localStorage.getItem("utag_chat_session") || "";

  async function refresh() {
    if (!sessionId) { log.innerHTML = `<p class="empty-note">No conversation yet. Send the first message.</p>`; return; }
    try {
      const msgs = await api(`chat_messages?select=role,content,created_at&session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc&limit=200`);
      log.innerHTML = (msgs || []).map(m => `
        <div class="msg msg-${m.role === "user" ? "user" : "assistant"}">
          <span class="who">${m.role === "user" ? "You" : "Hermes"}</span>${esc(m.content)}
        </div>`).join("") || `<p class="empty-note">No messages yet.</p>`;
      log.lastElementChild && log.lastElementChild.scrollIntoView({ block: "end" });
    } catch (err) {
      status.textContent = "Could not load the conversation.";
    }
  }

  await refresh();
  clearInterval(chatTimer);
  chatTimer = setInterval(refresh, 4000);

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
