## Why

`GET /api/v1/references` can be narrowed only by `publicationType`. Finding a reference
needs at least its DOI, a title, its authors or its year, and these fields are shared by every
publication type. Each needs its own match: an exact `eq` on a top-level payload key, which is
all the filter seam does today, fits none of them.

## What Changes

- Five new list filters on `references`, all on fields every publication type carries:
  - `doi`: the request value and the stored value are both normalized (a leading
    `https://doi.org/`, `http://dx.doi.org/` or `doi:` is removed, then lowercased) and compared
    for equality. A DOI is not unique, so this is a list filter (one DOI is on 14 refs).
  - `title`: every whitespace-separated word must occur in the title, in any order, ignoring
    case and accents.
  - `authors`: a comma-separated list of family names; a reference matches when, for each
    name, some author's `familyName` equals it, ignoring case and accents (all names must be
    present).
  - `firstAuthor`: one family name, matched the same way against the first author only.
  - `publicationYear`: `YYYY` (that year) or `YYYY-YYYY` (inclusive range). A reversed range,
    or any other form, is a 400. A stored year that is not four digits never matches.
- The descriptor's field filter grows from one match kind (`eq`) to a small set of named match
  kinds, each with its own query-parameter schema, description, value parsing and SQL predicate.
- The `firstAuthor` parameter is the first filter not named after a payload field; the
  field-filter requirement is relaxed to allow a parameter named for a part of one.
- The `unaccent` extension is installed by `db/02-core.sql`.
- `enteredBy` is not built. It is recorded in `docs/api-design-backlog.md`, behind the open
  question of whether provenance is ever shown in a response.
- Stored DOIs are not cleaned up (91 carry a URL or `doi:` prefix, about 140 are not DOIs). The
  filter tolerates the prefixes; whether the migration should normalize them is a question for
  the team.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `resource-routes`: the per-entity field-filter requirement gains the `references` filters
  `doi`, `title`, `authors`, `firstAuthor` and `publicationYear`, with their match rules and
  400s, and allows a parameter named for part of a payload field.
- `api-description`: the references operation lists the new filters; each filter's description
  states its match rule, including the rules enforced in code (the year range's order).
- `ddl-layout`: `02-core.sql` also holds the `unaccent` extension.

## Impact

- `api/src/lib/resource-tables.js` (references filters), `api/src/lib/query-schemas.js`
  (per-kind schema and description), `api/src/lib/list-filters.js` (per-kind value parsing),
  `api/src/lib/repository.js` (per-kind predicate), with a new module for the match kinds.
- `db/02-core.sql`: `CREATE EXTENSION IF NOT EXISTS unaccent`. Localhost `pbdb` and Aurora need
  the extension created by hand (no rebuild). Both have it available, not installed.
- Tests: unit tests for parsing, schemas and SQL shape; integration tests for the match
  semantics (accents, case, prefixes, ranges), which a fake `pg` cannot evaluate.
- No data is written or changed. Every filter is a read predicate over current heads, so there
  is no data-integrity risk. The risk is a wrong match: a reference silently missing from, or
  wrongly included in, a result. The integration tests exist to catch that.
- Performance: no new indexes. Each filter scans the current heads (about 40–100 ms on 96,122
  refs on localhost). Trigram or GIN indexes can follow when needed.
