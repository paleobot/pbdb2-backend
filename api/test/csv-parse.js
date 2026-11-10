/**
 * A minimal RFC 4180 reader for the tests: enough to read back what the API
 * writes (CRLF records, quoted fields with doubled quotes and line breaks), and
 * strict where it matters (a body must end with CRLF).
 */

/**
 * Parse a whole CSV body into rows of fields.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const fields = [];
    for (;;) {
      let value = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= text.length) throw new Error('unterminated quoted field');
          if (text[i] === '"' && text[i + 1] === '"') { value += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else value += text[i++];
        }
      } else {
        while (i < text.length && text[i] !== ',' && text[i] !== '\r') value += text[i++];
      }
      fields.push(value);
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '\r' && text[i + 1] === '\n') { i += 2; break; }
      throw new Error(`record not ended by CRLF at offset ${i}`);
    }
    rows.push(fields);
  }
  return rows;
}

/**
 * A CSV body as `{ header, records }`, each record keyed by column name.
 *
 * @param {string} text
 */
export function readCsv(text) {
  const [header, ...rows] = parseCsv(text);
  return { header, records: rows.map((row) => Object.fromEntries(header.map((name, k) => [name, row[k]]))) };
}
