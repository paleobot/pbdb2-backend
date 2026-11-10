## ADDED Requirements

### Requirement: CSV is selected by the Accept header

The system SHALL return CSV from a CSV-capable read only when the request's `Accept` header names `text/csv` with a non-zero `q` strictly greater than any `q` explicitly given to `application/json`. In every other case, including an absent `Accept`, a wildcard, or a tie, the response SHALL be JSON. No query parameter or URL suffix SHALL select the format.

Every response to a `GET` or `HEAD` SHALL carry `Vary: Accept`.

#### Scenario: A client asks for CSV

- **WHEN** a client sends `GET /api/v1/collections` with `Accept: text/csv`
- **THEN** the response has `Content-Type: text/csv; charset=utf-8; header=present`
- **AND** the response has `Vary: Accept`
- **AND** the response has `Content-Disposition: attachment; filename="collections.csv"`

#### Scenario: No Accept header

- **WHEN** a client sends `GET /api/v1/collections` with no `Accept` header
- **THEN** the response is the JSON envelope

#### Scenario: A browser's Accept header

- **WHEN** a client sends `Accept: text/html,application/xhtml+xml,*/*;q=0.8`
- **THEN** the response is the JSON envelope

#### Scenario: JSON is preferred

- **WHEN** a client sends `Accept: application/json, text/csv;q=0.5`
- **THEN** the response is the JSON envelope

#### Scenario: A tie goes to JSON

- **WHEN** a client sends `Accept: text/csv, application/json`
- **THEN** the response is the JSON envelope

#### Scenario: CSV alongside a wildcard

- **WHEN** a client sends `Accept: text/csv, */*`
- **THEN** the response is CSV

#### Scenario: A format parameter is not recognized

- **WHEN** a client sends `GET /api/v1/collections?format=csv`
- **THEN** the system responds with HTTP 400 naming `format`

### Requirement: Which reads offer CSV

The list and `ids` reads of `references`, `authorities`, `collections` and `taxa` SHALL offer CSV. Each route SHALL declare the non-JSON formats it offers. A `GET` or `HEAD` request that selects a format the API produces, on a route that does not offer it, SHALL be answered with HTTP 406 in the standard error shape, before its query is validated. A request selects a format under the same rule by which it selects CSV. A media type the API never produces SHALL be answered with JSON.

#### Scenario: A single read does not offer CSV

- **WHEN** a client sends `GET /api/v1/collections/{permid}` with `Accept: text/csv`
- **THEN** the system responds with HTTP 406 in the standard error shape

#### Scenario: Schemas do not offer CSV

- **WHEN** a client sends `GET /api/v1/schemas` with `Accept: text/csv`
- **THEN** the system responds with HTTP 406 in the standard error shape

#### Scenario: An index does not offer CSV

- **WHEN** a client sends `GET /api/v1` with `Accept: text/csv`
- **THEN** the system responds with HTTP 406 in the standard error shape

#### Scenario: A media type the API never produces

- **WHEN** a client sends `GET /api/v1/collections` with `Accept: application/xml`
- **THEN** the response is the JSON envelope

#### Scenario: An ids read offers CSV

- **WHEN** a client sends `GET /api/v1/references?ids=<permid>` with `Accept: text/csv`
- **THEN** the response is CSV with a header line and one record

### Requirement: Errors remain JSON

An error response SHALL use the standard JSON error shape whatever the request's `Accept` header says, provided the response has not started.

#### Scenario: An invalid filter on a CSV request

- **WHEN** a client sends an invalid query parameter with `Accept: text/csv`
- **THEN** the system responds with HTTP 400 and a JSON body

### Requirement: Columns are fixed by the resource's schema

A resource's CSV columns SHALL be derived from its `out` variant, in schema order, and SHALL NOT depend on the records returned. Every response from a resource SHALL have the identical header line, including a response with no records. A key in a record that the `out` variant does not declare SHALL NOT be exported. The header line SHALL be the first line, with no metadata lines before it.

#### Scenario: The header does not vary with the filter

- **WHEN** a client requests `references` as CSV filtered to `publicationType=journal article`, and again filtered to `publicationType=standalone book`
- **THEN** both responses have the identical header line

#### Scenario: An empty result

- **WHEN** a CSV list matches no records
- **THEN** the system responds with HTTP 200 and a body holding only the header line

#### Scenario: Permid is the first column

- **WHEN** any CSV list is returned
- **THEN** its first column is `permid`

### Requirement: Complex fields are flattened by rule

Fields SHALL be flattened as follows:

- A nested object SHALL produce one column per property, named by its dotted path.
- A link SHALL produce `<field>.permid` and `<field>.<label>`, and no `href`.
- An array of scalars SHALL produce one column, its elements joined with `|`.
- An array of objects SHALL produce one column per property, named by dotted path, with elements in array order joined with `|`. An element lacking the property SHALL still occupy its position.
- An array within an array of objects SHALL have its elements joined with `;`, and the groups joined with `|`.
- An array of links SHALL produce `<field>.permid` only.

A null, an absent property and an empty array SHALL each be an empty cell. Within any multi-valued column, each element's `\`, `|` and `;` SHALL be preceded by `\`.

#### Scenario: A nested object

- **WHEN** a collection with coordinates is returned as CSV
- **THEN** the header has a `location.coordinates.latitude` column holding its latitude

#### Scenario: A link

- **WHEN** an authority is returned as CSV
- **THEN** the header has `reference.permid` and `reference.title`
- **AND** the header has no `reference.href`

#### Scenario: Parallel columns stay aligned

- **WHEN** a reference has authors `{familyName: "Smith", givenName: "A"}`, `{familyName: "Jones"}` and `{familyName: "Lee", givenName: "C"}`
- **THEN** `authors.familyName` is `Smith|Jones|Lee`
- **AND** `authors.givenName` is `A||C`

#### Scenario: A nested array

- **WHEN** a collection has two lithofacies with adjectives `["sandy", "fine"]` and `["shaly"]`
- **THEN** `lithofacies.adjectives` is `sandy;fine|shaly`

#### Scenario: An array of links

- **WHEN** a collection with additional references is returned as CSV
- **THEN** the header has `additionalReferences.permid` holding their permids joined with `|`
- **AND** the header has no `additionalReferences.title`

#### Scenario: A delimiter in a value

- **WHEN** an element of a multi-valued column contains `|`
- **THEN** that character is written as `\|`

#### Scenario: A backslash in a value

- **WHEN** the elements of a multi-valued column are `a\` and `b`
- **THEN** the cell is `a\\|b`, its separator bare

#### Scenario: A delimiter in a single-valued column

- **WHEN** a single-valued string column contains `|`
- **THEN** the value is written unchanged

### Requirement: CSV text encoding

CSV output SHALL be UTF-8 with no byte order mark and follow RFC 4180: records end in CRLF, a field containing a double quote, comma, CR or LF is enclosed in double quotes, and a double quote within it is doubled. Embedded line breaks SHALL be preserved. Booleans SHALL be `true` or `false`. A string SHALL NOT be altered because of its first character.

#### Scenario: An embedded newline and quote

- **WHEN** a comment contains a line break and a double quote
- **THEN** the field is quoted, the line break is preserved and the quote is doubled

#### Scenario: A formula-like value

- **WHEN** a string value begins with `=`
- **THEN** the value is written unchanged

### Requirement: A CSV list with no limit returns the whole result

A CSV list read with no `limit` and no `ids` SHALL return every record matching its filters, in `permid_no` order, as a streamed response. The system SHALL NOT buffer the whole result in memory. A forward `cursor` without `limit` SHALL stream from that position. A backward `cursor` without `limit` SHALL be rejected with HTTP 400.

The first batch SHALL be read before the response starts, so a failure at that point is an ordinary error response. A failure after the response has started SHALL abort the connection and SHALL NOT end the body as if it were complete.

#### Scenario: More records than the maximum page size

- **WHEN** a client requests a CSV list with no `limit` and more records match than the maximum page size
- **THEN** the body holds every matching record exactly once, in `permid_no` order

#### Scenario: Filters narrow the export

- **WHEN** a client requests a CSV list with a field filter and no `limit`
- **THEN** the body holds exactly the records the filter matches

#### Scenario: A failure mid-stream

- **WHEN** a batch fails after the response has started
- **THEN** the connection is aborted

#### Scenario: The client disconnects

- **WHEN** a client disconnects during an export
- **THEN** the system issues no further batch queries

#### Scenario: A backward cursor without limit

- **WHEN** a client requests a CSV list with a backward `cursor` and no `limit`
- **THEN** the system responds with HTTP 400 in the standard error shape

### Requirement: A CSV list with a limit returns one page

A CSV list read with `limit` SHALL return one page under the same bounds as a JSON list. Further pages SHALL be named in a `Link` header (RFC 8288) with `rel="next"` and `rel="prev"`, each present only when that page exists and each an absolute URL preserving the request's other query parameters. An unbounded read and an `ids` read SHALL send no `Link` header.

#### Scenario: A further page exists

- **WHEN** a client requests a CSV list with `limit=10` and more records exist
- **THEN** the body holds 10 records
- **AND** the `Link` header has a `rel="next"` URL carrying the same `limit` and filters

#### Scenario: The last page

- **WHEN** a CSV page holds the final records and the request carried no `cursor`
- **THEN** no `Link` header is sent

#### Scenario: An oversized limit

- **WHEN** a client requests a CSV list with `limit` above the maximum page size
- **THEN** the system responds with HTTP 400 in the standard error shape

### Requirement: Expansions are not available in CSV

A CSV request that sets an expansion to true SHALL be rejected with HTTP 400 naming the parameter.

#### Scenario: Containing taxa

- **WHEN** a client sends `GET /api/v1/taxa?includeContainingTaxa=true` with `Accept: text/csv`
- **THEN** the system responds with HTTP 400 naming `includeContainingTaxa`

### Requirement: Concurrent unbounded exports are capped

Each API instance SHALL run at most `MAX_CONCURRENT_EXPORTS` unbounded exports at once, in any non-JSON format, defaulting to 4. A request beyond the cap SHALL be answered with HTTP 503 in the standard error shape and a `Retry-After` header. A slot SHALL be released when its response closes for any reason. Reads with `limit` or `ids` SHALL NOT count toward the cap.

#### Scenario: Over the cap

- **WHEN** the maximum number of unbounded exports are running and another is requested
- **THEN** the system responds with HTTP 503, a JSON body and `Retry-After`

#### Scenario: A slot is released on disconnect

- **WHEN** a client disconnects during an export at the cap and another export is requested
- **THEN** the new export is served

#### Scenario: A bounded read at the cap

- **WHEN** the maximum number of unbounded exports are running and a client requests CSV with `limit=10`
- **THEN** the page is served

### Requirement: HEAD on a CSV list sends no export

A `HEAD` request selecting CSV SHALL respond with the same status and headers as the `GET`, SHALL read at most the first batch, and SHALL NOT count toward the export cap.

#### Scenario: HEAD on a large list

- **WHEN** a client sends `HEAD /api/v1/taxa` with `Accept: text/csv`
- **THEN** the response has status 200, a `text/csv` content type and no body
- **AND** at most one batch query runs
