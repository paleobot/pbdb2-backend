# Occurrences

An occurrence is one fossil (or lot of fossils) found in a collection and identified as a taxon:
`GET /api/v1/occurrences` and `GET /api/v1/occurrences/{permid}`. They are read-only. The decisions
behind them are in the OpenSpec change `add-occurrence-reads` and the `occurrence-reads` spec.

## An occurrence and its identifications

An occurrence is named by **identifications**. The first one records the occurrence; later ones
reidentify it. The occurrence's permid is its first identification's permid.

- `identification` in an occurrence is the identification that **currently** names it: the one
  whose reference was published most recently (ties go to the one entered last). Its ranks (`genus`, `subgenus`, `species`,
  `subspecies`) are placed directly in it. `identification.name` is a display string made from
  them; the ranks are the authoritative form.
- `identification.href` is that identification's full record, with its `comments` and its own
  `plantOrgans`. There the ranks stay under `identification`, as stored.
- `GET /api/v1/occurrences/{permid}/identifications` lists all of them, the original first. Each
  identification's permid is valid only under its own occurrence.

## Two references

| Field | Meaning |
|---|---|
| `reference` | where the occurrence was **first recorded**: its original identification's reference |
| `identification.reference` | where its **current name** was published |

They are the same unless a reidentification wins (about 32,000 occurrences). To cite where a
fossil was described, use `reference`; to cite its current name, `identification.reference`.

## Two taxa, and two taxon filters

| Field | Meaning |
|---|---|
| `identification.taxon` | the taxon name the identification resolved to, as written: possibly a junior synonym. It has a permid but no `name` or `href` when the name opinion has no derived taxon (about 550 occurrences), and is `null` when the name did not resolve (about 51,000) |
| `acceptedTaxon` | the accepted name of that taxon's concept; `null` when there is no taxon |

| Filter | Matches |
|---|---|
| `taxon=<TXN permid>` | occurrences identified as **exactly** that name. Not its synonyms, and nothing within it: `taxon=<a genus>` does not find occurrences identified to species |
| `withinTaxon=<TXN permid>` | occurrences identified as anything **in the subtree** of that taxon's accepted concept: the concept, every taxon within it at any depth, and every synonym or spelling of each. A junior synonym's permid gives its senior's whole subtree |
| `collection=<COL permid>` | the occurrences of one collection |

Filters combine (AND), and combine with `ids` and paging. A value that is not a permid of the
filter's prefix is a 400; a well-formed permid that names nothing gives an empty list.
