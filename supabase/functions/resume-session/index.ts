import { json, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { Trial } from "../_shared/sequence.ts";

function blind(trials: Trial[]) {
  return trials.map(({ trial_number, page, image_id, storage_path }) => ({
    trial_number,
    page,
    image_id,
    image_url: storage_path,
  }));
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { resume_code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const resume_code = (body.resume_code ?? "").trim().toUpperCase();
  if (!resume_code) return json({ error: "resume_code required" }, 400);

  const db = serviceClient();

  const { data: participant, error } = await db
    .from("participants")
    .select("participant_id, trial_sequence, experiment_version, completed_at")
    .eq("resume_code", resume_code)
    .maybeSingle();

  if (error) {
    console.error("resume-session query failed", error.message);
    return json({ error: "Could not look up that resume code." }, 500);
  }
  if (!participant) {
    return json({ error: "No session found for that resume code." }, 404);
  }

  const { data: responses, error: respError } = await db
    .from("latest_responses")
    .select("trial_number, response")
    .eq("participant_id", participant.participant_id);
  if (respError) {
    console.error("resume-session responses query failed", respError.message);
    return json({ error: "Could not load your previous answers." }, 500);
  }

  const answered: Record<number, string> = {};
  for (const r of responses ?? []) answered[r.trial_number] = r.response;

  return json({
    participant_id: participant.participant_id,
    experiment_version: participant.experiment_version,
    trials: blind(participant.trial_sequence as Trial[]),
    answered,
    completed: !!participant.completed_at,
  });
});
