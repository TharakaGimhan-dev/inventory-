// csv.ts writes CSV by hand rather than pulling in a library.
//
// Export is the promise that a customer can always leave, so it is the last
// thing that should depend on a package that might break or be abandoned. The
// whole format is escaping and line endings, and both are below.
/**
 * Escapes one field.
 *
 * A value is quoted when it contains a comma, a quote, or a newline, and inner
 * quotes are doubled. Skipping this is how an asset described as
 * `Chair, broken` becomes two columns.
 */
function escape(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);

  // A leading =, +, - or @ is executed as a formula when the file is opened in
  // Excel. A field is the customer's own text, so it is prefixed to neutralise
  // it - the alternative is a spreadsheet that runs what an attacker typed
  // into an asset name.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(
  headers: string[],
  rows: (unknown[])[],
): string {
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));

  // CRLF, and a UTF-8 BOM added by the caller: Excel on Windows reads a plain
  // UTF-8 CSV as Latin-1 and turns Sinhala text into mojibake.
  return lines.join('\r\n');
}

export const UTF8_BOM = '﻿';
