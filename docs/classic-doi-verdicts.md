# Classic DOI verdicts: why a DOI was discarded

About 4% of the DOIs on PBDB Classic refs point to the wrong work, for example a 1866 crinoid paper carrying a *Lancet* DOI. Most were attached by matching the first author's surname and the year, without comparing titles. Before migration, every Classic DOI was checked against what its registration agency (Crossref, DataCite, …) holds for it, and each one got a **verdict**. The refs migration keeps or discards the DOI by that verdict.

[`classic-doi-discards.csv`](classic-doi-discards.csv) lists every discarded DOI, 1,861 of 46,812 (4.0%). This page defines the four verdicts that discard a DOI and explains the columns.

*Snapshot of 2026-11-17, from Classic dump `pbdb_2026_10_18`. The full verdict file, with the kept DOIs too, is `migrations/src/refs-migration/inputs/doi-verdicts.csv`. The rules are specified in `openspec/specs/classic-doi-audit/spec.md`.*

## The discard verdicts

| Verdict | Refs | Meaning |
|---|---:|---|
| `wrong` | 1,202 | The DOI belongs to an unrelated work. |
| `related-work` | 99 | The DOI belongs to a work with a similar title that is not this ref. |
| `unresolvable` | 279 | The DOI is well formed, but no registration agency knows it. |
| `malformed` | 281 | The value is not a DOI at all. |

### `wrong`
The registered title shares too little with the ref to be the same work. Neither the ref's title nor its `pubtitle` reaches the "uncertain" level (a title score of 0.3) against the registered title or container, and no rescue rule applies (see [Rescues](#rescues)).

Examples:
- Hall 1866, a crinoid paper, carries the DOI of a *Lancet* case report.
- Hall 1981, *The Mammals of North America*, carries the DOI of *Polymer Materials*.
- Alf 1966, "Mammal trackways from the Barstow Formation", carries the DOI of a cardiology paper.

Many `wrong` refs have the same first author and year as the registered work. That is how the DOI was attached, so it is no evidence the DOI is right.

### `related-work`
The titles agree (a score of 0.6 or more), but the years differ by more than one, and the title and first author don't both agree fully. The registered work is a different one with a similar title. Typical cases:
- **Another paper by the same author on a similar subject:** Gazin 1935 "A new antilocaprid from the Upper Pliocene of Idaho" carries the DOI of Gazin 1933 "New felids from the upper Pliocene of Idaho".
- **A review of the book:** the registered title is the book's title, but the author is the reviewer (*Quarterly Review of Biology*, *Journal of Mammalogy*).
- **An abstract pointing to the later full paper**, or a thesis pointing to the article published from it.

### `unresolvable`
The value looks like a DOI (`10.` + a 4–9 digit prefix + `/` + a suffix) but doesn't exist. Crossref has no record of it, and the DOI system (doi.org) reports it as not registered. These are usually typos or truncated DOIs.

### `malformed`
After any leading `doi:`, `https://doi.org/`, `dx.doi.org/` or `^` is removed, the value doesn't match the shape of a DOI. Examples:
- **Broken DOIs:** `10.666/12-075` (a 3-digit prefix), or `10.1016/ j.palaeo…` (an embedded space).
- **Other identifiers or links:** handle URLs (`hdl.handle.net/…`), JSTOR stable links, PDF URLs.
- **Free text:** author lists, dates ("17 December 1871"), "-".

## How titles are compared

A **title score** measures how much of one title appears in the other. Both titles are reduced to their words of three or more letters, ignoring case, accents, markup (`<i>`, `<scp>`) and common function words ("the", "and", "des", "der", "los"…). The score is the number of shared words divided by the word count of the shorter title. A score of 1.00 means every word of the shorter title appears in the longer one.

The years agree when they differ by at most one, or when either is missing.

The authors agree when the two first-author surnames match, ignoring accents, case and punctuation. One typo is allowed, and so is a shortened compound name.

## Rescues

The author only ever **rescues** a DOI that the titles alone would discard. It never causes a discard:
- **Full title and first author agree, years far apart → kept as `match`.** This covers online-first dates (*Historical Biology*, *Acta Palaeontologica Polonica*: the DOI's year is about 2 years before the print year), journal backfiles registered decades later, and year typos in Classic (1990 for 1900).
- **The ref's journal, first author and year all agree with the DOI's → kept as `uncertain`.** This covers titles registered in another language (*Estudios Geológicos*, *Andean Geology*, *Geobios*), and refs that have only a journal name, no article title.

## Verdicts that keep the DOI

For contrast:
- **`match`** (44,620): the title agrees and the years agree, or the title and author agree fully.
- **`part-or-container`** (25): the DOI is for the ref's book or volume, or for a part of it.
- **`uncertain`** (306): partial agreement, no registered metadata, no title on the ref, or a rescue.

## Columns of `classic-doi-discards.csv`

Rows are grouped by verdict (`wrong`, `related-work`, `unresolvable`, `malformed`), then sorted by `reference_no`.

| Column | Content |
|---|---|
| `reference_no` | Classic `reference_no` |
| `verdict` | One of the four discard verdicts |
| `source_doi` | The DOI as stored in Classic (trimmed) |
| `classic_type`, `first_author`, `year`, `reftitle`, `pubtitle` | The Classic ref's `publication_type`, `author1last`, `pubyr`, `reftitle` and `pubtitle` |
| `score` | The title score of the ref's title against the registered title; blank for `unresolvable` and `malformed` |
| `source` | Where the registered metadata came from: `crossref`, `doi.org` (DataCite and other agencies), or `none` (not registered); blank for `malformed` |
| `registered_title`, `registered_container`, `registered_year`, `registered_first_author` | What the registration agency holds for the DOI: the work's title, its journal or book, its year, and its first author's surname |

## Known limits

The rules were checked against a sample of a few hundred verdicts, not every row. In that sample, a handful of discarded DOIs were in fact right, typically:
- a title spelled slightly differently ("softshelled" against "soft-shelled");
- a year far off with the author recorded differently.

## Correcting a discard

To restore a DOI wrongly discarded, change its `verdict` to `match` in `migrations/src/refs-migration/inputs/doi-verdicts.csv` (not in this CSV) and re-run the refs migration. A normal audit run keeps the edit. `--all` and `--rescore` overwrite it, and the git diff shows that.
