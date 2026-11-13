# REPORT m2e-C-w3 (2026-11-04)
Status question: none relayed.

## Edits
- NOMENCLATURE.md §25: edited the **applet** row (Leave words -> origin rule; ⚠ note; appended the cause rule to its Charter). Appended 7 rows at the table tail (after the `W_SETTING_UNDESCRIBED` row, before the "What the layering build left" paragraph), all 🚧, 2026-11-04: **disabled** ("a provided book an administrator deleted (the tombstone dismissed)"), **Disable / Enable** events + sentences + client helpers, **primer row**, **otherRules** family, **Leave's origin rule**, **Advanced fold**, **declaredFieldRefusal**.
- STYLE-GUIDE.md: §6.4 (after the borders paragraph, ~line 1137: provided book no Delete), §6.11 (after "Status is a dot plus words", provided-book switch), §6.17 (bullet "The session's derived settings": Advanced fold trigger sentence).
- docs/getting-around.md (Leave, two places), docs/plugins.md (C5 sentence under What a plugin can't do; provided-book paragraph: removed "a book you deleted by hand comes back", added disable/Enable + uninstall keep/delete), docs/lorebooks.md (starter lorebooks: no Delete, Enabled switch, plugin books, clone deletable; ★50 sentence in "Lists from your rules"), docs/sessions.md line ~389 (Advanced fold, one clause).
- CHANGELOG.md does not exist; none added.

## D names still pending (lane D report §4 was "pending" when read and re-read; rows written from §1)
- the Advanced fold's SDK predicate name (row says "name from lane D's §4, pending");
- the seeded Reply sampling config (★47): NO row written, no docs sentence (skipped docs/connections.md);
- the frame-origin cause names and the grant refusal constant: no row;
- ★50 prose in docs/lorebooks.md depends on lane D sending `otherRules`; until then nothing draws.

## docs:build
Exit 0: "157 pages (4.15 MB), 1 assets", playground 5 files. No link errors.

## Collision check
`disabled` is generic; grep of NOMENCLATURE found no prior canon term (only `disabled_swaps`, noted as not). Retires `dismissed` (the tombstone) in the row; I did not add a §23 entry (owner/lane D to decide).

## Noticed, not done
- NOMENCLATURE.md, STYLE-GUIDE.md and several docs already carried uncommitted hunks from other programmes (git diff showed 27 deletions in NOMENCLATURE not mine); I did not touch them.
- NOMENCLATURE row at ~3156 (`plugins.provided` ... `dismissed`) still describes the tombstone; not rewritten (the new disabled row supersedes it).
- w2 asks for `appletFrom` in `src/app.d.ts` (outside my files).
- STYLE-GUIDE §6.17 says "Advanced · N settings · M changed" but SessionSettingsForm says "Advanced · N settings".
