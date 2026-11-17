## Why

`GET /api/v1/references` can be filtered on the fields every publication type carries
(`add-reference-shared-filters`), but not on the fields only some types carry. Finding the
articles in a journal, the volumes of a series or the books from a publisher still needs a
client-side scan.

## What Changes

- Six new list filters on `references`, on fields that only some publication types allow:
  - `journalTitle` and `seriesTitle`: the whole stored value equals the request value, ignoring
    case, accents and runs of whitespace (a new match kind, `foldedEq`). `journalTitle=Palaeontology`
    finds the journal *Palaeontology*, not *Journal of Systematic Palaeontology*.
  - `bookTitle`, `publisher` and `publicationCity`: every word, in any order, ignoring case and
    accents (the existing `allWords` kind, as `title` uses it).
  - `bookType`: equality (`eq`), with the value opaque. The field is dictionary-backed
    (`x-enumFrom: book_types`), not an inline enum, so an unknown value is an empty 200, as for any
    field without an inline enum.
- A filter matches the field wherever it is stored, on any publication type. It does not add a
  `publicationType` condition and does not require one. Legacy refs carry fields their type would
  not allow today (1,801 journal articles have a `publisher`), and these are matched.
- Each parameter's description names the publication types that allow its field, derived from
  `PUBLICATION_TYPES` in `payloadSchemas/reference.schema.js`, so the documentation cannot drift
  from the schema.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `resource-routes`: the `references` field filters gain `journalTitle`, `seriesTitle`,
  `bookTitle`, `publisher`, `publicationCity` and `bookType`, with their match rules.
- `api-description`: each new parameter's description states its match rule and the publication
  types that allow its field.

## Impact

- `api/src/lib/field-filter-ops.js` (the `foldedEq` kind), `api/src/lib/resource-tables.js` (six
  filters), `api/src/lib/query-schemas.js` (the per-filter type note in the description).
- No DDL change: `unaccent` is already installed (`db/02-core.sql`, localhost `pbdb`, Aurora).
- Tests: unit tests for the new kind and the descriptions; integration tests for the match rules.
- No data is written. As with the shared filters, the risk is a silently wrong match, which the
  integration tests exist to catch. No new indexes: each filter scans current heads.
