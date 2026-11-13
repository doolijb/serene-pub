# REPORT pl3-w2 — the notes' book-layer rows tied to the turn (★pl2-2, 2026-11-05)

Status question: none relayed.

## Changed files
- `src/lib/server/state/write.ts`
  - ~60-63: file-header paragraph, one dated sentence (notes exception, real books never anchored).
  - ~494-500: `notBehindOwnRows` filters by `session_id` only when `isSessionScoped(owner.kind)` (comment added).
  - ~524-562: new private `notesTurnOwnerOf(db, sessionId, owner)`, 🚧 doc comment. `lorebook` == own book -> `{session, sessionId}`; `cast_member` whose binding is in the own book -> `{session_cast, characterId}` (no characterId -> the world's turn); everything else, including an own-book `location`, -> null.
  - ~565-612: `anchorFor` doc comment (one dated sentence) and body: the turn owner is computed (session-scoped -> `turnOwnerOf`; else not book layer / `messageId === null` / no notes turn owner -> null), then the existing tail is shared unchanged.
- `src/lib/server/state/worldScope.int.test.ts` — appended a `describe` (~874-end) with 4 tests, plus private helpers `postMessageBy` and `backOf`.

No other file touched. No new export, no migration, no schema/SDK edit.

## Tests
- `worldScope.int.test.ts`: 35 passed (31 existing + 4 new).
- Full listed set (worldScope, write, handEdits, imprints, rewind int tests): 5 files, 130 tests passed. No old test asserted "own-book rows never anchored", so no expectation changed.
- `npx tsc --noEmit -p . | grep -E "state/write|worldScope"`: prints nothing.
- `npx prettier --check` warns on both files; they were already off-format (dirty at HEAD from other lanes). I did not reformat.
- Each test deletes its own `serene-pub-vitest-world-scope-*` dir in `afterAll`; none left.

New tests (pattern: the existing `retractStateAnchoredTo` / `restoreRetractedState` pair, not `rewindTurn`/`forwardTurn`, as the existing place test does; the fixtures post bare messages with no session/seat/door setup that `rewindTurn` needs):
1. Member's session, world value in the notes: A written with no message, message added, B written -> own-book `lorebook` row has `valid_from_message_id` = that message and `session_id` NULL; Back reads A; Forward reads B.
2. A person's value in the notes (seated character, own-book member): A before they speak (anchor null); then hero's reply, then a LATER message with no speaker; B anchors to the hero's reply (not the newest), `session_id` NULL; Back -> A, Forward -> B.
3. Owner's own (real) book: world value lands on the attached book's `lorebook` row with NULL anchor; Back leaves it.
4. Own-book `location` entry (cheap, so done): value row has NULL anchor.

## Decisions
- `notesTurnOwnerOf` is private; `anchorFor` computes the turn owner then shares the one tail (no duplication).
- Tests use the retract/restore pair for Back/Forward (see above).
- For test 2 I anchored via a real message with `characterId` (the default open-anchor path), not `ownAnchor`/`messageId`.

## Item 4 — what I found
`retractStateAnchoredTo` deletes `attribute_values` and `attribute_configs` with `where valid_from_message_id = messageId` only (no `session_id`/owner filter); `restoreRetractedState` re-inserts the returned rows whole (ids and all, `session_id` NULL included). So own-book rows take and restore with no change; the new tests prove it. `keepLaterState` in `sessions/rewind.ts` I did not read or run beyond `rewind.int.test.ts` passing; it is not touched.

## Item 5
`configure` calls `anchorFor` too, so an own-book config is now anchored like a session config (kept, as briefed). No test of my own covers it.

## Behaviour to know
- `decideProposal` (~2364) still passes a `{session}` owner for every book-layer change and keeps `messageId === null -> null`, so accepted proposals are unchanged.
- A sealed notes row now throws the same `StateRefusal` as a session value when a caller names a sealed message (`ctx.messageId` set, not own-anchored). Existing tests still pass.

## Noticed, not done
- `notBehindOwnRows` selects `attribute_values` only (not configs) for "held" anchors; unchanged.
- Prettier check fails on both files at HEAD (not mine).
