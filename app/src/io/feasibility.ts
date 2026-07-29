import { canGenerate } from "ringweave";
import { MAX_ROSTER_N } from "../model";

/** Above this, generation is noticeably slow; warn as a preflight (not a blocker). Module-local:
    only this file's preflight note reads it. */
const LARGE_ROSTER = 300;

export interface Feasibility {
  /** False when generation cannot proceed (too few / too many people, or bad k). */
  canGenerate: boolean;
  /** Plain-language notes shown before generation (parity, too-few/too-many-people). */
  messages: string[];
}

/**
 * Pre-generation checks shown to the organizer, mirroring the mock's `checkNote`.
 * n < k+1 is a hard blocker (the ring seed needs more people than buddies); n above
 * MAX_ROSTER_N is refused (generation would run too long); an odd n×k is a soft note.
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
  if (n > MAX_ROSTER_N) {
    return {
      canGenerate: false,
      messages: [`That's ${n} people — the most this tool generates for is ${MAX_ROSTER_N}.`],
    };
  }
  // ASK THE CORE, don't mirror its budget. Everything above is the app's OWN policy — its
  // advertised roster ceiling and its plain-language wording — but "will generation actually
  // run" is the core's arithmetic, and this function used to promise it for the whole
  // (n <= 1000, k in [2, 12]) rectangle on the strength of the constants alone. That held only
  // because the densest corner sits on `MAX_GREEDY_WORK` by exactly zero margin, which nothing
  // tested: one constant edit in either package and the button would enable a configuration the
  // library throws on, surfacing as a raw error string. Same shape as the k-blind polish-cap
  // literal `autoPolishEnabled` replaced (see model.ts); this was the last app-side gate still
  // predicting a core budget instead of asking it.
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
  // Preflight: generation cost grows steeply with n; warn honestly before a large run so the
  // "Generating…" spinner isn't a surprise (a near-limit roster can take tens of seconds).
  if (n > LARGE_ROSTER) {
    messages.push(`${n} people is a large group — generating can take a while (tens of seconds near the limit).`);
  }
  return { canGenerate: true, messages };
}
