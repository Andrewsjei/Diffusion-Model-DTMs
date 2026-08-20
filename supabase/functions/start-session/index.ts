import { json, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { newParticipantId, newResumeCode, newSequenceId } from "../_shared/ids.ts";
import { buildSequence } from "../_shared/sequence.ts";
import { EXPERIMENT_VERSION } from "../_shared/config.ts";

// Strips the ground-truth source_type before anything goes to the
// browser. This is the one place that matters most in the whole
// codebase: get this wrong and the study is no longer blind.
function blind(trials: Awaited<ReturnType<typeof buildSequence>>) {
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

  const db = serviceClient();

  try {
    const trials = await buildSequence();
    const participant_id = newParticipantId();
    const resume_code = newResumeCode();
    const trial_sequence_id = newSequenceId();

    const { error } = await db.from("participants").insert({
      participant_id,
      resume_code,
      trial_sequence: trials,
      trial_sequence_id,
      experiment_version: EXPERIMENT_VERSION,
    });
    if (error) throw new Error(error.message);

    return json({
      participant_id,
      resume_code,
      experiment_version: EXPERIMENT_VERSION,
      trials: blind(trials),
    });
  } catch (e) {
    console.error("start-session failed", e);
    return json(
      { error: "Could not start a new session. " + (e as Error).message },
      500,
    );
  }
});
