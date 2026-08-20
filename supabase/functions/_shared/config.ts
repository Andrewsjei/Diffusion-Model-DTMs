// Experimental design constants. Changing these changes the study itself —
// bump EXPERIMENT_VERSION whenever you touch this file, so old and new
// participants' rows are distinguishable in the exported data.
export const EXPERIMENT_VERSION = "v1";

export const CHECKPOINTS = [
  "checkpoint1",
  "checkpoint2",
  "checkpoint3",
  "checkpoint4",
] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];
export type SourceType = "real" | Checkpoint;

export const IMAGES_PER_PAGE = 8;
export const PAGES = 6;
export const TRIALS = IMAGES_PER_PAGE * PAGES; // 48

export const PER_CHECKPOINT_TOTAL = 6; // across the whole 48-trial sequence
export const REAL_TOTAL = 24;

// Every two consecutive pages (16 trials) form one "block": 2 images per
// checkpoint (8 AI) + 8 real. Three blocks cover the 48 trials and make
// the per-checkpoint and real/AI totals above come out exact.
export const BLOCKS = 3;
export const TRIALS_PER_BLOCK = TRIALS / BLOCKS; // 16
export const PER_CHECKPOINT_PER_BLOCK = PER_CHECKPOINT_TOTAL / BLOCKS; // 2
export const REAL_PER_BLOCK = REAL_TOTAL / BLOCKS; // 8
