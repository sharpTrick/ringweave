/** Hard ceiling on a file we'll read into memory. Bounds the cost of the read, the
    resulting string, and any parse that follows (JSON.parse / parseRoster run on the main
    thread) — the import/roster caps downstream can't help once an oversized file is already
    parsed, so the gate has to come first. Module-local: only the default below reads it.
    Decimal MB (not MiB) so the enforced boundary equals the "8 MB" the rejection message prints
    (which formats with /1e6). */
const MAX_FILE_BYTES = 8_000_000; // 8 MB

/** Read a dropped/selected file as text, rejecting oversized files BEFORE the read and
    surfacing read failures (deleted/permission-denied) instead of silently no-op'ing. */
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
