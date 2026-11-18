## MODIFIED Requirements

### Requirement: Build reference JSONB from PBot fields
The script SHALL construct the `reference` JSONB column from PBot Reference fields using the following mapping:

| PBot field | JSONB field | Condition |
|---|---|---|
| `title` | `title` | Always |
| `year` | `publicationYear` | When non-null |
| `publicationType` | `publicationType` | Always, normalized (see Normalize publicationType to the reference enum) |
| `journal` | `journalTitle` | When publicationType is "journal article" |
| `publicationVolume` | `journalVolume` | When publicationType is "journal article" |
| `journal` | `seriesTitle` | When publicationType is "serial monograph" |
| `publicationVolume` | `seriesVolume` | When publicationType is "serial monograph" |
| `publicationNumber` | `journalNumber` | When publicationType is "journal article" |
| `publicationNumber` | `seriesNumber` | When publicationType is "serial monograph" |
| `publisher` | `publisher` | When non-null |
| `bookTitle` | `bookTitle` | When non-null |
| `bookType` | `bookType` | When non-null; a value not in `dictionaries.book_types.name` becomes `other` |
| `editors` | `editors` | When non-null |
| `doi` | `doi` | When non-null |
| `firstPage` / `lastPage` | `pages: {first, last}` | When firstPage is non-null and numeric |
| `notes` | `comments` | When non-null |
| `description` | `description` | When non-null |
| `pbotID` | `legacyIDs.pbotID` | Always (nested under legacyIDs object) |
| (none) | `language` | Always "unknown" |

The `authors` array SHALL be built from the `authoredBy` relationship, sorted by the `order` property, with each entry containing `{ familyName: Person.surname, givenName: Person.given }`.

After mapping, the script SHALL keep only the shared fields and the fields the normalized type allows, as
defined by `PUBLICATION_TYPES` in `payloadSchemas/reference.schema.js`; it SHALL NOT keep its own copy of the
lists. Each field removed SHALL be logged with the reference's `pbotID`, the field name and the value. A type
declared unrestricted (`other`) keeps every mapped field.

PBot refs are held to the create-time field rule and PBDB refs are not, because PBot's extras are entry
noise from a UI that never enforced types (`publisher: "PBot"`, `"self"`, `"TBD"` on unpublished workbench
entries), while PBDB's are bibliographic history.

#### Scenario: Journal article with full fields
- **WHEN** a PBot Reference has `publicationType = 'journal article'`, `title = 'Test'`, `year = '2023'`, `journal = 'Nature'`, `publicationVolume = '123'`, `publicationNumber = '4'`, `doi = '10.1234/test'`, and two authoredBy persons
- **THEN** the JSONB contains `{ publicationType: 'journal article', title: 'Test', publicationYear: '2023', journalTitle: 'Nature', journalVolume: '123', journalNumber: '4', doi: '10.1234/test', language: 'unknown', authors: [{familyName, givenName}, ...], legacyIDs: { pbotID: '...' } }`

#### Scenario: Notes mapped to comments
- **WHEN** a PBot Reference has `notes = 'Needs verification'`
- **THEN** the JSONB contains `comments: "Needs verification"`

#### Scenario: Description mapped to description
- **WHEN** a PBot Reference of type `unpublished` has `description = 'Unpublished field notes from 2019 expedition'`
- **THEN** the JSONB contains `description: "Unpublished field notes from 2019 expedition"`

#### Scenario: Both notes and description present
- **WHEN** a PBot Reference of type `unpublished` has `notes = 'Review pending'` and `description = 'Lab dataset'`
- **THEN** the JSONB contains both `comments: "Review pending"` and `description: "Lab dataset"`

#### Scenario: pbotID nested under legacyIDs
- **WHEN** a PBot Reference has `pbotID = 'ec4353ee-467a-43cc-8383-524bd63987a7'`
- **THEN** the JSONB contains `legacyIDs: { pbotID: 'ec4353ee-467a-43cc-8383-524bd63987a7' }`

#### Scenario: Pages parsing
- **WHEN** a PBot Reference has `firstPage = '42'` and `lastPage = '58'`
- **THEN** the JSONB contains `pages: { first: 42, last: 58 }`

#### Scenario: Non-numeric pages
- **WHEN** a PBot Reference has `firstPage = 'e12345'`
- **THEN** the `pages` field is omitted from the JSONB and a warning is logged

#### Scenario: Authors ordered correctly
- **WHEN** a PBot Reference has authoredBy entries with `order = '2'` (Scott Wing) and `order = '1'` (Nathan Jud)
- **THEN** the JSONB `authors` array is `[{familyName: 'Jud', givenName: 'Nathan'}, {familyName: 'Wing', givenName: 'Scott'}]`

#### Scenario: Placeholder publisher dropped from an unpublished ref
- **WHEN** a PBot Reference of type `unpublished` has `publisher = 'PBot'`
- **THEN** the JSONB has no `publisher`, and the log names the `pbotID`, `publisher` and `"PBot"`

#### Scenario: Unmatched book type becomes other
- **WHEN** a PBot Reference of type `standalone book` has `bookType = 'thesis'`
- **THEN** the JSONB contains `bookType: "other"`, and the log names the `pbotID` and the original value

#### Scenario: Matching book type is kept
- **WHEN** a PBot Reference of type `standalone book` has `bookType = 'monograph'`
- **THEN** the JSONB contains `bookType: "monograph"`

#### Scenario: Catch-all keeps every field
- **WHEN** a PBot Reference of type `other` has `publisher = 'Geological Society of America'`
- **THEN** the JSONB keeps `publisher`

#### Scenario: Known drop count
- **WHEN** the migration runs against the current PBot data
- **THEN** it drops 18 fields from 15 references, and a run dropping more is a regression

#### Scenario: Serial monograph volume and number
- **WHEN** a PBot Reference has `publicationType = 'serial monograph'`, `journal = 'NMMNH Bulletin'`, `publicationVolume = '12'` and `publicationNumber = '3'`
- **THEN** the JSONB contains `seriesTitle: "NMMNH Bulletin"`, `seriesVolume: "12"` and `seriesNumber: "3"`, and no `journalTitle`, `journalVolume` or `journalNumber`
