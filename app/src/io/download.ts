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

/** Neutralize spreadsheet formula injection: a leading =,+,-,@ (or tab/CR) is prefixed with an
    apostrophe so a hostile name (`=HYPERLINK(...)`) is text, not a live formula, when the export
    is opened in a spreadsheet. Shared by BOTH spreadsheet-bound sinks — the CSV serializer and
    the clipboard copy — so the two can't drift apart. */
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
