## MODIFIED Requirements

### Requirement: Fetch Schemas from PBot GraphQL API
The script SHALL fetch all Schema nodes from `https://pbot.paleobiodb.org/graphql` using a POST request. The query SHALL retrieve schema scalar fields (`pbotID`, `title`, `year`, `purpose`, `acknowledgments`), `partsPreserved` and `notableFeatures` (as relationship nodes or string values), `references` (with `order` and Reference `pbotID`, `pbdbid` and `title`), `authoredBy` (with `order` and Person `given`, `surname`), and `enteredBy` (with `type`, `timestamp`, and Person `pbotID`).

The request SHALL carry no Authorization header unless the script was invoked with `--pbot-include-private`, so that by default only the schemas, characters and states PBot shows to anonymous visitors are fetched. With the flag, the request SHALL carry `Authorization: Bearer <PBOT_TOKEN>` (trimmed), and the script SHALL exit non-zero before fetching if `PBOT_TOKEN` is unset or blank. Before fetching, the script SHALL log `PBot access: anonymous, public records only` or `PBot access: token, including private records` accordingly. The Character and State fetches SHALL use the same access as the Schema fetch.

#### Scenario: Successful fetch
- **WHEN** the script sends the GraphQL query
- **THEN** all Schema nodes are returned with their full field set and relationships, and each cited Reference carries its `pbotID`, `pbdbid` and `title`

#### Scenario: API unreachable
- **WHEN** the GraphQL endpoint is unreachable or returns an error
- **THEN** the script logs the error and exits with a non-zero exit code

#### Scenario: Public records by default
- **WHEN** the script is invoked without `--pbot-include-private`
- **THEN** the request carries no Authorization header, even if `PBOT_TOKEN` is set, the script logs `PBot access: anonymous, public records only`, and only public Schema, Character and State nodes are returned

#### Scenario: Private records included on request
- **WHEN** the script is invoked with `--pbot-include-private` and `PBOT_TOKEN` is set
- **THEN** the request carries `Authorization: Bearer <PBOT_TOKEN>`, the script logs `PBot access: token, including private records`, and the Schema, Character and State nodes visible to that token are returned

#### Scenario: Flag without a token
- **WHEN** the script is invoked with `--pbot-include-private` and `PBOT_TOKEN` is unset or blank
- **THEN** the script exits non-zero naming `PBOT_TOKEN`, before fetching and before writing any row
