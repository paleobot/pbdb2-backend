/**
 * CSV for list reads (csv-output; design D3–D5, D12).
 *
 * A resource's columns are derived once from its payload source's `out`
 * variant, in schema order, so the header never depends on the rows. Each
 * column is a path through the record, where `[]` marks an array:
 *
 *   location.coordinates.latitude      ['location', 'coordinates', 'latitude']
 *   reference.title                    ['reference', 'title']          (a link)
 *   authors.familyName                 ['authors', '[]', 'familyName']
 *   lithofacies.adjectives             ['lithofacies', '[]', 'adjectives', '[]']
 *   additionalReferences.permid        ['additionalReferences', '[]', 'permid']
 *
 * An array's elements are joined with `|`, an array inside one with `;`. Inside
 * any array, an element's own `\`, `|` and `;` are escaped with `\`; the
 * separators are written bare. A link gives its permid and label, never `href`;
 * a link inside an array gives only its permid.
 */

import { deriveVariant } from '../../../payloadSchemas/lib/variants.js';

const ARRAY = '[]';

/** Separators by array depth: the outermost array joins with `|`. */
const SEPARATORS = ['|', ';'];

const typesOf = (schema) => [schema?.type].flat().filter(Boolean);
const isArray = (schema) => typesOf(schema).includes('array');

/**
 * The columns of `source`, in schema order.
 *
 * @param {object} source  annotated payload source
 * @returns {{ name: string, path: string[] }[]}
 */
export function csvColumns(source) {
  const columns = [];
  walk(deriveVariant(source, 'out'), [], 0, columns);
  return columns;
}

function walk(schema, path, depth, columns) {
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const at = [...path, name];

    if (prop['x-link']) {
      columns.push(column([...at, 'permid']));
      if (depth === 0) columns.push(column([...at, prop['x-link'].label]));
    } else if (isArray(prop)) {
      if (depth >= SEPARATORS.length) {
        throw new Error(`CSV supports arrays nested ${SEPARATORS.length} deep; ${at.join('.')} is deeper`);
      }
      const items = prop.items ?? {};
      if (items['x-link']) columns.push(column([...at, ARRAY, 'permid']));
      else if (items.properties) walk(items, [...at, ARRAY], depth + 1, columns);
      else columns.push(column([...at, ARRAY]));
    } else if (prop.properties) {
      walk(prop, at, depth, columns);
    } else {
      columns.push(column(at));
    }
  }
}

const column = (path) => ({ name: path.filter((s) => s !== ARRAY).join('.'), path });

/** One scalar as cell text: empty for null or absent, JSON's spelling otherwise. */
function scalar(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

const escapeElement = (text) => text.replace(/[\\|;]/g, '\\$&');

/**
 * The cell for one column of one record. `level` counts the arrays entered so
 * far; a scalar reached inside one is escaped, and each array joins its
 * elements with the separator for its depth. A missing value inside an array
 * still takes its position, so parallel columns stay aligned.
 */
function cell(value, path, level = 0) {
  if (path.length === 0) {
    const text = scalar(value);
    return level > 0 ? escapeElement(text) : text;
  }
  const [segment, ...rest] = path;
  if (segment === ARRAY) {
    if (!Array.isArray(value)) return '';
    return value.map((item) => cell(item, rest, level + 1)).join(SEPARATORS[level]);
  }
  return cell(value?.[segment], rest, level);
}

/** RFC 4180: quote a field holding a quote, comma, CR or LF, doubling quotes. */
export function csvField(text) {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const line = (fields) => `${fields.map(csvField).join(',')}\r\n`;

/**
 * The CSV serializer for a resource: its header line, and one line per record.
 *
 * @param {object} source  annotated payload source
 * @returns {{ columns: { name: string, path: string[] }[], header: () => string, record: (r: object) => string }}
 */
export function csvSerializer(source) {
  const columns = csvColumns(source);
  const header = line(columns.map((c) => c.name));
  return {
    columns,
    header: () => header,
    record: (record) => line(columns.map((c) => cell(record, c.path))),
  };
}
