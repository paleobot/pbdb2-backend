# RIS output

References can be returned as RIS, the format that reference managers (Zotero, EndNote, Mendeley)
import. The decisions behind this are in the OpenSpec change `add-ris-reference-output` and the
`ris-output` spec.

## Asking for RIS

Send the header `Accept: application/x-research-info-systems`. There is no format parameter or
`.ris` suffix in the URL. RIS is offered by:

- `GET /api/v1/references`: the list, a page with `limit`, or an `ids` read;
- `GET /api/v1/references/{permid}`: one reference.

```sh
# Every reference from 1991, as one file
curl -H 'Accept: application/x-research-info-systems' -o references.ris \
  'https://<host>/api/v1/references?publicationYear=1991'

# One reference
curl -H 'Accept: application/x-research-info-systems' -o REF-1-19.ris \
  'https://<host>/api/v1/references/REF-1-19'
```

Without the header, the same URLs return JSON. No other resource offers RIS: asking for it from
authorities, collections, taxa or schemas is a 406. A single reference cannot be had as CSV (also a
406); `?ids=<permid>` gives a one-row CSV.

## What you get

The list behaves as a CSV list does (`csv-output.md`):

- **No `limit`: the whole result**, every matching reference in permid order, streamed.
- **With `limit`: one page.** Further pages are in the `Link` response header.
- **`ids`:** the references found; unknown permids are simply absent.
- **No matches:** an empty 200.
- **Errors are JSON**, with the usual status codes. A single read of an unknown permid is a JSON 404.
- **Concurrent exports are capped** and share their slots with CSV: past the cap, a whole-result
  export is a 503 with `Retry-After`.

The response is `Content-Type: application/x-research-info-systems; charset=utf-8` with
`Content-Disposition: attachment`, named `references.ris` for a list and `<permid>.ris` for one
reference.

## Encoding

- UTF-8, no byte order mark. Accented names are written as they are, unescaped.
- Every line is `TAG  - value` (two spaces, a hyphen, a space) and ends with CRLF.
- A record starts with `TY` and ends with `ER  - `. Records are separated by one blank line. Nothing
  comes before the first record.
- A line break inside a value (a multi-line comment, say) becomes one space, so a record cannot be
  broken. Values are not truncated: the RIS specification's 255-character limits are ignored, as
  other writers ignore them.

## Types

| publicationType | `TY` |
|---|---|
| journal article | `JOUR` |
| article in edited collection | `CHAP` |
| edited collection | `EDBOOK` |
| serial monograph | `SER` |
| standalone book, `bookType` `Ph.D. thesis` or `M.S. thesis` | `THES` (and `M3` = the `bookType`) |
| standalone book, any other or no `bookType` | `BOOK` |
| unpublished | `UNPD` |
| other | `GEN` |

## Tags

In this order. A tag with no value is left out; `TY`, `ID`, `UR`, `DB` and `ER` are always present.

| Tag | Value |
|---|---|
| `TY` | the type, above |
| `ID` | `permid` |
| `UR` | the reference's API URL, `https://<host>/api/v1/references/<permid>` |
| `DB` | `Paleobiology Database` |
| `AU` | one per author: `Family, Given`, or the one name given |
| `A2` / `A3` | `editors` (below) |
| `PY` | `publicationYear` |
| `TI` | `title` |
| `T2` | `journalTitle`, else `bookTitle`, else `seriesTitle` |
| `M3` | `bookType`, on `THES` only |
| `VL` | `journalVolume`, else `seriesVolume` |
| `IS` / `M1` | `journalNumber`, else `seriesNumber`: `M1` on `SER`, `EDBOOK`, `BOOK` and `THES`, `IS` otherwise |
| `SP` | first page (on book types, the pages as one value: below) |
| `EP` | last page, when it differs from the first; not on book types |
| `PB` | `publisher` |
| `CY` | `publicationCity` |
| `N1` | `comments` |
| `N1` | `description`, on a second `N1` |
| `LA` | `language` |
| `DO` | `doi`, as stored |
| `ER` | empty |

Nothing else is exported: `legacyIDs` are not.

**Pages on book types.** On `SER`, `EDBOOK`, `BOOK`, `THES` and `UNPD`, importers read `SP` as the
number of pages and ignore `EP`, so the pages are one `SP`:

| pages | `SP` |
|---|---|
| 1–94 | `94`, a page count |
| 834–848 | `834-848`, a range inside a volume |
| 12–12 | `12` |

**The number on book types.** Zotero's book has no issue field, and it reads `M1` as a book's series
number. So a serial monograph's `seriesNumber` is written as `M1`, not `IS`.

**Editors are one line.** `editors` is free text (`P. L. Falkingham, D. Marty, & A. Richter`) and is
written as stored, on a single line, not split into names: a reference manager may show it as one
oddly named editor, but no name is wrongly split. The tag is the one Zotero reads as editor for the
type: `A3` on `SER`, `EDBOOK`, `BOOK` and `THES`, `A2` on `CHAP`, `JOUR`, `GEN` and `UNPD`. What
Zotero does with it:

- a value with no comma becomes a one-field name;
- a value with a comma is split at the first comma into family and given name. Zotero shows the text
  as written, but a citation style may reorder it;
- a thesis has no editor role in Zotero, so its editors import as *contributor*;
- an unpublished reference (a manuscript in Zotero) has no editor role either, and Zotero drops its
  editors. Other importers may read them.

Structured editors wait for a change to the reference model.

## Differences from Classic

Classic's `refs/list.ris` is the precedent, but its output is not reproduced:

| | Classic | pbdb2 |
|---|---|---|
| author | `AU  - Bone,D.A.` | `AU  - Bone, D. A.` (as stored) |
| year | `PY  - 1998///` | `PY  - 1998` |
| serial monograph | `JOUR` | `SER`, series title in `T2`, number in `M1` |
| edited collection | `CHAP` or `BOOK`, by editors | `EDBOOK` |
| `ID` | `paleodb:ref:N` | the permid |
| `UR` | none | the API URL |
| editors on book types | `A2` | `A3` |
| editors | split into names | one line, as stored |
| book pages | `SP` and `EP` | one `SP` |

`UNPD` for unpublished references, `DB`, comments in `N1` and `M3` for theses are as in Classic.

## Which importers were checked

The mapping was checked against Zotero's RIS importer only (`zotero/translation-server`, November
2026): item types, creators, container, volume, number, pages, DOI, URL, language, publisher, place
and notes land in the expected Zotero fields. `DB` lands in Zotero's *archive* field. EndNote and
Mendeley were not tested; if one reads a tag differently, please report it.
