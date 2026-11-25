## MODIFIED Requirements

### Requirement: Which reads offer CSV

The list and `ids` reads of `references`, `authorities`, `collections`, `taxa` and `occurrences` SHALL offer CSV. Each route SHALL declare the non-JSON formats it offers. A `GET` or `HEAD` request that selects a format the API produces, on a route that does not offer it, SHALL be answered with HTTP 406 in the standard error shape, before its query is validated. A request selects a format under the same rule by which it selects CSV. A media type the API never produces SHALL be answered with JSON.

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

#### Scenario: Occurrences offer CSV

- **WHEN** a client sends `GET /api/v1/occurrences?collection=<permid>` with `Accept: text/csv`
- **THEN** the response is CSV whose columns come from the occurrence source, including `identification.name`, `identification.taxon.permid`, `identification.taxon.name`, `identification.reference.permid` and `acceptedTaxon.name`

#### Scenario: An occurrence's identifications do not offer CSV

- **WHEN** a client sends `GET /api/v1/occurrences/{permid}/identifications` with `Accept: text/csv`
- **THEN** the system responds with HTTP 406 in the standard error shape
