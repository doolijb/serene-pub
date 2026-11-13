# REPORT — lane `sense-b2` — 2026-11-12 (saved by the lead; condensed from the supervisor's message)

Stage B: Apply in full, for what a session holds today. All seven items built; no stop condition; no migration,
no schema change; SDK docs only. One edit outside the owned files (★b2-1).

## The rule as built

**Automatic Apply** runs when all hold: the session's owner owns the lorebook; the session is not a branch; the
write setting in force for the lorebook is Full (`bookLoreWriteMode === 'full'`); the change is additive or clean.
**When:** a scene closes (a person, `openScene` closing the open scene, or the boundary watcher) → what the session
held up to that scene's end applies; while that scene's summary is `running` or in `review` the changes wait and
apply when it is saved; a dismissed, discarded, cancelled or failed summary releases the wait and they apply then;
Close out (so Archive and next chapter) applies what is left, before its `notRegistered` / `busy` / `nothing`
refusals. Any summary still `running` or in `review` holds back everything from its scene's start, whatever the
trigger. Conflicts stay held with their reason. The off switch is the existing "Writes from sessions to this book"
picker.

**Every Apply** records every item (each moved new entry and each link moving with it files an `origin: 'apply'`
record), drops held changes the lorebook already reads, and settles through the newest applied item's turn, never
past the message before the oldest item still held.

**Take-back:** the lorebook's owner only, all or nothing; entries and links return to their prior book, line,
position and anchors, fields to their before, changes are held again; refuses in a sentence when something stands
on what was applied; a batch holding a place always refuses; never moves the settle line.

## Settle triggers that remain (untouched)

`sources` writes (`host.ts` ~11544, ~11734, ~11878); a scene's summary saved (`sceneUpdateHandler`, and
`settledLineOf` counting `done` scenes); `settleOnWrite`; a person's touch (`sockets/entries.ts` ~941). While they
remain, "never past a held item" holds only for Apply's own settle.

## Provisional copy 🚧

Conflict: `An earlier change from this session to ‹label› is still waiting; apply it first.`
Take-back refusals: `‹Entry› is a place, and a place applied to the lorebook can't be taken back yet.` ·
`Something else in the lorebook now links to ‹Entry›, so this can't be taken back.` · `‹Entry› has a change of its
own in the lorebook now, so this can't be taken back.` · `A history day now names ‹Entry›, so this can't be taken
back.` · `‹Entry› was edited in the lorebook since it was applied, so this can't be taken back.` · `Another
session's story names ‹Entry›, so this can't be taken back.` · `Another session keeps values on ‹Entry›, so this
can't be taken back.` · `An entry in the lorebook is filed under ‹Entry› now, so this can't be taken back.`
Card: heading `Applied to the lorebook` (list aria-label `Applied to the lorebook from this session`); `1 change` /
`‹n› changes`; causes `by ‹name›` · `as a scene closed` · `when a scene's summary was saved` · `at Close out`, then
the time ago; items `‹title› · new entry` (`Untitled entry`), `‹Label›: ‹before› → ‹after›`; button `Take back`
(aria `Take back this change` / `Take back these ‹n› changes`); `Show what was applied` / `Hide what was applied`;
`The lorebook takes this session's changes by itself as each scene closes.`; link `Writes from sessions to this
book`. Docs paragraphs in `docs/lorebooks.md` and the sentence in `docs/sessions.md`.

## Changed files

`lorebooks/ownBook.ts` (`applyOverlayItems` records, done-row drop, settle, `automatic`, returns `dropped` and
`settled`; `takeBackApply(db, { batch, userId, sessionId? })`; `heldChangeVerdict` replaces `heldChangeConflict`;
new `applyHeldAutomatically`, `appliedBatchesOf`, `overlayAccessOf`, `assertTurnStands`; types
`AutomaticApplyCause`, `ApplyOverlayResult`); `sessions/settle.ts` (comment); `sockets/sessions.ts` (overlay
handlers, `sessions:appliedBatches`, `sessions:takeBackApply`, `tellApplyMoved`, `applyHeldAutomaticallyAndTell`);
`scenes/liveScenes.ts` (a call after each close site, `applyAtSceneClose`); `sockets/scenes.ts`
(`sceneUpdateHandler` after-commit call, the release in `setSummaryStatus`, the discard callback);
`sockets/sessionArchive.ts` (`closeOutSession({ io? })`); `shared/sockets/types.ts`, `interest.ts` (SCOPED and
GATED entries); `client/sockets/typedSocket.ts` (★b2-1); `SessionViewPanel.svelte`; docs (`docs/lorebooks.md`,
`docs/sessions.md`, NOMENCLATURE rows and §25, SDK `guides/storage.md`). Not changed: `lorebooks/imprints.ts`,
`client/contexts/sessionOutcomes.svelte.ts`, `SessionsSidebar.svelte`.

New tests: `lorebooks/applyTakeBack.int` (20), `lorebooks/autoApply.int` (16),
`sockets/sessions.applyLists.int` (6), `scenes/liveScenes.autoApply.int` (13),
`sessionForms/sessionViewPanel.applied.dom.test.svelte.ts` (8). Updated: `heldApply.int`,
`branch.heldAmendments.int`, `sessions.closeOut.int` (+3).

## Decisions inside scope

1. "The lists moved" is told by re-sending both lists to every member (each with their own `mayApply`); no new
   event name. 2. A take-back refusal is a success payload `refused: <sentence>`, shown in place. 3. Nothing toasts
   for an Apply or a take-back. 4. Trigger sites with no socket use `globalThis.__SERENE_PUB_SOCKET_STATE__?.io`
   (the `controlRoutes.ts` precedent). 5. A released wait applies then. 6. Automatic Apply offers every in-range
   held change to Apply's in-transaction re-check, so a chain of changes to one field folds in one Apply. 7. The
   waiting-summary gate also applies at Close out; scenes of any channel count. 8. Mark as scene (a scene filed
   already closed) is not a trigger. 9. "Edited since" compares the entry's `updatedAt` to the stamp stored in
   `cause.moved.updatedAt`, so any later write refuses. 10. Every Apply deletes done held rows; a list read writes
   nothing.

## Open ★

- **★b2-1** `client/sockets/typedSocket.ts` edited outside the list (four additive map entries).
- **★b2-2** moving the settle line back on take-back, for the lane that retires the other triggers.
- **★b2-3** (design C2) a graph build or history compile after an automatic Apply makes its take-back refuse;
  neither "take those runs back too" nor "say it cannot be undone" is built.
- **★b2-4** copy and names; "Take back" (undo an Apply) sits beside "taken back with its turn".
- **★b2-5** "Another session keeps values on ‹Entry›" also fires for a book-level row with no source session.
- **★b2-6** the "history day naming it" test includes a title whole-word match in history content (a heuristic).
- Carried: ★B1-1, ★B1-7.

## Tests (lane)

w1 13 files 135; `autoApply` 16/16; w2 13 files 156, scene batches 13 files 106 and 11 files 76; w3 3 files 13.
`tsc` 0 errors; `npm run check` 0 errors.

## Noticed, not done

- The next-chapter Close out passes no `io` (works through the global fallback).
- `foldInParent.ts` ~1186 would re-key an `apply` record whose subject id is in its map.
- Archive runs Close out after archiving, so an Apply can be announced to an archived session.
- Close out can push an Apply before answering `notRegistered` or `busy`.
- The card keeps two copies of the owner flag (`mayApply`, `mayTakeBack`).
- From b1: `recordLoreSources` files a source for a change only held; `entries:setMarks` answers by `lorebookId`;
  the "Share to ‹book›" confirm copy is untrue once a change conflicts.

## Scope review and the lead's follow-up (2026-11-12)

Lead's own run before the review: `tsc` clean; 94 files, 927 tests pass. The review found the lane in scope (no new
setting, column or migration; forbidden files untouched; access rules, transactions and scene-close coverage
sound) and raised five points. Fixed by the lead:

1. **A later held change that only reverts an earlier one was judged "done" and deleted by any Apply**, so the
   lorebook could end on a value the story had left. `heldChangeVerdict`: a key agrees only when no earlier held
   row of the session touches it. Test added.
2. **The Applied list threw on expanding an Apply with two changes to one entry** (duplicate each-key). The card
   keys its items by index.
3. **An automatic Apply silently discarded the Forward stack** (P1). `applyHeldAutomatically` returns nothing while
   the session holds a rewound turn; the next trigger applies. Test added; docs say so.
4. **At Close out, changes reached the lorebook before the summaries Close out starts** (the brief's order
   contradicted the 2026-11-12 ruling "a reviewed summary still gates its scene"; the lead's error). Now: where
   Close out files no scene, everything left applies; where it does, only what came before the closing stretch
   applies (`before`), and the stretch waits for its summaries. Docs updated.
5. The "another session keeps values" refusal can only fire for a place, which is refused earlier: noted with
   ★b2-5, no code change.

Also: the batch toggle's `aria-label` removed (visible text is its name); the refusal sentence is a `role="status"`;
a non-refusal `sessions:takeBackApply:error` frees the Take back buttons.

After the fixes: `tsc` clean; 42 files, 472 tests pass.

Review notes kept: a pressed Apply or Close out on a busy session settles with no busy guard (one test owed for a
regenerate at or below the new line); a released wait is recorded as `scene-close`, so the card says "as a scene
closed"; re-running a `done` summary and cancelling releases nothing; `takeBackApply` calls `ownBookFor` before its
transaction; a summary reset from `running` at boot triggers no Apply (waits for the next trigger).
