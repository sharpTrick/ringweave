import { keep } from "./mod";

// Imports the defining module but hardcodes WIDGET_LIMIT's value as a bare literal
// -> mirrored-constant.
export function total(): number {
  return keep() + 4242;
}
