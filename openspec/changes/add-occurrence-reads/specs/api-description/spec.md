## MODIFIED Requirements

### Requirement: The document covers exactly the operations a client can rely on

The document SHALL contain every GET operation that the discovery documents reach,
including the routes nested under a resource (an occurrence's identifications,
reached through each embedded identification's `href`), and SHALL NOT contain an
operation whose response is not real data. The stub write routes, the read-only
`taxa` and `occurrences` groups' 405 write routes, every `specimens` route (stub
reads), and the description's own routes SHALL be hidden from it. A hidden route
still answers as before.

#### Scenario: Coverage matches discovery

- **WHEN** the GET paths reachable from `/api/v1` discovery are compared with the document's paths
- **THEN** each reachable path has a GET operation in the document, single reads included

#### Scenario: Nested reads are documented

- **WHEN** the document is read
- **THEN** it has GET operations for `/api/v1/occurrences/{permid}/identifications`
  and `/api/v1/occurrences/{permid}/identifications/{identificationPermid}`

#### Scenario: Stubs and write verbs are absent

- **WHEN** the document is read
- **THEN** it contains no POST, PUT, PATCH or DELETE operation and no `specimens` path
