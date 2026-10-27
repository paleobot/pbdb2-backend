## MODIFIED Requirements

### Requirement: Keyset pagination on list endpoints

The system SHALL paginate every list endpoint using a keyset (cursor) over a
total, stable ordering of `permid` by the number it contains (the table's
`permid_no`, `prefixed-permids`): numerically, so `COL-99-…` precedes
`COL-100-…`. For migrated data this is Classic number order, followed by records
numbered from the sequence in creation order. A list request SHALL accept an
optional `limit` parameter bounding the page size and an optional `cursor`
parameter identifying the position to resume from. The cursor SHALL compose with
the existing list filters: a paginated request narrows the same set of current,
non-removed heads that `ids` and field filters produce.

Offset- or page-number-based pagination SHALL NOT be offered, and the sort order
SHALL NOT be client-selectable — both would break the stability the keyset
depends on.

#### Scenario: First page of a list

- **WHEN** a client sends GET to a DB-backed list endpoint with no `cursor`
- **THEN** the system responds with HTTP 200
- **AND** `data` contains at most `limit` records, ordered by the number in their `permid`

#### Scenario: Numeric, not textual, order

- **WHEN** a list contains records with permids `REF-99-…` and `REF-100-…`
- **THEN** `REF-99-…` is returned before `REF-100-…`

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

### Requirement: Opaque cursors

A cursor SHALL be opaque to clients: an encoded token, obtained only from a
`links.next` or `links.prev` URL, carrying both the position and the direction of
travel. Clients SHALL NOT construct or parse cursors. A cursor that cannot be
decoded SHALL be rejected with HTTP 400.

A cursor SHALL remain usable when the underlying data changes: because it encodes
a position in the stable numeric `permid` ordering rather than an offset, records
inserted or removed between requests SHALL NOT cause other records to be skipped
or repeated.

#### Scenario: Malformed cursor is rejected

- **WHEN** a client sends `?cursor=` with a value that is not a valid encoded
  cursor
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Cursor survives concurrent inserts

- **WHEN** records are added to a resource between a client's requests for two
  consecutive pages
- **THEN** no record present throughout is skipped or returned twice as a result
  of the insertion
