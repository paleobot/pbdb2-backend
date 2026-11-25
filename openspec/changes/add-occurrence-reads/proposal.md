## Why

Occurrences are the database's main data: 2,010,858 records of a fossil found in a collection and
identified as a taxon. Most questions people bring to PBDB ("where and when is this taxon found",
"what was found here") are answered from occurrences. The migration has loaded them
(`create-occurrences-migration`, archived 2026-11-25): the `identifications` ledger, the
`occurrence_abundances` table and the derived `occurrences` cache are populated on localhost and
Aurora. The API serves references, authorities, collections, schemas and taxa, but nothing that
connects a taxon to a collection.

Occurrences combine two shapes the API already reads separately. Like `taxa`, the `occurrences`
table is a derived cache of typed columns with no version chain and no write path. Its content
comes from a version-chained ledger (`identifications`), and an occurrence's permid is its root
identification's permid. So this change has to decide which of the three tables the API exposes, and
how an occurrence shows the identification that currently names it.

## What Changes

- **Add the `occurrences` route group**: `GET /occurrences` and `GET /occurrences/{permid}`, read-only
  (write verbs answer 405, as on `taxa`), read from the `occurrences` cache.
- **Add a nested, read-only identifications route**: `GET /occurrences/{permid}/identifications`
  (every current identification of the occurrence) and
  `GET /occurrences/{permid}/identifications/{permid}` (one identification's full record). There is
  no top-level `/identifications`. Every identification permid is an `OCC` permid, and a root
  identification's permid is also its occurrence's, so a top-level route would answer two resources
  for one permid (cf. the `TXN` overlap in `docs/api-design-backlog.md`). Nesting keeps each
  identification under the occurrence it identifies.
- **The occurrence representation** carries:
  - `collection` and `reference` links. `reference` is the **root's**, i.e. the publication the
    occurrence was first recorded from, as the cache stores it.
  - An embedded **`identification`**: the winning identification, with its rank names directly in
    the object (genus, subgenus, species, subspecies, each with a resolution), a formatted `name`, its
    `taxon` link, its **own `reference`** (which differs from the occurrence's on 32,208
    occurrences), its `permid` and an `href` to its full record. It leaves out the winner's
    `plantOrgans`, `comments` and `legacyIDs`, which are on the full record.
  - **`acceptedTaxon`**, at the top level: the accepted concept of the identified taxon. It differs
    from the identified taxon on 425,229 occurrences.
  - `plantOrgans` (as the cache derives them), the embedded `abundance` when there is one, and
    `legacyIDs.oldpbdbID`.
- **Filters:**
  - `collection=<permid>`: the occurrences in one collection.
  - `taxon=<permid>`: the occurrences identified as exactly that taxon.
  - A subtree filter (working name `withinTaxon=<permid>`): occurrences identified as the taxon or
    anything within it, synonyms included. A synonym's permid resolves to its accepted concept.

  These are the API's first filters on link columns rather than on payload fields.
- **CSV** on the occurrence list and `ids` reads.
- **New link targets** for the occurrence's links, starting with `collections`.

### Deliberately not included

- **No writes.** Creating an occurrence, adding a reidentification and editing an abundance are
  the future write path. B's nesting is chosen partly so they have obvious homes.
- **No top-level `identifications` or `abundances` resources.**
- **No name, reference, interval or geography filters.** A name filter is what would reach the
  51,317 occurrences with no `taxon_permid`. Interval and geography filters wait on the collection
  age and geography redesign.
- **No person links** (enterer, authorizer), as on every other resource.
- **No change to the cache.** The winner's reference is read through `winning_identification_id`,
  not copied into `occurrences` (measured: no cost on a page, +0.6 s on a 2-million-row read).
  Whether the cache should keep its copy of the winner's name block is a question for Andrew, in
  the backlog.
- **No change to how the winner is chosen.** The root-competes question with Andrew lives in
  `derive_occurrences()`; the API shows whatever the cache holds.

## Capabilities

### New Capabilities

- `occurrence-reads`: the occurrence resource contract. It covers the representation (root vs.
  winner reference, the embedded identification, accepted taxon, abundance, plant organs), the
  nested identifications routes and the identification's full record, the `collection`, `taxon`
  and subtree filters and their semantics (exact vs. subtree, synonym resolution), read-only
  verbs, and pagination.

### Modified Capabilities

- `resource-routes`: `occurrences` joins the route groups as the second read-only group; a route
  group may have a nested read-only sub-resource; a resource may declare link filters, which strict
  query-param handling then recognizes alongside field filters and expansions.
- `reference-enrichment`: `collections` joins the link-target registry, along with whatever the
  occurrence's links need beyond the current descriptor form (a link reached through another table,
  such as the winner's reference and the accepted taxon).
- `csv-output`: occurrences join the reads that offer CSV.
- `api-discovery`: the version root lists `occurrences`.
- `api-description`: the read-only `occurrences` group's 405 write routes are hidden, as `taxa`'s
  are.
- `payload-schema-variants`:
  - a read-only occurrence source (as for the taxon source);
  - a `taxonPermid` codec;
  - the codec context reads a link label from a plain column, not only from a JSONB key.
- `identification-schema`: the identification source gains `taxon` and `reference` link properties
  (column-backed, so its `db` variant is unchanged).
- `repository-layout`: `occurrence-reads` joins the list of API specs. (`api-description` is also
  missing from that list and is added at the same time.)

## Impact

- **Code (`api/`):** a new route group `src/routes/api/v1/occurrences/` with its nested
  identifications routes; a read repository for occurrences and identifications (bespoke or a
  generalization of `taxa-repository.js`, decided in design.md); `src/lib/resource-tables.js`
  (descriptor, link targets, link filters); `src/lib/query-schemas.js` and `list-filters.js` (link
  filter parameters); `src/lib/published-schemas.js` (occurrence and identification components).
- **Code (`payloadSchemas/`):** a new read-only `occurrence.schema.js`; link properties on
  `identification.schema.js`; a `taxonPermid` codec and plain-column labels in `lib/codecs.js` and
  `lib/storage.js`. The migration uses only the `db` variant, which is unchanged.
- **Code (`migrations/`):** the payload audit's identification entry selects `taxon_permid` and
  `reference_id`, so `--round-trip` keeps reproducing identifications now that their source has link
  properties.
- **Database:** none planned. The subtree filter has to work without a GiST index on
  `taxa.classification_path` (impossible at these path lengths, `db/03-taxa.sql`); measurements so
  far put a page under 0.4 s with a walk of `containing_concept_permid`.
- **API:** additive. No existing response changes.
- **Data integrity:** reads only, nothing is written. The risks are misrepresentation:
  - Showing the winner's reference as the occurrence's would misstate the occurrence's
    provenance on 32,208 occurrences. This is why both are shown and named apart.
  - 547 occurrences have a `taxon_permid` with no `taxa` row. Their taxon link must not vanish or
    claim a taxon that does not exist.
  - The cache is current only as of the last `rebuild_occurrences()`. With no write path that is
    the migration's last run.
- **Upstream:** the occurrences migration (done). **Downstream:** the occurrence write path, a
  name filter, and a `collection` → `occurrences` reverse link.
