## Context

Every list read goes through `listReadHandler` (`api/src/lib/crud-routes.js`), and every successful body through the `{ data, meta, links }` decorators. Records reach that handler already merged through their payload source and hydrated, or, for `taxa`, built by its own repository in the same record shape. Lists page by keyset on `permid_no`, with a default of 100 and a maximum of 1,000 per page.

Figures below are from localhost `pbdb` (November 2026), current heads only:

| Resource | Rows | Multi-valued fields, largest seen |
|---|---|---|
| references | 96,122 | `authors` 24 (mean 2.22) |
| authorities | 166,992 | `descriptors` 22; `legacyIDs.oldpbdbIDs` 10,944 |
| collections | 279,599 | `lithofacies` 2; `ages.measurements` 3; `context.collectionMethods` 8; `additionalReferences` 466 |
| taxa | 525,805 | none, apart from the optional `containingTaxa` chain |

Classic serves CSV by URL suffix. A live request for `colls/list.csv?base_name=Dinosauria` with no `limit` returned all 14,395 records, chunked. That is the largest case tried, and Classic's docs state no default limit.

## Goals / Non-Goals

**Goals:**

- CSV on the four large lists, selected only by `Accept`.
- A column set that is fixed for each resource and generated from its schema, with one set of flattening rules.
- A request with no `limit` that returns the complete result, without buffering it in memory.

**Non-Goals:**

- A format selector in the URL. If one is requested later, use `?format=csv`: unknown parameters are a 400 today, so the name is free and the addition is compatible. A `.csv` suffix would need an extra route per list.
- RIS for references. D1, D2, D6 and D9 are written so that it can be added without changing them.
- TSV, classification columns, and CSV for single reads. `?ids=<permid>` already gives a one-row CSV.
- CSV for `schemas`, whose value is the character and state tree, and for `specimens`, a stub until it has a real read.
- A UTF-8 byte order mark. It disturbs concatenation and some parsers; the cost is that double-clicking the file in Excel may show accented names wrongly until it is imported as UTF-8.
- Metadata lines above the header, which Classic's `rowcount` adds. The file stays a plain table, and the API computes no totals.

## Decisions

### D1. One function decides the format, and JSON is the default

`negotiate(acceptHeader, formats)` is a small pure function, used by both the 406 hook and the list handler. It returns the media type to serve: the format the request ranks highest when that format's non-zero `q` is strictly greater than any `q` explicitly given to `application/json`, and JSON otherwise. A tie goes to JSON. Wildcards never select a non-JSON format, so browsers and `*/*` clients get JSON.

The API's non-JSON formats are one registry, `text/csv` only for now. RIS (`application/x-research-info-systems`, which Classic serves for references) is the likely second, so nothing here names CSV in particular.

*Alternative:* `@fastify/accepts`. It answers a more general question than this API asks, and costs a dependency for about fifteen lines.

### D2. A route lists its formats, and the 406 is a hook

A route declares the non-JSON formats it offers as `config: { formats: ['text/csv'] }`. The four list routes do so; nothing else declares any. An `onRequest` hook handles `GET` and `HEAD` for every route. It sets `Vary: Accept`, and answers 406 when the request selects a format from the registry that the route does not list. So CSV requested of a single read is a 406, and so would RIS requested of `collections` be.

A media type the API never produces keeps getting JSON, as it does today. Running at `onRequest` means a 406 comes before query validation. Write verbs are outside the hook, because `Accept` says nothing useful about their stubbed bodies.

Answering such a request with JSON would be legal HTTP, but a CSV reader would then parse JSON as a table.

A RIS format would add itself to the registry and to the `references` list and single read. It would bring its own serializer: a hand-written field-to-tag mapping, unlike CSV's schema-derived columns (D3, D4).

### D3. Columns come from the `out` variant

A column list is computed once per resource at registration, by walking `deriveVariant(source, 'out')` in property order. Taxa uses `taxonSource`. The rows only supply values, so a filter or page can never change the header, and undeclared payload keys are not exported. The walker yields each column as a header name plus an accessor.

The walker uses `out`, not the published components, because publication replaces links with `$ref`s and strips the `x-link` annotation the walker needs. `out` makes link properties nullable, so the walker has to look through that wrapper.

Dotted names match what `jsonlite` `flatten=TRUE` and `json_normalize` produce from the JSON, so the two forms share a vocabulary.

### D4. Flattening rules

| Shape | Output |
|---|---|
| Object | One column per property, dotted path |
| Link (`x-link`) | `<field>.permid` and `<field>.<label>`, no `href` |
| Array of scalars | One column, elements joined with `\|` |
| Array of objects | One column per property, elements position-aligned and joined with `\|` |
| Array within an array of objects | Inner elements joined with `;`, outer with `\|` |
| Array of links | `<field>.permid` only |

Null, absent and empty array are all an empty cell. An absent property within an array element still takes its position, so `a||c` keeps three elements aligned.

- *JSON in a cell* was rejected: lossless, but it needs a JSON parser per cell and is unreadable in a spreadsheet.
- *Positional columns* (`lithofacies.1.lithology`) were rejected: the schema sets no maximum, so the column count would depend on the data or need an invented bound.
- *Separate long-format exports* were rejected as a new resource, not an output format.
- *A comma delimiter* is out: 524 of 213,121 author names and 90 of 227,760 descriptors contain one, as do environment values.
- `additionalReferences` drops titles because one collection has 466.

### D5. Multi-valued elements escape `\`, `|` and `;`

Separators are always written bare. Within each element of a multi-valued column, a literal `\`, `|` or `;` in the data is prefixed with `\`. For example, `["Smith", "Ab|cd", "Lee"]` is written `Smith|Ab\|cd|Lee`. The `\` itself is escaped, so that a value ending in `\` cannot make the following separator look escaped. A reader splits on unescaped separators, then removes the escapes. A naive split on `|` is correct for every row with nothing escaped.

Only one author name contains `|` and one contains `;` today, but writes will allow anything, and a delimiter read as data would misalign a parallel column. Single-valued columns are never split, so they are not escaped.

*Alternative:* correct the two author names and refuse the delimiters on write. That leaves no escape to handle, but it constrains what can be entered, and it is not available until the write path exists.

Agreed 2026-11-09.

### D6. Absent `limit` means the whole result

With no `limit` and no `ids`, the handler loops over `readHeads` in forward batches of `MAX_LIMIT`, hydrating each batch, and streams through `Readable.from` over an async generator, which gives backpressure. Each batch borrows a pooled connection only for its query. A destroyed response ends the generator.

The batch loop yields hydrated records and knows nothing about CSV. A serializer for the chosen format turns records into text. CSV writes a header line and one line per record, and another format plugs in its own serializer with the same streaming, paging, cap and error handling.

This deliberately differs from JSON. Most CSV tools don't follow a `Link` header, so a 100-row default would hand a researcher a truncated file with no error.

A sent `limit` means one page, exactly as in JSON. A forward `cursor` without `limit` streams from that position. A backward `cursor` without `limit` is a 400, because a backward stream has no useful meaning and the `prev` links the API issues always carry a `limit`.

### D7. The first batch is read before the response starts

Status and headers are committed only after the first batch succeeds, so a bad connection or a taxa request with no database still produces a normal JSON error. After that, a failure destroys the socket. A truncated transfer is then visible as a transport error, not a well-formed short file.

### D8. Paging links move to the `Link` header

When a client sends `limit`, the existing `pageLinks` result becomes `Link: <url>; rel="next"` and `rel="prev"`, omitted when null. It already preserves the query string. No `Link` is sent on an unbounded or `ids` read.

### D9. A per-instance cap on unbounded exports

An in-process counter limits concurrent unbounded exports in any non-JSON format (`MAX_CONCURRENT_EXPORTS`, default 4, to be revisited after the Aurora timing). The name carries no format, because a later RIS export of every reference shares the same slots. Over the cap the response is 503 with `Retry-After`, and JSON like any error. The counter is released when the response closes, however it closes. Bounded and `ids` CSV reads don't count, because their work is the same as a JSON page.

It's a 503, not a 429, because the limit is on the instance and not on the caller. A per-client limit needs an identity the API doesn't have yet.

### D10. Expansions are refused

A true expansion with CSV (`includeContainingTaxa=true`) is a 400 naming the parameter. The chain is recursive, and the schema excludes it from `taxonSource` in any case.

### D11. `HEAD` does not stream

A `HEAD` for CSV reads the first batch only, so that errors and headers match `GET`, and sends no body.

### D12. Text encoding

RFC 4180: CRLF between records, fields quoted when they contain `"`, a comma, CR or LF, with `"` doubled. Embedded newlines are preserved (31,276 collection strings, 1,022 reference strings). Booleans are `true` and `false`; numbers are written as JSON would. Strings beginning `=`, `+`, `-` or `@` (998 in collections, 8 in references) are left verbatim: the usual `'` prefix would alter the data for the R and pandas users this feature is for.

### D13. The pool grows from 5 to 10 connections, and the cap stays at 4

The API's pool had 5 connections (`api/src/plugins/postgres.js`). With the cap at 4, four exports all mid-query would leave one connection for every JSON read on the instance. Over a 145 ms link, an export is mid-query for a quarter of its time or more. The pool is now 10, so four exports leave at least six.

Pool and cap are both per instance, so Aurora sees instances × 10 connections at most. Aurora allows 844 (`max_connections` on the dev cluster, with 7 in use when measured), so the extra five per instance matter only if instances multiply a lot or other services share the database. Revisit both once a deployed API can be measured.

*Alternatives:* lowering the cap to 2 keeps the pool at 5, but it halves concurrent exports to protect a pool that has room to grow. Keeping both at their old values relies on an API deployed beside Aurora, where batches take milliseconds; that has not been measured.

Agreed 2026-11-09.

## Risks / Trade-offs

- [A plain `<a href>` cannot set `Accept`] → A frontend download uses `fetch` and saves a blob, which is awkward for a full taxa export. The URL parameter in Non-Goals is the fix if that bites.
- [`read.csv(url)` returns JSON without the header] → The docs lead with the R (`url(..., headers=)`) and pandas (`storage_options`) forms.
- [Unbounded exports load Aurora] → The per-instance cap, sequential batches, and a timing run of the full taxa export before deployment.
- [The result can change during an export] → Keyset order means a concurrent edit does not cause skips or repeats, but rows are not from one snapshot. Writes are still stubbed; revisit with the write path.
- [A mid-stream failure can only drop the connection] → D7 covers the likely case, failing before the first byte. Tools that ignore transport errors can still keep a short file.
- [CSV headers become a contract while `ages.intervals`, `environment` and `paleontology` are placeholders] → Those columns will change with that redesign, and the docs say so.
- [`legacyIDs.oldpbdbIDs` reaches 61,788 characters on "authority unknown" and 48,598 on Linnaeus 1753, past Excel's 32,767-character cell limit] → Excel may cut or mishandle those two cells; R and pandas are unaffected. Exported as stored and documented.

## Measurements

Full exports with no `limit`, localhost `pbdb` (PostgreSQL 16, the API on the same VM), 2026-11-09. Each was parsed with Python's `csv` module: row counts equal the current-head counts, every permid is unique, and every row has the header's width. Memory is the server's resident set, sampled every 0.25 s during each export.

| Resource | Rows | Columns | Time | Server RSS, start → peak |
|---|---|---|---|---|
| references | 96,122 | 24 | 1.8 s | 95 → 202 MB |
| authorities | 166,992 | 8 | 2.4 s | 201 → 235 MB |
| collections | 279,599 | 54 | 13.6 s | 238 → 315 MB |
| taxa | 525,805 | 8 | 24.1 s | 292 → 293 MB |

The exports ran one after another in one server. Taxa, the largest, added 1 MB, so the earlier growth is heap the process kept, not a result held in memory.

Aurora `pbdb2_migration_test` (the same row counts), with the API on this VM and reaching Aurora over the VPN, 2026-11-09. Every export was again complete and correct, with no server errors:

| Resource | Time | Server RSS, start → peak |
|---|---|---|
| references | 20.7 s | 97 → 165 MB |
| authorities | 35.3 s | 160 → 190 MB |
| collections | 143.0 s | 190 → 242 MB |
| taxa | 100.8 s, then 95.7 s | 215 → 232 MB, then 195 → 196 MB |

The time is the network, not the database. A round trip over the VPN is about 145 ms, while the database executes a 1,001-row batch in 0.5–2 ms (`EXPLAIN ANALYZE` on taxa and collections). Taxa costs about one round trip per batch (526 batches, about 185 ms each). Collections costs several per batch (heads, child rows, codec context), and moves the largest payloads. An API deployed beside Aurora would have far lower latency; that has not been measured.

So an export puts little load on the database: one short query at a time, holding a pooled connection only while that query runs, including the transfer of its rows. What an export does hold is its slot, for as long as the whole response takes, up to a few minutes from here.

Decision D13 follows from these figures.

## Migration Plan

Additive and deployed with the API. Run the Aurora timing (tasks) first and set `MAX_CONCURRENT_EXPORTS` from it. Rollback is reverting the change: `text/csv` requests then get JSON again.

## Open Questions

None.
