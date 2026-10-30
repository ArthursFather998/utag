// ssdb_mega_link.mjs — DRAFT helper, not run here, not wired anywhere.
//
// Purpose: list (and optionally download one file from) a Mega
// folder link, for the case where an rclone account login cannot
// see the folder. Verified case: the runner's Mega login sees
// DATUM/SSDB empty, while the folder link lists the full SSDB
// backup (416 audio files). This helper is the folder-link access
// path for ssdb_fixer.py: its JSON output feeds
// parse_mega_link_listing(), which does the Album /
// "Artist - Title.mp3" parsing and the UTAG lookup.
//
// SECURITY, read this before running it anywhere:
// - The folder link is supplied ONLY via the MEGA_FOLDER_LINK
//   environment variable (or a GitHub secret mapped to it) at
//   runtime. It is never written in this file, never printed,
//   never logged, and never committed. This script prints only
//   file paths and sizes — never the link, never any key.
// - It uses megajs, the same library Splotify v9.5 uses in the
//   browser (File.fromURL(...).downloadBuffer()). In Node, install
//   it first: npm install megajs   (do NOT commit a lockfile or
//   credentials with this draft).
// - Downloading the whole backup this way is one ~6,111 MB pass;
//   prefer --list for dry-runs, and download one file at a time
//   for tag audits, exactly as Splotify's import does.
//
// Usage:
//   MEGA_FOLDER_LINK='<link supplied at runtime>' node ssdb_mega_link.mjs --list
//   MEGA_FOLDER_LINK='<link supplied at runtime>' node ssdb_mega_link.mjs --download 'AM/Arctic Monkeys - I Wanna Be Yours.mp3' --out /tmp/song.mp3
//
// Output of --list: one JSON array on stdout:
//   [{"path": "AM/Arctic Monkeys - I Wanna Be Yours.mp3", "size": 1234567}, ...]
// Paths are relative to the link root, in link order. Errors go to
// stderr with exit code 1; the link is never included in them.

import { createWriteStream } from "node:fs";

function fail(msg) {
  console.error(`ssdb_mega_link: ${msg}`);
  process.exit(1);
}

const link = process.env.MEGA_FOLDER_LINK;
if (!link) fail("MEGA_FOLDER_LINK is not set; refusing to run without a runtime-supplied link.");

const args = process.argv.slice(2);
const mode = args.includes("--list") ? "list" : args.includes("--download") ? "download" : null;
if (!mode) fail("usage: --list, or --download <relative-path> --out <file>");

let megajs;
try {
  megajs = await import("megajs");
} catch {
  fail("megajs is not installed; run: npm install megajs (in the runner, not in this repo).");
}
const { File } = megajs;
let root;
try {
  root = File.fromURL(link);
  await root.loadAttributes();
} catch (e) {
  fail(`could not open the folder link (${e && e.message ? e.message : "unknown error"}).`);
}

// Walk the folder tree depth-first, collecting files only.
const out = [];
async function walk(node, prefix) {
  let children = [];
  try {
    children = await node.children;
  } catch {
    return;
  }
  for (const child of children || []) {
    try {
      await child.loadAttributes();
    } catch {
      continue;
    }
    const rel = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.directory) {
      await walk(child, rel);
    } else if (typeof child.size === "number") {
      out.push({ path: rel, size: child.size });
    }
  }
}
await walk(root, "");

if (mode === "list") {
  process.stdout.write(JSON.stringify(out));
  process.stdout.write("\n");
  process.exit(0);
}

// --download <relative-path> --out <file>
const di = args.indexOf("--download");
const oi = args.indexOf("--out");
const want = di >= 0 ? args[di + 1] : null;
const dest = oi >= 0 ? args[oi + 1] : null;
if (!want || !dest) fail("usage: --download <relative-path> --out <file>");

async function find(node, parts) {
  let children = [];
  try {
    children = await node.children;
  } catch {
    return null;
  }
  for (const child of children || []) {
    try {
      await child.loadAttributes();
    } catch {
      continue;
    }
    if (child.name !== parts[0]) continue;
    if (parts.length === 1) return child;
    if (child.directory) return find(child, parts.slice(1));
  }
  return null;
}
const target = await find(root, want.split("/"));
if (!target) fail("file not found in the linked folder.");
try {
  const buf = await target.downloadBuffer();
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(dest);
    ws.on("finish", resolve);
    ws.on("error", reject);
    ws.end(Buffer.from(buf));
  });
  // Deliberately print only the relative path and size, never the link.
  console.error(`downloaded ${want} (${buf.length} bytes)`);
} catch (e) {
  fail(`download failed (${e && e.message ? e.message : "unknown error"}).`);
}
