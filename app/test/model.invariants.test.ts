import { describe, it, expect } from "vitest";
import {
  SEPARATION_DEFAULT, SEPARATION_MIN, SEPARATION_MAX,
  BUDDY_MIN, BUDDY_MAX, DEFAULT_SETTINGS,
} from "../src/model";

describe("model default constants stay within their UI ranges", () => {
  it("SEPARATION_DEFAULT is within [SEPARATION_MIN, SEPARATION_MAX]", () => {
    expect(SEPARATION_DEFAULT).toBeGreaterThanOrEqual(SEPARATION_MIN);
    expect(SEPARATION_DEFAULT).toBeLessThanOrEqual(SEPARATION_MAX);
    expect(Number.isInteger(SEPARATION_DEFAULT)).toBe(true);
  });

  it("DEFAULT_SETTINGS.buddies is within [BUDDY_MIN, BUDDY_MAX]", () => {
    expect(DEFAULT_SETTINGS.buddies).toBeGreaterThanOrEqual(BUDDY_MIN);
    expect(DEFAULT_SETTINGS.buddies).toBeLessThanOrEqual(BUDDY_MAX);
  });
});
