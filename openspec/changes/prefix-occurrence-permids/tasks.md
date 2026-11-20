## 1. DDL (`db/02-core.sql`)

- [ ] 1.1 Add `OCC` (`241212`) to `permid_prefix_digits` and create `permid_occ_seq`
- [ ] 1.2 Start every permid sequence at 10,000,000; rewrite the floor comment (largest Classic number is `occurrence_no` 2,078,017)
- [ ] 1.3 `register_permids`: refuse numbers at or above 10,000,000, message "between 1 and 9999999"; update its comment
- [ ] 1.4 `occurrences.permid` → `text COLLATE "C" NOT NULL REFERENCES permids CHECK (permid_is_valid(permid, 'OCC'))`, plus the generated `permid_no`
- [ ] 1.5 `occurrences.taxon_permid` → `text COLLATE "C" REFERENCES permids CHECK (permid_is_valid(taxon_permid, 'TXN'))`; update its comment (root name opinion's permid; not an FK to `taxa`)
- [ ] 1.6 Move the occurrences table above the "ONE HEAD PER PERMID NUMBER" block and add `occurrences_one_head_per_number` to it
- [ ] 1.7 Note the numbering in the occurrences comment: Classic `occurrence_no`; reidentifications and new rows from the sequence
- [ ] 1.8 Apply the three DDL files to a scratch database; confirm no public column ending in `permid` is `uuid`; drop the database

## 2. Tests

- [ ] 2.1 `api/test/integration/permids.test.js`: the floor values (refuse `COL` 10,000,000 and 0 with the new message; first `SCH` mint is `SCH-10000000-57`)
- [ ] 2.2 Add: first `OCC` mint is `OCC-10000000-29`; `register_permids('OCC', ARRAY[2078017])` returns `OCC-2078017-88`
- [ ] 2.3 Add occurrence-table tests: an `OCC` permid with a registered `TXN` `taxon_permid` (and with NULL) is accepted; a `COL` permid, an unregistered `OCC` permid and a `COL` `taxon_permid` are refused; a second version keeps one head; no public permid column is `uuid`
- [ ] 2.4 Run `npm test` and `npm run test:integration`; all pass, none skipped

## 3. Docs

- [ ] 3.1 `migrations/src/occurrences-migration/docs/occurrences.md`: `permid` (Classic `occurrence_no`, registered; reidentifications minted from `OCC`) and `taxon_permid` (`TXN` permid of the root name opinion, `TXN-<taxon_no>` after checking it exists)
- [ ] 3.2 `docs/api-design-backlog.md`: `OCC` in the prefix list; the floor is 10,000,000 (`START WITH 10000000`), with this change named
- [ ] 3.3 Search the repository (outside archived changes) for the old floor (`1,000,000`, `1000000`, `999999`) and sequence permids with 7-digit numbers; update what remains

## 4. Rebuild and verify

- [ ] 4.1 Before rebuilding localhost, record: row counts of every table, the md5 of the sorted permids below 1,000,000, and per prefix the count of permids at or above 1,000,000 (save the sorted sequence permids to the scratchpad)
- [ ] 4.2 Rebuild localhost with the full runner (`--createdb`)
- [ ] 4.3 Check D6: row counts unchanged; legacy permid md5 unchanged; no number from 1,000,000 to 9,999,999; per-prefix counts at or above 10,000,000 equal the old counts; whether each sequence number is the old one plus 9,000,000; `occurrences` exists, empty
- [ ] 4.4 Record the results in a Verification section of `design.md`
- [ ] 4.5 With the user's go-ahead and the VPN up, rebuild Aurora `pbdb2_migration_test` and compare its counts and permid checks with localhost
