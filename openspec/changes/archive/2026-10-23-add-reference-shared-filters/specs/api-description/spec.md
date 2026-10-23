## MODIFIED Requirements

### Requirement: Every documented operation states its parameters and its response

Every GET operation in the document SHALL list each query parameter the route accepts, with its type,
bounds and, for a parameter whose field declares an inline `enum`, its legal values in order. Rules
that span parameters or that the route enforces in code SHALL be stated in the parameter's
`description`: `ids` cannot be combined with `limit` or `cursor`; `ids` holds at most 100 distinct
permids; a `cursor` is opaque and is obtained from `links.next` / `links.prev`. A field filter's
description SHALL state how it matches (equality, words contained, family names, a year or range)
and what it ignores (case, accents, a DOI prefix); the `publicationYear` description SHALL state
that both years of a range are included and the earlier comes first. Each operation
SHALL describe its HTTP 200 response as the envelope with its `data` schema.

#### Scenario: A list's filters are discoverable

- **WHEN** the document's `GET /api/v1/references` operation is read
- **THEN** it lists `ids`, `limit`, `cursor`, `publicationType`, `doi`, `title`, `authors`,
  `firstAuthor` and `publicationYear`
- **AND** `limit` is an integer with minimum 1 and maximum 1000
- **AND** `publicationType` lists the reference source's publication types in enum order

#### Scenario: A filter's match rule is documented

- **WHEN** the document's `GET /api/v1/references` operation is read
- **THEN** `publicationYear` is a string with the pattern `^\d{4}(-\d{4})?$`
- **AND** its description says both years of a range are included
- **AND** the `authors` description says the names are comma-separated and all must be present

#### Scenario: An expansion is discoverable

- **WHEN** the document's `GET /api/v1/taxa` operation is read
- **THEN** it lists `includeContainingTaxa` as a boolean
