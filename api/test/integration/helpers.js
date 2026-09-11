import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { loadPgConfig } from '../../src/config.js';

const { Client, Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// The backend schema (with its lineage triggers) lives in the sibling
// pbdb2-migrations repo. Overridable for non-default checkouts / CI.
const DEFAULT_SQL_PATH = join(__dirname, '../../../pbdb2-migrations/postgresql/create_new.sql');

function sslFrom(config) {
  return config.caCertPath ? { ca: readFileSync(config.caCertPath) } : false;
}

/**
 * Provision an ephemeral test database against the PostgreSQL identified by
 * `PG_*`, load `create_new.sql` into it (triggers and all), and return a pool
 * plus a `teardown` that drops it.
 *
 * Returns `{ available: false, reason }` — never throws — when there is no
 * connection or the schema file is missing, so integration tests SKIP cleanly
 * rather than failing on machines without a database.
 */
export async function setupTestDb() {
  const config = loadPgConfig();
  if (!config.configured) {
    return {
      available: false,
      reason: `PG_* not set (missing ${config.missing.join(', ')}); skipping integration tests`,
    };
  }

  const sqlPath = process.env.CREATE_SQL_PATH || DEFAULT_SQL_PATH;
  if (!existsSync(sqlPath)) {
    return { available: false, reason: `create_new.sql not found at ${sqlPath}; set CREATE_SQL_PATH` };
  }

  const ssl = sslFrom(config);
  const adminCfg = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl,
  };

  const admin = new Client(adminCfg);
  try {
    await admin.connect();
  } catch (err) {
    return { available: false, reason: `cannot reach PostgreSQL: ${err.message}; skipping` };
  }

  const dbName = `pbdb2_test_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  async function dropDatabase() {
    const dropper = new Client(adminCfg);
    await dropper.connect();
    // Drop fails if any session is still attached; close stragglers first.
    await dropper.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await dropper.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await dropper.end();
  }

  // From here on the database exists, so any failure must drop it rather than
  // leak an orphan (e.g. a broken create_new.sql failing to load).
  const pool = new Pool({ ...adminCfg, database: dbName });
  try {
    await pool.query(readFileSync(sqlPath, 'utf8'));
  } catch (err) {
    await pool.end().catch(() => {});
    await dropDatabase().catch(() => {});
    return { available: false, reason: `failed to load ${sqlPath}: ${err.message}; skipping` };
  }

  async function teardown() {
    await pool.end();
    await dropDatabase();
  }

  return { available: true, pool, dbName, teardown };
}

// Monotonic-counter state for newPermid(). The counter occupies the 12 bits of
// rand_a (byte 6's low nibble plus byte 7), so it holds 4096 mints per ms.
let lastMs = 0n;
let seq = 0;
const MAX_SEQ = 0xfff;

/**
 * Mint a UUIDv7 for use as a `permid`.
 *
 * Every versioned table declares
 * `permid uuid NOT NULL CHECK ((get_byte(uuid_send(permid), 6) >> 4) = 7)` —
 * the high nibble of byte 6 is the UUID version, so the column accepts v7 and
 * nothing else. `crypto.randomUUID()` emits v4 and is rejected, and there is no
 * `uuidv7()` to call in the database either: it arrives in PostgreSQL 18 and
 * `create_new.sql` defines no helper of its own. The schema's own comment on the
 * taxa/opinions tables settles the question — permids are "APP-MINTED uuidv7" —
 * so minting is the application's job, and the fixtures do it here.
 *
 * Layout per RFC 9562: 48-bit big-endian Unix timestamp in milliseconds, then
 * the version nibble, then random bits with the variant nibble pinned.
 *
 * Values are strictly increasing, including within a single millisecond, so
 * `ORDER BY permid` over minted fixtures is insertion order. That keeps any
 * assertion about permid ordering deterministic rather than dependent on which
 * random tail happened to sort first.
 */
export function newPermid() {
  const bytes = randomBytes(16);

  const now = BigInt(Date.now());
  if (now > lastMs) {
    lastMs = now;
    seq = 0;
  } else if (seq < MAX_SEQ) {
    // Same millisecond (or a clock that went backwards): keep advancing the
    // counter so successive permids still sort in mint order.
    seq += 1;
  } else {
    // Counter exhausted for this millisecond. Borrow from the next one rather
    // than let the counter wrap and silently break monotonicity.
    lastMs += 1n;
    seq = 0;
  }
  const ms = lastMs;

  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }

  // Byte 6 high nibble = version 7; its low nibble plus byte 7 carry the
  // monotonic counter, so intra-millisecond mints stay ordered.
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  bytes[7] = seq & 0xff;
  // Byte 8 high bits = variant 0b10.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * Bootstrap a person row. `persons.authorizer_person_id` is NOT NULL and
 * self-referential, so the very first person authorizes itself (explicit id,
 * the column is GENERATED BY DEFAULT so this is allowed). Resource rows below
 * reference this person as both enterer and authorizer.
 *
 * @returns {Promise<number>} the person id
 */
export async function seedPerson(pool) {
  const { rows } = await pool.query(
    `INSERT INTO persons (id, role_id, person, authorizer_person_id)
     VALUES (1, (SELECT id FROM dictionaries.roles WHERE role = 'Superadmin'),
             '{"name":"Seed Admin"}'::jsonb, 1)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
  );
  return rows.length ? rows[0].id : 1;
}

/**
 * Insert a reference row, returning its serial id. Pass `permid` to extend an
 * existing lineage (the triggers handle succession); omit `removed` for a live
 * row.
 */
export async function insertRef(pool, { permid, personId, reference = {}, removed = null }) {
  const { rows } = await pool.query(
    `INSERT INTO refs (permid, authorizer_person_id, enterer_person_id, reference, removed)
     VALUES ($1, $2, $2, $3::jsonb, $4)
     RETURNING id, permid`,
    [permid, personId, JSON.stringify(reference), removed],
  );
  return rows[0];
}

/**
 * Insert an authority row, returning its serial id. `reference_id` is the
 * single (primary) reference FK; pass `permid` to extend a lineage.
 */
export async function insertAuthority(
  pool,
  { permid, personId, authority = {}, referenceId, removed = null },
) {
  const { rows } = await pool.query(
    `INSERT INTO authorities (permid, authorizer_person_id, enterer_person_id, authority, reference_id, removed)
     VALUES ($1, $2, $2, $3::jsonb, $4, $5)
     RETURNING id, permid`,
    [permid, personId, JSON.stringify(authority), referenceId, removed],
  );
  return rows[0];
}

/**
 * Insert a collection row, returning its serial id. `reference_id` is the
 * primary reference; pass `permid` to extend a lineage.
 *
 * No age FKs: `collections.early_age_id` / `late_age_id` are commented out in the
 * current backend schema, so fixtures no longer seed an anchor `intervals` row.
 */
export async function insertCollection(
  pool,
  { permid, personId, collection = {}, referenceId, removed = null },
) {
  const { rows } = await pool.query(
    `INSERT INTO collections
       (permid, authorizer_person_id, enterer_person_id, collection, reference_id, removed)
     VALUES ($1, $2, $2, $3::jsonb, $4, $5)
     RETURNING id, permid`,
    [permid, personId, JSON.stringify(collection), referenceId, removed],
  );
  return rows[0];
}

/**
 * Insert a schema row, returning its serial id. `reference_id` is the primary
 * reference; pass `permid` to extend a lineage.
 */
export async function insertSchema(
  pool,
  { permid, personId, schema = {}, referenceId, removed = null },
) {
  const { rows } = await pool.query(
    `INSERT INTO schemas (permid, authorizer_person_id, enterer_person_id, schema, reference_id, removed)
     VALUES ($1, $2, $2, $3::jsonb, $4, $5)
     RETURNING id, permid`,
    [permid, personId, JSON.stringify(schema), referenceId, removed],
  );
  return rows[0];
}

/**
 * Link an additional (secondary) reference to a collection via the
 * `additional_collection_refs` join table.
 */
export async function insertAdditionalCollectionRef(pool, { collectionId, referenceId, personId }) {
  const { rows } = await pool.query(
    `INSERT INTO additional_collection_refs (authorizer_person_id, enterer_person_id, collection_id, reference_id)
     VALUES ($1, $1, $2, $3)
     RETURNING id`,
    [personId, collectionId, referenceId],
  );
  return rows[0];
}

/**
 * Link an additional (secondary) reference to a schema via the
 * `additional_schema_refs` join table.
 */
export async function insertAdditionalSchemaRef(pool, { schemaId, referenceId, personId }) {
  const { rows } = await pool.query(
    `INSERT INTO additional_schema_refs (authorizer_person_id, enterer_person_id, schema_id, reference_id)
     VALUES ($1, $1, $2, $3)
     RETURNING id`,
    [personId, schemaId, referenceId],
  );
  return rows[0];
}

/**
 * Insert a `taxa` row, returning its permid.
 *
 * Rows are inserted DIRECTLY rather than by seeding opinions and calling
 * `rebuild_taxa()`. Populating the table is the backend's job and is tested
 * there; what this repo's integration tests must prove is that the read path
 * works against the REAL schema — the actual columns, the `dictionaries`-schema
 * joins, and the ltree round-trip. A direct insert exercises all of that while
 * keeping the fixture tree small enough to assert against exactly.
 *
 * `classification_path` is built from concept permids, root-first, with hyphens
 * replaced by underscores (ltree labels cannot contain `-`). Note it ends at the
 * row's own CONCEPT, which for a synonym is a different row's permid — that
 * asymmetry is the whole point of the decoder.
 *
 * @param {object} args
 * @param {string} args.permid
 * @param {string} args.name
 * @param {string} args.rank              a `dictionaries.taxonomy_ranks` value
 * @param {string[]} args.conceptPath     concept permids, root-first, INCLUDING own concept
 * @param {string} [args.conceptPermid]   defaults to `permid` (an accepted name)
 * @param {string} [args.containing]      containing concept permid; omit for a root
 * @param {number} [args.authorityId]
 * @param {string} [args.nomenclaturalStatus]  a `dictionaries.nomenclatural_statuses` value
 */
export async function insertTaxon(
  pool,
  { permid, name, rank, conceptPath, conceptPermid, containing, authorityId, nomenclaturalStatus },
) {
  const ltree = conceptPath.map((p) => p.replaceAll('-', '_')).join('.');
  const concept = conceptPermid ?? permid;

  const { rows } = await pool.query(
    `INSERT INTO taxa
       (permid, name, rank_id, authority_id, original_permid, accepted_spelling_permid,
        concept_permid, containing_concept_permid, classification_path, nomenclatural_status_id)
     VALUES ($1, $2,
             (SELECT id FROM dictionaries.taxonomy_ranks WHERE taxonomy_rank = $3),
             $4, $1, $1, $5, $6, $7::ltree,
             (SELECT id FROM dictionaries.nomenclatural_statuses WHERE status = $8))
     RETURNING permid`,
    [permid, name, rank, authorityId ?? null, concept, containing ?? null, ltree,
     nomenclaturalStatus ?? null],
  );
  return rows[0].permid;
}
