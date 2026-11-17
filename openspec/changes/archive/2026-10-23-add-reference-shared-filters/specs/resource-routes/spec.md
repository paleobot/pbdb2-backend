## MODIFIED Requirements

### Requirement: Per-entity field filters

The system SHALL support per-entity field filters on the list endpoint, declared
per resource and matching a query-parameter value against a field within that
resource's JSONB payload. A field filter's query parameter SHALL be the name of
the payload field it matches, or, for a filter that matches only part of a field,
a camelCase name for that part (`firstAuthor` matches the first element of
`authors`), so that parameters, expansions and response fields share one camelCase
vocabulary. The `references` group SHALL support a
`publicationType` filter matching the payload's `publicationType` field. Field
filters SHALL compose with the multi-entity `ids` read and with one another,
narrowing the same set of current, non-removed heads (logical AND).

When the field a filter matches is a property of the resource's payload source
that declares an `enum`, the filter's legal values SHALL be exactly that enum, and
a value outside it SHALL be rejected with HTTP 400 in the standard error shape.
The error message SHALL name the parameter and list the legal values in enum
order. The comparison is exact, after trimming surrounding whitespace. The
`references` `publicationType` filter takes its legal values from the reference
source's `publicationType` enum. A filter whose field has no such enum accepts any
non-empty value.

A legal field-filter value that matches no current head SHALL yield an empty
result with HTTP 200 — field filters are pure filters and SHALL NOT produce the
`meta.missing` accounting reserved for the `ids` set semantics. A field-filter
parameter that is present with an empty value SHALL be rejected with HTTP 400.

When a field filter is combined with the `ids` read, the request SHALL be
treated as a filtered query: the `ids` partial-success accounting
(`meta.requested` / `meta.missing`) SHALL be suppressed. That accounting answers
"which requested ids have no current head?", which is only well-defined when the
id set is the sole constraint — a field filter introduces a second reason an id
can be absent from the result (filtered out rather than non-existent), so the
signal is withheld rather than overloaded.

#### Scenario: References filtered by publication type

- **WHEN** a client sends GET to the `references` list endpoint with
  `?publicationType=` naming a value
- **THEN** the system responds with HTTP 200
- **AND** `data` contains only the current heads whose `publicationType` equals
  that value

#### Scenario: The former snake_case name is unrecognized

- **WHEN** a client sends GET to `references` with `?publication_type=` naming a
  legal value
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the message names `publication_type` as unrecognized and lists
  `publicationType` among the accepted parameters

#### Scenario: Field filter composes with ids

- **WHEN** a client sends GET to `references` with both `?ids=` and
  `?publicationType=`
- **THEN** `data` contains only the requested ids that also match the
  publication type
- **AND** the `ids` partial-success accounting (`meta.requested` /
  `meta.missing`) is suppressed

#### Scenario: Field filter with no match

- **WHEN** a client sends `?publicationType=` with a legal value no current head has
- **THEN** the system responds with HTTP 200 and an empty `data` array
- **AND** no `meta.missing` accounting is produced

#### Scenario: Empty field-filter value is a 400

- **WHEN** a client sends `?publicationType=` with no value
- **THEN** the system responds with HTTP 400 in the standard error shape

#### Scenario: Field-filter value outside the enum is a 400

- **WHEN** a client sends `?publicationType=book`, which is not one of the
  reference source's publication types
- **THEN** the system responds with HTTP 400 in the standard error shape
- **AND** the message names `publicationType` and lists the legal values,
  including `standalone book`

#### Scenario: Enum check applies to the ids read

- **WHEN** a client sends `?ids=` together with a `publicationType` value outside
  the enum
- **THEN** the system responds with HTTP 400, as it would on a plain list

#### Scenario: Legal values come from the source

- **WHEN** the `references` repository is built
- **THEN** its `publicationType` filter's legal values equal
  `referenceSource.properties.publicationType.enum`, in order

## ADDED Requirements

### Requirement: Reference filters on shared fields

The `references` list endpoint SHALL support the field filters `doi`, `title`,
`authors`, `firstAuthor` and `publicationYear`, which match fields every publication
type carries. They follow the per-entity field-filter rules: they compose with each
other, with `publicationType` and with `ids` (logical AND); an empty value is a 400;
a legal value that matches nothing is an empty 200. Every comparison is made after
trimming the value's surrounding whitespace.

- `doi` SHALL match a reference whose stored `doi`, with a leading
  `https://doi.org/`, `http://doi.org/`, `https://dx.doi.org/`, `http://dx.doi.org/`
  or `doi:` removed, equals the parameter value with the same prefix removed,
  ignoring case. A value that is empty once the prefix is removed SHALL be a 400.
- `title` SHALL match a reference whose `title` contains every whitespace-separated
  word of the value as a substring, in any order, ignoring case and accents. The
  characters `%`, `_` and `\` in the value SHALL be matched literally. A reference
  with no `title` SHALL NOT match.
- `authors` SHALL take a comma-separated list of family names and match a reference
  that has, for each name, at least one author whose `familyName` equals it, ignoring
  case and accents. An empty item in the list SHALL be a 400.
- `firstAuthor` SHALL take one family name and match a reference whose first author's
  `familyName` equals it, ignoring case and accents. A value containing a comma SHALL
  be a 400.
- `publicationYear` SHALL take a four-digit year (`YYYY`) or a range of two
  (`YYYY-YYYY`), and match a reference whose stored `publicationYear` is four digits
  and lies in that year or range, both ends included. A range whose first year is
  later than its second SHALL be a 400 that names the parameter; any other form
  SHALL be a 400 that names the parameter and the accepted forms. A stored
  `publicationYear` that is not four digits SHALL NOT match.

`enteredBy` is not a filter; a request naming it is an unrecognized parameter.

#### Scenario: A DOI matches across prefix and case

- **GIVEN** a current reference whose stored `doi` is `https://doi.org/10.1234/ABC`
- **WHEN** a client sends GET to `references` with `?doi=10.1234/abc`
- **THEN** the system responds with HTTP 200 and `data` includes that reference
- **AND** the same reference is returned for `?doi=doi:10.1234/ABC`

#### Scenario: A DOI is not unique

- **GIVEN** two current references with the same `doi`
- **WHEN** a client sends `?doi=` naming it
- **THEN** `data` contains both

#### Scenario: Title words match in any order

- **GIVEN** a current reference titled `Archosaurs of the Late Triassic`
- **WHEN** a client sends `?title=triassic archosaur`
- **THEN** `data` includes that reference
- **AND** `?title=triassic mammal` does not return it

#### Scenario: Title matching ignores accents and treats wildcards literally

- **GIVEN** a current reference titled `Faunes du Pliocène`
- **WHEN** a client sends `?title=pliocene`
- **THEN** `data` includes that reference
- **AND** `?title=%` returns only references whose title contains a `%`

#### Scenario: Every named author must be present

- **GIVEN** a current reference whose authors have the family names `Sues` and
  `Reisz`, and another whose only author is `Sues`
- **WHEN** a client sends `?authors=sues,Reisz`
- **THEN** `data` includes the first reference and not the second

#### Scenario: Author matching ignores accents and case

- **GIVEN** a current reference with an author whose `familyName` is `Schröder`
- **WHEN** a client sends `?authors=schroder`
- **THEN** `data` includes that reference

#### Scenario: Author matching is on the whole family name

- **GIVEN** a current reference whose only author's `familyName` is `de la Fuente`
- **WHEN** a client sends `?authors=Fuente`
- **THEN** `data` does not include that reference

#### Scenario: An empty author item is a 400

- **WHEN** a client sends `?authors=Sues,`
- **THEN** the system responds with HTTP 400 in the standard error shape naming
  `authors`

#### Scenario: firstAuthor matches only the first author

- **GIVEN** a current reference whose authors are, in order, `Reisz` then `Sues`
- **WHEN** a client sends `?firstAuthor=Sues`
- **THEN** `data` does not include that reference
- **AND** `?firstAuthor=Reisz` includes it

#### Scenario: firstAuthor takes one name

- **WHEN** a client sends `?firstAuthor=Sues,Reisz`
- **THEN** the system responds with HTTP 400 in the standard error shape naming
  `firstAuthor`

#### Scenario: A single year matches that year

- **WHEN** a client sends `?publicationYear=1990`
- **THEN** `data` contains only current references whose `publicationYear` is `1990`

#### Scenario: A year range includes both ends

- **GIVEN** current references published in `1989`, `1990`, `2000` and `2001`
- **WHEN** a client sends `?publicationYear=1990-2000`
- **THEN** `data` includes the `1990` and `2000` references and not the `1989` or
  `2001` ones

#### Scenario: A reversed year range is a 400

- **WHEN** a client sends `?publicationYear=2000-1990`
- **THEN** the system responds with HTTP 400 in the standard error shape naming
  `publicationYear`

#### Scenario: A malformed year is a 400

- **WHEN** a client sends `?publicationYear=79`, `?publicationYear=1990-` or
  `?publicationYear=1990..2000`
- **THEN** the system responds with HTTP 400 in the standard error shape naming
  `publicationYear` and the forms `YYYY` and `YYYY-YYYY`

#### Scenario: A stored year that is not four digits never matches

- **GIVEN** a current reference whose stored `publicationYear` is `79`
- **WHEN** a client sends `?publicationYear=0001-9999`
- **THEN** `data` does not include that reference

#### Scenario: Shared-field filters compose

- **WHEN** a client sends `?firstAuthor=Sues&publicationYear=1990-2000&title=dinosaur`
- **THEN** `data` contains only current references matching all three

#### Scenario: enteredBy is not a filter

- **WHEN** a client sends `?enteredBy=Smith`
- **THEN** the system responds with HTTP 400 naming `enteredBy` as unrecognized
