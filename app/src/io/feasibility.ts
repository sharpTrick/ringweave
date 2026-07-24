export interface Feasibility {
  /** False when generation cannot proceed (too few people). */
  canGenerate: boolean;
  /** Plain-language notes shown before generation (parity, too-few-people). */
  messages: string[];
}

/**
 * Pre-generation checks shown to the organizer, mirroring the mock's `checkNote`
 * (mock/app.js:314). n < k+1 is a hard blocker (the ring seed needs more people than
 * buddies); an odd n×k is a soft note (one person ends up ±1 buddy — still fine).
 */
export function feasibility(n: number, k: number): Feasibility {
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
  return { canGenerate: true, messages };
}
