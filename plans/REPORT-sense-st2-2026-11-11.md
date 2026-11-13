# REPORT — lane `sense-st2` — one undo rule (2026-11-11; saved by the lead, condensed from the supervisor's message)

Built: two cases, **replaced** (swipe, regenerate, a failed run) and **leaves** (Back, delete); `keepOnRetell` in the
SDK, declared by the Dungeon Crawler on its plan fields; press-started annex writes anchor to the newest message.
`tsc` clean; 33 app test files, 386 tests; 48 SDK tests; no pin moved; no migration.

## Inventory (before)

| Caller | Verb | Ticks | Scene boundaries | Annex deltas |
|---|---|---|---|---|
| `sockets/sessions.ts:9326` | row regenerate | kept | kept | taken |
| `sockets/sessions.ts:9962` | swipe (`annex: "keep"`) | kept | kept | **kept** |
| `sessions/rewind.ts:646` | Back, and Regenerate the last turn via `retakeTurn` | taken | taken | taken |
| `runtime/host.ts:9842` | delete | taken | **kept** (`opened_at` left pointing at a deleted id) | taken |
| `utils/generationStatus.ts:243` | a failed reply's cleanup | kept | kept | taken |
| `write.ts` `restoreRetractedState` inner call | failed swipe, Forward | kept | kept | taken |

A2: on a swipe the seat-bench retraction was not gated by the annex flag. `sessions/retakeTurn.ts`
`deleteTurnYield` (Honour-mode turn delete) does not call the function and does not take scene boundaries.

## Now

`retractStateAnchoredTo(db, messageId, turnCase: "replaced" | "leaves")`, case required. Both take values,
configurations, proposals, clock moves, **scene boundaries**, scene notes, zone snapshots, lore, cast versions,
library changes, conversions, seat benches, annex deltas. Forward restores what Back took; a failed swipe restores
what the swipe took. The settle line is untouched. Two differences, both on **replaced**:

1. **The round's tick (`cause: 'tick'`) stays (interim, ★ST2-1).** It is anchored to the message that closed the
   round (the newest when the run executes). A swipe keeps the message id and `tallyTurn` never counts an id twice,
   so `round-ended` does not fire again; taking the tick would lose 5 minutes on every swipe of a round-closing
   reply. Back takes it and the next closing line ticks once (proven with real Story turns).
2. **`keepOnRetell` fields keep their value** on a replacement; they go when the turn leaves. Deltas stay
   whole-document: a row that changed only kept keys stays; a mixed row is narrowed in place. No schema change.

**A2 choice:** seats always go with their turn, in both cases; the Dungeon Crawler re-files them on the re-tell.
**Press anchor:** `host.ts` `writeAnnexDocument` anchors an `action`-family run that opened no row to the newest
message (`imprintAnchorFor`); a person's own value through `core:spec/set-annex-field` stands. Press lore imprints
and the lorebook annex write are unchanged.

## The name

`keepOnRetell?: true` on `AnnexFieldDecl` / `AnnexFieldInput`. Findings: any value but `true`; on a `user`-scope
field; on a `lorebook`-scope field. The Dungeon Crawler declares it on `dungeon-crawler-progress`,
`-planning-notes`, `-planning-notes-revealed`, `-journal`. Near-neighbour: the cast *retold* field (§8); every place
says "not a cast member's *retold* field".

## Changed files

App: `state/write.ts`, `state/clockMoves.ts` (comments), `sessions/annexChanges.ts`, `sessions/rewind.ts`,
`sockets/sessions.ts` (two call lines), `runtime/host.ts` (delete call, the annex anchor), `utils/generationStatus.ts`.
New tests: `sessions/annexChanges.keepOnRetell.int.test.ts` (6), `sessions/oneUndoRule.int.test.ts` (18),
`pipelines/routines/roundTick.undo.int.test.ts` (2). Call arguments updated in four owned test files and, **outside
the owned list**, in 14 more (`"replaced"` appended to no-argument calls only): `lorebooks/annex`,
`lorebooks/imprints`, `runtime/host.historyWrites`, `setSeatBench.announce`, `setSeatBench`, `stateNodes`,
`rulesets/ties`, `sessions/convertRuleset`, `sessions/settle`, `state/clockMoves`, `state/clockProposal`,
`state/lorebookStats`, `state/valueStamp`, `state/write`. Docs: `docs/sessions.md`, `docs/genre-dungeon-crawler.md`,
NOMENCLATURE §9 and §25.
SDK: `sdk/src/annexFields.ts`, `core-catalog/src/shared/annexField.ts`, `sdk-tests/keepOnRetell.test.ts` (6),
`guides/storage.md` (the verbs table is two rows; exceptions rewritten).

## Tests

Batch 1: 22 files, 310/310. Batch 2: 11 files, 76/76 (Dungeon Crawler, retraction, swipe restore, rewind, annex
changes, generation guard). SDK 48/48; `coreCatalog` 5/5, digest unchanged. `sdk:build` once.

## Open ★

- **★ST2-1** The round's tick on a replaced turn. Recommended: a re-told line ends its turn and round again
  (`retallyStoryLane` replays the lane without the replaced message), so the replaced case takes the tick like every
  other move; this also re-runs `round-ended` routines whose writes a regenerate already takes and never re-runs
  (the Lair keeper's values). Trade-off: every `round-ended` pipeline, model calls included, runs again on such a
  swipe. Needs an exclusion parameter on `replayStoryLane` (`pipelines/routines/moments.ts`).
- **★ST2-2** Draws (`core.rulesetDecks`) are anchored to no turn, so neither case takes them. Recommended: fold
  into ST3. **Lead: yes, ST3.**
- **★ST2-3** The Dungeon Crawler's *Reveal the planning notes* now anchors to the newest message, so Back past it
  un-reveals; its copy says "It cannot be taken back." (`reveal.ts:111,117`; `docs/genre-dungeon-crawler.md:272`).
- **★ST2-4** A failed fresh Dungeon Crawler turn keeps its plan while clock, sheet and seats go; the next Retry or
  swipe heals it. Recommended: leave. **Lead: leave.**
- **★ST2-5** Keep `keepOnRetell`, or rename `keepWhenReplaced`. **Lead: keep.**

## Queued for other owners

`moments.ts` `replayStoryLane` exclusion (★ST2-1); `retakeTurn.ts` `deleteTurnYield` to take scene boundaries;
`docs/stats-and-states.md:90` ("a reply's fixed tick" → "a round's move"); `reveal.ts` copy (★ST2-3).

## Noticed, not done

- `publishedValues.ts` ~280 `sessionGenerating` counts a background `story-turn-order` run as generating, so a swipe
  pressed right after a write is refused with "wait for the reply to finish".
- The round tick anchors to the newest message when the `round-ended` run executes, not to the event's `messageId`;
  a person's line landing first would get the tick.
- A Dungeon Crawler swipe also takes the swiped turn's lore writes, and the re-telling files `places: null`
  (existing behaviour).
- A plugin genre whose failed re-tell itself writes `keepOnRetell` fields can misplace a kept field on restore.
