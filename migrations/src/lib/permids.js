// Permids come from the database (openspec/specs/prefixed-permids): the SQL
// functions in db/02-core.sql are the only implementation of the format and
// check digits, and they register each permid in `permids`, which every permid
// column references. Call once per batch, never per row, and pass the script's
// transaction client where it has one, so the registry rows commit or roll back
// with the rows that use them.

// Classic numbers → permids, in input order (e.g. reference_no 12345 → 'REF-12345-15').
// Fails, registering nothing, on a number already registered under the prefix.
export async function registerPermids(db, prefix, numbers) {
  if (numbers.length === 0) return [];
  const { rows } = await db.query('SELECT register_permids($1, $2::bigint[]) AS permids', [prefix, numbers]);
  return rows[0].permids;
}

// n new permids from the prefix's sequence, in increasing order.
export async function mintPermids(db, prefix, n) {
  if (n === 0) return [];
  const { rows } = await db.query('SELECT mint_permids($1, $2) AS permids', [prefix, n]);
  return rows[0].permids;
}
