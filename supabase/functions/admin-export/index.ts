import { corsHeaders, preflight, json } from "../_shared/cors.ts";
import { serviceClient, requireAdmin, fetchAllRows } from "../_shared/db.ts";
import { CHECKPOINTS } from "../_shared/config.ts";

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}
function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

interface ResponseRow {
  participant_id: string;
  trial_number: number;
  page: number;
  image_id: string;
  image_source: string;
  response: string;
  response_time_ms: number | null;
  submitted_at: string;
  trial_sequence_id: string;
  experiment_version: string;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const userId = await requireAdmin(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let type = "raw";
  try {
    const body = await req.json();
    if (body?.type === "summary") type = "summary";
  } catch {
    // no body → default to raw
  }

  const db = serviceClient();

  // PostgREST caps a single response at 1000 rows by default -- fetch in
  // pages so a study past that size (this one already is) isn't silently
  // truncated. .order() has to stay on every page for a stable overall
  // ordering across the walk.
  let responses: ResponseRow[];
  try {
    responses = await fetchAllRows<ResponseRow>((from, to) =>
      db
        .from("latest_responses")
        .select(
          "participant_id, trial_number, page, image_id, image_source, response, response_time_ms, submitted_at, trial_sequence_id, experiment_version",
        )
        .order("participant_id")
        .order("trial_number")
        .range(from, to)
    );
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  if (type === "raw") {
    const header = [
      "participant_id", "trial_number", "page", "image_id", "image_source",
      "response", "response_time_ms", "submitted_at", "trial_sequence_id", "experiment_version",
    ];
    const rows = responses.map((r) => [
      r.participant_id, r.trial_number, r.page, r.image_id, r.image_source,
      r.response, r.response_time_ms, r.submitted_at, r.trial_sequence_id, r.experiment_version,
    ]);
    return csvResponse(toCsv([header, ...rows]), "raw_responses.csv");
  }

  // Participant-level summary. No PII to withhold — participant_id is
  // already the only identifier that exists. Counts only, no derived
  // accuracy/d-prime: those are one formula away in R/Python from hit,
  // miss, false-alarm counts, and baking a specific definition in here
  // would just be something to disagree with later.
  let participants: { participant_id: string; created_at: string; completed_at: string | null }[];
  try {
    participants = await fetchAllRows((from, to) =>
      db.from("participants").select("participant_id, created_at, completed_at").range(from, to)
    );
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  type Tally = { n: number; said_ai: number; said_real: number; said_notsure: number };
  const emptyTally = (): Tally => ({ n: 0, said_ai: 0, said_real: 0, said_notsure: 0 });

  const byParticipant = new Map<string, { real: Tally; cp: Record<string, Tally> }>();
  for (const p of participants) {
    byParticipant.set(p.participant_id, {
      real: emptyTally(),
      cp: Object.fromEntries(CHECKPOINTS.map((c) => [c, emptyTally()])),
    });
  }
  for (const r of responses) {
    const rec = byParticipant.get(r.participant_id);
    if (!rec) continue;
    const tally = r.image_source === "real" ? rec.real : rec.cp[r.image_source];
    if (!tally) continue;
    tally.n++;
    if (r.response === "ai") tally.said_ai++;
    else if (r.response === "real") tally.said_real++;
    else tally.said_notsure++;
  }

  const header = [
    "participant_id", "created_at", "completed_at", "n_responses",
    "real_n", "real_said_real", "real_said_ai", "real_said_notsure",
    ...CHECKPOINTS.flatMap((c) => [
      `${c}_n`, `${c}_said_ai`, `${c}_said_real`, `${c}_said_notsure`,
    ]),
  ];
  const rows = participants.map((p) => {
    const rec = byParticipant.get(p.participant_id)!;
    const nResponses = rec.real.n + CHECKPOINTS.reduce((s, c) => s + rec.cp[c].n, 0);
    return [
      p.participant_id, p.created_at, p.completed_at ?? "", nResponses,
      rec.real.n, rec.real.said_real, rec.real.said_ai, rec.real.said_notsure,
      ...CHECKPOINTS.flatMap((c) => [
        rec.cp[c].n, rec.cp[c].said_ai, rec.cp[c].said_real, rec.cp[c].said_notsure,
      ]),
    ];
  });

  return csvResponse(toCsv([header, ...rows]), "participant_summary.csv");
});
