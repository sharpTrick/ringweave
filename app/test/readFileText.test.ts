// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileText } from "../src/io/readFileText";

// Class: the byte-size gate must reject an oversized file BEFORE reading it (an already-parsed
// giant string can't be helped by the downstream import/roster caps). The maxBytes param is the
// testing seam for that gate.
describe("readFileText size gate", () => {
  it("rejects a file over the limit with a plain-language message, before reading", async () => {
    const big = new File(["x".repeat(1000)], "big.txt", { type: "text/plain" });
    await expect(readFileText(big, 100)).rejects.toThrow(/too large/i);
  });

  it("resolves an under-limit file's text unchanged", async () => {
    const f = new File(["Alice\nBob"], "roster.txt", { type: "text/plain" });
    await expect(readFileText(f, 1000)).resolves.toBe("Alice\nBob");
  });
});
