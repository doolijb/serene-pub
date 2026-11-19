# INVENTORY — where dated lore can be written without a date today (programme 1.7; read-only, 2026-11-16)

Paths under `src/lib/server/` unless `sdk:` (`../serene-pub-sdk/`). Re-verify every file:line.

**Short answer:** on a timeline lorebook only a pipeline's history entry is refused for lack of a date, and
only when the session has no story "now". Everything else goes through: optional-date rows are stored undated,
history dates fall back to Year 1 or the newest entry, undated edits are written onto the base row in place.

## 1. What is dated (`db/schema.ts`)

- **Always dated:** a history entry (`fields.year` required, default 1: `sdk:core-catalog/src/registry/entries.ts`
  242–254; a boot CHECK, `pipelines/boot/entryProjection.ts` 29–38, 232; `entryInsert` fills year 1,
  `utils/lorebookEntries.ts` 418–420; legacy undated rows exist and read as null, `state/reading.ts` 454–461);
  `cast_amendments.year`, `cast_presences.from_year` NOT NULL; `entry_amendments.year` NULL only when held.
- **Optionally dated (NULL = undated: "from the beginning", read on every line):** an entry's Beginning
  (`fields.year/month/day`; NULL = Perpetual, `lorebooks/entryDefaults.ts` 107–125); `history_entry_id` on
  `lorebook_bindings`, `narrative_relationships` (links and knowledge ties), `entry_amendments`,
  `cast_amendments`, `character_versions`, `attribute_configs`, `attribute_values`, `state_proposals`;
  `character_versions.year`; `scenes.history_entry_id` (NULL = not yet compiled); scenes' opened / closed clocks;
  `session_messages.story_clock_*`; `attribute_values.story_clock_*`; `lorebook_branches.fork_year`; the story
  clocks on `lorebooks`, branches and `sessions` (NULL = the line's present is its newest history entry).

## 2. Where each write's date comes from

Helpers: `writeDatingAt` (`state/reading.ts` 511–536) = the latest dated history entry at or before the moment,
or null; the reading's moment = the session's clock, else the line's clock, else null (368, 383; `linePresentOf`
408–427); `storyNowOf` is null only with no clock **and** no dated history entry (`state/storyTime.ts` 283–326).

| Pipeline write | On a timeline lorebook with no date |
|---|---|
| `create-lore-entry@1`, history (and summaries via `rememberNote`) | `fields.year`, else story now, else **refused** (`host.loreWrites.ts` 504–535; `host.ts` 639–643: "history needs a date. Give this write a year in its fields, or give the story a dated history entry first.") |
| `create-lore-entry@1`, other types | Beginning takes the reading's **moment** (not story now) (`host.ts` ~6449); with no clock **stored Perpetual, silently** (~6748). Items, the reckoning's places. |
| Links (both outlets) | `line.historyEntryId` or null (`host.loreWrites.ts` 274, 792); the own-book route with no attached book always null (368–379). **Written undated.** |
| `update-lore-entry@1` | A dated version only when `moment != null` (`host.ts` 474–479); otherwise **written in place on the base row** (532–578); a held change **held undated** (297–304). |
| `note-entry-knowledge@1` | `line.historyEntryId` (`host.loreWrites.ts` ~1090). **Undated.** |
| `update-cast-member@1` | `when = reading.moment ?? dating?.date ?? null` (`characters/versions.ts` 1951, 2025). **Undated.** |
| `advance-story-clock@1` | With no clock starts at Y1 M1 D1 00:00 (`storyTime.ts` 387, 465–473, 508). |
| Scene open / close | Message stamp, else session clock, else **all NULL** (`scenes/liveScenes.ts` 145–148, 1208, 1415). |
| Message stamps; stats | Nothing / NULL when there is no story now (`messages/store.ts` 95–109; `state/write.ts` 460, 2611). |
| Settle | `historyEntryId` can be null (`sessions/settle.ts` 168–187, 223). |
| Session notes, Apply | An undated held change folds into the entry row (`lorebooks/ownBook.ts` 1528, 2431); a moved link with no lorebook day on that date becomes undated (2336–2346). |

By a person (sockets): history create with no year → Y1/1/1, or the **next** day after the newest
(`sockets/entries.ts` 970–984, `messages/writes.ts` 329–341); scene compile with no date → the newest dated
entry, else creates Y1/1/1 (`scenes/historyEntryOfDate.ts` 151–155); Beginning, links and hand ties optional by
design; an author's cast version with `date: null` edits the base on main, refused on a line (`UNDATED_PLACE`).

Import / copies: import falls back to year 1 for history, links arrive undated; duplicate is exact; a
**timeless copy** strips every date and turns the timeline off, and the owner can switch it back on
(`sockets/lorebooks.ts` 1059–1155) → an undated book with a timeline; the attic carries years as written;
plugin-provided books write undated base cast versions.

## 3. When a session on a timeline lorebook has no story "now"

- At create no clock is set unless the request names one (`sockets/sessions.create.ts` 433–445, 746–758; the
  start form sends one only for "branch-off").
- New lorebooks and own books start with the clock unset (`lorebooks/ownBook.ts:233`) and `timeline_enabled`
  defaults to true (`schema.ts:1407`). **So a timeline lorebook can exist with no clock and no history: story
  now is null**, and every play write above goes undated until a clock is set or a history entry is dated.
- Chat and Guide (`keepsTime: 'real'`) have no clock of their own: on an attached lorebook they read its switch
  and clock; their own book starts with the timeline off. Summaries pass no year: story now, or refused.
- Story: Minimal's `timeline: false` applies only to its own book.

## 4. Refusals and how they report

`TIMELINE_OFF_SENTENCES` (`lorebooks/timeline.ts` 45–49); the two history sentences above; `assertDateLands`
(`storyTime.ts:178`). To the run: a `HostScopeError` throw fails the node; `written: false` + `notes` reach the
receipt (`receipts.ts:273`); the clock outlet returns `skipped` under `onRefusal`.

## 5. SDK

No in-port carries a date: `create-lore-entry@1` / `update-lore-entry@1` take it only through `fields: S.json`;
links, cast-member and knowledge outlets have none. No story-date shape (`clockTarget` is a time of day). No
`validate()` law on dates.

## 6. Tests that pin an undated or default-dated write on a timeline lorebook

`pipelines/runtime/host.entryDefaults.int.test.ts:201` ("Timeline on with no clock: no date");
`host.datedVersion.int.test.ts:587`; `host.heldEntryChange.int.test.ts` 279, 323;
`state/ownNotesLine.int.test.ts` 450, 518, 532; `lorebooks/applyOwnBookLinksDays.int.test.ts:652`;
`characters/versions.authoring.int.test.ts:807`; `lorebooks/sessionLine.int.test.ts:168`; fallbacks:
`sockets/scenes.compileLine.int.test.ts` 1389, 1411; `scenes/historyEntryOfDate.int.test.ts` 181, 201;
`sockets/entries.unfiledSceneCount.int.test.ts:114`; `state/sessionStoryClock.int.test.ts` 178, 299;
`sockets/sessions.timePasses.int.test.ts:128`; `lorebooks/entryDefaults.test.ts:78`.
`host.historyWrites.int.test.ts:275` already asserts the refusal.
