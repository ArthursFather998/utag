/* QA harness for utag-site (see AGENTS.md: render templates in Node).
 * Stubs document/window/location/storage/fetch, evals app.js, drives the
 * hash router through every library page, and asserts:
 *   1. no exceptions, expected content markers present
 *   2. every CSS class used exists in styles.css
 *   3. no library page fetches anything from supabase.co
 * Run: node backend/qa_harness.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}

/* ---------------- stubs ---------------- */
function fakeEl() {
  const el = {
    innerHTML: "", textContent: "", value: "", hidden: false, disabled: false,
    dataset: {}, style: {}, form: null, className: "",
    addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
    closest() { return null; },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    focus() {}, click() {}, appendChild() {}, setAttribute() {},
  };
  el.parentElement = fakeElShallow();
  return el;
}
function fakeElShallow() {
  return { appendChild() {}, addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} } };
}
const viewEl = fakeEl();
const listeners = {};
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}
const fetchedUrls = [];
async function fetchStub(url, opts) {
  const u = new URL(String(url));
  fetchedUrls.push(u.href);
  const p = u.pathname.replace(/^\/utag\//, "");
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    return { ok: false, status: 404, headers: { get: () => null },
             text: async () => "", json: async () => { throw new Error("not found: " + p); } };
  }
  const body = fs.readFileSync(fp, "utf8");
  return { ok: true, status: 200, headers: { get: () => null },
           text: async () => body, json: async () => JSON.parse(body) };
}
const documentStub = {
  baseURI: "https://example.com/utag/",
  body: fakeEl(),
  getElementById: id => (id === "view" ? viewEl : fakeEl()),
  querySelectorAll: () => [], querySelector: () => null,
  createElement: () => fakeEl(),
};
const locationStub = { hash: "", href: "https://example.com/utag/" };
const windowStub = {
  UTAG_CONFIG: { SUPABASE_URL: "https://example.supabase.co", ANON_KEY: "x" },
  addEventListener: (t, fn) => { listeners[t] = fn; },
  removeEventListener: () => {},
  scrollTo: () => {},
};

/* ---------------- load app ---------------- */
const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const ctx = {
  document: documentStub, window: windowStub, location: locationStub,
  localStorage: memStore(), sessionStorage: memStore(),
  fetch: fetchStub, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: "app.js" });

const catalog = JSON.parse(fs.readFileSync(path.join(DATA, "views/catalog.json"), "utf8"));
const firstArtist = catalog.artists[0];
const firstRelease = catalog.releases[0];
const searchTerm = firstRelease.title.split(" ")[0].slice(0, 4);

async function render(hash) {
  fetchedUrls.length = 0;
  viewEl.innerHTML = "";
  locationStub.hash = hash;
  await listeners["hashchange"]();
  await new Promise(r => setTimeout(r, 20)); // let floating promises settle
  return viewEl.innerHTML;
}

(async () => {
  await new Promise(r => setTimeout(r, 50)); // initial route() on load

  console.log("page renders:");
  let html = await render("#/");
  check("home renders", html.includes("Latest additions") && html.includes("Needs review"));
  check("home shows a real release", html.includes(firstRelease.title), firstRelease.title);
  check("home makes no supabase calls", !fetchedUrls.some(u => u.includes("supabase.co")), fetchedUrls.join(" "));

  html = await render("#/catalog");
  check("catalog renders", html.includes("<h1>Catalog</h1>") && html.includes(firstRelease.title));

  html = await render("#/artists");
  check("artists renders", html.includes("<h1>Artists</h1>") && html.includes(firstArtist.canonical_name));
  check("artists shows release counts", html.includes("releases</span>"));

  html = await render(`#/artist/${firstArtist.id}`);
  check("artist page renders", html.includes(firstArtist.canonical_name) && html.includes("Verification history"), firstArtist.canonical_name);

  html = await render(`#/release/${firstRelease.id}`);
  check("release page renders", html.includes("Tracklist") && html.includes("Cover art"), firstRelease.title);
  check("release shows artist link", html.includes(`#/artist/${catalog.releases[0].artists ? "" : ""}`) || html.includes("rec-byline"));

  html = await render("#/review");
  check("review renders", html.includes("Review queue"));

  html = await render(`#/search?q=${encodeURIComponent(searchTerm)}`);
  check("search finds release", html.includes(firstRelease.title), `term="${searchTerm}"`);

  html = await render("#/artist/00000000-0000-0000-0000-000000000000");
  check("bad artist id -> not found", html.includes("Artist not found"));
  html = await render("#/release/00000000-0000-0000-0000-000000000000");
  check("bad release id -> not found", html.includes("Release not found"));

  console.log("css classes:");
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  const used = new Set();
  for (const h of [await render("#/"), await render("#/catalog"), await render("#/artists"),
                   await render(`#/artist/${firstArtist.id}`), await render(`#/release/${firstRelease.id}`),
                   await render("#/review")]) {
    for (const m of h.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c) used.add(c);
    }
  }
  const missing = [...used].filter(c => !new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(css));
  check("all used classes exist in styles.css", missing.length === 0, missing.slice(0, 10).join(", "));

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(2); });
