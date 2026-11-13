# REPORT m2e-F-C-w3

Status question: none relayed.

## Changed files
- NOMENCLATURE.md: §23 row at line 1581 (`dismissed`, after the last §23 row); four §25 rows appended at the then-tail (just before `## 26. Shell`): forgetOtherRules/per-book keying, read-only mark `readOnly?: true`, `primerRowEditRefusal`/`primerRowEditProblem`, genre groups Writing/Lair; one in-place amendment of the "genre field group strings" row (line ~3189): list now `Turns, Writing, Players, Checks, Tools, Lair, Speech`, "open as ★M2e-D-2 (owner)" -> "ruled 2026-11-04: **Writing**, **Lair** (row d)". Full text is as the brief quoted, expanded with the names verified by grep.
- STYLE-GUIDE.md line 1142: **A primer row** paragraph, right after the "no Delete" paragraph.
- docs/lorebooks.md line 260: new bullet after **Your starter lorebooks**; line 277: "(a starter lorebook that comes with the pub has **Clone** instead)" after "Book settings and Duplicate as well". I left out "which admin holds them" beyond "the administrator who holds them" (lane D detail not verified in docs).
- docs/plugins.md: unchanged. Its paragraph (~52) describes provided books generally (they stay editable, updates reach them), not a starter lorebook being editable; no contradiction.

## Greps
- Exist: `turnTombstonesIntoDisabled` (providedBooks.ts:808), `primerRowEditRefusal` (providedMarks.ts:98), `primerRowEditProblem` (:108), `forgetOtherRules` (derivedPiece.ts:271), `isReadOnlyBook`, `primerRowLine` (starterKitCards.ts).
- Gone (no match in `src/` or `../serene-pub-sdk/*/src`): `ProvidedBookDismissal`, `dismissedProvidedBooks`, `recordDismissedProvidedBook`, `ProvidedSyncReport.dismissed`, `plugins.provided.dismissed`. (`ProvidedSyncReport` itself has no match either.)
- Genre `group:` strings in core-catalog: Turns, Writing, Players, Checks, Tools, Lair, Speech (+ Advanced fold). **"Rules" is no longer a genre group string** (only a preset label), so I dropped it from the amended list; check this is intended.

## docs:build
`npm run docs:build` exit 0 (157 pages, no link errors).

## Noticed, not done
- Did not independently verify in the `.svelte` files the exact copy/title strings; I used the brief's text.
- `ProvidedSyncReport` not found by name; the brief's mention of it may be stale.
