## Context

`migrate-refs.js` maps each Classic ref's `pubtitle`, `pubvol` and `pubno` by target type (`mapPubtitle`, `mapVolNo`). For `article in edited collection` it writes `pubtitle` to `bookTitle` and drops `pubvol` and `pubno`, because the type has no volume field.

One group already keeps them. A Classic `book` with two titles and no editors stays a `standalone book`, so its `pubtitle` has nowhere to go either. `fix-book-chapter-migration` D3 gave these 236 refs a container note in `comments`, built by `containerNote(ref, editors)`:

```
Published in: <pubtitle>[, vol. <pubvol>][, no. <pubno>]
```

`buildComments` adds it after any existing `comments` with `; `. The refs-migration spec says no other ref gets a note.

Chapters are the refs that migrate as `article in edited collection`:
- every Classic `book chapter`
- a `book/book chapter` with two titles
- a `book` with two titles and editors

In `pbdb_2026_10_18`, 1,907 of them carry a `pubvol` or `pubno`. Six of those have no `pubtitle`, and about 42 `book chapter` rows among them already have `comments`.

The proposal explains why the volume is not parsed into series fields. This design covers only how the note is written.

## Goals / Non-Goals

**Goals:**
- Keep every chapter's `pubvol` and `pubno` in the migrated record.
- Use the container note that already exists, in one format, so curators and any later recovery script deal with one pattern.
- Change nothing else in a chapter's payload.

**Non-Goals:**
- Series fields, a volume field, or any change to the reference payload schema.
- Parsing `pubtitle` into a book and a series.
- Notes for whole books (`standalone book`) with a volume, apart from the existing 236.
- PBot chapters: 1 of 18 has a volume.
- The API and RIS: a chapter still exports with no `VL`.

## Decisions

### D1. A chapter gets the note only when it has a volume or number

The note is written when the ref maps to `article in edited collection` and its trimmed `pubvol` or `pubno` is non-blank. A chapter with neither gets no note: its `pubtitle` is already in `bookTitle`, so a note would only repeat it.

The test is on the target type, not on the Classic type. That way it follows whatever `mapPublicationType` decides, including the title rules and any later reclassification.

*Alternative:* note every chapter, so that every Classic container string is kept verbatim. Rejected because it adds about 3,800 notes that just repeat `bookTitle`.

### D2. The note repeats the `pubtitle`, in the existing format

A chapter's note is built exactly like a book's:

```
Published in: The Continental Jurassic. Museum of Northern Arizona Bulletin, vol. 60
```

This repeats `bookTitle` inside `comments`, which is deliberate:
- **One format.** Books and chapters share one pattern, so a later script that recovers series and volumes, or a curator searching `comments`, has a single thing to look for.
- **It stands on its own.** The volume belongs to the series named inside `pubtitle`, so a bare volume means little. If a curator later shortens `bookTitle` to the book part and fills series fields, the note still holds the original Classic string it came from.
- **It isn't ambiguous.** A bare "vol. 60" after free text ("49 pl.; vol. 60") reads like part of that text. The `Published in:` prefix marks it as the container.

*Alternative:* a volume-only note (`vol. 60, no. 3`). It's shorter and has no duplication, but loses both points above.

### D3. A chapter with no `pubtitle` gets `Published in: vol. …`

The six chapters with a volume but no `pubtitle` (e.g. ref 87648, vol. 3, no. 2) get the note without a title part:

```
Published in: vol. 3, no. 2
```

The prefix stays, so the pattern is the same for every note. These refs are missing their book title anyway, and the note at least keeps the volume. `containerNote` builds the title part only when `pubtitle` is non-blank. The existing book case always has one, because two titles imply a non-blank `pubtitle`.

*Alternatives:* skip these six, which loses data; or write a bare `vol. 3, no. 2`, which breaks the single pattern.

### D4. `containerNote` takes the target type

`containerNote(ref, editors)` becomes `containerNote(ref, editors, referenceTypeName)`, with two cases:
- the existing book case, unchanged
- the new chapter case, when `referenceTypeName === 'article in edited collection'` and a volume or number is present

The caller already computes `pubType` before the note, so it only has to pass `pubType.referenceTypeName`.

Placement in `comments` is unchanged (`buildComments`): after existing comments with `; `, or as the whole value.

*Alternative:* a separate `chapterVolumeNote`. Rejected because the two would share the format code, and one function keeps a single format by construction.

### D5. Logging splits the container-note count

The single `Container notes written to comments: N` line becomes two counts, books and chapters. That makes the new rows visible and lets a re-run be compared with the baseline. Expected: books 236, chapters about 1,907.

## Risks / Trade-offs

- **[The volume is text, not a field]** → Filters, RIS and citation formatting don't see it. This is accepted and recorded in the backlog as a known data issue. Whether chapters get a field is the open model question there.
- **[`comments` repeats `bookTitle`]** → Accepted for D2's reasons. It's visible on about 1,900 records.
- **[Curators edit or delete the note]** → `comments` is free text, so that's their call. The Classic source stays available while migrations repeat.
- **[A re-migration changes more than intended]** → Verification compares every payload with a baseline built before the change. Only `comments` may differ, only on chapters, and the count must match the chapter-note count. All runner totals and permids must be identical.

## Migration Plan

1. Save a baseline: dump `refs.reference` payloads from the current localhost build.
2. Apply the code change and tests; run `npm test`.
3. Drop and recreate localhost `pbdb`, and run the full runner (`run-migrations.js --createdb`).
4. Compare with the baseline as described in Risks. Spot-check notes for:
   - a chapter with only a volume
   - a chapter with a volume and a number
   - a chapter that already has `comments`
   - each of the six chapters with no `pubtitle`
   - a chapter with no volume, which gets no note
5. Rebuild Aurora `pbdb2_migration_test` later, with the next scheduled rebuild.

Rollback: revert the commit and rebuild. The change has no schema or DDL part.

## Open Questions

None.
