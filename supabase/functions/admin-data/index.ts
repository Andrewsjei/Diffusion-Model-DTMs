import { json, preflight } from "../_shared/cors.ts";
import { serviceClient, requireAdmin, fetchAllRows } from "../_shared/db.ts";
import { computeKpis, computeParticipantKpis, SourceTally } from "../_shared/stats.ts";
import { EXPERIMENT_VERSION } from "../_shared/config.ts";

interface ParticipantRow {
  participant_id: string;
  completed_at: string | null;
  experiment_version: string;
}
interface ResponseRow {
  participant_id: string;
  image_source: string;
  response: "ai" | "real" | "not_sure";
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await requireAdmin(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  // Which round (image set) to show. The admin page sends
  // { experiment_version: "v2" } for a specific round, "all" for every
  // round combined, or nothing/null -- in which case we default to the
  // round that is currently live (EXPERIMENT_VERSION in config.ts).
  let version: string | null = EXPERIMENT_VERSION;
  try {
    const body = await req.json();
    if (body?.experiment_version === "all") {
      version = null; // null = no filter = every round
    } else if (typeof body?.experiment_version === "string" && body.experiment_version) {
      version = body.experiment_version;
    }
  } catch {
    // no body -> keep the default (current round)
  }

  const db = serviceClient();

  let allParticipants: ParticipantRow[];
  let responses: ResponseRow[];
  try {
    // All participants (small table), including their round, so we can
    // both build the round dropdown and filter below. .order() keeps the
    // paging stable.
    allParticipants = await fetchAllRows<ParticipantRow>((from, to) =>
      db
        .from("participants")
        .select("participant_id, completed_at, experiment_version")
        .order("participant_id")
        .range(from, to)
    );
    // Only the most recent answer per trial (latest_responses view), and
    // only for the selected round. The view already carries the
    // experiment_version column that submit-response stamped on each row.
    responses = await fetchAllRows<ResponseRow>((from, to) => {
      let q = db.from("latest_responses").select("participant_id, image_source, response");
      if (version) q = q.eq("experiment_version", version);
      return q.order("participant_id").order("trial_number").range(from, to);
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  // Rounds for the dropdown: every round that has participants, plus the
  // current one (which has none right after you switch to it, but must
  // still be selectable). Newest first, "v10" sorting after "v9".
  const versions = [...new Set([...allParticipants.map((p) => p.experiment_version), EXPERIMENT_VERSION])]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  const participants = version
    ? allParticipants.filter((p) => p.experiment_version === version)
    : allParticipants;

  const completed = participants.filter((p) => p.completed_at).length;

  const byResponse = { ai: 0, real: 0, not_sure: 0 };
  const bySource: Record<string, SourceTally> = {};

  for (const r of responses ?? []) {
    byResponse[r.response as keyof typeof byResponse]++;
    const src = bySource[r.image_source] ??= { ai: 0, real: 0, not_sure: 0, total: 0 };
    src[r.response as "ai" | "real" | "not_sure"]++;
    src.total++;
  }

  return json({
    selected_version: version ?? "all",
    current_version: EXPERIMENT_VERSION,
    versions,
    participants: {
      total: participants.length,
      completed,
      incomplete: participants.length - completed,
    },
    responses: {
      total: responses?.length ?? 0,
      by_answer: byResponse,
      by_source: bySource,
    },
    kpis: computeKpis(bySource),
    participant_kpis: computeParticipantKpis(responses ?? [], participants),
  });
});
