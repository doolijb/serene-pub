# PLAN (draft, not a go) — edit history for entries, cast versions and card versions (2026-11-13)

Owner, 2026-11-13: "Perhaps we should keep a change history. Change history that's not a dated change on the
timeline (i.e. it's purely an edit and not a timeline evolution) does not persist on copy, export, share, copied
from starter, etc. We can add admin and user controls for cleaning up non persistent change history." Agreed shape
("I agree"): previous values kept on every save that changes name, text or typed fields, with when and who; a list
with Restore in the form; the lorebook's, not a session's; never travels; user Clear (entry, lorebook), admin Clear
under Admin › Data; last 50 per entry; entries first. Then: "Also make a pass on cast history and make sure it
behaves similar so it's familiar across the entire lorebook. Lets also add card edit history." · "card edit
history should be per version".

Comes after lane `full-direct` and the children build. Nothing here is built.

## Facts (read-only inventory, 2026-11-13; re-verify before briefing)

**Entries: eight writers of name/content/typed fields, no shared funnel.**
1. Form save `applyEntryUpdate` (`sockets/entries.ts` ~497–527; `splitUpdate`/`mergeFields` in
   `utils/lorebookEntries.ts` ~673, ~160).
2. Pipeline `changeLoreEntry` (`pipelines/runtime/host.ts` ~2255, update ~2309; `fileOntoHistoryDay` ~2359).
3. Apply / Take back `writeEntryKeys` (`lorebooks/ownBook.ts` ~1785; callers ~2110, ~2355, ~2749, ~2760).
4. Imprint Revert / retract / restore `SUBJECTS.entry.write` (`lorebooks/imprints.ts` ~186–198).
5. Ruleset tie (`rulesets/ties.ts` ~732). 6. Cairns (`sessions/dcCairns.ts` ~351).
7. Provided books / primers upgrade (`plugins/providedBooks.ts` ~1436, `providedPrimers.ts` ~291).
8. Boot data upgrades (raw SQL, `db/dataUpgrades/*`).
Imports and iterate-next only insert. Apply / Take back also move a row between books by rewriting `lorebook_id`
(`ownBook.ts` ~2176, ~2715), so a history row must key on the entry, not carry a `lorebook_id`.

**Existing records cannot serve.** `lore_imprints` is the session's (`session_id` NOT NULL, cascade), a person's
save writes none, rows are deleted on rewrite / Revert / Keep, settle nulls `before`. `entry_amendments` is a
dated overlay with no previous value. `binding_merge_logs` is cast absorbs only.

**Cast.** `character_versions` holds cast versions and card versions (one of `card_id` / `cast_member_id`);
`characters/versions.ts` is its only writer. A cast version is a whole profile at (line, date, life point); Save on
the member page overwrites the shown version in place and keeps nothing (`versions.ts` ~1649; `updateCastVersion`,
`sockets/lorebooks.ts` ~1846). New rows only for a story write or a dated change. UI: `lorebooks/time/
AmendmentList.svelte` on the Member tab and the entry form, heading "Amendments", no who, no when, no Restore.
Duplicate copies every cast version; export the base only.

**Cards.** A card version is a `character_versions` row with `card_id`, `number`, `label`. Save is in place on
the chosen version through one funnel `updateCardVersion` (`versions.ts` ~541; callers `sockets/characters.ts`
~716, ~1080, ~2844, `portrait.ts` ~231, `appletLibrary.ts` ~232); "Save as new version" → `newCardVersion`. The
editor's save passes no `writtenBy`. Per-version history keys on `character_versions.id`; the same key serves cast
versions.

**Travel.** Duplicate, starter copy, session world copy and Merge into notes all run `copyLorebookTables` over
`LOREBOOK_TABLES` (`lorebooks/tableRegistry.ts` ~1121). An unregistered table fails `tableRegistry.test.ts` ~62;
the pattern is a registered spec with `notCopied` and an empty copy (as `binding_merge_logs`, ~1092), and the
duplicate test expects 0 rows. **Share as a lorebook renames the same row in place** (`ownBook.ts` ~1196–1245):
history stays unless that function clears it. Export is hand-listed. Overwrite import purges the book (ids change).

**Cleanup surfaces.** Entry form menus (`EntryWorkspace.svelte` ~1904–2061). Book settings has only Delete
actions (`BookSettings.svelte` ~405, ~458). Admin › Data (`admin/sections/data/Page.svelte`); the count + bytes +
**Clear** pattern is `components/media/SpokenLinesRow.svelte`.

**Migrations.** Highest index 0159 on 2026-11-13 (another session's, uncommitted): re-read at build time;
generated only.

## Today, side by side

| | Entries | Cast | Cards |
|---|---|---|---|
| Kept | nothing for a person's save; per-field before for runs, session-owned | dated versions; in-place edits overwrite | numbered versions; in-place edits overwrite |
| Shown | "Amendments"; the *replaced* note | "Amendments"; no who / when | "Card version" select |
| Restore | Revert (replaced note), Take back (an Apply) | none | none |

## Proposed shape (lead's recommendations, each an open ★ until ruled)

- One table for all three, keyed by subject (an entry, or a `character_versions` row), registered `notCopied`.
- Name in the UI: **Edit history** (not "History": history-type entries already use it), beside the existing
  dated list, which is left alone.
- Parts, in order: entries → cards (one funnel) → cast versions.

## ★ for the owner

1. Cast "behaves similar": an Edit history on each cast version (as cards), the dated list left as it is — or
   reshape the dated list?
2. Share as a lorebook (same row): clear the edit history then?
3. A session-written cast version taken back by Back / swipe takes its edit history with it: accepted?
4. Which machine writes record, and as whom (routines, Apply, Revert / Take back / Restore; cairns; plugin and
   boot upgrades)?
5. Overwrite import: cleared?
6. The name **Edit history**.
