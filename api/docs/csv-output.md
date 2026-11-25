# CSV output

The lists of `references`, `authorities`, `collections`, `taxa` and `occurrences`, and their `ids`
reads, can be returned as CSV. The decisions behind this are in the OpenSpec change
`add-csv-list-output` and the `csv-output` spec. An occurrence's identifications
(`/occurrences/{permid}/identifications`) are not offered as CSV.

## Asking for CSV

Send the header `Accept: text/csv`. There is no format parameter in the URL: `?format=csv` is
rejected as an unknown parameter.

```sh
curl -H 'Accept: text/csv' -o collections.csv 'https://<host>/api/v1/collections'
```

```r
refs <- read.csv(url("https://<host>/api/v1/references?publicationYear=1991",
                     headers = c(Accept = "text/csv")))
```

```python
import pandas as pd
refs = pd.read_csv("https://<host>/api/v1/references?publicationYear=1991",
                   storage_options={"Accept": "text/csv"})
```

Without the header, the same URL returns JSON. That includes `read.csv(url)` in R with no
`headers`, which will then fail to parse.

A browser link cannot set `Accept`, so a web page offering a download must `fetch` the URL with the
header and save the result.

## What you get

- **No `limit`: the whole result.** Every record matching the filters, in permid order, streamed.
  This differs from JSON, where a list without `limit` is one page of 100.
- **With `limit`: one page**, as in JSON. Further pages are in the `Link` response header
  (`rel="next"`, `rel="prev"`).
- **`ids`:** the records found. Unknown permids are simply absent; compare the `permid` column with
  your request to find them.
- **Errors are JSON**, with the usual status codes.
- **Concurrent exports are capped.** Each server runs a few whole-result exports at once. Beyond
  that you get a 503 with `Retry-After`; retry later, or page with `limit`.
- **A dropped connection means an incomplete file.** If the server fails partway through, the
  connection is aborted rather than the file ending early. Check that your client reports transfer
  errors.
- **`includeContainingTaxa` is not available in CSV**, and is a 400.

The file is UTF-8 with no byte order mark, has one header line, and follows RFC 4180: CRLF line
ends, and fields quoted when they contain a comma, quote or line break. Line breaks inside comments
are kept. Values are exported as stored: a value beginning with `=`, `+`, `-` or `@` is not altered.
If Excel shows accented names wrongly, import the file as UTF-8 rather than opening it directly.

## Columns

Columns come from the resource's schema, in the order of its JSON fields, starting with `permid`.
Every response from one resource has the same header, whatever the filter, even when there are no
records. A field with no value is an empty cell.

| JSON shape | CSV | Example column |
|---|---|---|
| nested object | one column per field, dotted path | `location.coordinates.latitude` |
| link | its permid and its label; no `href` | `reference.permid`, `reference.title` |
| link inside an object | the same | `identification.taxon.permid`, `identification.taxon.name` |
| list of values | one column, joined with `\|` | `descriptors` |
| list of objects | one column per field, joined with `\|` in the same order | `authors.familyName`, `authors.givenName` |
| list inside a list of objects | joined with `;` inside each `\|` part | `lithofacies.adjectives` |
| list of links | permids only | `additionalReferences.permid` |

No column is an `href`, including an occurrence's `identification.href`: every URL can be built from
the permids.

Lists of objects stay aligned: the n-th part of `authors.familyName` and of `authors.givenName` are
the same author, and a missing value keeps its place (`A||C`).

**Escaping.** Inside a list column, a `\`, `|` or `;` that is part of a value is written with a `\`
before it. The separators themselves are never escaped. So `["Smith", "Ab|cd", "Lee"]` is
`Smith|Ab\|cd|Lee`. Columns that are not lists are never escaped. A plain split on `|` is correct
for any cell with no `\` in it. To split exactly:

```python
import re

def split_cell(cell, sep="|"):
    """Split on unescaped separators. Escapes are kept, for a split on ';' after one on '|'."""
    if cell == "":
        return []
    parts, current, i = [], "", 0
    while i < len(cell):
        if cell[i] == "\\" and i + 1 < len(cell):
            current += cell[i:i + 2]
            i += 2
        elif cell[i] == sep:
            parts.append(current)
            current = ""
            i += 1
        else:
            current += cell[i]
            i += 1
    parts.append(current)
    return parts

def unescape(text):
    return re.sub(r"\\(.)", r"\1", text)

family_names = [unescape(p) for p in split_cell(row["authors.familyName"])]
adjectives = [[unescape(a) for a in split_cell(p, ";")] for p in split_cell(row["lithofacies.adjectives"])]
```

An empty cell is an empty list, so a list holding one empty value cannot be told apart from an
empty list.

## Occurrence columns

An occurrence row carries two references and two taxa, named apart on purpose (see
`occurrences.md`):

| Column | What it is |
|---|---|
| `reference.permid`, `reference.title` | where the occurrence was first recorded (its original identification) |
| `identification.reference.permid`, `.title` | where its current name was published (the identification that currently wins) |
| `identification.name` | that name formatted for display; the rank columns are the authoritative form |
| `identification.genus.resolution`, `identification.genus.name`, … `subspecies` | the ranks as written, with their qualifiers |
| `identification.taxon.permid`, `.name` | the taxon the name resolved to. A permid with an empty name is a name opinion with no derived taxon |
| `acceptedTaxon.permid`, `.name` | the accepted name of that taxon's concept; empty when the name did not resolve to a taxon |
| `abundance.value`, `abundance.unit` | how many were recorded, as text (`3-5` and `common` occur) |

`withinTaxon=<permid>` with no `limit` exports a whole subtree; Mammalia (about 94,000 occurrences)
takes about 15 seconds on a development machine.

## Known limits

- `legacyIDs.oldpbdbIDs` is very long on a few authorities: about 62,000 characters on "authority
  unknown" and 49,000 on "Linnaeus 1753". That exceeds Excel's 32,767-character cell limit. R and
  pandas read it in full.
- The collection columns under `ages.intervals`, `environment` and `paleontology` are placeholders
  awaiting a redesign, and will change.
