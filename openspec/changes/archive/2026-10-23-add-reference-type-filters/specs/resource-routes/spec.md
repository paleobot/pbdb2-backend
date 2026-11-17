## ADDED Requirements

### Requirement: Reference filters on type-specific fields

The `references` list endpoint SHALL support the field filters `journalTitle`,
`seriesTitle`, `bookTitle`, `publisher`, `publicationCity` and `bookType`, which match
fields that only some publication types allow. They follow the per-entity field-filter
rules: they compose with each other, with the shared-field filters, with
`publicationType` and with `ids` (logical AND); an empty value is a 400; a value that
matches nothing is an empty 200. Every comparison is made after trimming the value's
surrounding whitespace.

A filter SHALL match its field wherever the field is stored, whatever the reference's
`publicationType`. It SHALL NOT add a `publicationType` condition, and it SHALL NOT
require a `publicationType` parameter. A request whose filters contradict each other
(a `bookType` with `publicationType=journal article`) SHALL be an empty 200, not a 400.

- `journalTitle` and `seriesTitle` SHALL match a reference whose whole stored value
  equals the parameter value, ignoring case and accents, after each run of whitespace on
  both sides is collapsed to one space. A stored value that contains the parameter value
  as part of a longer title SHALL NOT match.
- `bookTitle`, `publisher` and `publicationCity` SHALL match a reference whose stored
  value contains every whitespace-separated word of the parameter value as a substring,
  in any order, ignoring case and accents, with `%`, `_` and `\` matched literally, as
  `title` does.
- `bookType` SHALL match a reference whose stored `bookType` equals the parameter value
  exactly. Its value is opaque: a value outside the `book_types` dictionary SHALL be an
  empty 200, not a 400, because the field has no inline `enum`.

A reference with no value for a filter's field SHALL NOT match that filter.

#### Scenario: A journal title matches the whole title only

- **GIVEN** current references in the journals `Palaeontology` and
  `Journal of Systematic Palaeontology`
- **WHEN** a client sends GET to `references` with `?journalTitle=palaeontology`
- **THEN** the system responds with HTTP 200
- **AND** `data` includes the `Palaeontology` reference and not the other one

#### Scenario: A journal title ignores accents and whitespace runs

- **GIVEN** a current reference whose stored `journalTitle` is
  `Revue de  Paléobiologie`, with two spaces after `de`
- **WHEN** a client sends `?journalTitle=revue de paleobiologie`
- **THEN** `data` includes that reference

#### Scenario: A series title matches the whole title

- **GIVEN** a current reference whose stored `seriesTitle` is
  `American Museum Novitates`
- **WHEN** a client sends `?seriesTitle=american museum novitates`
- **THEN** `data` includes that reference
- **AND** `?seriesTitle=Novitates` does not return it

#### Scenario: Publisher words match variants

- **GIVEN** current references whose publishers are `Elsevier` and `Elsevier BV`
- **WHEN** a client sends `?publisher=elsevier`
- **THEN** `data` includes both

#### Scenario: Publication city words match in any order

- **GIVEN** a current reference whose `publicationCity` is `Washington, D.C.`
- **WHEN** a client sends `?publicationCity=washington`
- **THEN** `data` includes that reference

#### Scenario: A book title matches the containing book

- **GIVEN** a current `article in edited collection` whose `bookTitle` is
  `The Dinosauria`, and a current `edited collection` whose `title` is
  `The Dinosauria` and which has no `bookTitle`
- **WHEN** a client sends `?bookTitle=dinosauria`
- **THEN** `data` includes the article and not the edited collection

#### Scenario: bookType matches exactly

- **GIVEN** a current reference whose `bookType` is `Ph.D. thesis`
- **WHEN** a client sends `?bookType=Ph.D. thesis`
- **THEN** `data` includes that reference

#### Scenario: An unknown bookType is an empty 200

- **WHEN** a client sends `?bookType=novel`
- **THEN** the system responds with HTTP 200 and an empty `data` array

#### Scenario: A field on a type that does not allow it still matches

- **GIVEN** a current `journal article` whose stored `publisher` is `Elsevier BV`
- **WHEN** a client sends `?publisher=Elsevier`
- **THEN** `data` includes that reference

#### Scenario: Contradictory filters are an empty 200

- **WHEN** a client sends `?publicationType=journal article&bookType=monograph`
- **THEN** the system responds with HTTP 200 and an empty `data` array, unless a
  stored journal article carries that `bookType`

#### Scenario: Type-specific filters compose with shared ones

- **WHEN** a client sends `?journalTitle=Palaeontology&publicationYear=2010-2020`
- **THEN** `data` contains only current references matching both
