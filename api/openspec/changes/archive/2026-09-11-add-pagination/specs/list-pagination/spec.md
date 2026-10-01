## ADDED Requirements

### Requirement: Keyset pagination on list endpoints

The system SHALL paginate every list endpoint using a keyset (cursor) over a
total, stable ordering of `permid`. A list request SHALL accept an optional
`limit` parameter bounding the page size and an optional `cursor` parameter
identifying the position to resume from. The cursor SHALL compose with the
existing list filters: a paginated request narrows the same set of current,
non-removed heads that `ids` and field filters produce.

Offset- or page-number-based pagination SHALL NOT be offered, and the sort order
SHALL NOT be client-selectable — both would break the stability the keyset
depends on.

#### Scenario: First page of a list

- **WHEN** a client sends GET to a DB-backed list endpoint with no `cursor`
- **THEN** the system responds with HTTP 200
- **AND** `data` contains at most `limit` records, ordered by `permid`

#### Scenario: Resuming from a cursor

- **WHEN** a client sends GET to a list endpoint with a `cursor` returned by a
  previous request
- **THEN** `data` continues from the position that cursor identifies
- **AND** no record from the previous page is repeated

#### Scenario: Pagination composes with a field filter

- **WHEN** a client sends a list request with both a declared field filter and
  `limit`
- **THEN** `data` contains at most `limit` records that match the filter
- **AND** paging through every page yields exactly the filtered set

### Requirement: Page size bounds

A list request without a `limit` SHALL return at most a default page size. A
`limit` above the maximum page size SHALL be rejected with HTTP 400 rather than
silently clamped, so a client never believes it received more than it did. A
`limit` that is not a positive integer SHALL be rejected with HTTP 400, as SHALL
a `limit` parameter present with an empty value.

#### Scenario: Default page size applies

- **WHEN** a client sends GET to a list endpoint with no `limit`
- **THEN** `data` contains at most the default page size

#### Scenario: Oversized limit is rejected

- **WHEN** a client sends `?limit=` with a value above the maximum page size
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Malformed limit is rejected

- **WHEN** a client sends `?limit=` with a value that is empty, zero, negative,
  or not an integer
- **THEN** the system responds with HTTP 400 in the standard error shape

### Requirement: Opaque cursors

A cursor SHALL be opaque to clients: an encoded token, obtained only from a
`links.next` or `links.prev` URL, carrying both the position and the direction of
travel. Clients SHALL NOT construct or parse cursors. A cursor that cannot be
decoded SHALL be rejected with HTTP 400.

A cursor SHALL remain usable when the underlying data changes: because it encodes
a position in a stable `permid` ordering rather than an offset, records inserted
or removed between requests SHALL NOT cause other records to be skipped or
repeated.

#### Scenario: Malformed cursor is rejected

- **WHEN** a client sends `?cursor=` with a value that is not a valid encoded
  cursor
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Cursor survives concurrent inserts

- **WHEN** records are added to a resource between a client's requests for two
  consecutive pages
- **THEN** no record present throughout is skipped or returned twice as a result
  of the insertion

### Requirement: Pagination links

For a list response, `links.next` SHALL be a URL that retrieves the following
page, preserving every other query parameter of the current request, or `null`
when the current page is the last. `links.prev` SHALL be a URL that retrieves the
preceding page, or `null` when the current page is the first.

#### Scenario: A full page offers a next link

- **WHEN** a list request returns a full page and further records exist
- **THEN** `links.next` is a URL carrying a cursor positioned after the last
  returned record
- **AND** requesting it returns the following records

#### Scenario: The last page has no next link

- **WHEN** a list request returns the final records of a result set
- **THEN** `links.next` is `null`

#### Scenario: The first page has no prev link

- **WHEN** a list request is made with no `cursor`
- **THEN** `links.prev` is `null`

#### Scenario: Links preserve filters

- **WHEN** a list request carries a field filter and returns a `links.next`
- **THEN** that URL carries the same field filter

### Requirement: Pagination and the `ids` read are mutually exclusive

A request combining `ids` with `limit` or `cursor` SHALL be rejected with HTTP
400 rather than having either constraint silently ignored: the multi-entity `ids`
read is bounded by its own batch cap and is inherently a single page. An `ids`
response SHALL continue to report its partial-success accounting and SHALL carry
`null` pagination links.

#### Scenario: Combining ids with a limit is rejected

- **WHEN** a client sends a request with both `?ids=` and `?limit=` (or
  `?cursor=`)
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: An ids read is a single page

- **WHEN** a client sends a multi-entity read with `?ids=`
- **THEN** `links.next` and `links.prev` are both `null`
- **AND** the `meta.requested` / `meta.missing` accounting is unchanged

### Requirement: Page-scoped result counts

The list envelope's `meta.found` and `meta.returned` SHALL describe the returned
page, not the full result set. The system SHALL NOT compute a total count of
matching records for a paginated request.

#### Scenario: Counts describe the page

- **WHEN** a paginated list request returns a page smaller than the full result
  set
- **THEN** `meta.found` and `meta.returned` describe the records in that page

### Requirement: Stub resources accept pagination parameters

A resource whose reads are served from stub data rather than a database SHALL
accept the pagination parameters without error and SHALL return its stub list as
a single page with `null` pagination links.

#### Scenario: Stub list with a limit

- **WHEN** a client sends a list request with `?limit=` to a stub-backed
  resource
- **THEN** the system responds with HTTP 200
- **AND** `links.next` and `links.prev` are both `null`
