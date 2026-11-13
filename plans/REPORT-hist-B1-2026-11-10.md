# REPORT — hist-B1: pipeline history writes (core host) — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs and reports: `plans/briefs/BRIEF-hist-B1-w{1,2}.md`, `plans/briefs/REPORT-hist-B1-w{1,2}.md`.

## Changed files
- **`pipelines/runtime/host.ts`:** a new helper, `fileOntoHistoryDay`, placed after `changeLoreEntry`.
  - The date comes from `fields.year`, else from `writeDatingAt`. When there is neither, the write is refused.
  - Then: `assertDateLands` → `historyEntryOfDate(create:true)` → an imprint of the created day entry → an append through the imprinted `changeLoreEntry`.
  - When the day's entry already existed, the result carries the receipt *"filed onto ‹date›'s entry"*.
  - **`create-lore-entry` with history** goes through the helper. `match` is ignored, and an existing day returns the `match` shape (`matched:true, written:false`).
  - **`update-lore-entry`:** a history re-date checks the lock → `assertDateLands` → `assertHistoryDateFree(exceptId)` → `assertRedateKeepsLines`, only when the date changes.
- **`tools/writeTools.ts`:** `history` is removed from `ENTRY_TYPES`, and `kind:"history"` → `ToolError("History comes from scenes: capture the moment and compile it, or write world lore.")`. One new test in `writeTools.test.ts`.
- **New `host.historyWrites.int.test.ts` (9 tests):**
  - two creates on one date → one row with both paragraphs;
  - with no fields, the write files onto the `writeDatingAt` entry;
  - a retake reverts the append and removes a created entry;
  - fork rules;
  - an undated write is refused;
  - the update refusals, and a resend passes.
- **Lead:** `messages/loreLinks.int.test.ts` gives its history commit `fields: {year:1, month:1, day:1}` (25/25 green).

## Tests
- 24 files, 185/186. The one failure was `loreLinks`, now fixed by the lead.
- DC suites: 37/43. **6 red ones are left for hist-D:**
  - W3: "a death retaken" and "stands where the fallen fell";
  - Walk100: "overkill blow", "is a NEW seat" and "At zero health";
  - Walk2: "the card stays with the fallen seat".
- `tsc`: clean in this lane's files.

## ⚠ Dungeon Crawler breaks in play until hist-D
The DC cairn write is undated, so it is now refused, and that fails the whole death turn ("generation failed") in real play too.

## Copy for hist-F
- The receipt note and the `write_entry` refusal.
- 🚧 The undated refusal: "‹node›: history needs a date. Give this write a year in its fields, or give the story a dated history entry first."

## Open ★
1. **A fork's pipeline history on or before its fork date is refused.** The parent owns that day, and an amendment has no imprinted path, so a retake couldn't undo it. This is the common case on branch sessions until the story passes the fork day. Recommended: keep the refusal (scenes first; compile already handles the fork day by amendment).
2. **The fallback date is `writeDatingAt`** (the latest history entry the session reads), not the session's story now. The socket's session write uses story now.
3. **The undated-refusal copy is provisional.**

## Noticed, not done
- An append onto a doubled day files onto the lowest id instead of refusing (plan item 8, "refused until fixed", isn't built in either lane).
- An append onto an `isCompleted` day isn't flagged.
- `fieldsFindings` doesn't refuse history fields with no year, and with no calendar, month 40 passes.
