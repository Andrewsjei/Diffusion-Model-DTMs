import { json, preflight } from "../_shared/cors.ts";
import { serviceClient, requireAdmin, fetchAllRows } from "../_shared/db.ts";
import { computeKpis, computeParticipantKpis, SourceTally } from "../_shared/stats.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await requireAdmin(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const db = serviceClient();

  let participants: { participant_id: string; completed_at: string | null }[];
  let responses: { participant_id: string; image_source: string; response: "ai" | "real" | "not_sure" }[];
  try {
    participants = await fetchAllRows((from, to) =>
      db.from("participants").select("participant_id, completed_at").range(from, to)
    );
    responses = await fetchAllRows((from, to) =>
      db.from("latest_responses").select("participant_id, image_source, response").range(from, to)
    );
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

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
