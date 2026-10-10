// UTAG control-center write path (Supabase Edge Function)
//
// The public site is read-only (anon key + RLS). Every write from the
// control center goes through this function, gated by a site password
// held in the SITE_PASSWORD function secret. Writes use the service role,
// which Supabase injects automatically as SUPABASE_SERVICE_ROLE_KEY.
//
// Deploy (dashboard): Edge Functions -> Create function "utag-control",
// paste this file, set the SITE_PASSWORD secret, deploy.
//
// Request: POST JSON { password, action, ... }
// Actions:
//   correct          { entity_type, entity_id, field, new_value, note? }
//                    -> inserts a corrections row (human ruling) and applies
//                       the field change to the entity. Corrections outrank AI.
//   set_confidence   { entity_type, entity_id, confidence }
//                    -> sets confidence (and status) on the entity.
//   resolve_verification { verification_id, status }
//                    -> marks a verification run verified / needs_review / conflicting.
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
  release: ["title", "release_type", "edition", "release_date", "release_year", "label", "catalog_number", "barcode", "country", "mbid", "spotify_id", "apple_id", "deezer_id", "discogs_id"],
  track: ["title", "track_number", "disc_number", "isrc", "duration_ms", "mbid", "spotify_id", "apple_id", "deezer_id"],
  artwork: ["role", "edition_label", "source_url"],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
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
  if (!sitePassword || body.password !== sitePassword) {
    return json({ ok: false, error: "Wrong password" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
      const corrValue = isArr ? JSON.stringify(body.new_value) : String(body.new_value ?? "");

      // Promoting artwork to canonical: demote the release's current
      // canonical first, or the one-canonical-per-release index rejects it.
      if (entityType === "artwork" && field === "role" && body.new_value === "canonical") {
        const { data: self } = await supabase
          .from("artwork").select("release_id").eq("id", entityId).single();
        if (self) {
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

      const patch: Record<string, unknown> = { [field]: body.new_value };
      if (entityType !== "artwork") patch.updated_at = new Date().toISOString();
      const { error: updErr } = await supabase.from(table).update(patch).eq("id", entityId);
      if (updErr) throw updErr;
      return json({ ok: true, action, entity_id: entityId, field });
    }

    if (action === "set_confidence") {
      const entityType = String(body.entity_type || "");
      const table = ENTITY_TABLE[entityType];
      const confidence = String(body.confidence || "");
      if (!table) return json({ ok: false, error: "Unknown entity_type" }, 400);
      if (!CONFIDENCE.includes(confidence)) return json({ ok: false, error: "Unknown confidence" }, 400);
      const patch: Record<string, unknown> = { confidence, status: confidence };
      if (entityType !== "artwork") patch.updated_at = new Date().toISOString();
      const { error } = await supabase.from(table)
        .update(patch)
        .eq("id", String(body.entity_id || ""));
      if (error) throw error;
      return json({ ok: true, action, confidence });
    }

    if (action === "resolve_verification") {
      const status = String(body.status || "");
      if (!CONFIDENCE.includes(status)) return json({ ok: false, error: "Unknown status" }, 400);
      const { error } = await supabase.from("verifications")
        .update({ status })
        .eq("id", String(body.verification_id || ""));
      if (error) throw error;
      return json({ ok: true, action, status });
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
      if (role === "canonical") {
        const { data: old } = await supabase.from("artwork")
          .select("id").eq("release_id", releaseId).eq("role", "canonical");
        for (const row of (old || []) as { id: string }[]) {
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
      return json({ ok: true, action, artwork_id: artId });
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
      const { data, error } = await supabase.from("hermes_bridge")
        .select("url,token,updated_at").eq("id", "utag").single();
      if (error || !data || !(data as { url?: string }).url) {
        return json({ ok: false, error: "Direct Hermes is not reporting yet" }, 404);
      }
      const row = data as { url: string; token: string; updated_at: string };
      return json({ ok: true, action, url: row.url, token: row.token, updated_at: row.updated_at });
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

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
