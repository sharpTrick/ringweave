/** Above this, generation is noticeably slow; warn as a preflight (not a blocker). */
export const LARGE_ROSTER = 800;

export interface Feasibility {
  /** False when generation cannot proceed (too few people). */
  canGenerate: boolean;
  /** Plain-language notes shown before generation (parity, too-few-people). */
  messages: string[];
}

/**
 * Pre-generation checks shown to the organizer, mirroring the mock's `checkNote`.
 * n < k+1 is a hard blocker (the ring seed needs more people than
 * buddies); an odd n×k is a soft note (one person ends up ±1 buddy — still fine).
 */
export function feasibility(n: number, k: number): Feasibility {
  // The core's ring seed floors every degree at 2, so buildBuddyGraph throws for k<2.
  // Block it here with plain language rather than letting the internal error surface
  // (e.g. after importing a hand-edited file whose settings carry buddies:1).
  if (!Number.isInteger(k) || k < 2) {
    return { canGenerate: false, messages: ["Each person needs at least 2 buddies."] };
  }
  if (n < k + 1) {
    const need = k + 1 - n;
    return {
      canGenerate: false,
      messages: [`Add at least ${need} more — you need more people than buddies.`],
    };
  }
  const messages: string[] = [];
  if ((n * k) % 2 !== 0) {
    messages.push(
      `${n} people × ${k} buddies is odd, so one person will have one buddy more or fewer. That's fine.`,
    );
  }
  // Preflight: generation cost grows with n; warn (don't block) before a large run so the
  // "Generating…" spinner isn't a surprise. The core caps genuinely-too-large rosters.
  if (n > LARGE_ROSTER) {
    messages.push(`${n} people is a large group — generating may take a few seconds.`);
  }
  return { canGenerate: true, messages };
}
