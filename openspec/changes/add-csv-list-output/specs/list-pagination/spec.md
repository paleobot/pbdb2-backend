## MODIFIED Requirements

### Requirement: Page size bounds

A JSON list request without a `limit` SHALL return at most a default page size; a
CSV list request without a `limit` SHALL return the whole result (`csv-output`). A
`limit` above the maximum page size SHALL be rejected with HTTP 400 rather than
silently clamped, so a client never believes it received more than it did. A
`limit` that is not a positive integer SHALL be rejected with HTTP 400, as SHALL
a `limit` parameter present with an empty value.

#### Scenario: Default page size applies

- **WHEN** a client sends GET to a list endpoint with no `limit` and does not select CSV
- **THEN** `data` contains at most the default page size

#### Scenario: Oversized limit is rejected

- **WHEN** a client sends `?limit=` with a value above the maximum page size
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Malformed limit is rejected

- **WHEN** a client sends `?limit=` with a value that is empty, zero, negative,
  or not an integer
- **THEN** the system responds with HTTP 400 in the standard error shape

### Requirement: Pagination links

For a JSON list response, `links.next` SHALL be a URL that retrieves the following
page, preserving every other query parameter of the current request, or `null`
when the current page is the last. `links.prev` SHALL be a URL that retrieves the
preceding page, or `null` when the current page is the first. A CSV list response
SHALL name those pages in a `Link` header instead (`csv-output`).

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
