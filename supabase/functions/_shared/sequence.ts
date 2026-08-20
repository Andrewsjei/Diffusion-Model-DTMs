import {
  BLOCKS,
  CHECKPOINTS,
  IMAGES_PER_PAGE,
  PER_CHECKPOINT_PER_BLOCK,
  PER_CHECKPOINT_TOTAL,
  REAL_PER_BLOCK,
  REAL_TOTAL,
  SourceType,
} from "./config.ts";
import { serviceClient } from "./db.ts";

interface ImageRow {
  image_id: string;
  source_type: SourceType;
  storage_path: string;
}

export interface Trial {
  trial_number: number;
  page: number;
  image_id: string;
  source_type: SourceType;
  storage_path: string;
}

// Least-shown-first with a random tie-break, so exposure stays roughly
// even across participants without needing a separate allocation table.
async function pickImages(
  db: ReturnType<typeof serviceClient>,
  sourceType: SourceType,
  count: number,
): Promise<ImageRow[]> {
  const { data, error } = await db
    .from("images")
    .select("image_id, source_type, storage_path, times_shown")
    .eq("source_type", sourceType)
    .eq("active", true)
    .order("times_shown", { ascending: true })
    .limit(count * 4); // wider pool than needed so the random step below has room to work with
  if (error) throw new Error(`images query failed: ${error.message}`);
  if (!data || data.length < count) {
    throw new Error(
      `not enough active images for "${sourceType}": need ${count}, have ${data?.length ?? 0}`,
    );
  }
  // Shuffle the least-shown slice, then take what we need — avoids always
  // returning the exact same images in the exact same order for images
  // tied on times_shown.
  const pool = data.slice(0, Math.max(count, Math.min(data.length, count * 2)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function fisherYates<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Interleaves one 16-trial block (8 real + 2 of each of 4 checkpoints, per
// config.ts) so no two adjacent trials share a source type. `seedLast`,
// when given, is the source type of the last trial of the *previous*
// block, so the boundary between blocks is covered too, not just each
// block's interior.
//
// This is the classic "reorganize string" greedy: repeatedly take the
// item from whichever remaining group is both (a) not equal to the type
// just placed and (b) has the most items left. That greedy choice is
// provably always able to finish without a same-type collision whenever
// no group holds more than half the items (ceil(n/2)) — which is exactly
// our case: real is 8 of 16, the maximum. An earlier version of this
// function used rejection-sampled random shuffles instead, which sounds
// equivalent but isn't: a random permutation of 8-of-16 non-adjacent
// items succeeds only ~0.07% of the time (9 valid placements out of
// C(16,8) = 12870), so 200 attempts failed to find one about 89% of the
// time in testing, falling through to a broken round-robin fallback that
// dumped several real images consecutively at the end of most blocks.
function shuffleBlock<T extends { source_type: SourceType }>(
  items: T[],
  seedLast: SourceType | null = null,
): T[] {
  const groups = new Map<SourceType, T[]>();
  for (const it of items) {
    const g = groups.get(it.source_type) ?? [];
    g.push(it);
    groups.set(it.source_type, g);
  }
  for (const g of groups.values()) fisherYates(g);

  const total = items.length;
  const maxCount = Math.max(...[...groups.values()].map((g) => g.length));
  if (maxCount > Math.ceil(total / 2)) {
    // Not achievable with these counts — shouldn't happen with the
    // design constants in config.ts. Better a same-type pair somewhere
    // than a thrown error mid-session.
    console.error("shuffleBlock: infeasible group sizes, returning best-effort order");
    return [...groups.values()].flat();
  }

  const out: T[] = [];
  let last: SourceType | null = seedLast;
  const remaining = [...groups.entries()];
  while (out.length < total) {
    remaining.sort((a, b) => b[1].length - a[1].length);
    const picked =
      remaining.find(([type, arr]) => arr.length > 0 && type !== last) ??
      remaining.find(([, arr]) => arr.length > 0)!; // only possible on the very last item, if last == seedLast's type
    const [type, arr] = picked;
    out.push(arr.shift()!);
    last = type;
  }
  return out;
}

// Builds one participant's full 48-trial sequence and bumps times_shown
// for every image used, so the next participant's least-shown query
// reflects it.
export async function buildSequence(): Promise<Trial[]> {
  const db = serviceClient();

  const real = await pickImages(db, "real", REAL_TOTAL);
  const byCheckpoint: Record<string, ImageRow[]> = {};
  for (const cp of CHECKPOINTS) {
    byCheckpoint[cp] = await pickImages(db, cp, PER_CHECKPOINT_TOTAL);
  }

  const realBlocks = chunk(real, REAL_PER_BLOCK);
  const checkpointBlocks: Record<string, ImageRow[][]> = {};
  for (const cp of CHECKPOINTS) {
    checkpointBlocks[cp] = chunk(byCheckpoint[cp], PER_CHECKPOINT_PER_BLOCK);
  }

  const trials: Trial[] = [];
  let trialNumber = 1;
  let lastType: SourceType | null = null;
  for (let b = 0; b < BLOCKS; b++) {
    const blockItems: ImageRow[] = [
      ...realBlocks[b],
      ...CHECKPOINTS.flatMap((cp) => checkpointBlocks[cp][b]),
    ];
    const ordered = shuffleBlock(blockItems, lastType);
    lastType = ordered[ordered.length - 1].source_type;
    for (const img of ordered) {
      trials.push({
        trial_number: trialNumber,
        page: Math.ceil(trialNumber / IMAGES_PER_PAGE),
        image_id: img.image_id,
        source_type: img.source_type,
        storage_path: img.storage_path,
      });
      trialNumber++;
    }
  }

  const usedIds = trials.map((t) => t.image_id);
  const { error: bumpError } = await db.rpc("bump_times_shown", {
    ids: usedIds,
  });
  if (bumpError) {
    // Non-fatal: the sequence is still valid, just exposure tracking
    // drifts slightly. Log it so it's visible in the function's logs.
    console.error("bump_times_shown failed", bumpError.message);
  }

  return trials;
}
