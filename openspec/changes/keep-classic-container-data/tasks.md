## 1. Baseline

- [ ] 1.1 Dump the current localhost `refs` heads to a scratch file: permid, `legacyIDs`, and the jsonb, ordered by permid. Record every runner step total from the last full run as the comparison baseline.

## 2. Payload schema

- [ ] 2.1 In `payloadSchemas/reference.schema.js`, declare `seriesNumber: { type: "string", maxLength: 10 }` immediately after `seriesVolume`, and add it to `serial monograph`'s `fields` in `PUBLICATION_TYPES`. Its `required` list does not change (design D6).
- [ ] 2.2 In `payloadSchemas/tests/sources.test.js`, add one test per new spec scenario:
  - a serial monograph passes `in-create` with and without `seriesNumber`;
  - `seriesNumber` on a journal article fails with `propertyNames`;
  - an 11-character `seriesNumber` fails the `db` variant.

## 3. Classic refs migration: untyped refs

- [ ] 3.1 In `migrations/src/refs-migration/migrate-refs.js`, add an exported `journalTitleCounts(refs)`. It returns a `Map<trimmed lowercased pubtitle, { journal, typed }>`, built from refs with a non-NULL `publication_type` and a non-blank `pubtitle` (D2).
- [ ] 3.2 Give `mapPublicationType(ref, editors, journalTitles)` the untyped-ref rule (D1): a NULL type maps to `journal article` when `journal * 2 > typed` for its pubtitle, and to `other` otherwise. Keep the NULL warning. In `main()`, build the map once, before the transform loop, and count the refs typed by the rule.

## 4. Classic refs migration: fields and note

- [ ] 4.1 `mapVolNo` writes `seriesNumber` from `pubno` on serial monographs.
- [ ] 4.2 Rewrite `containerNote` as `containerNote(ref, jsonb)` (D3–D5):
  - "held" is decided from the built jsonb;
  - the list is the pubtitle unless it is the ref's own title, then `vol.`, then `no.`;
  - the prefix is `Source: `, `Published in: ` or `Published as `, in that order of precedence.

  Remove the two-title/editors test, and update the comment above the function.
- [ ] 4.3 Reorder the jsonb build so that type, title, routed pubtitle and volume/number fields are written before `containerNote` runs, then `buildComments`. The DOI, pages and other fields are unaffected.
- [ ] 4.4 Replace the book/chapter note counters with counts per prefix and target type (with `bookType` for standalone books), and log them (D8).

## 5. Classic refs migration: untyped review list

- [ ] 5.1 Pull the single-title list's CSV field quoting and authors formatting out into helpers that both lists use (D7), so the existing `single-title-books-review.csv` is rewritten byte for byte.
- [ ] 5.2 After the upsert, write `src/refs-migration/untyped-refs-review.csv` with the spec's header and columns, one row per untyped ref sorted by `reference_no`. `journal_share` comes from the D2 map. Log the row count by target type.

## 6. Classic refs migration: tests

- [ ] 6.1 In `migrations/src/tests/refs-transforms.test.js`, update the `migrate()` helper for the new `mapPublicationType` and `containerNote` signatures. Every existing test of book notes, chapter notes and title rules must pass unchanged in its assertions.
- [ ] 6.2 Add untyped-ref tests, one per spec scenario:
  - a journal majority becomes a journal article, with `journalTitle`/`journalVolume`/`journalNumber`;
  - a minority (153/336) stays `other`;
  - exactly half stays `other`;
  - a blank or unmatched pubtitle stays `other`;
  - untyped refs don't vote;
  - `journalTitleCounts` ignores blank pubtitles and folds case.
- [ ] 6.3 Add note tests, one per new Container note scenario:
  - abstract, `Published in` with a volume;
  - untyped ref left `other`;
  - `other` with a volume only (`Published in: vol. 7`);
  - thesis `Source`;
  - unpublished `Source` after existing comments;
  - compendium `Source` with a volume and number;
  - guidebook `Published in`;
  - whole book `Published as vol. II`;
  - own title not repeated (`Published as vol. 2`);
  - journal articles and serial monographs never get a note;
  - a single-title book without a volume gets no note.
- [ ] 6.4 Add a test of the "held" invariant for every target type:
  - no note contains a `vol.` or `no.` value that the jsonb holds as a volume or number field, except chapters, whose note repeats `bookTitle` by design;
  - no non-blank pubtitle, volume or number is in neither a field nor the note.
- [ ] 6.5 Add a test that a serial monograph with `pubno` gets `seriesNumber` and no note. Also add the new shapes to the db-variant validation cases: a serial monograph with `seriesNumber`, an `other` with a note, and an untyped journal article.
- [ ] 6.6 Add tests that build untyped review rows: the `journal_share` format (`111/114`, blank when unmatched), column order, and the quoting of a pubtitle with a comma.

## 7. PBot refs migration

- [ ] 7.1 In `migrations/src/pbot-refs-migration/migrate-pbot-refs.js`, map `publicationNumber` to `seriesNumber` on serial monographs, beside `seriesVolume`. The script has no exported transforms, so this is checked by the full run (8.2), not by a unit test.

## 8. Re-migration and verification

- [ ] 8.1 Run `npm test` from the repository root. All suites pass, including the API's OpenAPI and discovery tests, which see `seriesNumber` through the schema.
- [ ] 8.2 Drop and recreate localhost `pbdb`, and run the full runner (`node src/run-migrations.js --createdb` from `migrations/`). The refs step should log:
  - 658 untyped refs typed `journal article`, 525 left `other`;
  - container notes as in the design's D4 table (5,220 in all);
  - an untyped review list of 1,183 rows.

  The pbot-refs step still drops 18 fields from 15 references.
- [ ] 8.3 Every runner step total and every ref permid matches the baseline, apart from the per-type summary shifting by the untyped refs. If a logged count differs from a spec or design figure, find out why, then correct the figure in the spec, design and proposal.
- [ ] 8.4 Diff the payloads against the baseline. The only differences allowed are:
  - (a) untyped refs typed `journal article`: `publicationType` and the three journal fields;
  - (b) `seriesNumber` on serial monographs (863);
  - (c) `comments` gaining a note on the new note refs only.

  The 1,907 chapter and 236 book notes must be byte-identical to the baseline.
- [ ] 8.5 Run the migration a second time. `untyped-refs-review.csv` and `single-title-books-review.csv` must be byte-identical across runs, and the single-title list identical to the committed one.
- [ ] 8.6 Spot-check through the API:
  - an untyped *Nature* ref is a `journal article`;
  - an untyped *USGS Professional Paper* ref is `other` with a note;
  - a JVP abstract has its note;
  - a thesis has a `Source:` note;
  - *Die Saugetiere* vol. II has `Published as vol. II`;
  - a serial monograph shows `seriesNumber` in JSON and in a `text/csv` list after `seriesVolume`.

## 9. Docs and wrap-up

- [ ] 9.1 Update `docs/api-design-backlog.md`:
  - "Known data issues": whole books with a volume now keep it, as a note.
  - Add an entry for the untyped refs: 658 typed `journal article` by title majority, 525 `other`, curators retype using `untyped-refs-review.csv`.
  - Note that `other` has no container field (the note holds it), as an open model question.
  - Correct the backlog line that says RIS doesn't see the volume: it's in `N1`.
- [ ] 9.2 Rollback check: the change is code and schema only, so reverting the commit and rebuilding restores the baseline. Say so in the commit message.
