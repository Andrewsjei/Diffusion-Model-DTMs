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
  d_prime: number | null;                  // AI sources only, vs the pooled real false-alarm rate
}

export interface Kpis {
  overall: {
    accuracy: number | null;
    accuracy_excluding_not_sure: number | null;
    not_sure_rate: number | null;
    hit_rate: number | null;         // pooled across all four checkpoints
    false_alarm_rate: number | null; // P(said "ai" | is real)
    d_prime: number | null;
  };
  by_source: Record<string, SourceKpi>;
}

export function computeKpis(bySource: Record<string, SourceTally>): Kpis {
  const real = bySource["real"] ?? { ai: 0, real: 0, not_sure: 0, total: 0 };
  const falseAlarmRate = real.total ? real.ai / real.total : null;
  const zFalseAlarm = probit(correctedRate(real.ai, real.total || 0));

  const checkpointKeys = Object.keys(bySource).filter((k) => k !== "real");
  let pooledAiN = 0, pooledAiHits = 0;
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
    d_prime: null,
  };
  overallN += real.total; overallCorrect += real_correct; overallNotSure += real.not_sure;

  for (const key of checkpointKeys) {
    const s = bySource[key];
    const correct = s.ai; // "correct" for an AI-sourced image means the participant said "ai"
    const hitRate = s.total ? s.ai / s.total : null;
    const dPrime = s.total
      ? probit(correctedRate(s.ai, s.total)) - zFalseAlarm
      : null;
    bySourceKpi[key] = {
      n: s.total,
      accuracy: s.total ? correct / s.total : null,
      accuracy_excluding_not_sure: (s.total - s.not_sure) ? correct / (s.total - s.not_sure) : null,
      not_sure_rate: s.total ? s.not_sure / s.total : null,
      hit_rate: hitRate,
      d_prime: dPrime,
    };
    pooledAiN += s.total; pooledAiHits += s.ai;
    overallN += s.total; overallCorrect += correct; overallNotSure += s.not_sure;
  }

  const pooledHitRate = pooledAiN ? pooledAiHits / pooledAiN : null;
  const overallDPrime = pooledAiN
    ? probit(correctedRate(pooledAiHits, pooledAiN)) - zFalseAlarm
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
