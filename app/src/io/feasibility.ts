import { canGenerate } from "ringweave";
import { MAX_ROSTER_N } from "../model";

/** Above this, generation is noticeably slow; warn as a preflight (not a blocker). */
const LARGE_ROSTER = 300;

export interface Feasibility {
  /** False when generation cannot proceed (too few / too many people, or bad k). */
  canGenerate: boolean;
  /** Plain-language notes shown before generation (parity, too-few/too-many-people). */
  messages: string[];
}

/** Pre-generation checks shown to the organizer. `canGenerate` false is a blocker; `messages` can
    be non-empty either way. */
export function feasibility(n: number, k: number): Feasibility {
  // `buildBuddyGraph` throws for k<2 (its ring seed floors every degree at 2), so block it here
  // rather than letting the internal error reach the user — an imported file can carry buddies:1.
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
  if (n > MAX_ROSTER_N) {
    return {
      canGenerate: false,
      messages: [`That's ${n} people — the most this tool generates for is ${MAX_ROSTER_N}.`],
    };
  }
  // ASK THE CORE, don't mirror its budget: the checks above are the app's own policy, but "will
  // generation actually run" is the core's arithmetic, and the app's densest allowed corner sits
  // on `MAX_GREEDY_WORK` by zero margin — one constant edit either side and a predicted answer
  // would enable a configuration the library throws on.
  if (!canGenerate(n, k)) {
    return {
      canGenerate: false,
      messages: [`${n} people with ${k} buddies each is too big to arrange — use fewer of either.`],
    };
  }

  const messages: string[] = [];
  if ((n * k) % 2 !== 0) {
    messages.push(
      `${n} people × ${k} buddies is odd, so one person will have one buddy more or fewer. That's fine.`,
    );
  }
  if (n > LARGE_ROSTER) {
    messages.push(`${n} people is a large group — generating can take a while (tens of seconds near the limit).`);
  }
  return { canGenerate: true, messages };
}
