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

/** Neutralize CSV formula injection: a cell starting with =,+,-,@ (or tab/CR) is prefixed with
    an apostrophe so a spreadsheet treats it as text, not a formula, when a hostile imported name
    (e.g. `=HYPERLINK(...)`) is exported and re-opened. */
function neutralizeFormula(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

/** Quote fields per RFC 4180 (double up embedded quotes) and join into CSV. */
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => `"${neutralizeFormula(c).replace(/"/g, '""')}"`).join(",")).join("\n");
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
