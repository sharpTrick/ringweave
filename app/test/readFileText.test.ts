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

  // Class: the STATED limit must equal the ENFORCED one. The default gate is 8 MB = 8,000,000 B
  // (decimal, matching the message's /1e6 formatting) — a file over 8e6 but under the old 8 MiB
  // (8,388,608) must now be rejected, and the message must name "8 MB".
  it("rejects a file just over the decimal 8 MB default (no MB-vs-MiB gap)", async () => {
    const over = new File(["x".repeat(8_000_001)], "big.txt", { type: "text/plain" });
    await expect(readFileText(over)).rejects.toThrow(/limit 8 MB/);
    const under = new File(["x".repeat(8_000_000)], "ok.txt", { type: "text/plain" });
    await expect(readFileText(under)).resolves.toHaveLength(8_000_000);
  });
});
