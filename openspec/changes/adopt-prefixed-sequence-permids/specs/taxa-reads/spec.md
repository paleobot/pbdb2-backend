## MODIFIED Requirements

### Requirement: Taxa lists are paginated in `permid` order

The `taxa` list endpoint SHALL accept `limit` and `cursor` and return a bounded
page with pagination links, on the same terms as every other list endpoint, using
the stable numeric `permid` ordering the pagination capability defines. Taxa
permids are `NOP` permids, so for migrated taxa this is Classic `taxon_no` order.
The `taxa` list SHALL NOT be unbounded.

#### Scenario: Taxa list is bounded and paginated

- **WHEN** a client sends GET to the `taxa` list endpoint with no parameters
- **THEN** `data` contains at most the default page size
- **AND** `links.next` is a URL when further taxa exist

#### Scenario: Taxa are ordered by taxon number

- **WHEN** a client pages through the `taxa` list
- **THEN** a taxon whose permid is `NOP-99-…` is returned before one whose permid is `NOP-100-…`
