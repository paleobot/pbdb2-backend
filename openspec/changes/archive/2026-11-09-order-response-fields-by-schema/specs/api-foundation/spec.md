## ADDED Requirements

### Requirement: Response entities present permid first and fields in schema order

So that responses are readable in a browser, every entity in a read response SHALL have `permid` as its first field. This covers a resource, a character or state in a schema tree, and a link object.

A resource read through a payload source SHALL list its fields in the order its source schema declares them, with any undeclared field after the declared ones. An object nested in a record and declared with its own properties SHALL follow the same rule. A source schema SHALL declare `permid` first, SHALL declare `name` or `title` immediately after it where the schema declares either (`citation` on an authority, which has neither), and SHALL declare `legacyIDs` last where it declares it.

A link object SHALL list `permid`, then the target's label field, then `href`.

This order is a presentation convention. JSON objects are unordered, and clients SHALL NOT depend on field order.

#### Scenario: A resource lists permid first and legacyIDs after its other payload fields

- **WHEN** a client reads a reference, authority, collection or schema, singly or in a list
- **THEN** the first field of each record is `permid`
- **AND** the remaining fields follow the order declared by the resource's source schema
- **AND** no field declared before `legacyIDs` appears after it

#### Scenario: A record's name or title follows its permid

- **WHEN** a client reads a resource whose source schema declares `name` or `title`, and the record has a value for it
- **THEN** that field is the second field of the record, directly after `permid`

#### Scenario: An authority's citation follows its permid

- **WHEN** a client reads an authority
- **THEN** `citation` is the second field of the record, directly after `permid`

#### Scenario: A field the schema does not declare is kept

- **WHEN** a stored payload holds a key its source schema does not declare
- **THEN** the merged record still contains that key
- **AND** it follows every declared field present

#### Scenario: A declared nested object follows its schema

- **WHEN** a record contains a nested object whose schema declares properties
- **THEN** that object's fields follow the declared order

#### Scenario: Characters and states list permid first

- **WHEN** a client reads a single schema with its character and state tree
- **THEN** the first field of every character and state in the tree is `permid`

#### Scenario: Link objects list permid first

- **WHEN** a response contains a link object, including a taxon's `authority` or `accepted` link
- **THEN** its fields are `permid`, the target's label field, and `href`, in that order
