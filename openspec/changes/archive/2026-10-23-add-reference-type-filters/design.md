## Context

`add-reference-shared-filters` made a descriptor filter `{ jsonPath, op }`, where `op` names a
match kind in `api/src/lib/field-filter-ops.js` (schema, description, parsing and predicate
together). This change adds filters on the fields that only some publication types allow. The
decisions come from an explore session on 2026-10-23 and from measurements on localhost `pbdb`
(96,122 current refs):

```
                              n      journalTitle bookType publisher city  bookTitle seriesTitle
journal article          80,393        80,055       ·       1,801    652      ·          ·
edited collection         3,711           ·         ·         333    304      ·          ·
serial monograph          3,564           ·         ·         376    246      ·        3,508
other                     3,117           ·         ·         232    242      ·          ·
article in edited coll.   2,589           ·         ·       2,063  1,710   2,573         ·
standalone book           2,471           ·       2,471     1,432  1,270      ·          ·
unpublished                 277           ·         ·           ·      ·      ·          ·
```

| fact | count |
|---|---|
| distinct `journalTitle`s | 12,992 (12,396 ignoring case) |
| `journalTitle`s containing the word "Palaeontology" | 3,000+ refs in 15+ journals; the journal *Palaeontology* itself has 1,457 |
| `journalTitle`s / `seriesTitle`s with a run of whitespace | 58 / 10 |
| … with leading or trailing whitespace, or HTML | 0 |
| `publicationCity` spellings of Washington | 7+ (`Washington, D.C.`, `Washington DC`, `Washington, D. C.`, …) |
| distinct `bookType`s | 6, all from `dictionaries.book_types`, all on standalone books |

## Goals / Non-Goals

**Goals:**
- `journalTitle`, `seriesTitle`, `bookTitle`, `publisher`, `publicationCity` and `bookType` on
  `GET /api/v1/references`, composing with every other filter.
- Descriptions that say which publication types allow each field.

**Non-Goals:**
- Making a filter depend on `publicationType` in behaviour (D1).
- `journalVolume`, `journalNumber`, `seriesVolume`, `editors`, `description`, `language`:
  not requested.
- Indexes, as for the shared filters.

## Decisions

### D1. Filters match the field on any type; only the description names the types

A type-specific filter is a plain field filter. `publisher=Elsevier` matches every ref whose
`publisher` matches, including the legacy journal articles that carry one. The filter adds no
`publicationType` condition and requires none. A client that wants one type adds
`publicationType`, and a contradiction (`publicationType=journal article&bookType=monograph`) is
an empty 200, as any two filters that match nothing together are.

*Alternatives considered:*
- **The field implies its types** (add `publicationType IN (…)`). This hides the legacy
  cross-type values. The response would then disagree with the stored data, and nothing tells
  the client that the filter dropped them.
- **The type is required** (400 without a `publicationType` that allows the field).
  `publicationType` takes one value, while `publisher` is allowed on four types (plus `other`).
  A client could not ask for "publisher X on any book-like type".

### D2. The type note is derived from `PUBLICATION_TYPES`

Each description ends with the types that allow the field, for example *"Allowed on standalone
book, edited collection, article in edited collection, serial monograph and other."* A type
allows a field when its `fields` list names it or it is `unrestricted` (`other`). The list is
computed from `PUBLICATION_TYPES`, not written by hand, so a schema change updates the document.
The wording "allowed on" describes what a create body may carry. Stored legacy refs can carry
the field elsewhere (D1).

The note is an optional `note` string on the descriptor filter. `resource-tables.js` fills it with
a small helper over `PUBLICATION_TYPES` (`allowedOn('publisher')`), and `query-schemas.js`
appends it to `kind.describe(jsonPath)`. This keeps `field-filter-ops.js` generic: a kind does
not know about publication types. The shared-field filters carry no note.

### D3. `foldedEq` for `journalTitle` and `seriesTitle`

A new kind. The whole value must equal the request value, ignoring case, accents and runs of
whitespace:

```sql
lower(unaccent(regexp_replace(payload->>key, '\s+', ' ', 'g')))
  = lower(unaccent(regexp_replace($n, '\s+', ' ', 'g')))
```

`parse` returns the value as is. The request value is already trimmed by `preValidation`, and
no stored title has edge whitespace. Collapsing whitespace on both sides covers the 58 + 10
stored titles with doubled spaces.

`allWords` was rejected for these two fields. People ask for "this journal" or "this series",
and words over-match: `journalTitle=Palaeontology` would return 15+ journals and 3,000+ refs,
with no way to narrow the result to *Palaeontology*. The cost is that variant spellings of one
journal (abbreviations, typos; ~600 case-only variants) are separate values, and a client finds
each one separately.

### D4. `allWords` for `bookTitle`, `publisher`, `publicationCity`

These use the existing kind, unchanged. Publishers and cities are spelled many ways (`Elsevier`
/ `Elsevier BV`; the Washington spellings), and book titles are long. Matching words finds the
variants.

The `bookTitle` description also says that it is the containing book of an *article in edited
collection*. An edited collection's own title is in `title`, so `bookTitle` finds the chapters,
not the volume.

### D5. `bookType` is `eq` with an opaque value

`bookType` is dictionary-backed (`x-enumFrom: book_types`), not an inline enum, so the existing
`eq` adds no `enum` to the parameter. An unknown value is an empty 200, as the strict-query rule
already says for a field with no inline enum. Validating against the dictionary would need a
database read at route build or per request. That is not needed for six values and is not built
now.

## Risks / Trade-offs

- **Variant journal spellings split one journal's refs** (D3). → Accepted. The cleanup belongs to
  data curation, not the filter. A words-based parameter can be added later if asked for.
- **Legacy cross-type fields appear in results** (D1). → Intended: results match what is stored.
- **Wrong matches are silent.** → Integration tests cover case, accents, whitespace runs, the
  `Palaeontology` vs *Journal of … Palaeontology* split, and a legacy journal article with a
  `publisher`.

## Open Questions

None.
