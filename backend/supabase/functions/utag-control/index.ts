// UTAG control-center write path (Supabase Edge Function)
//
// The public site is read-only (anon key + RLS). Every write from the
// control center goes through this function, gated by admin auth:
// either a Supabase Auth JWT for a user whose user_metadata has
// is_admin=true, or the SITE_PASSWORD function secret as a fallback.
// Writes use the service role, which Supabase injects automatically
// as SUPABASE_SERVICE_ROLE_KEY.
//
// Deploy (dashboard): Edge Functions -> open "utag-control", paste this
// file, keep the SITE_PASSWORD secret set, deploy.
//
// Request: POST JSON { auth_token?, password?, action, ... }
// Actions:
//   correct          { entity_type, entity_id, field, new_value, note? }
//                    -> inserts a corrections row (human ruling) and applies
//                       the field change to the entity. Corrections outrank AI.
//   set_confidence   { entity_type, entity_id, confidence }
//                    -> sets confidence (and status) on the entity.
//   resolve_verification { verification_id, status }
//                    -> marks a verification run verified / needs_review / conflicting.
//   hermes_bridge    { room }
//                    -> mints a short-lived relay ticket (HMAC with the bridge
//                       token from the hermes_bridge table).
//   proposal_approve / proposal_reject / job_retry / job_cancel / queue_set_paused
//                    -> Activity tab controls.
//   delete_upload    { upload_id }
//                    -> deletes an uploaded audio file (storage + row).
//                      Refused while Hermes is processing it.
// Response: JSON { ok: true, ... } or { ok: false, error }

import { createClient } from "jsr:@supabase/supabase-js@2";

const CONFIDENCE = ["verified", "high_confidence", "needs_review", "conflicting", "unknown"];
const ENTITY_TABLE: Record<string, string> = {
  artist: "artists",
  release: "releases",
  track: "tracks",
  artwork: "artwork",
};

// Fields a human ruling may change, per entity. Anything else is rejected.
const EDITABLE: Record<string, string[]> = {
  artist: ["canonical_name", "aliases", "genres", "image_url", "mbid", "spotify_id", "apple_id", "deezer_id", "discogs_id"],
  release: ["title", "release_type", "edition", "release_date", "release_year", "release_status", "label", "catalog_number", "barcode", "country", "mbid", "spotify_id", "apple_id", "deezer_id", "discogs_id"],
  track: ["title", "track_number", "disc_number", "isrc", "duration_ms", "mbid", "spotify_id", "apple_id", "deezer_id"],
  artwork: ["role", "edition_label", "source_url"],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/* Turn any thrown value — including raw PostgREST error objects, which are
   NOT Error instances — into a readable message. Never "[object Object]". */
function errText(err: unknown): string {
  const o = err as { message?: string; code?: string; details?: string; hint?: string } | null;
  if (o && typeof o.message === "string" && o.message) {
    if (o.code === "23505") {
      return "That value is already taken by another record — merge the records instead of renaming.";
    }
    const extra = [o.code, o.details, o.hint].filter(Boolean).join(" ");
    return extra ? `${o.message} (${extra})` : o.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// Browser calls are cross-origin (GitHub Pages -> Supabase): the function
// must answer CORS preflights itself and carry the headers on every
// response, or the browser blocks the call before it lands.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const sitePassword = Deno.env.get("SITE_PASSWORD") || "";

  // Admin gate: a Supabase Auth JWT for an is_admin user, or the site
  // password as a fallback. The JWT is verified against the Auth API so
  // a stolen anon key alone is never enough.
  async function checkAdmin(): Promise<boolean> {
    if (sitePassword && body.password === sitePassword) return true;
    const token = String(body.auth_token || "");
    if (!token) return false;
    try {
      const url = Deno.env.get("SUPABASE_URL")!;
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const res = await fetch(`${url}/auth/v1/user`, {
        headers: { apikey: key, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      const user = await res.json();
      return user?.user_metadata?.is_admin === true;
    } catch {
      return false;
    }
  }

  if (!(await checkAdmin())) {
    return json({ ok: false, error: "Not signed in as admin" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const REPO_OWNER = "ArthursFather998";
  const REPO_NAME = "utag";

  function toB64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  /* Event-driven repo sync: after a library write, commit the changed row's
     JSON file to the repo so the file library tracks Supabase on every edit.
     A GitHub Action rebuilds the derived views on each such push. Supabase is
     the source of truth — a failed commit never fails the save itself. */
  /* Best-effort activity log: every library write appears in the Activity tab. */
  async function logActivity(event: string, message: string, level = "info") {
    try {
      await supabase.from("hermes_events").insert({
        job_id: null,
        level,
        event,
        message: message.slice(0, 500),
        details: {},
      });
    } catch { /* never break the write for logging */ }
  }

  async function syncRowToRepo(table: string, id: string): Promise<"ok" | "skipped" | "failed"> {
    const token = Deno.env.get("GITHUB_REPO_TOKEN") || "";
    if (!token) return "skipped";
    try {
      const { data: row, error } = await supabase.from(table).select("*").eq("id", id).single();
      if (error || !row) return "failed";
      const path = `data/${table}/${id}.json`;
      const api = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      };
      let sha: string | undefined;
      const cur = await fetch(api, { headers });
      if (cur.ok) {
        sha = (await cur.json()).sha;
      } else if (cur.status !== 404) {
        return "failed";
      }
      const putBody: Record<string, unknown> = {
        message: `Sync ${table}/${id} via utag-control`,
        content: toB64(JSON.stringify(row, null, 2) + "\n"),
      };
      if (sha) putBody.sha = sha;
      const res = await fetch(api, { method: "PUT", headers, body: JSON.stringify(putBody) });
      return res.ok ? "ok" : "failed";
    } catch {
      return "failed";
    }
  }

  async function syncRowsToRepo(table: string, ids: string[]): Promise<"ok" | "skipped" | "failed"> {
    let sawOk = false, sawFailed = false;
    for (const id of ids) {
      const r = await syncRowToRepo(table, id);
      if (r === "ok") sawOk = true;
      if (r === "failed") sawFailed = true;
    }
    if (sawFailed) return "failed";
    return sawOk ? "ok" : "skipped";
  }

  async function deleteRowFromRepo(table: string, id: string): Promise<"ok" | "skipped" | "failed"> {
    const token = Deno.env.get("GITHUB_REPO_TOKEN") || "";
    if (!token) return "skipped";
    try {
      const path = `data/${table}/${id}.json`;
      const api = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      };
      const cur = await fetch(api, { headers });
      if (cur.status === 404) return "ok";
      if (!cur.ok) return "failed";
      const sha = (await cur.json()).sha;
      const res = await fetch(api, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ message: `Remove ${table}/${id} via utag-control`, sha }),
      });
      return res.ok ? "ok" : "failed";
    } catch {
      return "failed";
    }
  }

  async function deleteRowsFromRepo(pairs: [string, string][]): Promise<"ok" | "skipped" | "failed"> {
    let sawOk = false, sawFailed = false;
    for (const [table, id] of pairs) {
      const r = await deleteRowFromRepo(table, id);
      if (r === "ok") sawOk = true;
      if (r === "failed") sawFailed = true;
    }
    if (sawFailed) return "failed";
    return sawOk ? "ok" : "skipped";
  }

  const action = String(body.action || "");

  try {
    if (action === "correct") {
      const entityType = String(body.entity_type || "");
      const table = ENTITY_TABLE[entityType];
      const field = String(body.field || "");
      if (!table) return json({ ok: false, error: "Unknown entity_type" }, 400);
      if (!EDITABLE[entityType].includes(field)) {
        return json({ ok: false, error: `Field not editable: ${field}` }, 400);
      }
      const entityId = String(body.entity_id || "");
      const isArr = Array.isArray(body.new_value);
      // "auto" release status stores as null (date-checked).
      const storedValue = (entityType === "release" && field === "release_status" && body.new_value === "auto")
        ? null : body.new_value;
      const corrValue = isArr ? JSON.stringify(storedValue) : String(storedValue ?? "");

      // Promoting artwork to canonical: demote the release's current
      // canonical first, or the one-canonical-per-release index rejects it.
      const demotedIds: string[] = [];
      if (entityType === "artwork" && field === "role" && body.new_value === "canonical") {
        const { data: self } = await supabase
          .from("artwork").select("release_id").eq("id", entityId).single();
        if (self) {
          const { data: others } = await supabase.from("artwork").select("id")
            .eq("release_id", (self as { release_id: string }).release_id)
            .eq("role", "canonical")
            .neq("id", entityId);
          for (const o of (others || []) as { id: string }[]) demotedIds.push(o.id);
          await supabase.from("artwork")
            .update({ role: "alternate" })
            .eq("release_id", (self as { release_id: string }).release_id)
            .eq("role", "canonical")
            .neq("id", entityId);
        }
      }

      const { data: current, error: readErr } = await supabase
        .from(table).select(field).eq("id", entityId).single();
      if (readErr) throw readErr;

      // Artist rename to an existing name: merge instead of erroring.
      // Moves all releases/tracks to the existing artist, then deletes the old one.
      if (entityType === "artist" && field === "canonical_name") {
        const targetName = String(storedValue).trim();
        const { data: existing } = await supabase.from("artists").select("id")
          .ilike("canonical_name", targetName.replace(/[%_\\]/g, "\\$&"))
          .neq("id", entityId).limit(1).maybeSingle();
        if (existing) {
          const newArtistId = (existing as { id: string }).id;
          // Move releases; merge conflicting ones (same title/year) by moving their tracks.
          const { data: oldReleases } = await supabase.from("releases")
            .select("id,title,release_year,edition").eq("artist_id", entityId);
          for (const rel of (oldReleases || []) as { id: string; title: string; release_year: number | null; edition: string | null }[]) {
            const { data: conflict } = await supabase.from("releases").select("id")
              .eq("artist_id", newArtistId)
              .ilike("title", rel.title.replace(/[%_\\]/g, "\\$&"))
              .eq("edition", rel.edition || "original")
              .limit(1).maybeSingle();
            // Note: null years need special handling; match via is() below
            let conflictId = conflict ? (conflict as { id: string }).id : null;
            if (!conflictId) {
              let q = supabase.from("releases").select("id").eq("artist_id", newArtistId)
                .ilike("title", rel.title.replace(/[%_\\]/g, "\\$&"));
              q = rel.release_year ? q.eq("release_year", rel.release_year) : q.is("release_year", null);
              const { data: c2 } = await q.limit(1).maybeSingle();
              if (c2) conflictId = (c2 as { id: string }).id;
            }
            if (conflictId) {
              // Merge: move tracks to the existing release, delete the duplicate.
              await supabase.from("tracks").update({ artist_id: newArtistId, release_id: conflictId })
                .eq("release_id", rel.id);
              await supabase.from("artwork").delete().eq("release_id", rel.id);
              await supabase.from("releases").delete().eq("id", rel.id);
            } else {
              await supabase.from("releases").update({ artist_id: newArtistId }).eq("id", rel.id);
            }
          }
          // Move any remaining tracks directly tied to the old artist.
          await supabase.from("tracks").update({ artist_id: newArtistId }).eq("artist_id", entityId);
          // Delete the old artist.
          await supabase.from("artists").delete().eq("id", entityId);
          await supabase.from("corrections").insert({
            entity_type: "artist", entity_id: newArtistId, field: "canonical_name",
            old_value: current ? String((current as Record<string, unknown>)[field] ?? "") : null,
            new_value: targetName, source: "manual",
            note: `Merged artist ${entityId} into existing ${newArtistId}`,
          });
          const repoSync = "skipped"; // client triggers re-export via awaitLibraryUpdate
          await logActivity("edit", `Merged artist into ${targetName}`);
          return json({ ok: true, action, entity_id: newArtistId, field, merged: true, repo_sync: repoSync });
        }
      }

      // Apply the change FIRST, then record the ruling. If the update fails
      // (e.g. unique-name clash), no phantom correction is left behind.
      const patch: Record<string, unknown> = { [field]: storedValue };
      if (entityType !== "artwork") patch.updated_at = new Date().toISOString();
      const { error: updErr } = await supabase.from(table).update(patch).eq("id", entityId);
      if (updErr) throw updErr;

      const { error: corrErr } = await supabase.from("corrections").insert({
        entity_type: entityType,
        entity_id: entityId,
        field,
        old_value: current ? String((current as Record<string, unknown>)[field] ?? "") : null,
        new_value: corrValue,
        source: "manual",
        note: body.note ? String(body.note) : null,
      });
      if (corrErr) throw corrErr;
      const repoSync = await syncRowsToRepo(table, [entityId, ...demotedIds]);
      await logActivity("edit", `Edited ${entityType} ${field}: "${String(corrValue).slice(0, 80)}"`);
      return json({ ok: true, action, entity_id: entityId, field, repo_sync: repoSync });
    }

    if (action === "set_confidence") {
      const entityType = String(body.entity_type || "");
      const table = ENTITY_TABLE[entityType];
      const confidence = String(body.confidence || "");
      if (!table) return json({ ok: false, error: "Unknown entity_type" }, 400);
      if (!CONFIDENCE.includes(confidence)) return json({ ok: false, error: "Unknown confidence" }, 400);
      const entityId = String(body.entity_id || "");
      const patch: Record<string, unknown> = { confidence, status: confidence };
      if (entityType !== "artwork") patch.updated_at = new Date().toISOString();
      const { error } = await supabase.from(table)
        .update(patch)
        .eq("id", entityId);
      if (error) throw error;
      const repoSync = await syncRowToRepo(table, entityId);
      await logActivity("edit", `Set ${entityType} confidence to ${confidence}`);
      return json({ ok: true, action, confidence, repo_sync: repoSync });
    }

    if (action === "resolve_verification") {
      const status = String(body.status || "");
      if (!CONFIDENCE.includes(status)) return json({ ok: false, error: "Unknown status" }, 400);
      const verificationId = String(body.verification_id || "");
      const { error } = await supabase.from("verifications")
        .update({ status })
        .eq("id", verificationId);
      if (error) throw error;
      const repoSync = await syncRowToRepo("verifications", verificationId);
      return json({ ok: true, action, status, repo_sync: repoSync });
    }

    if (action === "add_artwork") {
      const releaseId = String(body.release_id || "");
      const sourceUrl = String(body.source_url || "").trim();
      const role = ["canonical", "candidate", "alternate"].includes(String(body.role))
        ? String(body.role) : "candidate";
      if (!releaseId || !sourceUrl) return json({ ok: false, error: "release_id and source_url required" }, 400);
      const { data: rel, error: relErr } = await supabase
        .from("releases").select("id").eq("id", releaseId).single();
      if (relErr || !rel) return json({ ok: false, error: "Release not found" }, 404);
      const demotedIds: string[] = [];
      if (role === "canonical") {
        const { data: old } = await supabase.from("artwork")
          .select("id").eq("release_id", releaseId).eq("role", "canonical");
        for (const row of (old || []) as { id: string }[]) {
          demotedIds.push(row.id);
          await supabase.from("artwork").update({ role: "alternate" }).eq("id", row.id);
          await supabase.from("corrections").insert({
            entity_type: "artwork", entity_id: row.id, field: "role",
            old_value: "canonical", new_value: "alternate", source: "manual",
            note: "Replaced as canonical by a manual artwork add",
          });
        }
      }
      const { data: art, error: artErr } = await supabase.from("artwork").insert({
        release_id: releaseId,
        source_url: sourceUrl,
        role,
        edition_label: body.edition_label ? String(body.edition_label) : null,
        source: "user",
        confidence: "verified",
        status: "verified",
      }).select("id").single();
      if (artErr) throw artErr;
      const artId = (art as { id: string }).id;
      await supabase.from("corrections").insert({
        entity_type: "artwork", entity_id: artId, field: "source_url",
        old_value: null, new_value: sourceUrl, source: "manual",
        note: `Artwork added manually with role ${role}`,
      });
      const repoSync = await syncRowsToRepo("artwork", [artId, ...demotedIds]);
      await logActivity("edit", `Added artwork (${role}) to release`);
      return json({ ok: true, action, artwork_id: artId, repo_sync: repoSync });
    }

    if (action === "fixer_save") {
      /* Save a fixed song to the library: ensure artist → release → track,
         add artwork if a URL came back, sync every touched row to the repo. */
      const artistName = String(body.artist || "").trim();
      const title = String(body.title || "").trim();
      if (!artistName || !title) return json({ ok: false, error: "artist and title required" }, 400);
      const escLike = (s: string) => s.replace(/[%_\\]/g, "\\$&");

      let artistId: string, artistExisted = true;
      {
        const { data } = await supabase.from("artists").select("id")
          .ilike("canonical_name", escLike(artistName)).limit(1).maybeSingle();
        if (data) artistId = (data as { id: string }).id;
        else {
          const { data: ins, error } = await supabase.from("artists")
            .insert({ canonical_name: artistName }).select("id").single();
          if (error) throw error;
          artistId = (ins as { id: string }).id;
          artistExisted = false;
        }
      }

      const album = String(body.album || "").trim();
      const releaseTitle = album || title;
      const releaseType = album ? "album" : "single";
      const year = body.year ? parseInt(String(body.year), 10) : null;
      let releaseId: string, releaseExisted = true;
      {
        let q = supabase.from("releases").select("id").eq("artist_id", artistId)
          .ilike("title", escLike(releaseTitle)).limit(1);
        if (year) q = q.eq("release_year", year);
        const { data } = await q.maybeSingle();
        if (data) releaseId = (data as { id: string }).id;
        else {
          const { data: ins, error } = await supabase.from("releases").insert({
            artist_id: artistId,
            title: releaseTitle,
            release_type: releaseType,
            release_year: year || null,
            confidence: body.verified ? "high_confidence" : "needs_review",
            status: body.verified ? "high_confidence" : "needs_review",
          }).select("id").single();
          if (error) throw error;
          releaseId = (ins as { id: string }).id;
          releaseExisted = false;
        }
      }

      const trackNo = body.track_no ? parseInt(String(body.track_no), 10) : null;
      const discNo = body.disc_no ? parseInt(String(body.disc_no), 10) : 1;
      const durationMs = body.duration_ms ? Math.round(Number(body.duration_ms)) : null;
      let trackId: string, trackExisted = true;
      {
        const { data } = await supabase.from("tracks").select("id")
          .eq("release_id", releaseId).ilike("title", escLike(title)).limit(1).maybeSingle();
        if (data) trackId = (data as { id: string }).id;
        else {
          const { data: ins, error } = await supabase.from("tracks").insert({
            release_id: releaseId,
            artist_id: artistId,
            title,
            track_number: trackNo || null,
            disc_number: discNo || 1,
            duration_ms: durationMs,
            confidence: body.verified ? "high_confidence" : "needs_review",
            status: body.verified ? "high_confidence" : "needs_review",
          }).select("id").single();
          if (error) throw error;
          trackId = (ins as { id: string }).id;
          trackExisted = false;
        }
      }

      let artworkId: string | null = null;
      const artUrl = String(body.art_url || "").trim();
      if (artUrl) {
        /* Auto-canonical: fixer-detected artwork goes straight to canonical
           (no manual approval). Demote any existing canonical first. */
        const { data: existingCanon } = await supabase.from("artwork")
          .select("id").eq("release_id", releaseId).eq("role", "canonical");
        const shouldAdd = !releaseExisted || !(existingCanon && existingCanon.length);
        if (shouldAdd) {
          const demotedIds: string[] = [];
          for (const row of (existingCanon || []) as { id: string }[]) {
            demotedIds.push(row.id);
            await supabase.from("artwork").update({ role: "alternate" }).eq("id", row.id);
          }
          const { data: ins } = await supabase.from("artwork").insert({
            release_id: releaseId,
            source_url: artUrl,
            role: "canonical",
            source: String(body.art_source || "fixer"),
            confidence: body.verified ? "high_confidence" : "needs_review",
            status: body.verified ? "high_confidence" : "needs_review",
          }).select("id").single();
          if (ins) {
            artworkId = (ins as { id: string }).id;
            await syncRowsToRepo("artwork", demotedIds);
          }
        }
      }

      const synced: string[] = [];
      if (!artistExisted) { await syncRowToRepo("artists", artistId); synced.push("artists"); }
      if (!releaseExisted) { await syncRowToRepo("releases", releaseId); synced.push("releases"); }
      if (!trackExisted) { await syncRowToRepo("tracks", trackId); synced.push("tracks"); }
      if (artworkId) { await syncRowToRepo("artwork", artworkId); synced.push("artwork"); }
      return json({
        ok: true, action, artist_id: artistId, release_id: releaseId,
        track_id: trackId, artwork_id: artworkId,
        existed: { artist: artistExisted, release: releaseExisted, track: trackExisted },
        repo_sync: synced.length ? "ok" : "skipped",
      });
    }

    if (action === "fixer_log") {
      /* Activity-tab logging for the fixer (client-side audit). op:
         start → new job row; event → live-log row; done → close the job. */
      const op = String(body.op || "");
      if (op === "start") {
        const { data, error } = await supabase.from("hermes_jobs").insert({
          kind: "upload",
          title: String(body.title || "Fixer").slice(0, 200),
          payload: { fixer: true, file_name: String(body.file_name || "") },
          status: "running",
          started_at: new Date().toISOString(),
        }).select("id").single();
        if (error) throw error;
        return json({ ok: true, action, job_id: (data as { id: string }).id });
      }
      if (op === "event") {
        const { error } = await supabase.from("hermes_events").insert({
          job_id: body.job_id ? String(body.job_id) : null,
          level: ["info", "success", "warn", "error"].includes(String(body.level)) ? String(body.level) : "info",
          event: String(body.event || "fixer").slice(0, 120),
          message: String(body.message || "").slice(0, 500),
          details: { fixer: true },
        });
        if (error) throw error;
        return json({ ok: true, action });
      }
      if (op === "done") {
        const status = ["done", "failed"].includes(String(body.status)) ? String(body.status) : "done";
        const { error } = await supabase.from("hermes_jobs").update({
          status,
          result: body.result ? String(body.result).slice(0, 500) : null,
          error: body.error ? String(body.error).slice(0, 500) : null,
          finished_at: new Date().toISOString(),
        }).eq("id", String(body.job_id || ""));
        if (error) throw error;
        return json({ ok: true, action });
      }
      return json({ ok: false, error: "Unknown fixer_log op" }, 400);
    }

    if (action === "delete_track") {
      const trackId = String(body.track_id || "");
      if (!trackId) return json({ ok: false, error: "Missing track_id" }, 400);
      const { data: trackRow, error: tErr } = await supabase
        .from("tracks").select("id").eq("id", trackId).single();
      if (tErr || !trackRow) return json({ ok: false, error: "Track not found" }, 404);
      const { data: verifs } = await supabase.from("verifications")
        .select("id").eq("entity_type", "track").eq("entity_id", trackId);
      // Delete the track and its verifications (meaningless without it).
      // Corrections stay as the history of your rulings.
      const { error: vDelErr } = await supabase.from("verifications")
        .delete().eq("entity_type", "track").eq("entity_id", trackId);
      if (vDelErr) throw vDelErr;
      const { error: delErr } = await supabase.from("tracks").delete().eq("id", trackId);
      if (delErr) throw delErr;
      const removed: [string, string][] = [["tracks", trackId]];
      for (const v of (verifs || []) as { id: string }[]) removed.push(["verifications", v.id]);
      const repoSync = await deleteRowsFromRepo(removed);
      await logActivity("edit", `Removed track ${trackId}`);
      return json({ ok: true, action, track_id: trackId, repo_sync: repoSync });
    }

    if (action === "chat_send") {
      const content = String(body.content || "").trim();
      if (!content) return json({ ok: false, error: "Empty message" }, 400);
      let sessionId = body.session_id ? String(body.session_id) : "";
      if (!sessionId) {
        const { data, error } = await supabase.from("chat_sessions")
          .insert({ title: content.slice(0, 60) }).select("id").single();
        if (error) throw error;
        sessionId = (data as { id: string }).id;
      }
      const { error } = await supabase.from("chat_messages")
        .insert({ session_id: sessionId, role: "user", content });
      if (error) throw error;
      return json({ ok: true, action, session_id: sessionId });
    }

    if (action === "hermes_bridge") {
      // Direct chat rides a Supabase Realtime channel: the bridge dials out
      // to it from the sandbox (public tunnels do not survive the egress
      // proxy) and the site joins the same channel. This action mints a
      // short-lived ticket, HMAC-signed with the bridge token, after the
      // password check above. The bridge verifies it before running.
      const { data, error } = await supabase.from("hermes_bridge")
        .select("url,token,updated_at").eq("id", "utag").single();
      if (error || !data || !(data as { url?: string }).url) {
        return json({ ok: false, error: "Direct Hermes is not reporting yet" }, 404);
      }
      const row = data as { url: string; token: string; updated_at: string };
      const room = String(body.room || "web").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 48).replace(/^-+|-+$/g, "") || "web";
      const exp = Math.floor(Date.now() / 1000) + 600;
      const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(row.token),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${room}.${exp}`));
      const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return json({
        ok: true, action, channel: row.url, room,
        ticket: `${room}.${exp}.${sig}`, exp, updated_at: row.updated_at,
      });
    }

    if (action === "proposal_approve" || action === "proposal_reject") {
      const proposalId = String(body.proposal_id || "");
      const { data: prop, error: pErr } = await supabase.from("hermes_proposals")
        .select("id,job_id,title,status").eq("id", proposalId).single();
      if (pErr || !prop) return json({ ok: false, error: "Proposal not found" }, 404);
      const p = prop as { id: string; job_id: string; title: string; status: string };
      if (p.status !== "pending") return json({ ok: false, error: `Proposal already ${p.status}` }, 409);
      if (action === "proposal_approve") {
        const { error } = await supabase.from("hermes_proposals")
          .update({ status: "approved", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", proposalId);
        if (error) throw error;
        await supabase.from("hermes_jobs")
          .update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", p.job_id);
        await supabase.from("hermes_events").insert({
          job_id: p.job_id, level: "info", event: "proposal_approved",
          message: `You approved: ${p.title}`, details: {},
        });
        return json({ ok: true, action, proposal_id: proposalId });
      }
      const { error } = await supabase.from("hermes_proposals")
        .update({ status: "rejected", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", proposalId);
      if (error) throw error;
      const { data: jobRow } = await supabase.from("hermes_jobs")
        .select("source_table,source_id").eq("id", p.job_id).single();
      await supabase.from("hermes_jobs")
        .update({ status: "rejected", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", p.job_id);
      const job = jobRow as { source_table?: string; source_id?: string } | null;
      if (job && job.source_table === "submissions" && job.source_id) {
        await supabase.from("submissions").update({ processed_at: new Date().toISOString() }).eq("id", job.source_id);
      } else if (job && job.source_table === "uploads" && job.source_id) {
        await supabase.from("uploads").update({ status: "rejected" }).eq("id", job.source_id);
      }
      await supabase.from("hermes_events").insert({
        job_id: p.job_id, level: "warn", event: "proposal_rejected",
        message: `You rejected: ${p.title}`, details: {},
      });
      return json({ ok: true, action, proposal_id: proposalId });
    }

    if (action === "job_retry" || action === "job_cancel") {
      const jobId = String(body.job_id || "");
      const { data: jobRow, error: jErr } = await supabase.from("hermes_jobs")
        .select("id,status,source_table,source_id").eq("id", jobId).single();
      if (jErr || !jobRow) return json({ ok: false, error: "Job not found" }, 404);
      const job = jobRow as { id: string; status: string; source_table?: string; source_id?: string };
      if (action === "job_retry") {
        const { data: failedProp } = await supabase.from("hermes_proposals")
          .select("id").eq("job_id", jobId).eq("status", "apply_failed").limit(1);
        if (failedProp && failedProp.length) {
          await supabase.from("hermes_proposals")
            .update({ status: "approved", updated_at: new Date().toISOString() }).eq("job_id", jobId);
          await supabase.from("hermes_jobs")
            .update({ status: "approved", error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
        } else {
          await supabase.from("hermes_jobs")
            .update({ status: "queued", attempts: 0, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
          if (job.source_table === "submissions" && job.source_id) {
            await supabase.from("submissions").update({ processed_at: null }).eq("id", job.source_id);
          } else if (job.source_table === "uploads" && job.source_id) {
            await supabase.from("uploads").update({ status: "queued" }).eq("id", job.source_id);
          }
        }
        await supabase.from("hermes_events").insert({
          job_id: jobId, level: "info", event: "job_retry", message: "You sent this job back for another run", details: {},
        });
        return json({ ok: true, action, job_id: jobId });
      }
      if (job.status !== "queued") return json({ ok: false, error: "Only queued jobs can be cancelled" }, 409);
      await supabase.from("hermes_jobs")
        .update({ status: "skipped", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId);
      if (job.source_table === "submissions" && job.source_id) {
        await supabase.from("submissions").update({ processed_at: new Date().toISOString() }).eq("id", job.source_id);
      } else if (job.source_table === "uploads" && job.source_id) {
        await supabase.from("uploads").update({ status: "rejected" }).eq("id", job.source_id);
      }
      await supabase.from("hermes_events").insert({
        job_id: jobId, level: "warn", event: "job_cancelled", message: "You cancelled this queued job", details: {},
      });
      return json({ ok: true, action, job_id: jobId });
    }

    if (action === "queue_set_paused") {
      const paused = Boolean(body.paused);
      const { error } = await supabase.from("hermes_control")
        .upsert({ id: "queue", paused, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) throw error;
      await supabase.from("hermes_events").insert({
        job_id: null, level: "warn", event: paused ? "queue_paused" : "queue_resumed",
        message: paused ? "You paused Hermes's queue" : "You resumed Hermes's queue", details: {},
      });
      return json({ ok: true, action, paused });
    }

    if (action === "delete_upload") {
      const uploadId = String(body.upload_id || "");
      if (!uploadId) return json({ ok: false, error: "Missing upload_id" }, 400);
      const { data: row, error: readErr } = await supabase
        .from("uploads").select("id, storage_path, file_name, status").eq("id", uploadId).single();
      if (readErr || !row) return json({ ok: false, error: "Upload not found" }, 404);
      if (row.status === "processing") {
        return json({ ok: false, error: "Hermes is working on this file right now. Try again in a minute." }, 409);
      }
      const { error: storErr } = await supabase.storage.from("uploads").remove([row.storage_path]);
      if (storErr) throw storErr;
      const { error: delErr } = await supabase.from("uploads").delete().eq("id", uploadId);
      if (delErr) throw delErr;
      return json({ ok: true, action, file_name: row.file_name });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ ok: false, error: errText(err) }, 500);
  }
});
