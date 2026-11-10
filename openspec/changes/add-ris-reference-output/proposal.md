## Why

Classic serves references as RIS (`refs/list.ris`, `application/x-research-info-systems`), the format reference managers (Zotero, EndNote, Mendeley) import. pbdb2 has no equivalent, so a user who wants PBDB references in their library has to go back to Classic or convert JSON by hand. `add-csv-list-output` built the format registry, negotiation, 406 rule, streaming and export cap so that a second format could be added without changing them. RIS is that second format, and the backlog has carried it since then.

The decisions were settled in exploration on 2026-11-10 and are recorded in `design.md`. That includes a check of how Zotero's RIS importer reads each tag. This change depends on `fix-book-chapter-migration`: until it is applied, 3,045 chapters are stored as edited collections with no book title, and they would export as whole books.

## What Changes

- **References offer RIS:**
  - Where: `GET /api/v1/references` (list, `ids`, one page with `Link`, or the whole result streamed) and the single read `GET /api/v1/references/{permid}`.
  - How it is selected: by `Accept: application/x-research-info-systems`, under the same rule that selects CSV.
- **Only references offer it.** RIS requested of any other route is a 406, as the existing format rule already provides.
- **A hand-written serializer maps each publication type to a `TY` and each field to a tag.** It follows the RIS specification and Zotero's import behaviour rather than Classic's output. Where the result differs from Classic, the docs say so:
  - `AU  - Family, Given` instead of `Bone,D.A.`
  - `PY  - 1998` instead of `1998///`
  - serial monographs as `SER` instead of `JOUR`
- **The single read gets format negotiation.** Until now only list routes declared formats, so the single-read handler gains the same negotiation and route `formats` declaration.
- **An unbounded RIS export of references shares the existing `MAX_CONCURRENT_EXPORTS` slots.**
- **OpenAPI describes the RIS response** on both reference operations.
- **`api/docs/` gains a RIS section** with the tag mapping and the differences from Classic.

No change to stored data, schemas or DDL. CSV behaviour is unchanged.

## Capabilities

### New Capabilities

- `ris-output`: RIS for references. It covers:
  - which reads offer it
  - the publication-type → `TY` mapping
  - the field → tag mapping, including authors, editors, titles, pages, identifiers and notes
  - text encoding and line endings
  - the single-read response
  - how RIS shares CSV's selection, 406, streaming, paging, error and export-cap behaviour

### Modified Capabilities

- `api-description`: an operation that offers RIS describes an `application/x-research-info-systems` 200 response. A single read can now document a non-JSON format.
- `repository-layout`: `ris-output` joins the list of API specs whose paths are relative to `api/`.

## Impact

- **Code:**
  - `api/src/lib/formats.js` (a registry entry)
  - a new `api/src/lib/ris.js` serializer
  - `api/src/lib/crud-routes.js` (single-read negotiation, and a `FORMAT_DOCS` entry for RIS)
  - `api/src/routes/api/v1/references/index.js` (offering the format)
- **Tests:** unit tests for the serializer, covering each type and tag; route tests for negotiation, 406, single read and streaming; integration against localhost.
- **Docs:** `api/docs/` gets a RIS section. `api/CLAUDE.md` gets a mention if it lists formats. The "Output formats beyond CSV" entry in `docs/api-design-backlog.md` is updated to point here.
- **Dependency:** `fix-book-chapter-migration` must be applied and localhost re-migrated before this change's integration tests and the Zotero import check, so that chapters export as `CHAP` with their book title.
- **Clients:** this only adds behaviour. JSON stays the default, and no existing response changes.
