## Context

A field filter today is `{ jsonPath, op: 'eq' }` in the resource descriptor. Three stages read it:

```
query-schemas.js               list-filters.js              repository.readHeads
listQuerySchema(): param  →    collectListFilters():   →    payload->>'<jsonPath>' = $n
{ type: string, minLength,     copies the raw value         AND HEAD_FILTER … ORDER BY permid
  enum? }  → 400s
```

The five new `references` filters each match differently. The decisions below come from an
explore session on 2026-10-23 and from measurements on localhost `pbdb` (96,122 current refs):

| fact | count |
|---|---|
| refs with a `doi` | 46,906 |
| … as an `https://doi.org/` or `http://dx.doi.org/` URL | 77 |
| … with a `doi:` prefix | 14 |
| … that are not DOIs (handle/jstor URLs, `ISSN …`, `June 2007`) | ~140 |
| most refs sharing one DOI | 14 |
| `publicationYear` not four digits | 2 (`"210"`, `"79"`) |
| refs with no `title` | 530 |
| titles containing HTML tags (`<i>…</i>`) | 140 |
| author `familyName`s with non-ASCII characters | 12,173 |

## Goals / Non-Goals

**Goals:**
- `doi`, `title`, `authors`, `firstAuthor` and `publicationYear` filters on `GET /api/v1/references`,
  composing with each other, with `publicationType` and with `ids` as filters do now.
- Adding a match kind means adding one entry, not a new branch in each stage.

**Non-Goals:**
- `enteredBy` (parked: see D8).
- Cleaning stored DOIs in the migration (pending a question to the team).
- Indexes. A filtered list scans current heads: 85 ms for a title `ILIKE`, 96 ms for an author
  `EXISTS` on localhost. That is acceptable at 96k rows.
- Relevance ranking or full-text search. Lists stay in `permid` order, which the cursor needs.
- Filters on fields specific to one publication type (`journalTitle`, …).

## Decisions

### D1. Named match kinds, each defined once

`op` names a match kind. A new module, `lib/field-filter-ops.js`, holds one entry per kind with
the three parts every stage needs:

```
FIELD_FILTER_OPS = {
  eq:              { schema, describe(jsonPath), parse(value), predicate(payload, jsonPath, bind) },
  doi:             { … },
  allWords:        { … },
  familyNames:     { … },
  firstFamilyName: { … },
  yearRange:       { … },
}
```

- `schema`: the parameter's JSON Schema beyond `{ type: 'string', minLength: 1 }`, for example the
  year pattern. `listQuerySchema` merges it in; `eq` still adds the source's inline `enum`.
- `describe(jsonPath)`: the parameter's description in the API document.
- `parse(value)`: turns the validated string into what the predicate binds. It throws
  `httpErrors.badRequest` for what the schema cannot express. `collectListFilters` calls it, so
  a malformed value is still rejected before any query.
- `predicate(payload, jsonPath, bind)`: returns the SQL fragment. `bind(value)` pushes a
  parameter and returns its `$n`, so values are always bound. `jsonPath` comes from the trusted
  descriptor and is quoted with `literal()`, as now.

The references descriptor becomes:

```js
filters: {
  publicationType: { jsonPath: 'publicationType', op: 'eq' },
  doi:             { jsonPath: 'doi', op: 'doi' },
  title:           { jsonPath: 'title', op: 'allWords' },
  authors:         { jsonPath: 'authors', op: 'familyNames' },
  firstAuthor:     { jsonPath: 'authors', op: 'firstFamilyName' },
  publicationYear: { jsonPath: 'publicationYear', op: 'yearRange' },
}
```

*Alternative:* a `switch (def.op)` in each of the three stages. That spreads one kind over three
files, so its parsing and its SQL can drift apart. The seam was designed so that a new filter is
one contributor. The repository still owns where the SQL runs: it calls `predicate` and composes
the result. An unknown `op` throws when the repository is built, not on a request.

### D2. `doi`: normalize both sides, compare equal

`parse`: trim, remove a leading `https?://(dx\.)?doi\.org/` or `doi:` (case-insensitive, with any
whitespace after it), then lowercase. If nothing is left, the value is a 400.

Predicate: `lower(regexp_replace(payload->>'doi', '^(https?://(dx\.)?doi\.org/|doi:)\s*', '', 'i')) = $n`.

Both sides use the same pattern, defined once in the module as a source string that both the JS
`RegExp` and the SQL literal use. DOIs are case-insensitive by definition. A stored value that is
not a DOI simply never matches a DOI-shaped request; it is not an error. The query keeps
tolerating prefixes even if the migration later normalizes them; it costs nothing.

### D3. `title`: all words, any order, case- and accent-insensitive

`parse`: split on whitespace, drop empty items, and de-duplicate. The predicate escapes `\`, `%`
and `_` in each word for `LIKE` as it binds it, so parsed words stay as the client wrote them.

Predicate: one `unaccent(payload->>'title') ILIKE '%' || unaccent($n) || '%'` per word, joined
with `AND`. If a ref has no `title`, the comparison is `NULL` and the ref never matches.

All-words matching (not a phrase) also covers the 140 titles with HTML: in
`<i>Tyrannosaurus</i> <i>rex</i>`, `Tyrannosaurus rex` matches as two words even though the phrase
would not. Matching is on substrings, so `saur` matches `Dinosaurs`. That is what "contains"
means, and it suits partial words. Accent-insensitivity was asked for authors; it is applied to
titles too, so one rule covers both text filters (`Pliocène` and `Pliocene` match each other).

### D4. `authors`: every named family name is present

`parse`: split on commas, trim each item, de-duplicate. An empty item (`Sues,`, `,Reisz`) is a 400.

Predicate, per name:

```sql
EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'authors') a
        WHERE lower(unaccent(a->>'familyName')) = lower(unaccent($n)))
```

The names are joined with `AND`, so `authors=Sues,Reisz` returns refs on which both appear, in
any position. If `authors` is absent, `jsonb_array_elements(NULL)` yields no rows and the ref does
not match. The db variant guarantees that `authors` is an array whenever it is present.

The comparison is exact on the whole family name, so `Fuente` does not find `de la Fuente`.
Prefix or particle-aware matching can come later. Exact is the start that was agreed. Commas
cannot occur inside a family name, so splitting on them is safe. A name with a comma ("Farrand,
Jr.") is not stored that way; the data has `Farrand Jr.`.

### D5. `firstAuthor`: one name, against `authors[0]`

`parse`: trim. This parameter takes one name; a comma is a 400 that says only one family name is
allowed. The predicate is
`lower(unaccent(payload->'authors'->0->>'familyName')) = lower(unaccent($n))`. It composes with
`authors`, so `firstAuthor=Sues&authors=Reisz` means Sues first, with Reisz somewhere on the ref.

`firstAuthor` is not the name of a payload field. The field-filter requirement says a parameter
is named after the field it matches, so that parameters and response fields share one camelCase
vocabulary. The requirement is relaxed (see the resource-routes delta): a parameter may name part
of a field, in the same camelCase vocabulary. `authors` stays named after its field.

### D6. `publicationYear`: `YYYY` or `YYYY-YYYY`, inclusive

The schema pattern is `^\d{4}(-\d{4})?$`. Anything else is a 400 through the formatter's
`pattern` path, with a hand-written message: `` `publicationYear` must be a year (YYYY) or a range
(YYYY-YYYY) ``.

`parse` returns `{ from, to }`. A single year has `from = to`. `from > to` is a 400 in `parse`,
because JSON Schema cannot compare two parts of one string: `` `publicationYear` range 2000-1990 is
reversed; write the earlier year first ``. A range with equal ends (`1990-1990`) is legal.

Predicate:

```sql
(CASE WHEN payload->>'publicationYear' ~ '^\d{4}$'
      THEN (payload->>'publicationYear')::int END) BETWEEN $a AND $b
```

The `CASE` guards the cast. PostgreSQL does not promise to evaluate the parts of an `AND` in
order, so `x ~ … AND x::int …` could cast a value like `n.d.` and fail. The db variant allows any
string of up to 4 characters. A stored year that is not four digits gives `NULL` and never
matches, which is right for `"210"` and `"79"`. A single year is the same range with
`from = to`, so there is one code path. Comparing strings would be wrong: `'79' > '2000'`.

### D7. `unaccent` in `db/02-core.sql`

Add `CREATE EXTENSION IF NOT EXISTS unaccent;` next to `postgis`, with a comment naming its user
(the API's text filters). The ddl-layout requirement lists the extensions each file holds, so its
delta adds `unaccent` to `02-core.sql`. The integration suite builds its database from `db/`, so
it picks up the extension.

Localhost `pbdb` and Aurora `pbdb2_migration_test` are not rebuilt. The extension is created on
each by hand (one statement, no data change). Both have `unaccent` 1.1 available but not
installed (checked 2026-10-23; Aurora is reachable only while the VM is on the VPN).

`unaccent(text)` is `STABLE`, not `IMMUTABLE`. That matters only for an expression index, and
this change adds none.

### D8. `enteredBy` is parked

It goes into `docs/api-design-backlog.md` under "Fields the server supplies", where "whether
provenance is ever shown in a response" is already open. A filter on the enterer would expose
provenance, because it lists every reference a person entered. There are four obstacles:
1. Provenance is not exposed today.
2. There is no `/persons` read, so a client cannot learn a person's permid.
3. Names are ambiguous (14 persons are named Smith; Nathan Jud has two records on purpose).
4. On a head row, `enterer_person_id` is whoever made the latest edit, not the original enterer.

If the filter takes either a permid or a name in one parameter, telling them apart by the value's
shape depends on the permid format (UUIDs today; prefixed sequences are being considered). Two
parameters avoid that.

### D9. Descriptions

The description of each parameter states its rule:

| param | description |
|---|---|
| `publicationType` | Only items whose `publicationType` equals this value. (unchanged) |
| `doi` | Only items whose `doi` equals this DOI, ignoring case and a leading `https://doi.org/` or `doi:`. |
| `title` | Only items whose `title` contains every word of this value, in any order, ignoring case and accents. |
| `authors` | Only items with an author of each of these comma-separated family names, ignoring case and accents. |
| `firstAuthor` | Only items whose first author has this family name, ignoring case and accents. |
| `publicationYear` | Only items published in this year (`YYYY`) or range (`YYYY-YYYY`, both years included, earlier first). |

## Risks / Trade-offs

- **Wrong matches are silent.** A ref missing from a result or wrongly included shows no error.
  → The match rules are tested end to end against a real database (accents, case, DOI prefixes,
  range ends, absent fields, a non-four-digit year). The fake-`pg` unit tests cannot evaluate them.
- **Scan cost grows with the table.** A rare match scans every head before it fills a page. →
  Accepted at 96k rows. The predicates are plain enough to index later (trigram for `title`, GIN
  or an `unaccent` expression for authors) without an API change.
- **`unaccent` is available but not yet installed on Aurora.** → A missing extension makes the query fail
  (`function unaccent does not exist`). It does not give wrong results. Creating the extension
  is an apply task, and it is checked before reads are pointed there.
- **Substring title matching is generous** (`saur` matches widely). → Accepted; it is what
  "contains" means. Narrower matching would be a different kind, added later.
- **Exact family names miss particles** (`Fuente` does not find `de la Fuente`). → Accepted as
  the agreed start; prefix matching is an obvious follow-up kind.

## Migration Plan

1. `db/02-core.sql` gains the extension. The integration database picks it up.
2. Run `CREATE EXTENSION IF NOT EXISTS unaccent;` on localhost `pbdb` and on Aurora
   `pbdb2_migration_test`.
3. Deploy the API. Rolling back the API needs no database change. The extension is harmless
   and can stay.

## Open Questions

- Should the migration normalize stored DOIs (remove the 91 prefixes; decide what to do with the
  ~140 non-DOI values)? This is a question for the team, outside this change.
