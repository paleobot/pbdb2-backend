## MODIFIED Requirements

### Requirement: Fetch all References from PBot GraphQL API
The script SHALL fetch all Reference nodes from `https://pbot.paleobiodb.org/graphql` using a single POST request. The query SHALL retrieve all scalar Reference fields (`pbotID`, `title`, `year`, `publicationType`, `firstPage`, `lastPage`, `journal`, `bookTitle`, `publicationVolume`, `publicationNumber`, `publisher`, `description`, `bookType`, `editors`, `notes`, `doi`, `pbdbid`) plus nested `enteredBy` (with `type`, `timestamp`, and `Person` fields) and `authoredBy` (with `order` and `Person` fields).

The request SHALL carry no Authorization header unless the script was invoked with `--pbot-include-private`, so that by default only the references PBot shows to anonymous visitors are fetched. With the flag, the request SHALL carry `Authorization: Bearer <PBOT_TOKEN>` (trimmed), and the script SHALL exit non-zero before fetching if `PBOT_TOKEN` is unset or blank. Before fetching, the script SHALL log `PBot access: anonymous, public records only` or `PBot access: token, including private records` accordingly. This SHALL be the same rule `pbot-schemas` follows, so that both steps see the same set of PBot records.

#### Scenario: Successful fetch
- **WHEN** the script sends the GraphQL query to pbot.paleobiodb.org
- **THEN** all Reference nodes are returned with their full field set, enteredBy relationships, and authoredBy relationships

#### Scenario: API unreachable
- **WHEN** the GraphQL endpoint is unreachable or returns an error
- **THEN** the script logs the error and exits with a non-zero exit code

#### Scenario: Public records by default
- **WHEN** the script is invoked without `--pbot-include-private`
- **THEN** the request carries no Authorization header, even if `PBOT_TOKEN` is set, the script logs `PBot access: anonymous, public records only`, and only public Reference nodes are returned

#### Scenario: Private records included on request
- **WHEN** the script is invoked with `--pbot-include-private` and `PBOT_TOKEN` is set
- **THEN** the request carries `Authorization: Bearer <PBOT_TOKEN>`, the script logs `PBot access: token, including private records`, and the Reference nodes visible to that token are returned

#### Scenario: Flag without a token
- **WHEN** the script is invoked with `--pbot-include-private` and `PBOT_TOKEN` is unset or blank
- **THEN** the script exits non-zero naming `PBOT_TOKEN`, before fetching and before writing any row
