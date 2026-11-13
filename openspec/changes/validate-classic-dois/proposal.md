## Why

About 1,900 of the 46,812 DOIs on Classic refs point to the wrong work, and the refs migration copies every one of them into pbdb2 unchanged (`migrate-refs.js` only trims). Hall 1866, a crinoid paper, carries a *Lancet* DOI. Hall 1981, *The Mammals of North America*, carries the DOI of *Polymer Materials*. Fourteen Agassiz *Poissons Fossiles* refs share one *Annalen der Physik* DOI. A wrong DOI is worse than none: the API's `doi` filter returns these refs for the wrong DOI, and RIS output (`add-ris-reference-output`) would write them as `DO` lines that Zotero follows. The full measurements are under [Evidence](#evidence-pbdb_2026_10_18-and-crossref-2026-11-13).

The bad DOIs can't be found from the Classic row alone. 158 of the 160 wrong DOIs in the sample agree with the ref's first-author surname and year: whatever attached them matched on those two fields and never compared the title. Telling them apart needs the registered metadata for each DOI, chiefly the title.

## What Changes

- **New one-off audit:** a script resolves every Classic DOI through Crossref, falling back to doi.org content negotiation for DOIs registered elsewhere (DataCite and others). It compares the registered title and year with the ref. Each DOI gets one verdict:
  - `match`: the title agrees and the year is within one.
  - `related-work`: the title agrees but the year doesn't. Usually an abstract pointing to the later full paper, or a reprint.
  - `part-or-container`: the registered work is the ref's container, or a part of it.
  - `uncertain`
  - `wrong`
  - `unresolvable`
  - `malformed`

  The audit runs outside the migration, at Crossref's polite rate, in about 1.5–2 hours. It can be re-run for only the refs that are new or changed in a later dump.
- **Committed verdict file:** the audit writes a CSV keyed by `reference_no`. It holds the source DOI, the normalized DOI, the verdict, and the registered title, year and first author. It lives beside `migrate-refs.js`, because the migration reads it, and it is the record of every DOI pbdb2 did not keep.
- **The refs migration uses the verdicts:**
  - **Normalized:** DOIs are stored without a leading `doi:`, `DOI:`, `https://doi.org/`, `dx.doi.org/` or stray `^` (68 refs).
  - **Dropped:** DOIs with verdict `wrong`, `related-work`, `unresolvable` or `malformed` are not migrated. That includes the ~280 strings that are not DOIs at all, such as handles, JSTOR or PDF URLs, author lists, dates and "-".
  - **Kept:** `match` and `part-or-container` DOIs, and `uncertain` ones until a curator decides.
  - **Run summary:** the migration reports how many DOIs it normalized and how many it dropped under each verdict.
- **Classic itself is unchanged.** The verdict CSV can go upstream as a report, separately from this change.
- **Localhost is re-migrated** with the full runner. Aurora `pbdb2_migration_test` is rebuilt later.

No API, payload schema or DDL change. PBot refs are out of scope.

## Capabilities

### New Capabilities

- `classic-doi-audit`: the offline audit, which covers how DOIs are normalized and resolved, the verdict rules, the CSV format, incremental re-runs, and its etiquette toward Crossref and doi.org (rate, retries, a generic User-Agent with no personal contact details).

### Modified Capabilities

- `refs-migration`: under "Additional jsonb fields", `doi` changes from "the source `doi` column (NULL if empty)" to the normalized DOI, omitted when its verdict says drop. New scenarios cover a prefixed DOI, a wrong DOI, a non-DOI string, and a ref with no row in the verdict file.

## Impact

- **Source → target:** MariaDB `pbdb_2026_10_18`.`refs`.`doi` → PostgreSQL `refs.reference` jsonb `doi`. No other field or table changes.
- **Code:**
  - The new audit script and its tests.
  - `migrations/src/refs-migration/migrate-refs.js`: normalizing, reading the verdict file, the run summary.
  - `migrations/src/tests/refs-transforms.test.js`.
  - The script and the CSV must fit `migration-script-layout`. Nothing outside `migrations/` reads the CSV.
- **External services:** the audit sends each DOI to `api.crossref.org` and `doi.org`. DOIs are public identifiers, and nothing about the user or the project is sent. The migration itself makes no network calls and reads only the committed file, so runs stay deterministic.
- **Data integrity:**
  - About 1,900 refs lose their `doi` (estimate below). No other field changes, and no ref is dropped.
  - Permids, collections, opinions and specimens are unaffected, so every other runner count must reproduce exactly.
  - Dropping is safe in one direction: a wrongly dropped DOI loses a correct link, but the CSV keeps it, and it can be restored with an override. Keeping a wrong DOI misleads every reader.
  - **Risk: false `wrong` verdicts** from title comparison across languages and translations. Kramarz 2009 has a Spanish title and an English DOI title; it scored `part-or-container`, not `match`, so it was kept. Design must set and test the thresholds against a hand-checked sample.
  - **Risk: verdicts go stale.** The file is keyed by `reference_no` but also stores the source DOI. A ref whose DOI changed in a newer dump has no current verdict, so design must decide what the migration does then: keep the DOI, drop it, or fail the run.
- **Anomalies:** NULL vs empty string for "no value" (blank DOI → omitted, as today). The DOI problem is not in `anomaly-report.md` and is new.
- **API:** no code change. The `doi` filter already strips a `doi:` or `https://doi.org/` prefix from both sides. After the re-run it stops matching the dropped DOIs.
- **Follow-up:**
  - `add-ris-reference-output` can emit `DO` lines without exporting known-bad DOIs.
  - The ~1,000 bad journal-article DOIs are a small rate (2%) but a large count. A curator may want the `uncertain` and `related-work` rows.

## Evidence (`pbdb_2026_10_18` and Crossref, 2026-11-13)

Gathered while exploring `reclassify-single-title-books`: 408 of its 665 refs carry a DOI, and most of those looked wrong.

### Method

Stratified sample of 1,094 refs with a DOI: 400 journal articles, 100 each from `book`, `book/book chapter`, `book chapter`, `serial monograph` and NULL type, and every DOI from the small types. Each DOI was resolved through Crossref, then doi.org, and the registered title was compared with `reftitle`. The comparison is token containment over words of 3+ letters, ignoring accents and case. `pubtitle` was also compared for book types, and for refs whose only title is `pubtitle`. A title score of 0.6 or more counts as agreement, and `match` also needs the year within one. Author and year alone were not trusted: 158 of the 160 `wrong` verdicts agree on both.

### Results

| Classic type | DOIs | Sample | Wrong, related-work, unresolvable or malformed | Est. bad |
|---|---:|---:|---:|---:|
| journal article | 42,833 | 400 | 2% (9) | ~960 (95% CI ~500–1,800) |
| book | 767 | 100 | 48% | ~370 |
| book/book chapter | 845 | 100 | 37% | ~310 |
| NULL | 498 | 100 | 13% | ~65 |
| serial monograph | 1,045 | 100 | 4% | ~40 |
| book chapter | 630 | 100 | 3% | ~20 |
| abstract | 63 | 63 | 49% | ~31 |
| Ph.D. thesis | 31 | 31 | 65% | ~20 |
| unpublished | 22 | 22 | 59% | ~13 |
| M.S. thesis | 15 | 15 | 80% | ~12 |
| guidebook | 43 | 43 | 26% | ~11 |
| compendium | 17 | 17 | 53% | ~9 |
| news article | 3 | 3 | 0% | 0 |
| **Total** | **46,812** | **1,094** | | **~1,870 (4%)** |

The verdicts were spot-checked by hand. The `wrong` ones are unambiguous, for example:

| Ref | Registered work behind its DOI |
|---|---|
| Voorhies 1990, *Proc. Nebraska Acad. Sci.* | "Intraoperative Ultrasound Imaging in Neurosurgery" |
| Tanner 1965, *Proc. Nebraska Acad. Sci.* | "Crime and Punishment in East Africa" |
| Lumley 1987, *L'Anthropologie* | "Does This Work?" (*Pediatrics*) |
| Thurmond 1981, *Fossil Vertebrates of Alabama* | "A simple method of nucleus removal…" |
| Holman 2000, *The fossil snakes of North America* | "Editorial" (*Early Music*) |

Where the bad ones cluster:
- **Books:** Crossref holds few old monographs, so a surname-and-year match lands on an unrelated article.
- **Refs with no article title,** where the only title is the journal name, so nothing could check the match.
- **Abstracts,** which often point to the later full paper (`related-work`).

Other findings:
- **BHL DOIs** (`10.5962/bhl.title.*`) are mostly right: 60 of 71. The misses are other volumes of the same multi-volume work.
- **IODP corporate authors** ("Expedition 3xx Scientists") fail the author test but match on title, which is another reason author agreement is not used.
- **Every era has them.** Bad DOIs appear in refs created before 2007, 2007–13, 2014–19 and 2020+, so the source may still be active in Classic. That is an inference; Classic's code was not inspected.
- **Shared DOIs** (2,203 shared by more than one ref) are mostly legitimate, because Classic stores one ref per section of the same paper. They are not a sign of a bad DOI.

### DOI string formats (all 46,812)

| Format | Refs |
|---|---:|
| Clean `10.NNNN/…` | 46,463 |
| Valid after stripping a `doi:`, `DOI:`, resolver URL or `^` prefix | 68 |
| Starts with `10.` but broken (`10.666/12-075`, `10.111/let.12205`, embedded spaces, truncated) | 157 |
| URL or handle, not a DOI (`hdl.handle.net`, JSTOR stable or SICI links, PDF URLs) | 75 |
| Other text (author lists, "17 December 1871", "-") | 49 |

### Reproducing

The exploration script and the sample results were scratch files: `doi-audit.mjs` and `results.jsonl` in the 2026-11-13 session scratchpad, not committed. The audit this change builds replaces them.
