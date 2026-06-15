# auth-stub

## Purpose

The write-verb protection seam for the PBDB2 API: a reusable `authenticate`
decorator attached to write verbs. Currently a no-op pass-through stub to be
replaced by real JWT verification (and a login route) in a future change.

## Requirements

### Requirement: Authentication seam on write verbs

The system SHALL provide a reusable authentication seam, exposed as a Fastify
`authenticate` decorator, and SHALL attach it as a `preHandler` to every write
verb (POST, PUT, PATCH, DELETE) across all resource route groups. Read verbs
(GET) SHALL NOT require authentication.

#### Scenario: Write verbs run the authenticate seam

- **WHEN** a client sends a POST, PUT, PATCH, or DELETE request to a resource
- **THEN** the `authenticate` seam runs before the route handler

#### Scenario: Read verbs are open

- **WHEN** a client sends a GET request to a resource
- **THEN** the request is handled without invoking the `authenticate` seam

### Requirement: Stubbed pass-through authentication

For this change, the `authenticate` seam SHALL be a no-op pass-through that
allows the request to proceed, and SHALL be clearly documented as a stub to be
replaced by real JWT verification in a future change. It SHALL NOT issue,
verify, or reject tokens.

#### Scenario: Stub allows the request through

- **WHEN** the `authenticate` seam runs on a write request
- **THEN** it permits the request to continue to the route handler
- **AND** it does not verify or require any token

#### Scenario: Login and token issuance are absent

- **WHEN** the scaffold is in place
- **THEN** no login route or token-issuance endpoint is provided
