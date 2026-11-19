## Context

`add-csv-list-output` left a format registry (`api/src/lib/formats.js`). Each entry has a `contentType`, an `extension` and a `serializer(source)` factory built once per route, which returns `{ header(), record(r) }`. Around it:

- `negotiate()` chooses between JSON and a route's offered formats.
- An `onRequest` hook answers 406 when a request selects a registry format its route does not list in `config.formats`.
- `sendExport()` serves `ids`, one page with `Link`, or the whole result streamed under `MAX_CONCURRENT_EXPORTS`.

Only list routes declare formats. The single-read handler always sends JSON.

The reference payload (`payloadSchemas/reference.schema.js`) has:
- seven publication types
- structured `authors` (`familyName`, `givenName`)
- a free-text `editors` string
- type-specific container fields (`journalTitle`, `bookTitle`, `seriesTitle`, with volume and number fields, including `seriesNumber` on serial monographs)
- `pages: { first, last }`, `doi`, `language`, `comments`, and `description` for unpublished refs

The db variant accepts any declared field on any type, so legacy refs can carry fields their type would not allow on create.

Classic's writer (`classic/lib/PBDB/ReferenceEntry.pm`, `formatRISRef`) is the precedent, but it has quirks: an unreachable `SER` branch, `UNPD`, compact author forms and slash dates. The tag mapping below was checked against Zotero's RIS translator (`zotero/translators` `RIS.js`): how each `TY` and tag imports.

This change assumes `fix-book-chapter-migration`, `reclassify-single-title-books` and `keep-classic-container-data` have been applied (all are archived, and localhost was rebuilt after each). After them, chapters are `article in edited collection` with a `bookTitle`, the 665 single-title Classic `book/book chapter` refs are `standalone book`, and no Classic ref maps to `edited collection`. That type holds only PBot refs and references created through the API, which are real edited volumes.

## Goals / Non-Goals

**Goals:**
- References in RIS that Zotero imports to the right item type, with authors, editors, container, volume, pages, DOI and a link back to the API.
- The list read in every form CSV supports (`ids`, page, whole result) and the single read.
- No change to negotiation, the 406 rule, streaming or the export cap beyond what the single read needs.

**Non-Goals:**
- RIS for any resource other than references.
- Matching Classic's output byte for byte. The differences are documented instead.
- Parsing the free-text `editors` string into names. That waits for structured editors in the reference model.
- A preamble or header lines, other formats (BibTeX, CSL-JSON), and a URL parameter or suffix to select the format.
- Testing EndNote and Mendeley. Only a Zotero import is part of verification.

## Decisions

### D1. RIS is a registry entry, selected like CSV

`FORMATS['application/x-research-info-systems']`:
- `contentType`: `application/x-research-info-systems; charset=utf-8`
- `extension`: `ris`
- `serializer`: `risSerializer` from a new `api/src/lib/ris.js`

`header()` returns `''`. The references route lists both `text/csv` and the RIS type. Selection, the 406 for other routes, `Vary: Accept`, JSON errors, `Link` paging, streaming, the export cap and `HEAD` all behave exactly as for CSV, with no change to `negotiate`, the hook or `sendExport`.

*Alternative:* `application/x-research-info-systems` is not registered with IANA, and some servers use `application/x-ris` or `text/plain`. Classic uses this one and Zotero recognises it, so it is the only one offered.

### D2. The serializer factory takes the route's base href

`serializer(source, { baseHref })`. `baseHref` is `fastify.publicBaseUrl + fastify.prefix`, known when the route is registered, and `UR` needs it. `csvSerializer` ignores the second argument. Building the serializer once per route is unchanged.

*Alternative:* reading the href from a hydrated record. References carry no self link to read it from, and adding one would change the JSON.

### D3. The single read negotiates

The single-read route declares `config: { formats }` from the same `formats` option. Its handler calls `negotiate()`. For a non-JSON type it reads the head as now (a missing permid is a JSON 404), then sends `serializer.header() + serializer.record(record)`, with `Content-Disposition: attachment; filename="<permid>.ris"`. `HEAD` sends the headers only.

The handler does not go through `sendExport`, whose `ids`, page and stream branches don't apply to a single record. The single read offers only RIS: CSV for a single read stays a 406, as the CSV change decided, so `registerCrudRoutes` gains a separate `singleFormats` option and references passes `['application/x-research-info-systems']`.

*Alternative:* serving single-read RIS as `?ids=<permid>`. Clients and Classic links expect a resource URL to give the record itself.

### D4. Publication type → `TY`

| publicationType | `TY` | Zotero imports as | Note |
|---|---|---|---|
| journal article | `JOUR` | journal article | |
| article in edited collection | `CHAP` | book section | |
| edited collection | `EDBOOK` | book, `AU` → editors | only real edited volumes remain (`reclassify-single-title-books`) |
| serial monograph | `SER` | book | Classic wrote `JOUR` |
| standalone book, `bookType` Ph.D. or M.S. thesis | `THES` | thesis | `M3` = the `bookType` |
| standalone book, any other `bookType` | `BOOK` | book | |
| unpublished | `UNPD` | manuscript | Zotero does not know the spec's `UNPB` and would import it as a journal article |
| other | `GEN` | journal article | Zotero's fallback for `GEN`; acceptable for a catch-all |

### D5. Field → tag

Tags are written in this order, and each is omitted when its value is absent or blank:

| Tag | Value |
|---|---|
| `TY` | D4 |
| `ID` | `permid` |
| `UR` | `<baseHref>/<permid>`, the absolute API URL |
| `DB` | `Paleobiology Database` |
| `AU` | one line per author: `familyName, givenName`, or `familyName` when the given name is blank |
| `A2` / `A3` | `editors` as one line, as stored (D6) |
| `PY` | `publicationYear` as stored |
| `TI` | `title` |
| `T2` | the container title: `journalTitle`, else `bookTitle`, else `seriesTitle` |
| `M3` | `bookType`, on `THES` only |
| `VL` | `journalVolume`, else `seriesVolume` |
| `IS` / `M1` | `journalNumber`, else `seriesNumber` (added by `keep-classic-container-data`): `M1` on `SER`, `EDBOOK`, `BOOK` and `THES`, `IS` otherwise |
| `SP` | `pages.first`; on `SER`, `EDBOOK`, `BOOK`, `THES` and `UNPD` the pages as one value (below) |
| `EP` | `pages.last`, only when it differs from `pages.first`; not on the types above |
| `PB` | `publisher` |
| `CY` | `publicationCity` |
| `N1` | `comments`; then, on its own `N1`, `description` |
| `LA` | `language` |
| `DO` | `doi` |
| `ER` | empty; ends the record |

Container, volume and number use one precedence across every type, not a table per type. The db variant lets a legacy ref of any type carry any of these fields, and one rule exports what is stored. In practice each type carries only its own field (journal articles `journalTitle`, chapters `bookTitle`, serial monographs `seriesTitle`), so the precedence decides nothing for current data beyond `other`.

For serial monographs the series goes in `T2`, not `T3`: Zotero reads a book's `T2` as its series.

*Corrected after the Zotero import (tasks 5.4, 2026-11-19):*
- **Pages on book types.** Zotero reads `SP` on a book, thesis or manuscript as the number of pages and drops `EP`, so `1`–`94` imported as 1 page and `834`–`848` as 834 pages. On `SER`, `EDBOOK`, `BOOK`, `THES` and `UNPD` the pages are now one `SP`. It holds `pages.last` when the range starts at page 1, so 4,001 of the 5,575 book-type refs on localhost get a real page count. It holds the one page when there is only one, and otherwise `first-last`, so a range inside a series volume is kept (1,574 refs). The RIS spec's `SP` on a book is also the number of pages.
- **The number on book types.** Zotero's book has no issue field, so `IS` was dropped, which lost the series number of the 863 serial monographs that have one. Zotero reads `M1` on a book as its series number. On `SER`, `EDBOOK`, `BOOK` and `THES` the number is written as `M1`; only `SER` has values today.

*Alternatives:*
- Classic's compact `AU  - Bone,D.A.` and `PY  - 1998///`. Most importers expect `Last, First` and a plain year.
- `JO`/`JF` for journal titles. Zotero reads `T2` for journal articles, and `T2` keeps one tag for every container.

### D6. Editors: one line, tag by type

`editors` is free text, for example `"P. L. Falkingham, D. Marty, & A. Richter"`. It is written as a single line, unparsed. A reference manager will show it as one oddly named editor, but nothing is lost or garbled by a wrong split.

The tag is the one Zotero reads as *editor* for the item type:
- `A3` on `SER`, `EDBOOK`, `BOOK` and `THES`, where Zotero's book type reads `A2` as series editor.
- `A2` on `CHAP`, `JOUR`, `GEN` and `UNPD`.

How Zotero reads the one line (checked in the import, tasks 5.3):
- A value with no comma becomes a one-field name, e.g. `J. Shoshani and P. Tassy`.
- A value with a comma is split at the first comma into family and given name, e.g. `K. M. Stewart, K. L. Seymour`. Zotero shows it as written, but a citation style would reorder it. Nothing is lost.
- On `THES`, Zotero has no editor role, so `A3` imports as *contributor* (`A2` would be dropped).
- On `UNPD` (Zotero's manuscript), there is no editor role and both `A2` and `A3` are dropped. `A2` is kept for other importers. One unpublished ref on localhost has editors, and the docs say so.

*Alternatives:*
- Parsing the string the way Classic's `risOtherAuthors` does. It is wrong on real values, e.g. `"R. G. a. E. Jiménez-Hidalgo"`.
- Leaving editors out, which loses them.

### D7. Text encoding

- UTF-8 with no byte order mark.
- Lines end with CRLF.
- Each line is `TAG  - value`: two spaces, a hyphen, a space.
- `ER  - ` ends a record, and a blank line separates records.
- Within a value, any run of whitespace that includes a CR or LF becomes one space, and the value is trimmed, so a multi-line comment cannot break the record.
- Values are not truncated. The RIS spec's 255-character limits on some tags are ignored, as other writers ignore them, and importers accept longer values.

### D8. Differences from Classic are documented, not reproduced

The `api/docs/` RIS section lists each difference:
- the author form
- the year form
- `SER` for serial monographs (Classic: `JOUR`)
- `EDBOOK` (Classic: `CHAP` or `BOOK` by editors)
- `ID` as the permid (Classic: `paleodb:ref:N`)
- the new `UR`
- `T2` series titles
- `A3` editors on book types

`UNPD`, `DB`, `N1` comments and `M3` for theses match Classic.

## Risks / Trade-offs

- **[EndNote or Mendeley read some tags differently from Zotero]** → Verification imports into Zotero only. The docs say which importer the mapping was checked against, and a report from another importer is a small follow-up.
- **[The `A2`/`A3` choice for `THES`, `UNPD` and `GEN` is not confirmed by the translator read]** → Checked in the Zotero import (below). `GEN` imports `A2` as editor. `THES` imports `A3` as contributor, since Zotero's thesis has no editor role. `UNPD` drops both (D6).
- **Zotero import check (2026-11-19, tasks 5).**
  - Setup: `zotero/translation-server` at `00032f6` (2026-11-05), translators submodule `9d04f4b`, 752 translators loaded, run on localhost and `POST /import`.
  - Sample: 22 records, at least two per `TY`. Eighteen were real localhost refs served by the new single read: chapters with editors and DOIs; serial monographs with and without editors and series numbers; a Ph.D. and an M.S. thesis; books with and without editors; unpublished refs with descriptions; journal articles; `other` with and without editors; a multi-line comment; non-ASCII authors; a single page; a ref with no title. Four were made by hand, because localhost has no `edited collection`, no thesis with editors and no unpublished ref with pages: two `EDBOOK`, a thesis with editors and an unpublished ref with editors and pages.
  - Item types follow D4. Authors import as authors. `EDBOOK` authors import as editors. `A2` imports as editor on `CHAP` and `GEN`, and `A3` as editor on `BOOK`, `SER` and `EDBOOK`.
  - `T2` lands as `publicationTitle` (journal), `bookTitle` (chapter) or `series` (book). `VL` lands as volume, `IS` as issue on journals, and `M1` as `seriesNumber` on books. `SP`/`EP` land as pages on articles and chapters, and the one `SP` as `numPages` on books, theses and manuscripts. `M3` lands as `thesisType`.
  - `DO`, `UR`, `LA`, `PB` and `CY` land as DOI, URL, language, publisher and place. Each `N1` becomes a child note. `DB` lands in Zotero's *archive* field. `ID` is ignored. Non-ASCII names arrive intact.
  - Two corrections were made (D5): book pages and the number on book types. In the first import, before them, `numPages` held the first page and the series number was dropped. One finding is documented and not worked around: `UNPD` editors are dropped (D6). The clone was deleted after the check.
- **[`EDBOOK` turns the authors of a whole book into editors]** → Settled by `reclassify-single-title-books`: the whole books that Classic stored as `book/book chapter` are now `standalone book`, so `edited collection` holds only real edited volumes. Classic edited volumes that migrated as `standalone book` export as `BOOK` until a curator corrects their type.
- **[One-line editors look wrong in a reference manager]** → Documented. The real fix is structured editors in the reference model.
- **[A large unbounded RIS export]** → It shares the existing per-instance cap and streaming, as CSV does. Each record costs about the same as a CSV row.

## Verification

**Whole export against localhost (2026-11-19, tasks 4.3).** `GET /api/v1/references` with `Accept: application/x-research-info-systems`, no `limit`, from a server on localhost `pbdb`: 200, 39.5 MB, 1.7 s, 96,119 records. Every line has the `TAG  - value` form and ends in CRLF, and there is no byte order mark. The count of records by `TY` equals the count of current references by type:

| `TY` | Records | References |
|---|---|---|
| `JOUR` | 81,050 | journal article 81,050 |
| `CHAP` | 5,712 | article in edited collection 5,712 |
| `SER` | 3,564 | serial monograph 3,564 |
| `BOOK` | 2,623 | standalone book, not a thesis, 2,623 |
| `GEN` | 2,459 | other 2,459 |
| `THES` | 435 | standalone book, `Ph.D. thesis` or `M.S. thesis`, 435 |
| `UNPD` | 276 | unpublished 276 |
| `EDBOOK` | 0 | edited collection 0 |

Localhost has no `edited collection` references, so `EDBOOK` is exercised only by the unit tests and by a hand-made record in the Zotero check.

## Migration Plan

Additive, with no data step. The migration changes it depends on are applied and localhost is re-migrated, so the integration tests and the Zotero import see chapters as `CHAP` with a `T2`, serial monographs with an `IS`, and container notes in `N1`. Rollback is a revert: no client depends on RIS until it ships.

## Open Questions

- ~~`EDBOOK` or `BOOK` for edited collections~~ Settled (2026-11-13): `EDBOOK`. `reclassify-single-title-books` moved the 665 single-title Classic refs, mostly authored books, to `standalone book`, so `edited collection` holds only real edited volumes.
- ~~Whether to mark the `api-design-backlog` "Output formats beyond CSV" RIS bullet done, or remove it~~ Settled at archive (2026-11-19): removed. The entry's intro names RIS beside CSV, and its bullets keep only what is still deferred.
