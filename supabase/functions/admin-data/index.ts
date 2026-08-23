import { json, preflight } from "../_shared/cors.ts";
import { serviceClient, requireAdmin } from "../_shared/db.ts";
import { computeKpis, computeParticipantKpis, SourceTally } from "../_shared/stats.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await requireAdmin(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const db = serviceClient();

  const { data: participants, error: pErr } = await db
    .from("participants")
    .select("participant_id, completed_at");
  if (pErr) return json({ error: pErr.message }, 500);

  const { data: responses, error: rErr } = await db
    .from("latest_responses")
    .select("participant_id, image_source, response");
  if (rErr) return json({ error: rErr.message }, 500);

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
