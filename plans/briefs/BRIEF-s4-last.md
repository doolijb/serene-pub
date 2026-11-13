# BRIEF — lane `s4-last` (wave 6, last build lane) — branches of merged sessions, card-less seats in branches, the line control

Read `plans/briefs/BRIEF-s4-common.md`, the ruling **★bk-fold-1 (2026-11-08): "a session on its own notes reads them on its own line and moment, like any book"**, and **`plans/REPORT-s4-fold2-2026-11-08.md` in full** (★s4-fold2-1…4) plus `plans/REPORT-s4-fold-2026-11-08.md`.

## Goal, in order

1. **★s4-fold2-3 (S4 regression — lead: fix now):** `sessions/branch.ts` keeps a seat only with `characterId` or `envoySlug`, so a live card-less seat is dropped. Keep any live seat with a `castMemberId` (through `seatCast({ castMemberId, seatedBy })` or the branch's existing seat-copy path — whichever keeps `seated_by_user_id`); "departed" = no card, no envoy, no member. Test: a branch keeps a card-less character seat and a card-less player seat, with their seater.
2. **★s4-fold2-1 (built as recommended, flagged ★):** store each ancestor's line at the fork as an optional `lineId` in its `branch_ancestry` entry (a missing field reads main — today's behaviour; no boot pass); `cast/memberAsRead.ts` `pickVersions` (~548–563) reads each chain book along that line; `state/reading.ts` as needed. Flip the `test.fails` in `foldInParent.int.test.ts`. Test that existing ancestry (no `lineId`) reads exactly as before.
3. **★s4-fold2-2 (built as recommended, flagged ★):** branching a session on its own notes also copies the notes' durable rows (values, configs, sheets) and links on the line's chain into the branch's notes, re-pointing entries via `entryRemap`; members stay as they are (★CV-14). Test: a branch of a merged session keeps its stats and relationships and reads the same as its parent at the fork.
4. **★s4-fold2-4 (built as recommended, flagged ★):** `EditSessionForm.svelte` (~2742) shows `SessionLorebookReading` (Line + Story clock) for the session's own book when the notes have lines, with existing words. DOM test.
5. Small Noticed items from fold2 if they are one-liners in your files: `sockets/state.ts` `storyTimeWords` takes the calendar from `links.calendar` for an own-notes session; check `deleteBranch` moving sessions by `lorebook_id` leaves no own-notes session on a deleted notes line (fix if small, else list).
6. Queue NOMENCLATURE rows (`branch_ancestry` `lineId`; the branch copy rule) — **the lead merges them** (no lane holds the file now; don't edit it).

## Files owned

`src/lib/server/sessions/branch.ts`, `src/lib/server/cast/memberAsRead.ts`, `src/lib/server/state/reading.ts`, `src/lib/server/lorebooks/ownBook.ts` (`copyOwnBookToBranch` and helpers), `src/lib/server/lorebooks/foldInParent.int.test.ts` (flip only), `src/lib/server/sockets/state.ts` (`storyTimeWords` only), the `deleteBranch` site (find it; that function only), `src/lib/client/components/sessionForms/EditSessionForm.svelte` (the reading block only), `docs/sessions.md` (a sentence on branching a merged session, if needed), tests next to all of these.

**Another Claude session (serene-pub-43) owns image generation** — keep clear of `dispatchImage.ts`, `imageGen/**`, `matting.ts`, `KoboldCppManagedAdapter.ts`. No other S4 lane is running.

## Done means

The tests above; `branch.*.int`, `foldInParent.int` (no `test.fails`), `ownNotesLine*.int`, `ownNotesReading.int`, `memberAsRead*`, `seatKeys.*` green; tsc + check no new errors. Report `plans/REPORT-s4-last-2026-11-08.md`.
