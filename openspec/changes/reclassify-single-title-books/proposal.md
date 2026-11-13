## Why

`fix-book-chapter-migration` moved the 3,045 Classic `book/book chapter` refs that have two distinct titles to `article in edited collection`. The other 665 still migrate as `edited collection`, but almost none of them are edited volumes. In Classic, `book/book chapter` meant "a book or a chapter", and a ref with one title is how Classic stored a whole book. A sample on localhost (2026-11-12) shows:

- 609 have only a `pubtitle` and no editors.
- 502 have a single author, and 384 were published before 1950. Examples: Gould, *The Panda's Thumb*; Dawson, *Acadian Geology*; d'Orbigny, *Paléontologie française*.

`edited collection` tells API readers that these refs' `authors` are a volume's editors. RIS output (`add-ris-reference-output`) would export them as `EDBOOK`, so Zotero would import every author as an editor. That is the open question RIS is paused on. These refs are authored books, and Classic `book` refs already migrate as `standalone book`. The full measurements are under [Evidence](#evidence-localhost-and-pbdb_2026_10_18-2026-11-12).

## What Changes

- **Reclassified:** a Classic `book/book chapter` ref without two distinct titles migrates as `standalone book` with `bookType` `"monograph"`, the same target as Classic `book`. That applies to all 665 such refs in `pbdb_2026_10_18`:

  | Titles | No editors | Editors |
  |---|---:|---:|
  | `pubtitle` only | 609 | 9 |
  | equal titles | 14 | 2 |
  | `reftitle` only | 12 | 3 |
  | neither | 0 | 16 |

- **Unchanged rules:**
  - A ref with two titles is still `article in edited collection` (the 3,045).
  - The title fallback from `pubtitle` already applies to `standalone book`, so no title is lost.
  - `editors` are kept wherever they are stored, as on the Classic `book` refs that already migrate as `standalone book` with editors.
- **Classic data loses `edited collection`:** no Classic type maps to it any more. It remains a publication type for PBot refs ("edited book of contributed articles") and for new references.
- **Known misclassifications are documented, not special-cased.** Nothing stored in Classic tells them apart from authored books:
  - **About 20–50 real edited volumes** whose editors were entered as authors, e.g. Fraser & Sues, *In the Shadow of the Dinosaurs*. They become `standalone book` with the editors as authors.
  - **About 30 chapters missing their chapter title** (titles like "in Bering Land Bridge", or a blank title with editors), plus a few misfiled articles. They were wrong as `edited collection` and are equally wrong as `standalone book`.
- **Suspect refs are recorded in a review list:** `docs/refs-single-title-books-review.csv`, regenerated from MariaDB whenever the refs are re-migrated. It lists the reclassified refs that match at least one signal, with one row per ref and every matching signal named. Each signal flags about 50% false positives on its own (measured 2026-11-13), so the list is for a curator to read, and the migration does not act on it:

  | Signal | Refs | What it catches |
  |---|---:|---|
  | Editors present, and the title blank or starting with "in " | ~30 | chapters missing their chapter title (high precision) |
  | Two or more authors and no editors | ~150 | co-authored books mixed with edited volumes whose editors were entered as authors |
  | `pubtitle` is the book title of other refs' chapters | 36 | edited volumes mixed with authored books whose chapters are cited separately |
  | `pubtitle` is the journal title of other refs' journal articles | 15 | misfiled articles, but mostly books that journal-article refs cite as their journal |
  | First page after 1 | 57 | mostly instalments of multi-part 19th-century works, plus some chapters and articles |
  | Title names a proceedings, symposium, congress, conference or festschrift, or "ed."/"eds."/"editor(s)"/"edited" in `title` or `comments` | ~5 | edited volumes |

- **Localhost is re-migrated** with the full runner. Aurora `pbdb2_migration_test` is rebuilt later.

No API, payload schema or DDL change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `refs-migration`:
  - The `book/book chapter` row of the publication-type table maps to `standalone book` (`"monograph"`) when the ref lacks two titles.
  - The scenarios in which a ref "stays an edited collection" become `standalone book`.
  - The title-rule counts gain the 665.

## Impact

- **Source → target:** MariaDB `pbdb_2026_10_18`.`refs` (`publication_type`, `reftitle`, `pubtitle`) → PostgreSQL `refs.reference` jsonb (`publicationType`, `bookType`). `ref_authors` and `ref_editors` are unaffected. The PBot refs migration is unaffected.
- **Code:** `migrations/src/refs-migration/migrate-refs.js` (`PUB_TYPE_MAP`, `PUBTITLE_TITLE_TYPES`, the mapping summary) and `migrations/src/tests/refs-transforms.test.js`. The review list is new: the code that writes `docs/refs-single-title-books-review.csv`, and the CSV itself, which is committed in the style of `docs/taxa-orphans-670.csv`.
- **Data integrity:**
  - 665 refs change `publicationType`, and each gains `bookType: "monograph"`. Titles, authors, editors, pages and every other field are unchanged.
  - Permids are minted on a full rebuild as before. Collections, opinions and specimens link to refs by permid and not by type, so every other runner count must reproduce exactly.
  - Migrated rows are validated by the db variant. `editors` on a `standalone book` is already accepted there, because Classic `book` refs carry them.
  - The roughly 20–50 edited volumes lose a type that was right for them by accident. This is accepted: the alternative keeps about 600 authored books labelled as edited.
- **Anomalies:** NULL vs empty-string title fields (legacy "no value" inconsistency) are handled by the existing trimmed, blank-is-absent title comparison. The 1,201 NULL `publication_type` refs still map to `other`.
- **API:** no code change. After the re-run, `publicationType=edited collection` returns only PBot refs, and `standalone book` gains 665.
- **Follow-up:**
  - `add-ris-reference-output`: the EDBOOK-vs-BOOK open question closes. `edited collection` keeps `EDBOOK`, since it now holds only real edited volumes.
  - `add-chapter-series-fields` comes next and also touches `migrate-refs.js`.

## Evidence (localhost and `pbdb_2026_10_18`, 2026-11-12)

Gathered while exploring whether `add-ris-reference-output` should export `edited collection` as `EDBOOK` or `BOOK`. Localhost had been re-migrated after `fix-book-chapter-migration`.

### Current publication types on localhost

Head rows only (`succeeded_by_id IS NULL`):

| `publicationType` | Rows |
|---|---:|
| journal article | 80,393 |
| article in edited collection | 5,712 |
| serial monograph | 3,564 |
| other | 3,117 |
| standalone book | 2,393 |
| edited collection | 666 |
| unpublished | 277 |

Of the 666 `edited collection` rows:
- 665 come from Classic `book/book chapter`.
- 1 is a PBot test ref, `REF-1000036-88` ("Ref-ddm-06-30a", editors "me"), to be removed with the user's PBot test data.

### Where they come from in Classic

The migration maps Classic `book/book chapter` to `edited collection` (`migrate-refs.js` `PUB_TYPE_MAP`). Since `fix-book-chapter-migration`, it does so only when the ref lacks two distinct titles (trimmed, compared ignoring case). The breakdown of those 665 refs in MariaDB:

| Classic titles | No editors | Editors | Total |
|---|---:|---:|---:|
| `pubtitle` only | 609 | 9 | 618 |
| both, equal | 14 | 2 | 16 |
| `reftitle` only | 12 | 3 | 15 |
| neither | 0 | 16 | 16 |
| **Total** | **635** | **30** | **665** |

A single title in `pubtitle` with no editors is how Classic stored a whole book.

For comparison, editors across Classic `publication_type` values:

| Classic type | Refs | With editors |
|---|---:|---:|
| journal article | 80,218 | 211 |
| book/book chapter | 3,710 | 1,314 |
| serial monograph | 3,564 | 108 |
| book chapter | 2,573 | 2,001 |
| abstract | 1,835 | 210 |
| book | 1,694 | 113 |
| NULL | 1,183 | 2 |
| Ph.D. thesis | 262 | 1 |
| unpublished | 248 | 1 |
| guidebook | 210 | 63 |
| M.S. thesis | 173 | 1 |
| compendium | 111 | 3 |
| news article | 88 | 0 |
| instcoll | 9 | 0 |

Most `book/book chapter` refs with editors are the 3,045 chapters that already moved.

### What the 666 contain

| Field | Rows |
|---|---:|
| `authors` non-empty | 665 |
| `editors` non-empty | 31 |
| `bookTitle` | 0 |
| `title` blank | 16 |

Authors per ref:

| Authors | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 15 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Rows | 1 | 502 | 102 | 31 | 9 | 5 | 9 | 1 | 3 | 2 | 1 |

Signals of what the rows really are:

| Signal | Rows | Reading |
|---|---:|---|
| One author | 502 | authored monographs |
| `publicationYear` before 1950 | 384 | 18th–19th-century monographs dominate; edited volumes were rare then |
| `title` starts with "in " | 13 | chapters whose chapter title is missing |
| `title` names a proceedings, symposium, congress, conference or festschrift | 2 | edited volumes |
| "ed.", "eds.", "editor(s)" or "edited" in `title` or `comments` | 3 | edited volumes |

### Random sample of 30 (ordered by `md5(permid)`)

| permid | Authors | Title (truncated) | Year |
|---|---|---|---|
| REF-20269-08 | Bertrand | Dictionnaire universel des Fossiles propres, et des Fossiles accidente… | 1763 |
| REF-20598-88 | Cumberland | Reliquiae conservatae, From the primitive materials of our present glo… | 1826 |
| REF-28596-53 | Dawson | Acadian geology, 1st ed. | 1855 |
| REF-22089-77 | Ramsay | Catalogue of a collection of fossils in the Australian Museum | 1883 |
| REF-21752-21 | Miller | North American geology and paleontology, first appendix. | 1892 |
| REF-22488-44 | Steinmann | Die geologischen Grundlagen der Abstammungslehre | 1908 |
| REF-7373-46 | Gould | The Panda's Thumb: More Reflections in Natural History | 1980 |
| REF-22759-07 | Sumrall; Sprinkle | Early ontogeny of the glyptocystitid rhombiferan Lepadocystis moorei | 1998 |
| REF-36067-47 | d'Orbigny | Paléontologie française: Terrains crétacés. 1. Céphalopodes… | 1841 |
| REF-27306-43 | Muir-Wood | A History of the Classification of the Phylum Brachiopoda | 1955 |
| REF-21024-71 | Gürich | Leitfossilien; ein Hilfsbuch zum Bestimmen von Versteinerungen… | 1933 |
| REF-23773-69 | Phillips | Geology of Oxford and the Valley of the Thames… | 1871 |
| REF-8221-24 | Cooray | An Introduction to the Geology of Ceylon | 1967 |
| REF-18961-52 | Zardini | Fossili Cassiani (Trias Medio-Superiore). Atlante dei Gasteropodi… | 1978 |
| REF-84305-57 | Blainville | Osteographie ou description iconographique comparee du squelette… | 1841 |
| REF-41294-80 | Siemiradzki | Geologia ziem polskich, 1, Formacye starsze do jurajskiej… | 1903 |
| REF-32925-64 | Claus | Grundzüge der Zoologie. 3rd edition… | 1876 |
| REF-15587-86 | Benton; Spencer | Fossil Reptiles of Great Britain… | 1995 |
| REF-25372-25 | Abel | Die vorzeitlichen Saugetiere | 1914 |
| REF-7324-96 | Fraser; Sues | In the Shadow of the Dinosaurs; Early Mesozoic Tetrapods | 1997 |
| REF-11503-19 | Koken; Perner | Die Gastropoden des baltischen Untersilurs | 1925 |
| REF-20737-59 | Dubatolova; Yeltysheva; Modzalevskaya | Morskie lilii devona i nignego karbona Dalnego Vostoka… | 1967 |
| REF-15351-18 | Cope | Syllabus of Lectures on the Vertebrata… | 1898 |
| REF-7433-60 | Barnes | The diversity of living organisms | 1998 |
| REF-3343-11 | Swinehart; Diffendal, Jr. (editors: Biggs) | *(blank)* | 1987 |
| REF-18085-61 | Cope | Syllabus of Lectures on Geology and Paleontology. Part III… | 1891 |
| REF-22872-56 | Ure | History of Rutherglen and East Kilbride | 1793 |
| REF-15954-52 | Grabau; Shimer | North American index fossils, invertebrates | 1909 |
| REF-35231-33 | Duff | Sketch of the Geology of Moray | 1842 |
| REF-37151-93 | Dawson | The geology of Nova Scotia, New Brunswick and Prince Edward Island… | 1891 |

In this sample:
- 27 of 30 are authored books.
- 1 is a real edited volume: Fraser & Sues.
- 1 looks like an article: Sumrall & Sprinkle.
- 1 is a chapter with no title and editors: REF-3343-11.

### Multi-author refs without editors (sample of 25)

This group, 2 or more authors and no editors, is where any real edited volumes hide. It is mixed:

- **Co-authored books:** Benton & Spencer; Kenrick & Crane, *The Origin and Early Diversification of Land Plants*; Grabau & Shimer; Vaught, Abbott & Boss, *A classification of the living Mollusca*; Poppe & Goto, *European Seashells*.
- **Edited volumes with the editors entered as authors:**
  - Fraser & Sues, *In the Shadow of the Dinosaurs*
  - Martill & Hudson, *Fossils of the Oxford Clay*
  - probably Kotlyar, Zakharov et al., *Evolution of the latest Permian biota* (two volumes)
  - probably Makridin et al., *Stratigraphy of the USSR. Jurassic system*
- **Chapters missing their chapter title:** Pewe & Hopkins, "in Bering Land Bridge"; Covert & Williams, "in Anthropoid Origins".
- **Article-like:** Sumrall & Sprinkle.

### Refs with editors (sample of 12 of 31)

| permid | Authors | Editors | Title |
|---|---|---|---|
| REF-3343-11 | Swinehart; Diffendal, Jr. | Biggs | *(blank)* |
| REF-3655-45 | Wilson; Prothero | Girty et al. | Geology of the Western Cordillera |
| REF-2443-92 | Martin | Martin and Barnosky | *(blank)* |
| REF-1979-29 | Hunt, Jr. | Prothero and Emry | *(blank)* |
| REF-1557-34 | Froehlich; Reser | Lucas et al. | *(blank)* |
| REF-1247-91 | Clemens; Lillegraven; Lindsay; Simpson | Lillegraven et al. | Where, when, and what: a survey of known Mesozoic mamma… |
| REF-1683-44 | Goodwin | Martin and Barnosky | *(blank)* |
| REF-3795-13 | Zakrzewski | T. C. Gustavson | Bureau of Economic Geology Guidebook |
| REF-1300-29 | Daeschler | K. M. Stewart | *(blank)* |
| REF-1000036-88 | — | me | Ref-ddm-06-30a *(PBot test ref)* |
| REF-1425-42 | Edmund | K. M. Stewart | A review of Pleistocene giant armadillos |
| REF-3205-37 | Spittler; Arthur | Ingersoll and Woodburne | *(blank)* |

Rows with editors are mostly chapters. Their chapter title is missing, or the book title was entered as the title. They are wrong as `edited collection` and as `standalone book`.

### Estimate

```
 665 Classic "book/book chapter" refs without two distinct titles
 ├── ~580–620  authored books: monographs and co-authored books
 ├──  ~20–50   real edited volumes, editors entered as authors
 └──  ~30      chapters missing their chapter title, or misfiled articles
```

Only a reading of each ref would separate edited volumes from co-authored books, because Classic records nothing that tells them apart.

### Queries

Localhost (PostgreSQL `refs`):

```sql
-- type counts
SELECT reference->>'publicationType', count(*) FROM refs
WHERE succeeded_by_id IS NULL GROUP BY 1 ORDER BY 2 DESC;

-- authors per edited collection
SELECT jsonb_array_length(coalesce(reference->'authors','[]')) n, count(*) FROM refs
WHERE succeeded_by_id IS NULL AND reference->>'publicationType' = 'edited collection'
GROUP BY 1 ORDER BY 1;

-- signals
SELECT count(*) FILTER (WHERE reference->>'title' ~* '^in ') in_prefix,
       count(*) FILTER (WHERE reference->>'title' ~* '(proceedings|symposium|congress|conference|volume in honou?r|festschrift)') proceedings,
       count(*) FILTER (WHERE reference->>'title' ~* '\m(eds?\.|editors?|edited)\M'
                           OR reference->>'comments' ~* '\m(eds?\.|editors?|edited)\M') ed_words,
       count(*) FILTER (WHERE (reference->>'publicationYear')::int < 1950) pre1950
FROM refs WHERE succeeded_by_id IS NULL AND reference->>'publicationType' = 'edited collection';
```

MariaDB (`pbdb_2026_10_18`):

```sql
SELECT CASE WHEN trim(coalesce(reftitle,''))<>'' AND trim(coalesce(pubtitle,''))<>'' THEN 'both(equal)'
            WHEN trim(coalesce(reftitle,''))<>'' THEN 'reftitle only'
            WHEN trim(coalesce(pubtitle,''))<>'' THEN 'pubtitle only' ELSE 'neither' END titles,
       trim(coalesce(editors,''))<>'' has_editors, count(*)
FROM refs
WHERE publication_type = 'book/book chapter'
  AND NOT (trim(coalesce(reftitle,''))<>'' AND trim(coalesce(pubtitle,''))<>''
           AND lower(trim(reftitle)) <> lower(trim(pubtitle)))
GROUP BY 1, 2 ORDER BY 1, 2;
```
