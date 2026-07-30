/** Hard ceiling on a file read into memory. The import/roster caps downstream cannot help once an
    oversized file is already read and parsed, so this gate has to come first. Decimal MB (not
    MiB) so the enforced boundary equals the "8 MB" the rejection message prints. */
const MAX_FILE_BYTES = 8_000_000; // 8 MB

/**
 * Structural budget for a JSON file, checked BEFORE `JSON.parse` — the byte cap does NOT bound
 * the parse, which allocates per node, and 8 MB of `[` costs seconds of synchronous main-thread
 * time before `importGraph`'s first gate can see the value. Import shows no spinner and offers no
 * Cancel while that runs.
 *
 * `[`, `{`, `,` and `:` are what `JSON.parse` allocates for, so counting them bounds nodes
 * directly; depth is capped separately because a deep nest is cheap in characters and expensive
 * in stack. Characters inside string literals are skipped — a name may contain a brace.
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

/** Read a dropped/selected file as text, rejecting oversized files BEFORE the read. The SHAPE
    gate is separate (`checkJsonShape`) because only the JSON path parses. */
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
