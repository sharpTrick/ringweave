/**
 * Turn the core's structured infeasibility {@link Reason}s into copy that names
 * people.
 *
 * The core reports indices ("person 4") because it has no roster. This is the one
 * place that becomes "Alice", and it is a mapping over structured data rather
 * than a rewrite of the core's prose — parsing those strings would mean matching
 * twelve templates, one of which contains an en-dash, and only six of which name
 * a person at all.
 *
 * `unknown-person` and `self-pair` can carry an index that is deliberately OUT of
 * range — that is what those reasons report — so every lookup goes through
 * `personName`, which falls back rather than rendering "undefined".
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
      // The core summarises rather than listing once a rule set is malformed past counting; the
      // count is exact even though the list it replaces is not. Reached only through the library
      // directly — this app caps rules long before it — but the switch is exhaustive on purpose,
      // and leaving a code unhandled is what the compiler is here to refuse.
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
