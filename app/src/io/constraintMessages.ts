/**
 * Turn the core's structured infeasibility {@link Reason}s into copy that names people.
 *
 * `unknown-person` and `self-pair` carry an index that is deliberately OUT of range — that is
 * what those reasons report — so every lookup goes through `personName` rather than `names[i]`.
 */
import type { Reason } from "ringweave";

/** A roster name, or a readable placeholder when the index names nobody. */
function personName(i: number, names: string[]): string {
  const name = names[i];
  return typeof name === "string" && name !== "" ? name : `person ${i}`;
}

/** One reason, worded for someone who has never heard the word "vertex". */
function describeReason(r: Reason, names: string[]): string {
  switch (r.code) {
    case "roster-invalid":
      return "That roster isn't a valid list of people.";
    case "roster-too-large":
      return `That roster has ${r.n} people — the limit is ${r.max}.`;
    case "unknown-person":
      return "A buddy rule refers to someone who isn't in this roster — remove it and try again.";
    case "self-pair":
      return `${personName(r.person, names)} can't be paired with themselves.`;
    case "too-many-invalid-constraints":
      // Unreachable from this app (it caps rules first), but the switch is exhaustive on purpose:
      // an unhandled code is a compile error, which is how a new core reason gets worded.
      return `${r.count} buddy rules refer to someone who isn't in this roster — remove them and try again.`;
    case "roster-too-large-constrained":
      return `Buddy rules can only be used with up to ${r.max} people — this roster has ${r.n}.`;
    case "buddy-count-invalid":
      return "The buddies-per-person setting isn't a valid number.";
    case "work-too-large":
      return `${r.n} people with ${r.k} buddies each would take too long to arrange — reduce the group size or the buddy count.`;
    case "required-degree-exceeds-k":
      return `${personName(r.person, names)} has ${r.required} must-be-buddies rules but each person only gets ${r.k} buddies — raise buddies-per-person or remove one.`;
    case "required-and-prohibited":
      return `${personName(r.a, names)} and ${personName(r.b, names)} are set to be buddies and to never be buddies — pick one.`;
    case "required-within-prohibited":
      return `${personName(r.person, names)} can't meet their must-be-buddies rules without breaking a never-be-buddies rule.`;
    case "prohibited-from-everyone":
      return `${personName(r.person, names)} is set to never be buddies with everyone — they'd have nobody.`;
    case "prohibited-splits-group":
      return `The never-be-buddies rules split the group — ${personName(r.person, names)} can't be connected to everyone.`;
  }
}

/** Every reason, worded. Order is the core's (sorted and deduplicated). */
export function describeReasons(reasons: Reason[], names: string[]): string[] {
  return reasons.map((r) => describeReason(r, names));
}

/**
 * Codes that are about the ROSTER or the settings rather than a buddy rule. Listed as the
 * exception because the majority are rule-shaped: each of those tells the user to edit a row, and
 * the rows live behind a disclosure that opens closed.
 */
const NOT_ABOUT_A_RULE = new Set<Reason["code"]>([
  "roster-invalid", "roster-too-large", "roster-too-large-constrained",
  "buddy-count-invalid", "work-too-large",
]);

/** Whether any of these refusals asks the user to change a buddy rule. */
export function anyAboutARule(reasons: Reason[]): boolean {
  return reasons.some((r) => !NOT_ABOUT_A_RULE.has(r.code));
}
