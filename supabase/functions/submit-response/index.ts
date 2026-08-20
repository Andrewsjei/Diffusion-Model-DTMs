import { json, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { Trial } from "../_shared/sequence.ts";
import { TRIALS } from "../_shared/config.ts";

const VALID_RESPONSES = new Set(["ai", "real", "not_sure"]);

interface SubmitBody {
  participant_id?: string;
  resume_code?: string;
  trial_number?: number;
  response?: string;
  response_time_ms?: number;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const { participant_id, resume_code, trial_number, response, response_time_ms } = body;
  if (!participant_id || !resume_code || !trial_number || !response) {
    return json({ error: "participant_id, resume_code, trial_number and response are required" }, 400);
  }
  if (!VALID_RESPONSES.has(response)) {
    return json({ error: "response must be ai, real, or not_sure" }, 400);
  }

  const db = serviceClient();

  // participant_id + resume_code together act as the session's only
  // credential — knowing both is what lets this call write on the
  // participant's behalf. See study/README.md, "Threat model".
  const { data: participant, error: pErr } = await db
    .from("participants")
    .select("participant_id, trial_sequence, trial_sequence_id, experiment_version, completed_at")
    .eq("participant_id", participant_id)
    .eq("resume_code", resume_code.trim().toUpperCase())
    .maybeSingle();
  if (pErr) {
    console.error("submit-response participant lookup failed", pErr.message);
    return json({ error: "Could not verify session." }, 500);
  }
  if (!participant) return json({ error: "Invalid participant_id / resume_code." }, 403);
  if (participant.completed_at) {
    return json({ error: "This session is already complete." }, 409);
  }

  const trial = (participant.trial_sequence as Trial[]).find(
    (t) => t.trial_number === trial_number,
  );
  if (!trial) return json({ error: "trial_number is not part of this session." }, 400);

  // Idempotent on true duplicates (e.g. the client's retry queue re-sends
  // an answer that already made it through) — but a genuinely changed
  // answer (participant went back and picked differently) always inserts
  // a new row, preserving the full audit trail.
  const { data: existing } = await db
    .from("latest_responses")
    .select("response")
    .eq("participant_id", participant_id)
    .eq("trial_number", trial_number)
    .maybeSingle();

  if (!existing || existing.response !== response) {
    const { error: insErr } = await db.from("responses").insert({
      participant_id,
      trial_number,
      page: trial.page,
      image_id: trial.image_id,
      image_source: trial.source_type,
      response,
      response_time_ms: response_time_ms ?? null,
      trial_sequence_id: participant.trial_sequence_id,
      experiment_version: participant.experiment_version,
    });
    if (insErr) {
      console.error("submit-response insert failed", insErr.message);
      return json({ error: "Could not save your answer. Please try again." }, 500);
    }
  }

  const { count, error: cErr } = await db
    .from("latest_responses")
    .select("trial_number", { count: "exact", head: true })
    .eq("participant_id", participant_id);
  if (cErr) console.error("submit-response completion check failed", cErr.message);

  let completed = false;
  if ((count ?? 0) >= TRIALS) {
    completed = true;
    await db
      .from("participants")
      .update({ completed_at: new Date().toISOString() })
      .eq("participant_id", participant_id)
      .is("completed_at", null);
  }

  return json({ ok: true, completed });
});
