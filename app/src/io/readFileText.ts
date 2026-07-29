/** Hard ceiling on a file we'll read into memory. Bounds the cost of the read and the resulting
    string — and, with `checkJsonShape` below, the parse that follows. The import/roster caps
    downstream can't help once an oversized file is already parsed, so the gate has to come first.
    Module-local: only the default below reads it. Decimal MB (not MiB) so the enforced boundary
    equals the "8 MB" the rejection message prints (which formats with /1e6). */
const MAX_FILE_BYTES = 8_000_000; // 8 MB

/**
 * Structural budget for a JSON file, checked BEFORE `JSON.parse`.
 *
 * The byte cap bounds BYTES, and this docblock used to claim it bounded the parse too. It does
 * not: `JSON.parse` allocates per NODE, and 8 MB buys wildly different node counts. Measured on
 * files all at exactly the byte limit:
 *   a valid max graph (n=1000, m=6000)            96 ms
 *   3.9M '[' then 3.9M ']'                     1,778 ms, ~238 MB
 *   800k distinct object keys                     860 ms, ~611 MB
 *   2M empty objects                              505 ms, ~517 MB
 * All synchronous on the main thread, with no spinner and no Cancel — the busy overlay is driven
 * by the generation worker, and import never touches it — and all paid BEFORE `importGraph`'s
 * first gate can look at the value (it then rejects in 0 ms).
 *
 * So the shape is bounded here, by one linear scan of text already in memory: a few ms against a
 * parse that can cost two seconds. `[`, `{`, `,` and `:` are what `JSON.parse` allocates for, and
 * counting them bounds nodes directly; depth is capped separately because a deep nest is cheap in
 * characters and expensive in stack. The valid ceiling file measures ~34k structural characters
 * at depth 4, so both caps sit an order of magnitude above anything this app can write.
 *
 * Characters inside string literals are skipped — a name may legitimately contain a brace.
 */
const MAX_JSON_NODES = 400_000;
const MAX_JSON_DEPTH = 32;

export function checkJsonShape(text: string, maxNodes = MAX_JSON_NODES, maxDepth = MAX_JSON_DEPTH): void {
  let nodes = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "[" || ch === "{") {
      depth++;
      if (depth > maxDepth) throw new Error("That file is nested too deeply to read.");
    } else if (ch === "]" || ch === "}") {
      depth--;
    } else if (ch !== "," && ch !== ":") {
      continue;
    }
    nodes++;
    if (nodes > maxNodes) throw new Error("That file has too many parts to read.");
  }
}

/** Read a dropped/selected file as text, rejecting oversized files BEFORE the read and
    surfacing read failures (deleted/permission-denied) instead of silently no-op'ing.
    The SHAPE gate is separate (`checkJsonShape`) because only the JSON path parses; a roster
    .txt/.csv goes to `parseRoster`, which is linear and already capped. */
export function readFileText(file: File, maxBytes: number = MAX_FILE_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`That file is too large (${(file.size / 1e6).toFixed(1)} MB; limit ${Math.floor(maxBytes / 1e6)} MB).`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsText(file);
  });
}
