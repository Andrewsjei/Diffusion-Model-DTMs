// Experimental design constants. Changing these changes the study itself —
// bump EXPERIMENT_VERSION whenever you touch this file, so old and new
// participants' rows are distinguishable in the exported data.
export const EXPERIMENT_VERSION = "v1";

// 'real', or the name of whatever AI source folder is active (e.g.
// 'checkpoint1', 'BaseModel1.5') -- not a fixed set. Which non-real
// pools are actually in rotation is a runtime decision (see
// scripts/set_active_pools.py and sequence.ts), not a compile-time one.
export type SourceType = string;

export const IMAGES_PER_PAGE = 8;
export const PAGES = 6;
export const TRIALS = IMAGES_PER_PAGE * PAGES; // 48

export const REAL_TOTAL = 24;
export const AI_TOTAL = TRIALS - REAL_TOTAL; // 24, split evenly across however many AI pools are active

// Every two consecutive pages (16 trials) form one "block": some AI
// images (split evenly across the active pools) + 8 real. Three blocks
// cover the 48 trials and make the totals above come out exact.
export const BLOCKS = 3;
export const TRIALS_PER_BLOCK = TRIALS / BLOCKS; // 16
export const REAL_PER_BLOCK = REAL_TOTAL / BLOCKS; // 8
export const AI_PER_BLOCK = TRIALS_PER_BLOCK - REAL_PER_BLOCK; // 8, split across the active AI pools
