// Signal-detection / accuracy KPIs shown on the admin dashboard.
// The raw CSV exports (admin-export) deliberately stay counts-only —
// this file is the one place a specific formula gets chosen, so it's
// used for the at-a-glance dashboard and nowhere else.

// Inverse of the standard normal CDF (probit), Peter Acklam's rational
// approximation — accurate to ~1.15e-9. Used only for d-prime.
function probit(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

// Log-linear correction (Hautus, 1995): avoids infinite z-scores when a
// rate is exactly 0 or 1, and is standard practice for d-prime generally,
// not just at the extremes.
function correctedRate(count: number, n: number): number {
  return (count + 0.5) / (n + 1);
}

export interface SourceTally {
  ai: number;
  real: number;
  not_sure: number;
  total: number;
}

export interface SourceKpi {
  n: number;
  accuracy: number | null;                 // correct / n (not_sure counts as incorrect)
  accuracy_excluding_not_sure: number | null; // correct / (n - not_sure)
  not_sure_rate: number | null;
  hit_rate: number | null;                 // AI sources only: P(said "ai" | is AI)
  false_alarm_rate: number | null;         // P(said "ai" | is real) -- shared across every row, since it's a property of the real/noise pool, not of any one checkpoint
  d_prime: number | null;                  // AI sources only, vs the real false-alarm rate -- "not sure" trials excluded from both rates entirely, not counted as incorrect
}

export interface Kpis {
  overall: {
    accuracy: number | null;
    accuracy_excluding_not_sure: number | null;
    not_sure_rate: number | null;
    hit_rate: number | null;         // pooled across all active AI pools
    false_alarm_rate: number | null; // P(said "ai" | is real)
    d_prime: number | null;          // "not sure" excluded from both rates entirely, see SourceKpi.d_prime
  };
  by_source: Record<string, SourceKpi>;
}

export function computeKpis(bySource: Record<string, SourceTally>): Kpis {
  const real = bySource["real"] ?? { ai: 0, real: 0, not_sure: 0, total: 0 };
  const falseAlarmRate = real.total ? real.ai / real.total : null;

  // d-prime is computed on decided trials only -- "not sure" is excluded
  // from its denominator entirely, rather than counted as an implicit
  // miss/correct-rejection. This only affects d-prime: the displayed
  // hit_rate / false_alarm_rate / accuracy fields below stay inclusive
  // of "not sure", unchanged.
  const realDecidedN = real.total - real.not_sure;
  const zFalseAlarmDecided = probit(correctedRate(real.ai, realDecidedN));

  const checkpointKeys = Object.keys(bySource).filter((k) => k !== "real");
  let pooledAiN = 0, pooledAiHits = 0;
  let pooledDecidedN = 0;
  let overallN = 0, overallCorrect = 0, overallNotSure = 0;

  const bySourceKpi: Record<string, SourceKpi> = {};

  const real_correct = real.real;
  bySourceKpi["real"] = {
    n: real.total,
    accuracy: real.total ? real_correct / real.total : null,
    accuracy_excluding_not_sure: (real.total - real.not_sure)
      ? real_correct / (real.total - real.not_sure) : null,
    not_sure_rate: real.total ? real.not_sure / real.total : null,
    hit_rate: null,
    false_alarm_rate: falseAlarmRate,
    d_prime: null,
  };
  overallN += real.total; overallCorrect += real_correct; overallNotSure += real.not_sure;

  for (const key of checkpointKeys) {
    const s = bySource[key];
    const correct = s.ai; // "correct" for an AI-sourced image means the participant said "ai"
    const hitRate = s.total ? s.ai / s.total : null;
    const decidedN = s.total - s.not_sure;
    const dPrime = decidedN
      ? probit(correctedRate(s.ai, decidedN)) - zFalseAlarmDecided
      : null;
    bySourceKpi[key] = {
      n: s.total,
      accuracy: s.total ? correct / s.total : null,
      accuracy_excluding_not_sure: (s.total - s.not_sure) ? correct / (s.total - s.not_sure) : null,
      not_sure_rate: s.total ? s.not_sure / s.total : null,
      hit_rate: hitRate,
      false_alarm_rate: falseAlarmRate,
      d_prime: dPrime,
    };
    pooledAiN += s.total; pooledAiHits += s.ai; pooledDecidedN += decidedN;
    overallN += s.total; overallCorrect += correct; overallNotSure += s.not_sure;
  }

  const pooledHitRate = pooledAiN ? pooledAiHits / pooledAiN : null;
  const overallDPrime = pooledDecidedN
    ? probit(correctedRate(pooledAiHits, pooledDecidedN)) - zFalseAlarmDecided
    : null;

  return {
    overall: {
      accuracy: overallN ? overallCorrect / overallN : null,
      accuracy_excluding_not_sure: (overallN - overallNotSure)
        ? overallCorrect / (overallN - overallNotSure) : null,
      not_sure_rate: overallN ? overallNotSure / overallN : null,
      hit_rate: pooledHitRate,
      false_alarm_rate: falseAlarmRate,
      d_prime: overallDPrime,
    },
    by_source: bySourceKpi,
  };
}

export interface ParticipantKpi {
  participant_id: string;
  completed: boolean;
  n: number;
  accuracy: number | null;
  accuracy_excluding_not_sure: number | null;
  not_sure_rate: number | null;
  hit_rate: number | null;         // across this participant's checkpoint (AI) trials only
  false_alarm_rate: number | null; // across this participant's real trials only
}

// Same accuracy/hit/false-alarm/not-sure definitions as computeKpis, just
// grouped by participant instead of pooled across everyone. No d-prime
// here -- 24 real + 24 AI trials per participant is thin enough that a
// per-participant d' would mostly be noise, and it wasn't asked for.
export function computeParticipantKpis(
  responses: { participant_id: string; image_source: string; response: "ai" | "real" | "not_sure" }[],
  participants: { participant_id: string; completed_at: string | null }[],
): ParticipantKpi[] {
  const real = new Map<string, SourceTally>();
  const ai = new Map<string, SourceTally>();
  const emptyTally = (): SourceTally => ({ ai: 0, real: 0, not_sure: 0, total: 0 });

  for (const r of responses) {
    const bucket = r.image_source === "real" ? real : ai;
    const t = bucket.get(r.participant_id) ?? emptyTally();
    t[r.response]++;
    t.total++;
    bucket.set(r.participant_id, t);
  }

  return participants.map((p) => {
    const realT = real.get(p.participant_id) ?? emptyTally();
    const aiT = ai.get(p.participant_id) ?? emptyTally();
    const n = realT.total + aiT.total;
    const correct = realT.real + aiT.ai;
    const notSure = realT.not_sure + aiT.not_sure;
    return {
      participant_id: p.participant_id,
      completed: !!p.completed_at,
      n,
      accuracy: n ? correct / n : null,
      accuracy_excluding_not_sure: (n - notSure) ? correct / (n - notSure) : null,
      not_sure_rate: n ? notSure / n : null,
      hit_rate: aiT.total ? aiT.ai / aiT.total : null,
      false_alarm_rate: realT.total ? realT.ai / realT.total : null,
    };
  });
}
