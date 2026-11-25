// Migrates Classic `occurrences` and `reidentifications` into `identifications`
// (one row per identification act) and `occurrence_abundances`, then derives the
// `occurrences` cache with rebuild_occurrences(). See
// openspec/specs/occurrence-migration/spec.md and docs/occurrences.md beside this file.
//
// Three things shape the script.
//
// 1. Nothing chooses a current identification. Every occurrence becomes a root
//    identification (permid = occurrence_permid = OCC-<occurrence_no>) and every
//    reidentification a non-root one; derive_occurrences() picks the winner. Classic's
//    caches of its own pick (occurrences.reid_no, reidentifications.most_recent) are
//    not read.
//
// 2. Load order is the winner's tie-break. created_at is left to its default, so every
//    row of the one transaction shares it, and derive_occurrences() falls through to
//    the lineage's first id. Roots load in occurrence_no order, then reidentifications
//    in reid_no order, which is Classic's own tie-break (pubyr DESC, reid_no DESC). Do
//    not reorder the passes or split them across transactions run out of order.
//
// 3. 2M rows are streamed, never staged: each batch of 1,000 is built, validated and
//    inserted before the next is read. Per occurrence the script keeps only two numbers
//    in typed arrays indexed by occurrence_no (the root's reference_id and the Classic
//    collection_no), which pass 2 needs for the reference fallback and the conflict log.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mariadb, pg, closeAll } from '../lib/db.js';
import { registerPermids, mintPermids } from '../lib/permids.js';
import { resolvePersons, loadReferenceIdMap, loadNamePermidMap } from '../lib/identity.js';
import { createAnomalyLog } from '../lib/anomaly-log.js';
import { identificationSource } from '../../../payloadSchemas/identification.schema.js';
import { occurrenceAbundanceSource } from '../../../payloadSchemas/occurrenceAbundance.schema.js';
import { resolveEnums } from '../../../payloadSchemas/lib/enums.js';
import { deriveVariant } from '../../../payloadSchemas/lib/variants.js';
import { createAjv } from '../../../payloadSchemas/lib/ajv.js';

const BATCH_SIZE = 1000;
const LOG_SAMPLE_LIMIT = 20;
const DIFF_PRINT_LIMIT = 50;

// The curator lists the run is checked against (design D2), at the backend root.
const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EXCLUDED_CSV = join(BACKEND_ROOT, 'docs/occurrences-excluded.csv');
const CONFLICTS_CSV = join(BACKEND_ROOT, 'docs/occurrences-collection-conflicts.csv');

const RANKS = ['genus', 'subgenus', 'species', 'subspecies'];

// ---------- Pure helpers ----------

// Classic uses 0 and SQL NULL interchangeably for "no value". Every legacy
// foreign-key test goes through here so neither spelling is missed.
export function isUnset(v) {
  return v == null || Number(v) === 0;
}

// NUL bytes stripped (jsonb cannot store \u0000; 15 occurrence comments carry one),
// then trimmed, so '' and whitespace-only both read as "not given".
function clean(s) {
  return s == null ? '' : String(s).replace(/\u0000/g, '').trim();
}

function setIfPresent(obj, key, value) {
  const s = clean(value);
  if (s !== '') obj[key] = s;
}

// One payload for both kinds of row. On an occurrence, plant_organ2 follows
// plant_organ; a reidentification has no second organ column. The ditto mark '"'
// is a member of the resolution enums and passes through like any other value.
export function buildIdentificationPayload(src, { reid = false } = {}) {
  const payload = { legacyIDs: { oldpbdbID: String(src.occurrence_no) } };
  if (reid) payload.legacyIDs.oldpbdbReidID = String(src.reid_no);

  const identification = {};
  for (const rank of RANKS) {
    const r = {};
    setIfPresent(r, 'resolution', src[`${rank}_reso`]);
    setIfPresent(r, 'name', src[`${rank}_name`]);
    if (Object.keys(r).length > 0) identification[rank] = r;
  }
  if (Object.keys(identification).length > 0) payload.identification = identification;

  const organs = [src.plant_organ, reid ? null : src.plant_organ2].map(clean).filter(Boolean);
  if (organs.length > 0) payload.plantOrgans = organs;

  setIfPresent(payload, 'comments', src.comments);
  return payload;
}

// Both fields stay text: abund_value is not always a number ("3-5", "common").
export function buildAbundancePayload(src) {
  const payload = { legacyIDs: { oldpbdbID: String(src.occurrence_no) } };
  setIfPresent(payload, 'value', src.abund_value);
  setIfPresent(payload, 'unit', src.abund_unit);
  return payload;
}

export function hasAbundance(src) {
  return clean(src.abund_value) !== '' || clean(src.abund_unit) !== '';
}

// The first two columns of a curator CSV as "a:b" keys. Neither column is ever
// quoted (a table name and integers), so a split on the first two commas suffices.
function csvKeys(path) {
  const lines = readFileSync(path, 'utf8').trim().split('\n').slice(1);
  return new Set(lines.map((l) => l.split(',', 2).join(':')));
}

// Fails with every difference printed (up to a limit) when the run's set and the
// file's differ in either direction.
function compareWithCsv(label, actual, path) {
  const expected = csvKeys(path);
  const missing = [...expected].filter((k) => !actual.has(k));
  const unexpected = [...actual].filter((k) => !expected.has(k));
  if (missing.length === 0 && unexpected.length === 0) {
    console.log(`  ${label}: ${actual.size} rows, identical to ${path.slice(BACKEND_ROOT.length)}`);
    return;
  }
  console.error(`  ${label} differ from ${path.slice(BACKEND_ROOT.length)}:`);
  for (const k of unexpected.slice(0, DIFF_PRINT_LIMIT)) console.error(`    in this run, not in the file: ${k}`);
  for (const k of missing.slice(0, DIFF_PRINT_LIMIT)) console.error(`    in the file, not in this run: ${k}`);
  throw new Error(`${label}: ${unexpected.length} not in the file, ${missing.length} not in this run`);
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) throw new Error(`assertion failed: ${label}: ${actual} ≠ ${expected}`);
  console.log(`  ✓ ${label}: ${actual}`);
}

const makeSampleLogger = (label) => {
  let n = 0;
  return (msg) => {
    if (n < LOG_SAMPLE_LIMIT) console.log(`    [${label}] ${msg}`);
    else if (n === LOG_SAMPLE_LIMIT) console.log(`    [${label}] ... further occurrences suppressed`);
    n++;
  };
};

function validated(validate, payload, what, label) {
  if (!validate(payload)) {
    console.error(`  Validation failed for ${label}`);
    console.error(JSON.stringify(validate.errors, null, 2));
    console.error(JSON.stringify(payload, null, 2));
    throw new Error(`payload failed ${what} db-schema validation`);
  }
  return JSON.stringify(payload);
}

// ---------- Main ----------

async function main() {
  const startTime = Date.now();
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[${new Date(startTime).toISOString()}] Occurrences migration starting${dryRun ? ' (DRY RUN)' : ''}`);

  const anomalyLog = createAnomalyLog(import.meta.url, 'occurrence_no');

  // db variants, enums resolved from dictionaries (throws before any row is read).
  const ajv = createAjv();
  const validateIdentification = ajv.compile(deriveVariant(await resolveEnums(pg, identificationSource), 'db'));
  const validateAbundance = ajv.compile(deriveVariant(await resolveEnums(pg, occurrenceAbundanceSource), 'db'));

  // ---- PostgreSQL lookup maps ----
  const refMap = await loadReferenceIdMap(pg);
  const namePermidMap = await loadNamePermidMap(pg);
  const { rows: collRows } = await pg.query(`
    SELECT id, reference_id, (collection->'legacyIDs'->>'oldpbdbID')::int AS cn
    FROM collections
    WHERE succeeded_by_id IS NULL
  `);
  const collMap = new Map();
  for (const r of collRows) if (r.cn !== null) collMap.set(Number(r.cn), { id: r.id, referenceId: r.reference_id });
  console.log(`  Loaded ${refMap.size} refs, ${namePermidMap.size} name permids, ${collMap.size} collections`);

  // Per occurrence_no: the loaded root's reference_id (0 = not loaded) and its Classic
  // collection_no. Float64 holds any bigint id this database will see.
  const [[{ maxOcc }]] = await mariadb.query('SELECT COALESCE(MAX(occurrence_no), 0) AS maxOcc FROM occurrences');
  const rootReference = new Float64Array(Number(maxOcc) + 1);
  const rootCollectionNo = new Uint32Array(Number(maxOcc) + 1);

  const counts = {
    occRead: 0, reidRead: 0, roots: 0, nonRoots: 0, abundances: 0,
    rootRefFallback: 0, reidRefFallback: 0,
    rootTaxonUnset: 0, reidTaxonUnset: 0, orphanTaxon: 0,
    personSentinel: 0, conflicts: 0,
  };
  const excludedByReason = new Map();
  const excluded = new Set(); // "occurrences:<n>" / "reidentifications:<n>", as the CSV keys rows
  const conflicts = new Set(); // "<occurrence_no>:<reid_no>"
  const timings = {};

  const logExcluded = makeSampleLogger('excluded');
  const logOrphanTaxon = makeSampleLogger('orphan taxon_no');
  const logRefFallback = makeSampleLogger('reference fallback');
  const logPersonSentinel = makeSampleLogger('auth/ent 0-sentinel');
  const logConflict = makeSampleLogger('collection conflict');

  const exclude = (table, no, occurrenceNo, reason, description) => {
    excluded.add(`${table}:${no}`);
    excludedByReason.set(`${table}: ${reason}`, (excludedByReason.get(`${table}: ${reason}`) ?? 0) + 1);
    logExcluded(`${table} ${no}: ${reason}`);
    anomalyLog.log(occurrenceNo, 'identifications', 'skip', reason, description);
  };

  // The fields both kinds of row resolve the same way: persons and taxon.
  const resolveCommon = (src, label) => {
    if (isUnset(src.authorizer_no) || isUnset(src.enterer_no)) {
      counts.personSentinel++;
      logPersonSentinel(`${label} authorizer_no=${src.authorizer_no} enterer_no=${src.enterer_no}`);
    }
    const { authorizerPersonId, entererPersonId } = resolvePersons(src);
    let taxonPermid = null;
    if (!isUnset(src.taxon_no)) {
      taxonPermid = namePermidMap.get(Number(src.taxon_no)) ?? null;
      if (taxonPermid === null) {
        counts.orphanTaxon++;
        logOrphanTaxon(`${label} taxon_no=${src.taxon_no}`);
        anomalyLog.log(src.occurrence_no, 'identifications', 'warning', 'orphan taxon_no',
          `${label}: taxon_no ${src.taxon_no} has no name opinion; taxon_permid left NULL, name kept in the payload`);
      }
    }
    return { authorizerPersonId, entererPersonId, taxonPermid };
  };

  // A rolled-back earlier run leaves the tables with pages but, once autovacuum has
  // been, reltuples = 0: the planner then takes them for empty however large they
  // grow, and place_in_lineage()'s per-row head lookup scans the whole
  // *_one_head_per_number index instead of using *_permid_head_idx (quadratic; a
  // second attempt crawled at 1.1M rows in 19 min). Vacuuming the empty tables
  // truncates them to 0 pages, so estimates come from tuple width again, as on a
  // fresh database. Must run outside the transaction.
  await pg.query('VACUUM (ANALYZE) identifications, occurrence_abundances, occurrences');

  const client = await pg.connect();
  const conn = await mariadb.getConnection();
  try {
    await client.query('BEGIN');

    // ---- Pass 1: occurrences → roots + abundances ----
    const insertRoots = async (batch) => {
      const permids = await registerPermids(client, 'OCC', batch.map((r) => r.occurrenceNo));
      await client.query(`
        INSERT INTO identifications (permid, occurrence_permid, authorizer_person_id, enterer_person_id,
                                     collection_id, taxon_permid, reference_id, identification, oldpbdb_occurrence_no)
        SELECT p, p, a, e, c, t, r, i::jsonb, o
        FROM unnest($1::text[], $2::int[], $3::int[], $4::bigint[], $5::text[], $6::bigint[], $7::text[], $8::int[])
             AS u(p, a, e, c, t, r, i, o)`,
      [permids, batch.map((r) => r.authorizerPersonId), batch.map((r) => r.entererPersonId),
        batch.map((r) => r.collectionId), batch.map((r) => r.taxonPermid), batch.map((r) => r.referenceId),
        batch.map((r) => r.json), batch.map((r) => r.occurrenceNo)]);

      // Abundances in occurrence_no order within the batch, so the ABD sequence runs in
      // occurrence_no order across the whole load.
      const withAbundance = batch.map((r, k) => ({ ...r, permid: permids[k] })).filter((r) => r.abundanceJson);
      const abdPermids = await mintPermids(client, 'ABD', withAbundance.length);
      if (withAbundance.length > 0) {
        await client.query(`
          INSERT INTO occurrence_abundances (permid, occurrence_permid, authorizer_person_id, enterer_person_id,
                                             reference_id, abundance)
          SELECT p, o, a, e, r, j::jsonb
          FROM unnest($1::text[], $2::text[], $3::int[], $4::int[], $5::bigint[], $6::text[]) AS u(p, o, a, e, r, j)`,
        [abdPermids, withAbundance.map((r) => r.permid), withAbundance.map((r) => r.authorizerPersonId),
          withAbundance.map((r) => r.entererPersonId), withAbundance.map((r) => r.referenceId),
          withAbundance.map((r) => r.abundanceJson)]);
      }
      counts.roots += batch.length;
      counts.abundances += withAbundance.length;
    };

    let t = Date.now();
    let batch = [];
    const occStream = conn.connection.query(`
      SELECT occurrence_no, collection_no, reference_no, taxon_no, authorizer_no, enterer_no,
             genus_reso, genus_name, subgenus_reso, subgenus_name,
             species_reso, species_name, subspecies_reso, subspecies_name,
             plant_organ, plant_organ2, abund_value, abund_unit, comments
      FROM occurrences
      ORDER BY occurrence_no ASC
    `).stream();
    for await (const src of occStream) {
      counts.occRead++;
      if (counts.occRead % 200000 === 0) console.log(`  Read ${counts.occRead} occurrences, ${counts.roots + batch.length} roots...`);
      const occNo = Number(src.occurrence_no);
      const label = `occurrence ${occNo}`;

      const coll = isUnset(src.collection_no) ? undefined : collMap.get(Number(src.collection_no));
      if (!coll) {
        const reason = isUnset(src.collection_no) ? 'no collection' : 'collection not in PostgreSQL';
        exclude('occurrences', occNo, occNo, reason, `collection_no ${src.collection_no ?? 'NULL'}; not migrated`);
        continue;
      }

      let referenceId = isUnset(src.reference_no) ? undefined : refMap.get(Number(src.reference_no));
      if (!referenceId) {
        referenceId = coll.referenceId;
        counts.rootRefFallback++;
        logRefFallback(`${label} reference_no=${src.reference_no} → collection ${src.collection_no}'s reference`);
        anomalyLog.log(occNo, 'identifications', 'warning', 'reference from collection',
          `reference_no ${src.reference_no ?? 'NULL'} unset or not migrated; root takes collection ${src.collection_no}'s reference`);
      }
      if (!referenceId) throw new Error(`${label}: no reference, and collection ${src.collection_no} has none`);

      if (isUnset(src.taxon_no)) counts.rootTaxonUnset++;
      const common = resolveCommon(src, label);
      const json = validated(validateIdentification, buildIdentificationPayload(src), 'identification', label);
      const abundanceJson = hasAbundance(src)
        ? validated(validateAbundance, buildAbundancePayload(src), 'occurrence-abundance', label)
        : null;

      rootReference[occNo] = Number(referenceId);
      rootCollectionNo[occNo] = Number(src.collection_no);
      batch.push({ occurrenceNo: occNo, collectionId: coll.id, referenceId, json, abundanceJson, ...common });
      if (batch.length === BATCH_SIZE) {
        await insertRoots(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await insertRoots(batch);
    timings.pass1 = (Date.now() - t) / 1000;
    console.log(`  Pass 1: ${counts.occRead} occurrences read, ${counts.roots} roots and ${counts.abundances} abundances inserted (${timings.pass1.toFixed(1)}s)`);

    // ---- Pass 2: reidentifications → non-roots ----
    const insertNonRoots = async (rows) => {
      const permids = await mintPermids(client, 'OCC', rows.length);
      // occurrence_permid is formatted in SQL: check digits are computed only there.
      await client.query(`
        INSERT INTO identifications (permid, occurrence_permid, authorizer_person_id, enterer_person_id,
                                     taxon_permid, reference_id, identification, oldpbdb_occurrence_no, oldpbdb_reid_no)
        SELECT p, format_permid('OCC', o), a, e, t, r, i::jsonb, o, n
        FROM unnest($1::text[], $2::int[], $3::int[], $4::int[], $5::text[], $6::bigint[], $7::text[], $8::int[])
             AS u(p, o, a, e, t, r, i, n)`,
      [permids, rows.map((r) => r.occurrenceNo), rows.map((r) => r.authorizerPersonId),
        rows.map((r) => r.entererPersonId), rows.map((r) => r.taxonPermid), rows.map((r) => r.referenceId),
        rows.map((r) => r.json), rows.map((r) => r.reidNo)]);
      counts.nonRoots += rows.length;
    };

    t = Date.now();
    batch = [];
    const reidStream = conn.connection.query(`
      SELECT reid_no, occurrence_no, collection_no, reference_no, taxon_no, authorizer_no, enterer_no,
             genus_reso, genus_name, subgenus_reso, subgenus_name,
             species_reso, species_name, subspecies_reso, subspecies_name,
             plant_organ, comments
      FROM reidentifications
      ORDER BY reid_no ASC
    `).stream();
    for await (const src of reidStream) {
      counts.reidRead++;
      const reidNo = Number(src.reid_no);
      const occNo = isUnset(src.occurrence_no) ? 0 : Number(src.occurrence_no);
      const label = `reidentification ${reidNo} (occurrence ${occNo})`;

      const rootRef = occNo > 0 && occNo < rootReference.length ? rootReference[occNo] : 0;
      if (rootRef === 0) {
        exclude('reidentifications', reidNo, occNo, 'occurrence not loaded',
          `occurrence ${occNo} does not exist or was excluded; reidentification ${reidNo} not migrated`);
        continue;
      }

      if (!isUnset(src.collection_no) && Number(src.collection_no) !== rootCollectionNo[occNo]) {
        counts.conflicts++;
        conflicts.add(`${occNo}:${reidNo}`);
        logConflict(`${label}: collection ${src.collection_no}, occurrence's ${rootCollectionNo[occNo]}`);
        anomalyLog.log(occNo, 'identifications', 'warning', 'collection conflict',
          `reidentification ${reidNo} names collection ${src.collection_no}; its occurrence is in ${rootCollectionNo[occNo]}, which is kept`);
      }

      let referenceId = isUnset(src.reference_no) ? undefined : refMap.get(Number(src.reference_no));
      if (!referenceId) {
        referenceId = rootRef;
        counts.reidRefFallback++;
        logRefFallback(`${label} reference_no=${src.reference_no} → the root's reference`);
        anomalyLog.log(occNo, 'identifications', 'warning', 'reference from root',
          `reidentification ${reidNo}: reference_no ${src.reference_no ?? 'NULL'} unset or not migrated; takes the root's reference`);
      }

      if (isUnset(src.taxon_no)) counts.reidTaxonUnset++;
      const common = resolveCommon(src, label);
      const json = validated(validateIdentification, buildIdentificationPayload(src, { reid: true }), 'identification', label);

      batch.push({ reidNo, occurrenceNo: occNo, referenceId, json, ...common });
      if (batch.length === BATCH_SIZE) {
        await insertNonRoots(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await insertNonRoots(batch);
    timings.pass2 = (Date.now() - t) / 1000;
    console.log(`  Pass 2: ${counts.reidRead} reidentifications read, ${counts.nonRoots} non-roots inserted (${timings.pass2.toFixed(1)}s)`);

    // ---- Checks before COMMIT ----
    compareWithCsv('Excluded rows', excluded, EXCLUDED_CSV);
    compareWithCsv('Collection conflicts', conflicts, CONFLICTS_CSV);

    const excludedOcc = [...excluded].filter((k) => k.startsWith('occurrences:')).length;
    const excludedReid = excluded.size - excludedOcc;
    assertEqual('roots + excluded occurrences = occurrences read', counts.roots + excludedOcc, counts.occRead);
    assertEqual('non-roots + excluded reidentifications = reidentifications read', counts.nonRoots + excludedReid, counts.reidRead);

    // Counted in the database, not from the script's own counters.
    const { rows: [db] } = await client.query(`
      SELECT (SELECT count(*) FILTER (WHERE permid = occurrence_permid) FROM identifications)::int AS roots,
             (SELECT count(*) FILTER (WHERE permid <> occurrence_permid) FROM identifications)::int AS non_roots,
             (SELECT count(*) FROM occurrence_abundances)::int AS abundances`);
    assertEqual('root identifications in the table', db.roots, counts.roots);
    assertEqual('non-root identifications in the table', db.non_roots, counts.nonRoots);
    assertEqual('abundances = loaded occurrences with a value or unit', db.abundances, counts.abundances);

    // The 2M rows are uncommitted, so autovacuum has never seen them and the planner
    // takes identifications for a few dozen rows: derive_occurrences() then plans a
    // per-root nested loop over the head index, quadratic over 2M roots (killed after
    // 37 min). ANALYZE in this transaction counts its own inserted rows.
    t = Date.now();
    await client.query('ANALYZE identifications');
    timings.analyze = (Date.now() - t) / 1000;
    console.log(`  ANALYZE identifications (${timings.analyze.toFixed(1)}s)`);

    // Even analyzed, roots are estimated at ~0.5% of the table (occurrence_permid =
    // permid compares two columns, which no statistic covers): 10K for 2M. PG 16 still
    // hash-joins the candidates; Aurora's PG 18 drives a nested loop from the roots and
    // did not finish in 31 min. A full rebuild reads every occurrence, so a nested loop
    // is never the right plan for it (35-90 s with hash joins). SET LOCAL ends with the
    // transaction.
    await client.query('SET LOCAL enable_nestloop = off');
    t = Date.now();
    const { rows: [{ changed }] } = await client.query('SELECT rebuild_occurrences() AS changed');
    timings.rebuild = (Date.now() - t) / 1000;
    console.log(`  rebuild_occurrences(): ${changed} rows changed (${timings.rebuild.toFixed(1)}s)`);
    const { rows: [{ n: occurrences }] } = await client.query('SELECT count(*)::int AS n FROM occurrences');
    assertEqual('occurrences = roots', occurrences, counts.roots);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('  DRY RUN — transaction rolled back (no data written)');
    } else {
      // The deferred one-head-per-number checks run here, one per inserted row.
      t = Date.now();
      await client.query('COMMIT');
      timings.commit = (Date.now() - t) / 1000;
      console.log(`  Transaction committed (${timings.commit.toFixed(1)}s)`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('  Failed, transaction rolled back:', err.message);
    process.exitCode = 1;
    return;
  } finally {
    conn.release();
    client.release();
  }

  const anomalyCount = anomalyLog.flush();

  // ---- Final report ----
  console.log('');
  console.log(`  Occurrences read:                ${counts.occRead}`);
  console.log(`  Reidentifications read:          ${counts.reidRead}`);
  console.log(`  Root identifications:            ${counts.roots}`);
  console.log(`  Non-root identifications:        ${counts.nonRoots}`);
  console.log(`  Abundances:                      ${counts.abundances}`);
  console.log(`  Occurrences derived:             ${counts.roots}`);
  console.log('  Excluded:');
  for (const [reason, n] of [...excludedByReason].sort()) console.log(`    ${reason.padEnd(44)} ${n}`);
  console.log(`  Collection conflicts (logged):   ${counts.conflicts}`);
  console.log(`  Reference from collection:       ${counts.rootRefFallback}`);
  console.log(`  Reference from root:             ${counts.reidRefFallback}`);
  console.log(`  Unset taxon (roots / non-roots): ${counts.rootTaxonUnset} / ${counts.reidTaxonUnset}`);
  console.log(`  Orphan taxon_no (NULL, logged):  ${counts.orphanTaxon}`);
  console.log(`  Person 0-sentinel applied:       ${counts.personSentinel}`);
  console.log(`  Anomalies recorded:              ${anomalyCount}`);
  console.log(`  Pass 1 / pass 2 / rebuild${dryRun ? '' : ' / commit'}: ${timings.pass1.toFixed(1)}s / ${timings.pass2.toFixed(1)}s / ${timings.rebuild.toFixed(1)}s${dryRun ? '' : ` / ${timings.commit.toFixed(1)}s`}`);
  console.log(`  Peak RSS:                        ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] Occurrences migration complete in ${elapsed}s${dryRun ? ' (dry run, nothing written)' : ''}`);
}

// Only run main() when invoked directly, so pure transforms can be imported for unit tests.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }).finally(() => closeAll());
}
