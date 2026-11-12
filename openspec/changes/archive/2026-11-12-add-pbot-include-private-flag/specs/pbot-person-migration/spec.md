## MODIFIED Requirements

### Requirement: Fetch Person nodes from PBot GraphQL API
The script SHALL fetch all Person nodes from `https://pbot.paleobiodb.org/graphql` using a single POST request. The query SHALL retrieve `pbotID`, `given`, `surname`, `email`, `orcid`, and `registered` fields.

The request SHALL always carry `Authorization: Bearer <PBOT_TOKEN>` (trimmed), because PBot returns `email` as null to anonymous requests and the script filters and matches persons by email. The script SHALL exit non-zero before fetching if `PBOT_TOKEN` is unset or blank, and SHALL log `PBot access: token (person emails are not public)` before fetching. `--pbot-include-private` does not apply to this step.

#### Scenario: Successful fetch
- **WHEN** the script sends the GraphQL query to pbot.paleobiodb.org
- **THEN** all Person nodes are returned with their full field set

#### Scenario: API unreachable
- **WHEN** the GraphQL endpoint is unreachable or returns an error
- **THEN** the script logs the error and exits with a non-zero exit code

#### Scenario: Token always sent
- **WHEN** the script fetches Person nodes, with or without `--pbot-include-private` given to the runner
- **THEN** the request carries `Authorization: Bearer <PBOT_TOKEN>` and persons are returned with their emails

#### Scenario: Missing token
- **WHEN** `PBOT_TOKEN` is unset or blank
- **THEN** the script exits non-zero naming `PBOT_TOKEN`, before fetching and before writing any row
