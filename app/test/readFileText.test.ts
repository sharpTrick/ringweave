// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { checkJsonShape, readFileText } from "../src/io/readFileText";

describe("readFileText size gate", () => {
  it("rejects a file over the limit with a plain-language message, before reading", async () => {
    const big = new File(["x".repeat(1000)], "big.txt", { type: "text/plain" });
    await expect(readFileText(big, 100)).rejects.toThrow(/too large/i);
  });

  it("resolves an under-limit file's text unchanged", async () => {
    const f = new File(["Alice\nBob"], "roster.txt", { type: "text/plain" });
    await expect(readFileText(f, 1000)).resolves.toBe("Alice\nBob");
  });

  it("rejects a file just over the decimal 8 MB default (no MB-vs-MiB gap)", async () => {
    const over = new File(["x".repeat(8_000_001)], "big.txt", { type: "text/plain" });
    await expect(readFileText(over)).rejects.toThrow(/limit 8 MB/);
    const under = new File(["x".repeat(8_000_000)], "ok.txt", { type: "text/plain" });
    await expect(readFileText(under)).resolves.toHaveLength(8_000_000);
  });
});

describe("the shape of a JSON file is bounded before it is parsed", () => {
  // The byte cap bounds BYTES; `JSON.parse` allocates per NODE, and 8 MB buys wildly different
  // node counts — synchronously, before importGraph gets to reject anything.
  it("passes the largest file this app can write, with an order of magnitude to spare", () => {
    const n = 1000;
    const file = {
      version: 1,
      people: Array.from({ length: n }, (_, i) => ({ id: i, name: `Person ${i}` })),
      edges: Array.from({ length: 6000 }, (_, i) => [i % n, (i * 7 + 1) % n]),
      constraints: { required: [], prohibited: [] },
      settings: { buddies: 12, minSeparation: 5, seed: 1, polish: "auto" },
    };
    expect(() => checkJsonShape(JSON.stringify(file))).not.toThrow();
  });

  it("refuses the shapes the byte cap admits and the parser cannot afford", () => {
    // Deep nesting: cheap in characters, expensive in stack and time.
    expect(() => checkJsonShape("[".repeat(5000) + "]".repeat(5000))).toThrow(/nested too deeply/);
    // Wide: shallow, but a node per pair of characters.
    expect(() => checkJsonShape("[" + "{},".repeat(300_000) + "{}]")).toThrow(/too many parts/);
  });

  it("counts structure, not text — a brace inside a name is just a character", () => {
    // The scan must skip string literals, or a legitimate name would be charged for its content
    // and a hostile one could hide structure from the count.
    const braces = JSON.stringify({ version: 1, people: [{ id: 0, name: "{[,:".repeat(2000) }] });
    expect(() => checkJsonShape(braces)).not.toThrow();
    // ...including when the brace is preceded by an escaped quote.
    expect(() => checkJsonShape(JSON.stringify({ name: 'a"{['.repeat(100) }))).not.toThrow();
  });
});
