# REPORT m2e-C-w4 (2026-11-04)
Status question: none relayed.

## Edits
NOMENCLATURE.md (§25, edited in place by exact-string replacement; re-read tail first):
- plugins.provided row (~3156): appended the ⚠ 2026-11-04 M2e clause ("the tombstone `dismissed` became the **disabled** mark ...").
- disabled row (~3178): added shownLorebook()/isDisabledProvidedBook() decider, setProvidedBookDisabled writer, turnTombstonesIntoDisabled, clearDisabledOnKeptBooks (★M2e-D-1), providedOwnerPresent(s); ⚠ not plugin enabled switch, not lorebook_entries.enabled, decider not a permission check.
- Disable / Enable row: added `Sockets.Plugins.SetProvidedBookDisabled` and ⚠ PROVIDED_BOOK_DELETE_REFUSAL is not STARTER_KIT_SENTENCES.shippedKeep.
- primer row: added syncProvidedPrimers (src/lib/server/plugins/providedPrimers.ts), owner, idempotence, upgrade diff.
- Advanced fold row: placeholder replaced by `undescribedSettingParts(decl, { reach? })` (SDK sdk/src/settings.ts).
- Appended 4 rows after the declaredFieldRefusal row (M2e (lane D), 2026-11-04): frame-origin cause/frameCause; appletClosedRefusal + USER_ANNEX_CLOSED + USER_STORAGE_CLOSED; sampling-reply/Reply; genre field group strings (with the R1 ⚠ and ★M2e-D-2).

docs/connections.md (Sampling configs section, end of the "Configs are edited in the Sampling view" paragraph): "A fresh install replies with the built-in **Reply** config: thinking off, up to 1024 tokens a reply."

## Skipped
- ★39 sentence: docs/plugins.md never mentions presets (grep -i preset: none), so skipped.
- plugins.md check: no "dismissed" or "stays deleted"; line 52 now says a provided book can't be deleted, disabled via the Enabled switch. Confirmed fixed.
- No §23 entry (retiring `dismissed` is the owner's call; note it).

## docs:build
Exit 0: "157 pages (4.16 MB), 1 assets", playground 5 files; no link errors.

## Noticed, not done
- Reply sampling config also affects other pages? No other page lists shipped sampling configs.
- Foreign hunks: NOMENCLATURE.md diff carries ~27 deletions not mine (other programmes); untouched.
