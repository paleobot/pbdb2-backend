## Why

Classic PBDB's users are largely R and Python scientists who rely on tabular export, and CSV has been on the roadmap since the envelope decision (`api/docs/api-response-envelope-comparison.md`). The API serves only JSON today, and its largest lists can be retrieved only 1,000 records at a time.

## What Changes

- `GET` lists and `?ids=` reads of `references`, `authorities`, `collections` and `taxa` return CSV when the request's `Accept` header asks for `text/csv`. JSON stays the default, and existing clients see no change.
- A CSV list with no `limit` returns the whole result, streamed, as Classic does. `limit` and `cursor` are honoured when sent, with further pages named in a `Link` header.
- Columns are derived from each resource's `out` schema, never from the rows, so a resource's header does not vary by page or filter. Complex fields follow one set of flattening rules: dotted paths for objects, delimited values for arrays.
- Each route declares the non-JSON formats it offers. Asking for one on a route that doesn't offer it is a 406. Errors are always JSON. Negotiation, streaming and the export cap are not specific to CSV, so RIS for `references` (which Classic serves) can be added later as a format with its own serializer.
- Concurrent unbounded exports are capped per API instance; a request over the cap gets a 503 with `Retry-After`.
- The OpenAPI document describes the `text/csv` response on the four lists.

Not in this change: RIS, a format selector in the URL (`?format=csv` is the recorded route if one is asked for), TSV, classification columns (`phylum`, `class`, `order`, `family`), and CSV for single reads, `schemas` or the stubbed `specimens`.

## Capabilities

### New Capabilities

- `csv-output`: which reads offer CSV, how a client asks for it, the flattening rules and text encoding, whole-result streaming, and the export cap.

### Modified Capabilities

- `api-foundation`: CSV responses are a further exception to the standard envelope.
- `list-pagination`: the default page size and the `links` members apply to JSON lists; CSV has its own rules.
- `resource-routes`: the `meta.requested` / `meta.missing` report belongs to the JSON form of an `ids` read.
- `api-description`: the four CSV lists document their `text/csv` response.
- `repository-layout`: `csv-output` joins the list of API specs whose paths are relative to `api/`.
- `data-access`: the connection pool grows from 5 to 10, so concurrent exports leave room for other reads (design D13).

## Impact

- **Code:** `api/src/lib/crud-routes.js` (the shared list handler and route schemas), the four resources' route registration, new modules for negotiation and CSV writing under `api/src/lib/`, `api/src/app.js` (the 406 and `Vary` hook), `api/src/config.js` (the export cap) and `api/src/plugins/postgres.js` (a pool of 10 instead of 5). No new dependency.
- **API:** additive. A client that sends no `Accept: text/csv` gets what it gets today, plus a `Vary: Accept` header.
- **Database:** no DDL. An unbounded export runs sequential keyset page queries, holding one pooled connection per batch and none between batches.
- **Data integrity:** read-only, but a CSV must not silently misrepresent records. The risks are a parallel array losing its alignment, a value containing a delimiter being misread as two values, and a failed stream being mistaken for a complete file. The specs address each. Formula-like strings are deliberately left verbatim, because altering them would corrupt the data for R and pandas users.
