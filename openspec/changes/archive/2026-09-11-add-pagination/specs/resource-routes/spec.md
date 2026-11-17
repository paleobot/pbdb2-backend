## ADDED Requirements

### Requirement: List endpoints accept pagination parameters

Every list endpoint — on the uniform resource groups and on `schemas` — SHALL
accept the `limit` and `cursor` pagination parameters and return a bounded page
with pagination links, per the `list-pagination` capability. A list endpoint
SHALL NOT return an unbounded result set.

#### Scenario: Every list endpoint is bounded

- **WHEN** a client sends GET to any resource list endpoint with no parameters
- **THEN** the system responds with HTTP 200
- **AND** `data` contains at most the default page size

### Requirement: The `schemas` list uses the shared list-filter seam

The `schemas` list endpoint SHALL parse its query parameters through the same
shared list-filter seam as the uniform resource groups, rather than reading heads
directly. It SHALL thereby accept the multi-entity `ids` read and the pagination
parameters on the same terms as every other list endpoint. The `schemas` single
read SHALL remain the aggregate tree, which is not paginated.

#### Scenario: Schemas list accepts ids

- **WHEN** a client sends GET to the `schemas` list endpoint with `?ids=` naming
  several `permid`s
- **THEN** the system responds with HTTP 200
- **AND** `data` contains exactly the requested schema heads

#### Scenario: Schemas list is paginated

- **WHEN** a client sends GET to the `schemas` list endpoint with `?limit=`
- **THEN** `data` contains at most that many schema heads
- **AND** `links.next` is a URL when further schemas exist

#### Scenario: The schema tree is not paginated

- **WHEN** a client requests a single schema by `permid`
- **THEN** the aggregate tree is returned whole, with its nested characters and
  states unpaginated
