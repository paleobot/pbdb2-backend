-- ============================================================================
-- 02-core.sql — the DDL, part 2 of 3
-- ----------------------------------------------------------------------------
-- The tables the application writes: the versioning trigger functions, the
-- versioned entities (persons through authorities), the opinion ledgers
-- (name_opinions, assignment_opinions, validity_opinions) and the hand-entered
-- taxon tables outside the derivation stack (taxon_annotations, homonyms).
--
-- Load order: 01-dictionaries.sql, 02-core.sql, 03-taxa.sql. A file refers only
-- to objects in itself or an earlier file (openspec/specs/ddl-layout): nothing
-- here may name a table or function from 03-taxa.sql, including in a trigger.
-- A trigger on a table here that runs a taxa function is defined in 03-taxa.sql.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis; -- collections.location is a geography column
CREATE EXTENSION IF NOT EXISTS unaccent; -- the API's accent-insensitive text filters (references title, authors)
CREATE SCHEMA lookup;

-- ============================================================
-- Entity versioning trigger system
-- Automatically swings FK references when a new entity version
-- is inserted and maintains the version chain.
-- ============================================================

-- Core function: finds all FKs pointing at target_table via pg_constraint
-- and updates them from old_id to new_id, excluding version-chain columns.
CREATE OR REPLACE FUNCTION swing_fks_to_new_version(
    target_table text,
    old_id bigint,
    new_id bigint
) RETURNS void AS $$
DECLARE
    fk record;
BEGIN
    FOR fk IN
        SELECT
            src_ns.nspname AS src_schema,
            src.relname    AS src_table,
            a_src.attname  AS src_column
        FROM pg_constraint con
        JOIN pg_class     src    ON con.conrelid  = src.oid
        JOIN pg_namespace src_ns ON src.relnamespace = src_ns.oid
        JOIN pg_class     tgt    ON con.confrelid = tgt.oid
        JOIN pg_attribute a_src
            ON  a_src.attrelid = con.conrelid
            AND a_src.attnum   = ANY(con.conkey)
        WHERE con.contype = 'f'
          AND tgt.relname = target_table
          AND a_src.attname NOT IN ('preceded_by_id', 'succeeded_by_id')
    LOOP
        EXECUTE format(
            'UPDATE %I.%I SET %I = $1 WHERE %I = $2',
            fk.src_schema, fk.src_table,
            fk.src_column, fk.src_column
        ) USING new_id, old_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- BEFORE INSERT trigger function: automatically determines lineage placement.
-- Finds the current head of the lineage (matching permid, succeeded_by_id IS NULL)
-- and sets preceded_by_id accordingly. Always clears succeeded_by_id.
CREATE OR REPLACE FUNCTION place_in_lineage()
RETURNS trigger AS $$
DECLARE
    head_id bigint;
    head_count integer;
BEGIN
    -- Count existing lineage heads for this permid
    EXECUTE format(
        'SELECT count(*), max(id) FROM %I WHERE permid = $1 AND succeeded_by_id IS NULL',
        TG_TABLE_NAME
    ) USING NEW.permid INTO head_count, head_id;

    IF head_count > 1 THEN
        RAISE EXCEPTION 'Corrupted lineage: % heads found for permid % in table %',
            head_count, NEW.permid, TG_TABLE_NAME;
    END IF;

    -- Set preceded_by_id to the head (NULL if new lineage)
    IF head_count = 1 THEN
        NEW.preceded_by_id := head_id;
    ELSE
        NEW.preceded_by_id := NULL;
    END IF;

    -- Always clear succeeded_by_id on insert
    NEW.succeeded_by_id := NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function: swings FKs and sets succeeded_by_id on the old version.
-- Fires AFTER INSERT when preceded_by_id IS NOT NULL.
CREATE OR REPLACE FUNCTION handle_new_version()
RETURNS trigger AS $$
BEGIN
    -- Swing all external FK references from old version to new
    PERFORM swing_fks_to_new_version(TG_TABLE_NAME, NEW.preceded_by_id, NEW.id);

    -- Close out the old version
    EXECUTE format(
        'UPDATE %I SET succeeded_by_id = $1 WHERE id = $2',
        TG_TABLE_NAME
    ) USING NEW.id, NEW.preceded_by_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper: installs both version triggers on a given table.
CREATE OR REPLACE FUNCTION install_version_triggers(target_table text)
RETURNS void AS $$
BEGIN
    EXECUTE format(
        'CREATE TRIGGER a_place_in_lineage
         BEFORE INSERT ON %I
         FOR EACH ROW
         EXECUTE FUNCTION place_in_lineage()',
        target_table
    );
    EXECUTE format(
        'CREATE TRIGGER b_swing_fks_on_new_version
         AFTER INSERT ON %I
         FOR EACH ROW
         WHEN (NEW.preceded_by_id IS NOT NULL)
         EXECUTE FUNCTION handle_new_version()',
        target_table
    );
    -- Partial index backing the place_in_lineage() head lookup
    -- (WHERE permid = $1 AND succeeded_by_id IS NULL). Without it, every insert
    -- seq-scans the table and bulk loads degrade to O(n^2).
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (permid) WHERE succeeded_by_id IS NULL',
        target_table || '_permid_head_idx',
        target_table
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Permids (openspec/specs/prefixed-permids)
-- A permid is <PREFIX>-<number>-<CC>, e.g. COL-12345-70. CC is ISO 7064
-- MOD 97-10 over the whole ID with the hyphens removed and each letter
-- written as two digits (A=10 ... Z=35), so a mistyped prefix fails the check.
-- The functions below are the only implementation of the format: scripts and
-- tests get permids from register_permids() (legacy Classic numbers) and
-- mint_permids() (sequence numbers), never by formatting one themselves.
--
-- Prefixes, one per table that creates entities:
--   REF refs        PRS persons            COL collections   SPM specimens
--   INT intervals   TSC timescales         AUT authorities   TXN name_opinions
--   AOP assignment_opinions  VOP validity_opinions  TAN taxon_annotations
--   SCH schemas     CHR characters         STA states
-- TXN is Classic's taxon prefix: a taxon's permid is its root name opinion's, so
-- the derived taxa tables have no prefix of their own (TXN-<n> is not promised to
-- equal Classic txn:<n>).
-- ============================================================

-- One row per entity, written once when its permid is created. Every permid
-- column in the schema is an FK to it, and is COLLATE "C" like it: permids are
-- ASCII codes, so comparisons are bytewise. Neither collation orders permids by
-- number; that is permid_no's job. No entity-type column: the prefix says.
CREATE TABLE permids (
    permid text COLLATE "C" PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- One sequence per mintable prefix. The floor, 1,000,000, is above every Classic
-- number that becomes a permid (the largest is taxon_no, 526,272), so a minted
-- permid can't collide with a registered one and is visibly one digit longer.
CREATE SEQUENCE permid_ref_seq START WITH 1000000;
CREATE SEQUENCE permid_prs_seq START WITH 1000000;
CREATE SEQUENCE permid_col_seq START WITH 1000000;
CREATE SEQUENCE permid_spm_seq START WITH 1000000;
CREATE SEQUENCE permid_int_seq START WITH 1000000;
CREATE SEQUENCE permid_tsc_seq START WITH 1000000;
CREATE SEQUENCE permid_aut_seq START WITH 1000000;
CREATE SEQUENCE permid_txn_seq START WITH 1000000;
CREATE SEQUENCE permid_aop_seq START WITH 1000000;
CREATE SEQUENCE permid_vop_seq START WITH 1000000;
CREATE SEQUENCE permid_tan_seq START WITH 1000000;
CREATE SEQUENCE permid_sch_seq START WITH 1000000;
CREATE SEQUENCE permid_chr_seq START WITH 1000000;
CREATE SEQUENCE permid_sta_seq START WITH 1000000;

-- The ELSE of permid_prefix_digits: a SQL function can't raise by itself.
CREATE OR REPLACE FUNCTION permid_unknown_prefix(prefix text)
RETURNS text AS $$
BEGIN
    RAISE EXCEPTION 'unknown permid prefix %', prefix;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- The prefix written as digits (A=10 ... Z=35), e.g. TXN → 293323. This is the
-- one list of mintable prefixes; anything else, NULL included, raises. Plain SQL
-- so a call with a literal prefix folds to a constant.
CREATE OR REPLACE FUNCTION permid_prefix_digits(prefix text)
RETURNS text AS $$
    SELECT CASE prefix
        WHEN 'REF' THEN '271415'  WHEN 'PRS' THEN '252728'  WHEN 'COL' THEN '122421'
        WHEN 'SPM' THEN '282522'  WHEN 'INT' THEN '182329'  WHEN 'TSC' THEN '292812'
        WHEN 'AUT' THEN '103029'  WHEN 'TXN' THEN '293323'  WHEN 'AOP' THEN '102425'
        WHEN 'VOP' THEN '312425'  WHEN 'TAN' THEN '291023'  WHEN 'SCH' THEN '281217'
        WHEN 'CHR' THEN '121727'  WHEN 'STA' THEN '282910'
        ELSE permid_unknown_prefix(prefix)
    END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Raises unless prefix is one of the mintable prefixes above.
CREATE OR REPLACE FUNCTION permid_check_prefix(prefix text)
RETURNS void AS $$
BEGIN
    PERFORM permid_prefix_digits(prefix);
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- The MOD 97-10 check digits for prefix + number, as two characters. Not STRICT,
-- so it can be inlined into permid_is_valid.
CREATE OR REPLACE FUNCTION permid_check_digits(prefix text, number bigint)
RETURNS text AS $$
    SELECT lpad((98 - (permid_prefix_digits(prefix) || number::text || '00')::numeric % 97)::text, 2, '0')
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- (prefix, number) → '<PREFIX>-<number>-<CC>'.
CREATE OR REPLACE FUNCTION format_permid(prefix text, number bigint)
RETURNS text AS $$
BEGIN
    PERFORM permid_check_prefix(prefix);
    IF number IS NULL OR number < 1 THEN
        RAISE EXCEPTION 'permid number must be a positive integer, got %', number;
    END IF;
    RETURN prefix || '-' || number || '-' || permid_check_digits(prefix, number);
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- The CHECK on every permid column: value has this prefix, a number with no
-- leading zero, and correct check digits. Registration is the FK's job. Plain SQL
-- and not STRICT, so PostgreSQL inlines it into each CHECK and folds the literal
-- prefix's parts to constants; a NULL value still gives NULL. The first arm only
-- makes an unknown prefix raise whatever the value; the CASE keeps the bigint
-- cast away from values that fail the format.
CREATE OR REPLACE FUNCTION permid_is_valid(value text, prefix text)
RETURNS boolean AS $$
    SELECT CASE
        WHEN permid_prefix_digits(prefix) IS NULL THEN NULL
        WHEN value !~ ('^' || prefix || '-[1-9][0-9]{0,17}-[0-9]{2}$') THEN false
        ELSE split_part(value, '-', 3) = permid_check_digits(prefix, split_part(value, '-', 2)::bigint)
    END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Registers Classic numbers as permids and returns them in input order. All or
-- nothing: refuses numbers outside [1, floor), repeats within the call, and
-- permids already registered (two source rows claiming one number is an error,
-- never a merge).
CREATE OR REPLACE FUNCTION register_permids(prefix text, numbers bigint[])
RETURNS text[] AS $$
DECLARE
    result text[];
    taken text;
BEGIN
    PERFORM permid_check_prefix(prefix);
    IF EXISTS (SELECT 1 FROM unnest(numbers) AS n WHERE n IS NULL OR n < 1 OR n >= 1000000) THEN
        RAISE EXCEPTION 'register_permids(%): legacy numbers must be between 1 and 999999', prefix;
    END IF;
    IF (SELECT count(DISTINCT n) <> count(*) FROM unnest(numbers) AS n) THEN
        RAISE EXCEPTION 'register_permids(%): a number appears more than once', prefix;
    END IF;

    SELECT coalesce(array_agg(format_permid(prefix, n) ORDER BY i), '{}')
      INTO result
      FROM unnest(numbers) WITH ORDINALITY AS u(n, i);

    SELECT permid INTO taken FROM permids WHERE permid = ANY (result) LIMIT 1;
    IF taken IS NOT NULL THEN
        RAISE EXCEPTION 'register_permids(%): % is already registered', prefix, taken;
    END IF;

    INSERT INTO permids (permid) SELECT unnest(result);
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Takes n numbers from the prefix's sequence, registers them, and returns the
-- permids in sequence order. One call per batch, not per row.
CREATE OR REPLACE FUNCTION mint_permids(prefix text, n integer)
RETURNS text[] AS $$
DECLARE
    result text[];
BEGIN
    PERFORM permid_check_prefix(prefix);
    IF n IS NULL OR n < 0 THEN
        RAISE EXCEPTION 'mint_permids(%): n must be zero or more, got %', prefix, n;
    END IF;

    SELECT coalesce(array_agg(format_permid(prefix, v) ORDER BY v), '{}')
      INTO result
      FROM (SELECT nextval(format('permid_%s_seq', lower(prefix))::regclass) AS v
              FROM generate_series(1, n)) AS s;

    INSERT INTO permids (permid) SELECT unnest(result);
    RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE persons (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    -- Externally-facing identity for a person: PRS-<person_no>-<CC> for Classic
    -- persons, a sequence number for the rest (prefixed-permids). UNIQUE, unlike
    -- the permid on a versioned table: there, many rows share one permid (one per
    -- edit) and the head constraint enforces one *head* per number. persons is NOT
    -- versioned (no preceded_by_id/succeeded_by_id, no install_version_triggers
    -- call below), so there is no succession chain to carry that guarantee and
    -- UNIQUE carries "one row per permid" directly -- the same reasoning
    -- taxa_linnaean states inline in 03-taxa.sql.
    permid text COLLATE "C" NOT NULL UNIQUE REFERENCES permids CHECK (permid_is_valid(permid, 'PRS')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED UNIQUE,
    password text,
    role_id integer REFERENCES dictionaries.roles("id") NOT NULL,
    person jsonb NOT NULL,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- This requires a conditional expression, if the role_id is student or enterer, then it needs an authorizer or above
    active boolean,
    total_hours numeric,
    created_at timestamptz DEFAULT NOW()
);
    
 CREATE TABLE refs (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, --This is the id of the reference record. It will be unique for each version of the reference.
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'REF')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    reference jsonb NOT NULL, -- derived from JSON PBot node
    preceded_by_id bigint REFERENCES refs("id"),
    succeeded_by_id bigint REFERENCES refs("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW()

);
SELECT install_version_triggers('refs');

-- from scale_data in original
CREATE TABLE timescales (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'TSC')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id"),
    enterer_person_id integer REFERENCES persons("id"),
    name text NOT NULL,
    early_age numeric NOT NULL, -- equivalent to b_age/max_age
    late_age numeric NOT NULL, -- equivalent to t_age?min_age
    reference_id integer REFERENCES refs("id"),
    preceded_by_id integer REFERENCES timescales("id"),
    succeeded_by_id integer REFERENCES timescales("id"),
    created_at timestamptz DEFAULT NOW()
);
SELECT install_version_triggers('timescales');

-- From interval_data in original
CREATE TABLE intervals (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'INT')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id"),
    enterer_person_id integer REFERENCES persons("id"),
    name text NOT NULL,
    abbreviation varchar(4),
    early_age numeric NOT NULL, -- equivalent to b_age
    late_age numeric NOT NULL, -- equivalent to t_age
    interval_type integer REFERENCES dictionaries.interval_types("id"),
    zone_type integer   REFERENCES dictionaries.zone_types("id"), -- only if interval_type is zone
    reference_id integer REFERENCES refs("id"),
    preceded_by_id integer REFERENCES intervals("id"),
    succeeded_by_id integer REFERENCES intervals("id"),
    created_at timestamptz DEFAULT NOW()
);
SELECT install_version_triggers('intervals');

CREATE TABLE lookup.intervals_timescales (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    interval_id integer REFERENCES intervals("id"),
    timescale_id integer REFERENCES timescales("id")
);

CREATE TABLE collections (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, --This is the id of the collection record. It will be unique for each version of the collection.
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'COL')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    collection jsonb NOT NULL, -- Collection json -- taken directly from PBot!!!
    location geography, -- make sure PostGIS is installed
    reference_id bigint REFERENCES refs("id") NOT NULL, -- A single refs is considered the "primary".
    --early_age_id integer REFERENCES intervals("id"), --NOT NULL,
    --late_age_id integer REFERENCES intervals("id"), --NOT NULL, -- just repeat early_age if only 1 age given
    preceded_by_id bigint REFERENCES collections("id"),
    succeeded_by_id bigint REFERENCES collections("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW()
);
SELECT install_version_triggers('collections');

-- A lookup table for additional refs (called refs_secondary in original db)
CREATE TABLE additional_collection_refs (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    collection_id bigint REFERENCES collections("id"),
    reference_id bigint REFERENCES refs("id")
);
-- The API reads a page's child rows by parent (collection_id = ANY(<head ids>)).
CREATE INDEX additional_collection_refs_collection_idx ON additional_collection_refs (collection_id);

CREATE TABLE specimens (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, --This is the id of the specimen record. It will be unique for each version of the reference.
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'SPM')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    --specimen_type_id integer REFERENCES dictionaries.specimen_types("id"),
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    specimen jsonb NOT NULL, 
    name_opinions_permid text COLLATE "C" REFERENCES permids CHECK (permid_is_valid(name_opinions_permid, 'TXN')),
    oldpbdb_occurrence_no integer, -- For migration. Can be dropped after.
    collection_id bigint REFERENCES collections("id"), 
    reference_id bigint REFERENCES refs("id") NOT NULL, -- NOT NULL, but during migration from PBOT or 1.0 may be inherited from collection
    preceded_by_id bigint REFERENCES specimens("id"),
    succeeded_by_id bigint REFERENCES specimens("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW()

);
SELECT install_version_triggers('specimens');

CREATE TABLE schemas (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'SCH')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    schema jsonb NOT NULL,
    reference_id bigint REFERENCES refs("id") NOT NULL,
    preceded_by_id bigint REFERENCES schemas("id"),
    succeeded_by_id bigint REFERENCES schemas("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW()
);
SELECT install_version_triggers('schemas');

-- A lookup table for additional refs (called refs_secondary in original db)
CREATE TABLE additional_schema_refs (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    schema_id bigint REFERENCES schemas("id"),
    reference_id bigint REFERENCES refs("id")
);

CREATE TABLE characters (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'CHR')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    parent_schema_id bigint REFERENCES schemas("id"),
    parent_character_id bigint REFERENCES characters("id"), -- optional
    --name text NOT NULL,
    --definition text,
    sort_order integer, -- Probably needs to be some constraint expression here that checks whether the order makes sense - i.e., for given parent, cannot be 2 if there is no 1
    character jsonb NOT NULL,
    preceded_by_id bigint REFERENCES characters("id"),
    succeeded_by_id bigint REFERENCES characters("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW(),
    CONSTRAINT character_of CHECK (
        (parent_schema_id IS NOT NULL AND parent_character_id IS NULL) OR
        (parent_schema_id IS NULL AND parent_character_id IS NOT NULL)
    )
);
SELECT install_version_triggers('characters');

CREATE TABLE states (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'STA')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    parent_character_id bigint REFERENCES characters("id"), -- not optional
    parent_state_id bigint REFERENCES states("id"), -- optional
    --name text NOT NULL,
    --definition text,
    sort_order integer, -- Probably needs to be some constraint expression here that checks whether the order makes sense - i.e., for given parent, cannot be 2 if there is no 1
    state jsonb NOT NULL,
    quantitative boolean NOT NULL DEFAULT FALSE,
    preceded_by_id bigint REFERENCES states("id"),
    succeeded_by_id bigint REFERENCES states("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW(),
    CONSTRAINT state_of CHECK (
        (parent_character_id IS NOT NULL AND parent_state_id IS NULL) OR
        (parent_character_id IS NULL AND parent_state_id IS NOT NULL)
    )
);
SELECT install_version_triggers('states');

-- This represents a significant change to authorities from v1.0, where it was
-- actually a table of taxonomic names and their associated authorities, rather than a table of authorities.
-- It is now exlusivley a table of authorities, and the taxonomic names themselves are stored in the taxa table.
CREATE TABLE authorities (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'AUT')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
    enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
    authority jsonb NOT NULL, -- Defined in authority.schema.js
    reference_id bigint REFERENCES refs("id") NOT NULL, -- see notes below
    preceded_by_id bigint REFERENCES authorities("id"),
    succeeded_by_id bigint REFERENCES authorities("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW()
);
SELECT install_version_triggers('authorities');

-- For the taxa migration: each authority row carries every legacy taxon_no it
-- absorbed during dedup in authority->'legacyIDs'->'oldpbdbIDs' (jsonb array of
-- strings, sorted ASC). To resolve a legacy taxon_no → current authority.id,
-- add this index when the taxa migration runs:
--   CREATE INDEX authorities_oldpbdbids_gin
--     ON authorities USING gin ((authority->'legacyIDs'->'oldpbdbIDs') jsonb_path_ops);
--   -- lookup:
--   SELECT id FROM authorities
--    WHERE authority->'legacyIDs'->'oldpbdbIDs' ? '12345'
--      AND succeeded_by_id IS NULL;

-- ============================================================================
-- TAXA & OPINIONS — the application-written half (Layer 1 and outside the stack)
-- ----------------------------------------------------------------------------
-- The derived half (Layers 2 and 3: the taxa_* ledgers and the derive_*/
-- rebuild_* functions) is in 03-taxa.sql.
--
-- Implements the IDENTITY INVERSION settled in docs/classic-taxa-opinions.md
-- §9.8: permid = a name-AS-SPELLED (legacy authorities.taxon_no), NOT the
-- original combination (legacy orig_no). The name-lineage and the concept are
-- both DERIVED by taxonomy.derive() (Layer 2, 03-taxa.sql), not stored. name + rank are
-- immutable attributes of a permid, minted with it, so there is NO rank_opinions
-- table and NO rank fan-out (rank_id rides the minting name_opinion).
--
-- name_opinions are typed EDGES between permids (subject → target); the reason's
-- edge_class ('root' | 'name' | 'concept') selects which of derive()'s two
-- union-finds the edge feeds. edge_class is pinned onto each row and FK-checked,
-- so the minting shape is a plain CHECK (Way 2 / A1 / §10.6 D9).
--
-- Design rationale: docs/classic-taxa-opinions.md §9.5 (truth vs. materialization;
-- the three layers), §9.5.2.1 (Layer 1 versioning — with permid, without the
-- version triggers), §9.6 (column vocabulary), §9.8 (the inversion), §10 (legacy
-- disposition + migration). This supersedes the pre-design taxa / rank_opinions /
-- assignment_opinions / rename_opinions / homonyms block that stood here.
--
-- Conventions inherited from elsewhere in this file:
--   * permid text COLLATE "C", an FK to permids, CHECK permid_is_valid(permid, '<PREFIX>'),
--     and a generated permid_no — permids come from register_permids() and
--     mint_permids() (prefixed-permids). Each versioned table also has a
--     <table>_one_head_per_number constraint (end of this file).
--   * SELECT install_version_triggers('t') installs place_in_lineage() /
--     handle_new_version() AND a partial head index t_permid_head_idx on (permid)
--     WHERE succeeded_by_id IS NULL. EXCEPTION: the three opinion tables are
--     versioned but deliberately DO NOT call it (§9.5.2.1) — swinging their
--     inbound FKs (all of them taxa.winning_*_opinion_id, derived provenance)
--     would corrupt history. They hand-create their permid head indexes below.
-- ============================================================================


-- ============================================================================
-- LAYER 1 — ASSERTIONS (input to derive())
-- ----------------------------------------------------------------------------
-- Append-only. Versioned (permid + preceded_by_id / succeeded_by_id) but WITHOUT
-- install_version_triggers() (§9.5.2.1). The succession chain records TRANSCRIPTION
-- CORRECTIONS, not changes of belief: a mistyped pubyr → new version of the same
-- opinion (same permid); a disagreement → a NEW opinion (new permid) that derive()
-- ranks. The write path sets preceded_by_id / succeeded_by_id directly and the
-- AFTER STATEMENT trigger (B2) takes it from there. derive() reads
-- `WHERE removed IS NOT TRUE AND succeeded_by_id IS NULL`.
--
-- All *_permid columns are name-as-spelled pointers (TXN permids). They are FKs to
-- the permids registry, which guarantees each names a permid that exists, but not
-- that it is a name: that is still by construction, re-checked by the
-- derive(all) ≡ heads invariant. (This reverses §9.5.1, which had no registry; see
-- openspec/specs/prefixed-permids.) A permid is MINTED by the
-- name_opinions row that first introduces it as subject (reason 'original' for a
-- root, or a 'name' reason for a spelling introduced as a form of an earlier
-- one); that row carries the permid's immutable identity (new_name + rank_id +
-- authority provenance) and nothing ever changes it.
-- ============================================================================

-- Name, spelling, synonymy. A row is a typed EDGE: subject_permid defers to
-- target_permid in the manner given by reason_id (whose edge_class selects the name-lineage
-- vs concept grouping in derive()). MINTING rows (reason 'original', or a 'name'
-- reason introducing a new spelling) carry new_name / rank_id / authority_id /
-- pages / figures — the immutable identity of subject_permid. NON-MINTING rows (a
-- 'concept'-class synonymy/replacement edge about an already-minted permid) carry
-- neither. 'original' is a reason value (not a separate table) so competing claims
-- about the original combination are an ordinary ranking contest, not a constraint
-- violation — which is what heals the 81 legacy orig_no rows pointing at the wrong
-- original (the migration ignores orig_no and rebuilds the lineage from these edges).
CREATE TABLE name_opinions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'TXN')),  -- opinion identity across transcription corrections
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,
    oldpbdb_taxon_no integer,

    subject_permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(subject_permid, 'TXN')),  -- the name-as-spelled this opinion is about
    target_permid text COLLATE "C" REFERENCES permids CHECK (permid_is_valid(target_permid, 'TXN')),  -- what subject defers to; NULL only for edge_class 'root' ('original')
    reason_id integer NOT NULL,            -- FK is composite with edge_class, below
    edge_class text NOT NULL,              -- pinned copy of the reason's edge_class (Way 2 / A1). Lets the
                                           -- shape CHECK run as a plain same-row CHECK; the composite FK
                                           -- below guarantees it equals the dictionary's value for reason_id.
    negates boolean NOT NULL DEFAULT false, -- flips the polarity of `reason` rather than naming its own
                                           -- reason: `reason = 'misspelling', negates = true` reads as
                                           -- "not a misspelling of [target]," not "misspelling." NOT
                                           -- pinned to the dictionary (unlike edge_class) — polarity is a
                                           -- fact about this opinion, not a permanent property of the
                                           -- reason token. `edge_class = 'root'` rows are never negated
                                           -- (see name_opinion_shape). See taxa-opinions spec, "An opinion
                                           -- can assert the negation of a name or concept relationship."
    objective boolean,                     -- 'junior synonym' edges only: objective (true) vs subjective (false).
                                           -- SOLE carrier of the split (D7): no separate synonym reason tokens.

    -- IMMUTABLE identity of subject_permid, populated ONLY on the minting row.
    -- NULL on non-minting (concept-class) edges. rank_id here is where legacy
    -- authorities.taxon_rank lands. There is no separate rank_opinions table.
    new_name text,
    rank_id integer REFERENCES dictionaries.taxonomy_ranks("id"),

    -- Present on the 'original' minting row: the naming act's own provenance.
    authority_id bigint REFERENCES authorities("id"),

    reference_id bigint REFERENCES refs("id") NOT NULL,
    publication_year integer,       -- second-hand: the attributed year, overriding the reference's
    attribution jsonb,   -- second-hand: WHO, authors only; payloadSchemas/opinionAttribution.schema.js
    evidence boolean NOT NULL,   -- stated with evidence (true) vs. everything else

    created_at timestamptz NOT NULL DEFAULT NOW(),
    removed boolean,
    preceded_by_id bigint REFERENCES name_opinions("id"),
    succeeded_by_id bigint REFERENCES name_opinions("id"),

    CONSTRAINT name_opinion_not_self CHECK (subject_permid IS DISTINCT FROM target_permid),

    -- Way 2 (A1 / §10.6 D9): pin (reason_id, edge_class) to the dictionary's composite
    -- unique key, so the row's edge_class is provably the reason's and cannot drift.
    FOREIGN KEY (reason_id, edge_class)
        REFERENCES dictionaries.namechange_reasons (id, edge_class),

    -- THE MINTING SHAPE, a plain same-row CHECK because edge_class is on the row.
    -- Identity (new_name, rank_id) is set IFF edge_class = 'root': a permid's name
    -- and rank are minted once, on its root row (from authorities); name and
    -- concept edges assert relationships between permids whose identities already
    -- live on their own root rows, so they carry a target and NO identity.
    -- (Ledger model — mapping doc §3.2, 2026-08-17.)
    --   'root'    ('original')    ⇒ no target; mints identity  (new_name, rank_id set)
    --   'name'    (new spelling)  ⇒ target set; NO identity     (new_name, rank_id NULL)
    --   'concept' (synonymy edge) ⇒ target set; NO identity     (new_name, rank_id NULL)
    CONSTRAINT name_opinion_shape CHECK (
           (edge_class = 'root'    AND target_permid IS NULL     AND new_name IS NOT NULL AND rank_id IS NOT NULL AND negates = false)
        OR (edge_class = 'name'    AND target_permid IS NOT NULL AND new_name IS NULL     AND rank_id IS NULL)
        OR (edge_class = 'concept' AND target_permid IS NOT NULL AND new_name IS NULL     AND rank_id IS NULL)
    )
    -- RESIDUAL (not covered here): "objective NOT NULL iff reason = 'junior synonym'"
    -- needs reason-token granularity edge_class lacks; left to the write path + a
    -- derive(all) assertion (§10.6 D9 Residual).
);

-- Classification / containment. NOT "parent": rank containment is not evolutionary
-- ancestry (§9.6.1). subject_permid is the name-as-spelled the opinion classifies
-- (legacy child_spelling_no), containing_permid the spelling of the higher taxon
-- (legacy parent_spelling_no). derive() resolves both to concepts and pools these
-- across the WHOLE concept (junior-synonym borrowing) — the opposite scope from
-- accepted-spelling selection.
--
-- containing_permid is nullable: legacy parent_spelling_no = 0 is Classic's own
-- assertion that the subject has no containing taxon (a rootless "belongs to"
-- opinion, not a gap) -- migrated as a real row so it can win or lose derive()'s
-- usual evidence/pubyr/id contest like any other assignment claim (taxa.
-- containing_concept_permid is already NULL-as-root for exactly this reason).
-- NULL is reserved for that asserted case ONLY: an unresolvable/orphaned
-- parent_spelling_no is never migrated as NULL here -- that row is skipped and
-- logged instead, so containing_permid IS NULL always means "Classic said none,"
-- never "we couldn't figure out which."
CREATE TABLE assignment_opinions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'AOP')),  -- opinion identity across transcription corrections
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(subject_permid, 'TXN')),
    containing_permid text COLLATE "C" REFERENCES permids CHECK (permid_is_valid(containing_permid, 'TXN')),  -- NULL = Classic asserted no containing taxon (see above)
    questioned boolean NOT NULL DEFAULT false,   -- incertae sedis

    reference_id bigint REFERENCES refs("id") NOT NULL,
    publication_year integer,       -- second-hand: the attributed year, overriding the reference's
    attribution jsonb,   -- second-hand: WHO, authors only; payloadSchemas/opinionAttribution.schema.js
    evidence boolean NOT NULL,   -- stated with evidence (true) vs. everything else

    created_at timestamptz NOT NULL DEFAULT NOW(),
    removed boolean,
    preceded_by_id bigint REFERENCES assignment_opinions("id"),
    succeeded_by_id bigint REFERENCES assignment_opinions("id"),

    CONSTRAINT assignment_not_self CHECK (subject_permid <> containing_permid)
);

-- Nomenclatural validity. Purely self-referential testimony about subject_permid's own
-- naming act — never a name change (the name is unaltered) and never an assignment
-- (nothing moves), so it fits neither table above. Replaces the second job of the old
-- taxa.accepted boolean (§10.4).
--
-- NOT a target-bearing table (mapping doc §5.2, 2026-08-18 — supersedes the earlier
-- "invalid subgroup of" targeted design). Every status left in
-- dictionaries.nomenclatural_statuses is untargeted by construction: 'invalid subgroup
-- of' and targeted 'nomen oblitum' moved to name_opinions as ordinary concept-class
-- folds (Classic treats them as synonymy-equivalent — see that dictionary's header),
-- and the remaining family (nomen dubium, nomen vanum, nomen nudum, untargeted nomen
-- oblitum) is deliberately never allowed to redirect anything, even on the ~90% of
-- legacy rows that carried a legacy parent_no — see dictionaries.nomenclatural_statuses
-- for the accepted-loss rationale.
--
-- nomen dubium, nomen nudum, and nomen vanum are all tree-affecting
-- (dictionaries.nomenclatural_statuses.invalidates), via the SAME mechanism:
-- derive() computes the winning validity opinion per subject_permid
-- (evidence/pubyr/id, exactly as everywhere else), and only at the END of
-- selecting an accepted spelling or concept senior — never as a pre-filter —
-- checks whether that winning opinion outranks any live sign elsewhere in
-- the ledger (the permid's own name-class activity, or a concept-class
-- opinion deferring to it) that the name is still legitimately in use. See
-- derive_taxa()'s/derive_linnaean()'s "Accepted spelling"/"Seniority
-- tiebreak" sections. Untargeted nomen oblitum has no derive() effect at
-- all — recorded for the historical record only (mapping doc §5.2).
CREATE TABLE validity_opinions (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'VOP')),  -- opinion identity across transcription corrections
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(subject_permid, 'TXN')),
    nomenclatural_status_id integer NOT NULL REFERENCES dictionaries.nomenclatural_statuses("id"),

    reference_id bigint REFERENCES refs("id") NOT NULL,
    publication_year integer,       -- second-hand: the attributed year, overriding the reference's
    attribution jsonb,   -- second-hand: WHO, authors only; payloadSchemas/opinionAttribution.schema.js
    evidence boolean NOT NULL,   -- stated with evidence (true) vs. everything else

    created_at timestamptz NOT NULL DEFAULT NOW(),
    removed boolean,
    preceded_by_id bigint REFERENCES validity_opinions("id"),
    succeeded_by_id bigint REFERENCES validity_opinions("id")
);

-- DEFERRED (§10.6 D6): type material and biological traits. Earlier drafts modelled
-- these as type_opinions / trait_opinions (winner-selection only, invisible to
-- dependency_closure). Both are dropped; the legacy type block (type_taxon_no,
-- type_specimen, museum, catalog_number, type_body_part, part_details, type_locality)
-- and trait fields (extant, preservation, form_taxon) will be integrated into pbdb2
-- once PBOT's description system settles where they belong.


-- ============================================================================
-- OUTSIDE THE STACK — non-derived data
-- ----------------------------------------------------------------------------
-- Neither input to derive() nor output of it. Hand-entered, never reconstructed
-- by rebuild(), invisible to dependency_closure. Beside the Layer 1/2/3 stack.
-- ============================================================================

-- Curatorial annotation has no opinion behind it, so it CANNOT live in `taxa` (a
-- rebuild() would blank it). Versioned, because unlike an opinion this is authored
-- content whose edits are genuine changes of content.
CREATE TABLE taxon_annotations (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'TAN')),
    permid_no bigint GENERATED ALWAYS AS (split_part(permid, '-', 2)::bigint) STORED,
    authorizer_person_id integer REFERENCES persons("id") NOT NULL,
    enterer_person_id integer REFERENCES persons("id") NOT NULL,

    subject_permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(subject_permid, 'TXN')),  -- the taxon being annotated
    common_name text,
    comments text,
    discussion text,
    discussed_by_reference_id bigint REFERENCES refs("id"),

    preceded_by_id bigint REFERENCES taxon_annotations("id"),
    succeeded_by_id bigint REFERENCES taxon_annotations("id"),
    removed boolean,
    created_at timestamptz DEFAULT NOW()
);
SELECT install_version_triggers('taxon_annotations');

CREATE INDEX taxon_annotations_head_subject_idx
    ON taxon_annotations (subject_permid) WHERE succeeded_by_id IS NULL;

-- Homonymy is a fact about our data, not a published assertion (legacy
-- opinions.status has no 'homonym of'). Grouped, not pairwise, so n > 2 homonyms
-- are representable. No has_homonym flag on `taxa` (that would make a derived table
-- depend on a non-opinion source); read-path LEFT JOIN instead. homonym_group_id is
-- an APP-MINTED uuidv7 (§10.6 D10) -- internal and never exposed, so not a permid
-- (prefixed-permids): the writer mints one uuid and stamps it on all N
-- member rows in a single INSERT — no sequence, no MAX()+1 race, collision-free by
-- construction. No homonym_groups parent table: a group IS its membership rows.
CREATE TABLE homonyms (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    homonym_group_id uuid NOT NULL CHECK ((get_byte(uuid_send(homonym_group_id), 6) >> 4) = 7),
    permid text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'TXN')),  -- a member name, not an identity of its own
    created_at timestamptz DEFAULT NOW(),
    UNIQUE (homonym_group_id, permid)
);
CREATE INDEX homonyms_permid_idx ON homonyms (permid);


-- ============================================================================
-- LAYER 1 INDEXES
-- ----------------------------------------------------------------------------
-- derive() gathers opinions by subject; dependency_closure (B2) walks the lineage
-- (name target), concept, and containment edges. All HEAD-ONLY: derive() reads
-- only current versions, so a superseded (corrected) opinion is never gathered.
-- ============================================================================
CREATE INDEX name_opinions_subject_idx          ON name_opinions (subject_permid)          WHERE succeeded_by_id IS NULL;
CREATE INDEX name_opinions_target_idx           ON name_opinions (target_permid)           WHERE succeeded_by_id IS NULL;
CREATE INDEX assignment_opinions_subject_idx    ON assignment_opinions (subject_permid)    WHERE succeeded_by_id IS NULL;
CREATE INDEX assignment_opinions_containing_idx ON assignment_opinions (containing_permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX validity_opinions_subject_idx      ON validity_opinions (subject_permid)      WHERE succeeded_by_id IS NULL;

-- Head lookup by permid. Elsewhere install_version_triggers() creates this; because
-- the opinion tables deliberately skip it (§9.5.2.1), these are created BY HAND and
-- are NOT optional — the write path resolves "current version of this opinion"
-- through them (the lookup whose absence degraded the collections migration to O(n²)).
CREATE INDEX name_opinions_permid_head_idx       ON name_opinions (permid)       WHERE succeeded_by_id IS NULL;
CREATE INDEX assignment_opinions_permid_head_idx ON assignment_opinions (permid) WHERE succeeded_by_id IS NULL;
CREATE INDEX validity_opinions_permid_head_idx   ON validity_opinions (permid)   WHERE succeeded_by_id IS NULL;


-- ============================================================================
-- ONE HEAD PER PERMID NUMBER (prefixed-permids)
-- ----------------------------------------------------------------------------
-- On every versioned table, at most one head per permid_no. Lists order and seek
-- on permid_no over heads, and this constraint's index serves them. It is an
-- EXCLUDE constraint, not a partial unique index, so that it can be DEFERRED: a
-- new version is inserted as a head while the old head is still open, and
-- handle_new_version() closes the old head only in its AFTER trigger. A unique
-- index is checked row by row and would reject every new version.
-- ============================================================================
ALTER TABLE refs                ADD CONSTRAINT refs_one_head_per_number                EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE timescales          ADD CONSTRAINT timescales_one_head_per_number          EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE intervals           ADD CONSTRAINT intervals_one_head_per_number           EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE collections         ADD CONSTRAINT collections_one_head_per_number         EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE specimens           ADD CONSTRAINT specimens_one_head_per_number           EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE schemas             ADD CONSTRAINT schemas_one_head_per_number             EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE characters          ADD CONSTRAINT characters_one_head_per_number          EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE states              ADD CONSTRAINT states_one_head_per_number              EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE authorities         ADD CONSTRAINT authorities_one_head_per_number         EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE name_opinions       ADD CONSTRAINT name_opinions_one_head_per_number       EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE assignment_opinions ADD CONSTRAINT assignment_opinions_one_head_per_number EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE validity_opinions   ADD CONSTRAINT validity_opinions_one_head_per_number   EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE taxon_annotations   ADD CONSTRAINT taxon_annotations_one_head_per_number   EXCLUDE (permid_no WITH =) WHERE (succeeded_by_id IS NULL) DEFERRABLE INITIALLY DEFERRED;

-- STUBBED OUT pending the occurrences reform (a future change). This placeholder
-- predates the taxa/opinions identity inversion and is inconsistent with it in two
-- ways: (1) `taxon_id integer REFERENCES taxa("id")` is a swing FK to the now-
-- versioned `taxa` — exactly the anti-pattern the inversion removed from the opinion
-- tables (§9.8.3); under the new model an occurrence should reference a taxon by
-- PERMID, not by taxa("id") (see occurrence synergy, §9.8.5). (2) permid is `text`
-- and the surrogate keys are `integer`, both out of step with the rest of the schema.
-- Left commented out so no swing FK to `taxa` lands; restore and redesign when
-- occurrences is reformed.
--
-- The most significant change intended here is eliminating reidentification as a
-- separate table: a reidentification links back to the prior occurrence instead.
--
-- CREATE TABLE occurrences (
--     id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     permid text NOT NULL,
--     authorizer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever was the authorizer of the enterer
--     enterer_person_id integer REFERENCES persons("id") NOT NULL, -- Whoever made the entry or edit
--     taxon_id integer REFERENCES taxa("id") NOT NULL, -- the taxon in question
--     reidentification_occurrence_id integer REFERENCES occurrences("id"),
--     collection_id integer REFERENCES collections("id") NOT NULL, -- collection taxon belongs to
--     reference_id integer REFERENCES refs("id") NOT NULL,
--     preceded_by_id integer REFERENCES occurrences("id"),
--     succeeded_by_id integer REFERENCES occurrences("id")
-- );

