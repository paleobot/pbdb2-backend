## MODIFIED Requirements

### Requirement: Page-scoped result counts

The list envelope's `meta.returned` SHALL be the number of records in the
returned page, not in the full result set. The system SHALL NOT compute a total
count of matching records for a paginated request. `meta` SHALL NOT carry a
second count equal to `returned` (the former `found`): a field name that suggests
a total SHALL NOT hold a page count. A total, if added later behind an opt-in
parameter, SHALL arrive under its own name and mean all matching records.

#### Scenario: Counts describe the page

- **WHEN** a paginated list request returns a page smaller than the full result
  set
- **THEN** `meta.returned` equals the number of records in that page

#### Scenario: No found count

- **WHEN** a client requests any list, including a multi-entity `ids` read
- **THEN** `meta` has no `found` field
