// Split an API-shaped payload into its storage parts, and merge them back, as
// declared by x-storage on the annotated source:
//   split(source, payload, ctx) -> { jsonb, columns, children }
//   merge(source, { jsonb, columns, children }, ctx) -> payload
// x-storage is followed through nested `properties` only. A property with
// { column } and no codec maps one-to-one; codec groups go through ./codecs.js.
// An object left empty only because its stored-elsewhere fields were split out
// is dropped from the jsonb, and recreated on merge when those fields return.
//
// `ctx` is the codec context: a Map from a looked-up table to { byKey, byValue },
// needed by a codec that cannot be computed from the payload alone. Build it with
// collectCodecSources + loadCodecContext, or hand-build one in a test. split and
// merge remain pure and synchronous; a codec that declares no sources ignores it.
// See openspec/specs/payload-schema-variants/spec.md.
import { getCodec } from './codecs.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const IDENT = /^[a-z_][a-z0-9_]*$/;

// A codec property's link: on the property itself, or on its items for an
// array of links. Only `items` is reached; a codec owns the whole array value.
const linkOf = (prop) => prop['x-link'] ?? prop.items?.['x-link'];

// Group a node's x-storage properties: codec groups keyed by codec name, plain
// columns individually.
function storageGroups(properties) {
  const groups = new Map();
  for (const [name, prop] of Object.entries(properties ?? {})) {
    const storage = prop['x-storage'];
    if (!storage) continue;
    const key = storage.codec ? `codec:${storage.codec}` : `column:${name}`;
    if (!groups.has(key)) groups.set(key, { storage, names: [], link: linkOf(prop) });
    groups.get(key).names.push(name);
  }
  // A codec serving one property receives its name as storage.property, and
  // its link (if any) as storage.link. One serving several names its own keys.
  return [...groups.values()].map(({ storage, names, link }) => {
    if (!storage.codec || names.length !== 1) return { storage, names };
    return { storage: { ...storage, property: names[0], ...(link ? { link } : {}) }, names };
  });
}

// ---------- The codec context ----------

const sourceKey = ({ table, key, value }) => `${table}.${key}->${value}`;

const OPTIONAL_SOURCE_KEYS = ['versioned', 'payload', 'labels'];

function checkSource(codecName, source) {
  const shown = JSON.stringify(source);
  if (!isObject(source)) throw new Error(`${codecName}: a declared source must be { table, key, value }: ${shown}`);
  const keys = Object.keys(source).filter((k) => !OPTIONAL_SOURCE_KEYS.includes(k)).sort().join(',');
  if (keys !== 'key,table,value') {
    throw new Error(`${codecName}: a declared source must have exactly the keys table, key and value (and optionally ${OPTIONAL_SOURCE_KEYS.join(', ')}): ${shown}`);
  }
  if ('versioned' in source && source.versioned !== true) {
    throw new Error(`${codecName}: a source's versioned flag, when given, must be true: ${shown}`);
  }
  if ('labels' in source && !('payload' in source)) {
    throw new Error(`${codecName}: a source with labels must name its payload column: ${shown}`);
  }
  if ('labels' in source && !Array.isArray(source.labels)) {
    throw new Error(`${codecName}: a source's labels must be an array: ${shown}`);
  }
  const parts = [...String(source.table).split('.'), source.key, source.value];
  if ('payload' in source) parts.push(source.payload);
  for (const part of [...parts, ...(source.labels ?? [])]) {
    if (!IDENT.test(part)) throw new Error(`${codecName}: unsafe identifier in source ${shown}`);
  }
  return source;
}

// A property that carries both x-enumFrom and a codec reading a dictionaries
// table must have the two name the same table: otherwise the values the schema
// accepts and the keys the codec stores are free to drift apart.
function checkEnumAgreement(name, prop, sources) {
  const ann = prop['x-enumFrom'];
  if (!ann?.table) return;
  for (const source of sources) {
    if (!source.table.startsWith('dictionaries.')) continue;
    if (source.table !== `dictionaries.${ann.table}`) {
      throw new Error(
        `${name}: x-enumFrom names dictionaries.${ann.table} but codec '${prop['x-storage'].codec}' reads ${source.table}`,
      );
    }
  }
}

// Every distinct { table, key, value } the source's codecs declare. A codec
// property that is a link (x-link on it or on its items) asks its sources for
// the link's label; duplicates merge their label lists.
export function collectCodecSources(schema) {
  const seen = new Map();
  const visit = (node) => {
    for (const [name, prop] of Object.entries(node.properties ?? {})) {
      const codecName = prop['x-storage']?.codec;
      if (codecName) {
        const label = linkOf(prop)?.label;
        const sources = (getCodec(codecName).sources ?? []).map((s) =>
          checkSource(codecName, label === undefined ? s : { ...s, labels: [label] }),
        );
        checkEnumAgreement(name, prop, sources);
        for (const s of sources) {
          const prior = seen.get(sourceKey(s));
          if (!prior) seen.set(sourceKey(s), s);
          else if (s.labels) seen.set(sourceKey(s), { ...prior, labels: [...new Set([...(prior.labels ?? []), ...s.labels])] });
        }
      }
      if (isObject(prop.properties)) visit(prop);
    }
  };
  visit(schema);
  return [...seen.values()];
}

// Every x-storage annotation in the source, reached through nested `properties`.
function storageAnnotations(schema) {
  const found = [];
  const visit = (node) => {
    for (const prop of Object.values(node.properties ?? {})) {
      if (prop['x-storage']) found.push(prop['x-storage']);
      if (isObject(prop.properties)) visit(prop);
    }
  };
  visit(schema);
  return found;
}

// Which stored column's values are a source's keys, per looked-up table: what a
// caller reading rows in batches restricts that source to. Following x-storage
// rather than naming the columns keeps a batching caller out of the codecs'
// business.
//
// A table that a child-table codec also reads is left out entirely, even when
// another codec reads it through a column: some of its keys live in child rows,
// which this map cannot name, so restricting it to the columns would drop them.
// The payload audit, this function's caller, then reads it in full once per run.
// The API reads child rows and uses codecKeySites instead.
export function codecKeyColumns(schema) {
  const annotations = storageAnnotations(schema);
  const childRead = new Set();
  for (const storage of annotations) {
    if (storage.codec && storage.table) {
      for (const source of getCodec(storage.codec).sources ?? []) childRead.add(source.table);
    }
  }
  const byTable = new Map();
  for (const storage of annotations) {
    if (!storage.codec || !storage.column) continue;
    for (const source of getCodec(storage.codec).sources ?? []) {
      if (childRead.has(source.table)) continue;
      if (!byTable.has(source.table)) byTable.set(source.table, new Set());
      byTable.get(source.table).add(storage.column);
    }
  }
  return byTable;
}

// Where a source's keys are held, per looked-up table: the parent columns the
// x-storage annotations name, and per child table the codec's `keyColumn`s. A
// reader that loads the child rows restricts the codec context to the keys
// found at these sites. A child-table codec without a keyColumn contributes no
// child site.
export function codecKeySites(schema) {
  const byTable = new Map();
  const site = (table) => {
    if (!byTable.has(table)) byTable.set(table, { columns: [], children: {} });
    return byTable.get(table);
  };
  for (const storage of storageAnnotations(schema)) {
    if (!storage.codec) continue;
    const codec = getCodec(storage.codec);
    for (const source of codec.sources ?? []) {
      const entry = site(source.table);
      if (storage.column && !entry.columns.includes(storage.column)) entry.columns.push(storage.column);
      if (storage.table && codec.keyColumn) {
        const cols = (entry.children[storage.table] ??= []);
        if (!cols.includes(codec.keyColumn)) cols.push(codec.keyColumn);
      }
    }
  }
  return byTable;
}

const quoted = (table) => table.split('.').map((p) => `"${p}"`).join('.');

// A curated vocabulary rather than an entity table: read in full, once per run.
export const isDictionarySource = (source) => source.table.startsWith('dictionaries.');

// Map each source's table to { byKey, byValue }, both filled by one read. The
// same read fills `labels` (key -> { <label>: value }, a NULL label left out)
// for a source asking for labels, and `removed` (the keys of soft-removed heads)
// for a versioned one. Removed heads stay in byKey and byValue, so a codec that
// ignores `removed` resolves exactly as before.
//
// A source declaring `versioned: true` is read from lineage heads only. Every
// version of a row shares its permid, so value -> key is a function only over
// the heads; byKey is built from them too, so a stored id naming a superseded
// row throws in the codec rather than resolving quietly.
//
// `selection` is { <table>: { column, values } }: the column being restricted on
// — the source's `key` when the caller starts from a stored id, its `value` when
// it starts from a payload value such as a permid — and the values to restrict
// to. A source not named there is read in full. A source in the dictionaries
// schema is always read in full and is never restricted: those are curated
// vocabularies (dictionaries.roles holds six rows), and batching them would issue
// one pointless six-row query per batch.
//
// `reuse` seeds the result with an already-loaded context, and a source whose
// table it already holds is not read again. That is how a caller iterating in
// batches loads its dictionary sources once for the run and only its entity
// sources per batch: the returned Map is new each call, so a batch's selection
// never accumulates into the next one's.
export async function loadCodecContext(pg, sources, selection = {}, reuse) {
  const ctx = new Map(reuse);
  for (const source of sources) {
    const { table, key, value, versioned, payload, labels = [] } = checkSource('loadCodecContext', source);
    if (ctx.has(table)) continue;
    const restrict = isDictionarySource(source) ? undefined : selection[table];
    const where = versioned ? ['succeeded_by_id IS NULL'] : [];
    const params = [];
    if (restrict) {
      if (restrict.column !== key && restrict.column !== value) {
        throw new Error(`loadCodecContext: ${table} can be restricted on ${key} or ${value}, not ${restrict.column}`);
      }
      where.push(`"${restrict.column}" = ANY($1)`);
      params.push([...restrict.values]);
    }
    const cols = [`"${key}" AS k`, `"${value}" AS v`];
    labels.forEach((label, i) => cols.push(`"${payload}"->>'${label}' AS l${i}`));
    if (versioned) cols.push('COALESCE(removed, false) AS removed');
    let sql = `SELECT ${cols.join(', ')} FROM ${quoted(table)}`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    let rows;
    try {
      ({ rows } = await pg.query(sql, params));
    } catch (err) {
      throw new Error(`Cannot read codec source ${table}: ${err.message}`);
    }
    const byKey = new Map();
    const byValue = new Map();
    const entry = { byKey, byValue };
    if (labels.length) entry.labels = new Map();
    if (versioned) entry.removed = new Set();
    for (const r of rows) {
      byKey.set(r.k, r.v);
      byValue.set(r.v, r.k);
      if (entry.labels) {
        const found = {};
        labels.forEach((label, i) => { if (r[`l${i}`] !== null && r[`l${i}`] !== undefined) found[label] = r[`l${i}`]; });
        entry.labels.set(r.k, found);
      }
      if (entry.removed && r.removed) entry.removed.add(r.k);
    }
    ctx.set(table, entry);
  }
  return ctx;
}

// Every column the source's x-storage annotations name: what a caller reading
// stored rows selects for merge. A codec annotated with a child table names none.
export function storageColumns(schema) {
  return [...new Set(storageAnnotations(schema).map((s) => s.column).filter(Boolean))];
}

// storageColumns with the SQL expression that selects each one in the form merge
// expects: the codec's select(column) when it declares one (wgs84Point), the
// quoted column otherwise. A reader aliases each expression to its column.
export function storageSelects(schema) {
  const selects = new Map();
  for (const storage of storageAnnotations(schema)) {
    const { column } = storage;
    if (!column || selects.has(column)) continue;
    if (!IDENT.test(column)) throw new Error(`storageSelects: unsafe column name ${JSON.stringify(column)}`);
    const select = storage.codec ? getCodec(storage.codec).select : undefined;
    selects.set(column, select ? select(column) : `"${column}"`);
  }
  return [...selects].map(([column, expression]) => ({ column, expression }));
}

// ---------- split / merge ----------

function addParts(parts, { columns, children }) {
  Object.assign(parts.columns, columns ?? {});
  for (const [table, rows] of Object.entries(children ?? {})) {
    parts.children[table] = [...(parts.children[table] ?? []), ...rows];
  }
}

function splitNode(schema, value, parts, ctx) {
  const out = { ...value };
  let removedAny = false;
  for (const { storage, names } of storageGroups(schema.properties)) {
    const picked = {};
    for (const n of names) if (n in out) { picked[n] = out[n]; delete out[n]; removedAny = true; }
    if (storage.codec) addParts(parts, getCodec(storage.codec).split(picked, storage, ctx));
    else if (names[0] in picked) parts.columns[storage.column] = picked[names[0]];
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (prop['x-storage'] || !isObject(out[name]) || !isObject(prop.properties)) continue;
    const child = splitNode(prop, out[name], parts, ctx);
    if (child === undefined) delete out[name];
    else out[name] = child;
  }
  return removedAny && Object.keys(out).length === 0 ? undefined : out;
}

export function split(source, payload, ctx) {
  const parts = { columns: {}, children: {} };
  const jsonb = splitNode(source, payload, parts, ctx) ?? {};
  return { jsonb, ...parts };
}

function mergeNode(schema, value, parts, ctx) {
  const out = value === undefined ? {} : { ...value };
  for (const { storage, names } of storageGroups(schema.properties)) {
    if (storage.codec) {
      const rebuilt = getCodec(storage.codec).merge(parts, storage, ctx);
      for (const n of names) if (rebuilt[n] !== undefined) out[n] = rebuilt[n];
    } else {
      const v = parts.columns?.[storage.column];
      if (v !== undefined && v !== null) out[names[0]] = v;
    }
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (prop['x-storage'] || !isObject(prop.properties)) continue;
    if (out[name] !== undefined && !isObject(out[name])) continue;
    const child = mergeNode(prop, out[name], parts, ctx);
    if (child !== undefined) out[name] = child;
  }
  return value === undefined && Object.keys(out).length === 0 ? undefined : out;
}

export function merge(source, { jsonb, columns = {}, children = {} }, ctx) {
  return mergeNode(source, jsonb ?? {}, { columns, children }, ctx) ?? {};
}
