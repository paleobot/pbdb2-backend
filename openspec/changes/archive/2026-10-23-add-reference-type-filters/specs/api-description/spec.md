## MODIFIED Requirements

### Requirement: Every documented operation states its parameters and its response

Every GET operation in the document SHALL list each query parameter the route accepts, with its type,
bounds and, for a parameter whose field declares an inline `enum`, its legal values in order. Rules
that span parameters or that the route enforces in code SHALL be stated in the parameter's
`description`: `ids` cannot be combined with `limit` or `cursor`; `ids` holds at most 100 distinct
permids; a `cursor` is opaque and is obtained from `links.next` / `links.prev`. A field filter's
description SHALL state how it matches (equality, the whole value, words contained, family names, a
year or range) and what it ignores (case, accents, runs of whitespace, a DOI prefix); the
`publicationYear` description SHALL state that both years of a range are included and the earlier
comes first. The description of a `references` filter on a field that only some publication types
allow SHALL name those types, computed from the reference source's `PUBLICATION_TYPES` (a type
allows a field when its `fields` list names it or it is unrestricted). Each operation
SHALL describe its HTTP 200 response as the envelope with its `data` schema.

#### Scenario: A list's filters are discoverable

- **WHEN** the document's `GET /api/v1/references` operation is read
- **THEN** it lists `ids`, `limit`, `cursor`, `publicationType`, `doi`, `title`, `authors`,
  `firstAuthor`, `publicationYear`, `journalTitle`, `seriesTitle`, `bookTitle`, `publisher`,
  `publicationCity` and `bookType`
- **AND** `limit` is an integer with minimum 1 and maximum 1000
- **AND** `publicationType` lists the reference source's publication types in enum order

#### Scenario: A filter's match rule is documented

- **WHEN** the document's `GET /api/v1/references` operation is read
- **THEN** `publicationYear` is a string with the pattern `^\d{4}(-\d{4})?$`
- **AND** its description says both years of a range are included
- **AND** the `authors` description says the names are comma-separated and all must be present
- **AND** the `journalTitle` description says the whole value must match

#### Scenario: A type-specific filter names the types that allow its field

- **WHEN** the document's `GET /api/v1/references` operation is read
- **THEN** the `journalTitle` description names `journal article` and `other`
- **AND** the `publisher` description names `standalone book`, `edited collection`,
  `article in edited collection`, `serial monograph` and `other`
- **AND** no shared-field filter's description names publication types

#### Scenario: bookType is documented without an enum

- **WHEN** the document's `GET /api/v1/references` operation is read
- **THEN** `bookType` is a string with no `enum`

#### Scenario: An expansion is discoverable

- **WHEN** the document's `GET /api/v1/taxa` operation is read
- **THEN** it lists `includeContainingTaxa` as a boolean
