/** Trigger a client-side file download. Everything stays on the device (privacy NFR). */
export function downloadBlob(filename: string, mime: string, data: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Neutralize spreadsheet formula injection: a value starting with =,+,-,@ (or tab/CR) is
    prefixed with an apostrophe so a spreadsheet treats it as text, not a formula, when a hostile
    imported name (e.g. `=HYPERLINK(...)`) reaches a paste sink and is re-opened. Shared by BOTH
    spreadsheet-bound exports — the CSV serializer (per cell) and the clipboard copy (per line's
    leading name) — so the two sinks can't drift out of sync. */
export function neutralizeCell(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

/** Quote fields per RFC 4180 (double up embedded quotes) and join into CSV. */
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => `"${neutralizeCell(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}
