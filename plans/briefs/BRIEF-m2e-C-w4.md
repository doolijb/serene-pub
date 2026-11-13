# BRIEF m2e-C-w4 — docs/vocabulary follow-up: lane D's names (M2e)

Worker for lane **m2e-C** of build M2e, Serene Pub (`/home/jody/github/serene-pub`). A follow-up to w3 (`plans/briefs/REPORT-m2e-C-w3.md`,
`plans/briefs/BRIEF-m2e-C-w3.md` — read both; **every rule in w3's brief applies here unchanged**, read its "Rules you carry").

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Lane D has finished: `plans/REPORT-m2e-D-2026-11-04.md` §4 now holds its row texts and §7 what it queued for docs. w3 wrote D's rows from §1 before §4 existed.

## Goal
1. **NOMENCLATURE.md §25** (re-read the table tail with `sed -n` immediately before editing; another programme appends rows there too — never touch theirs):
   - Fill the **Advanced fold** row's "name from lane D's §4, pending" with D's predicate **`undescribedSettingParts(decl, { reach? })`** (SDK `sdk/src/settings.ts`).
   - Reconcile w3's rows (**disabled**, **Disable / Enable**, **primer row**, **`declaredFieldRefusal`**) with D's §4 texts: add D's helper names
     where they belong (`shownLorebook()` / `isDisabledProvidedBook()` the one decider; `setProvidedBookDisabled` the one writer;
     `turnTombstonesIntoDisabled` the boot pass; `clearDisabledOnKeptBooks`; `providedOwnerPresent(s)`; `syncProvidedPrimers`
     in `src/lib/server/plugins/providedPrimers.ts`; `Plugins.SetProvidedBookDisabled`; ⚠ `PROVIDED_BOOK_DELETE_REFUSAL` is not
     `STARTER_KIT_SENTENCES.shippedKeep`). Edit w3's rows in place (they are this lane's, written today); don't duplicate.
   - Append new rows (D's §4 texts, shaped like the table's rows with a **Charter:**, "M2e (lane D), 2026-11-04"): **frame-origin cause** /
     `frameCause` (`src/lib/server/sockets/appletCause.ts`); **`appletClosedRefusal(thing)`** + `USER_ANNEX_CLOSED` + `USER_STORAGE_CLOSED`
     (_"<thing> is only available while the app is open."_); **`sampling-reply` / "Reply"** (the seeded sampling config: immutable, reasoning off,
     1024 response tokens, 8192 context; the Reply loadout's and a fresh install's text→text default; ⚠ not "Default"); **genre field group strings**
     (Turns, Reply, Players, Checks, Tools, Story, Speech, Rules — 🚧, not drawn today; write ⚠ "R1: _Reply_ also names the Reply loadout and the
     Reply sampling config; _Story_ overlaps the Story genre; open as ★M2e-D-2 (owner)"). Copy D's §4 wording; trim, don't invent.
   - The **plugins.provided** row (~line 3156, `grep -n "dismissed" NOMENCLATURE.md`) still describes the tombstone: add one ⚠ clause at its end —
     "⚠ 2026-11-04 M2e: the tombstone `dismissed` became the **disabled** mark (row below); a boot pass turns each into it." Smallest edit.
2. **docs/** (re-read each file right before editing; additive, small hunks; never reformat; `docs/sessions.md` is shared with another programme):
   - The new Reply sampling default: find where docs describe sampling configs / the Reply default (`grep -n -i "sampling" docs/*.md`); if a page
     lists the shipped sampling configs or what a fresh install uses for replies, add one sentence: a fresh install replies with the **Reply**
     sampling config (thinking off, up to 1024 tokens a reply). If no page lists them, skip and say so.
   - ★39 (ruled 2026-11-04 "presets available on enable"): in `docs/plugins.md`, where enabling a plugin or its session presets is described
     (`grep -n -i "preset" docs/plugins.md`), one sentence: a plugin's session presets are available as soon as you switch the plugin on; an
     administrator can hide one afterwards. Skip if presets aren't mentioned, and say so.
   - Check `docs/plugins.md` no longer says a deleted provided book stays deleted / is "dismissed" (D §7 says it did; w3 says it fixed it) — confirm.
3. Run `npm run docs:build` at the end; report its result.

## Files owned
`NOMENCLATURE.md`, `docs/**`. (STYLE-GUIDE needs nothing more.)
## Out of scope
No new rows beyond those listed; no edits to other programmes' rows; no §23 entry (a retirement is the owner's call — note it).
## Done means
The edits landed; `npm run docs:build` exits 0.
## Report
`plans/briefs/REPORT-m2e-C-w4.md`: each edit (file:line, first words), docs:build tail, anything skipped and why, **Noticed, not done**, any foreign hunk seen.
