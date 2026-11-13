# REPORT — lane s4-rul-f (2026-11-10): boot pass that makes members of old deleted cards card-less

Saved by the lead from the supervisor's final message. Supervisor worked alone (no workers). No relayed status question.

**Status:** built, tests pass. Cast members still linked to a soft-deleted card become card-less at boot and keep the card's content, by the same steps a card delete runs (no second converter). A second boot selects nothing and writes nothing. No migration, event, `SeatChange`, SDK change, `sdk:build`, commit or stash; no dev server started; no `/tmp/serene-pub-vitest-*` dirs left.

## What was built
- New `src/lib/server/cast/deletedCardMembers.ts`: 🚧 `deletedCardMembers(db)`, 🚧 `DeletedCardMembersReport { cards, members, failed }`; ⏳ "delete at the RC1 squash, with the attic" (serves deletes before ★3 and attic ETL rows, `attic/etl/lore.ts` ~80–81).
  - Candidate query: `lorebook_bindings` joined to `characters` where `is_deleted`, grouped by card; every selected row gets `character_id` cleared, so a second boot selects nothing.
  - Per card, one transaction, as `charactersDelete` (`sockets/characters.ts` ~1216–1232): `resolveFollows(t, { cardId })`; re-select the card's linked members inside the transaction; `makeMemberCardless(t, id, { cause: "card-delete" })` each. Only `tx`.
  - A throwing card rolls back alone, is logged `[deleted-card-members] deleted card N and its cast member(s) … were left as they were`, counts in `failed`; a non-zero `failed` throws one error after the loop (as `seatMembers`).
- `src/lib/server/startup/index.ts`: one entry `deleted-card-members`, `failsHealth: true`, after `character-versions` and before `seat-keys`, ⏳ JSDoc saying why; logs only when it converted something.
- `cast/cardless.ts`: read only, unchanged (already reads a soft-deleted card).
- `docs/lorebook-cast.md:177`: *", and a member still linked to such a card becomes card-less the same way, keeping what it read from the card."*

## Changed files
`src/lib/server/cast/deletedCardMembers.ts` (new), `src/lib/server/cast/deletedCardMembers.int.test.ts` (new, 3 tests), `src/lib/server/startup/index.ts` (one entry), `docs/lorebook-cast.md` (one clause).

## Tests
`boot()` runs the passes in `startupTasks` order (`ensureOwnBooks`, `purgeKeptOwnBooks`, `seatMembers`, `liftCharacterVersions`, `deletedCardMembers`, `seatKeys`); doesn't import `startup` (it starts `appReady`).
1. Attic-shaped: soft-deleted card with no version, member linked with no versions, a seat with no member → one boot: exactly one member across attached and own book, card-less, `membersAsRead` gives the card's description, every version `follows []` / `parentVersionId null`, seated. Second boot zeros, every table unchanged.
2. A seated member of a deleted card (`insertCastMember`, follows the card) plus a second member in another user's book → `cards: 1, members: 2`; seat keeps its member and reads the card's words; second boot unchanged; `deletedCardMembers` alone zeros.
3. Untouched: a live card's member, a card-less member, a member already converted by lanes c/d — bindings and versions byte-equal.
Runs (6G cap): new file 3/3; with neighbours 8 files, 104 passed (`deletedCardMembers`, `cast/cardless`, `seatMembers`, `seatMembers.deletedCards`, `seats`, `seats.cardDelete`, `seats.cardless`, `characters.softDelete`).

## tsc / check
tsc 0 → 0. check 0 errors / 8 warnings → 1 error / 8 warnings — the error is lane s4-rul-e's new `src/lib/client/lorebooks/cast/cardlessWords.dom.test.ts:30` (a `CastRow` cast; `exampleDialogues` `string[]` vs `string`), written mid-run. Prettier clean on new files; `startup/index.ts` fails only on untouched lines.

## Members swapped onto another card
Partly covered: `resolveFollows({ cardId })` runs only for a deleted card that still has a linked member, so a swapped member's versions are resolved only when it shares such a card. A deleted card with no linked member left is never selected. Scope not widened.

## Open ★
- **★rul-f-1 — cards hidden by session Back.** `undoLibraryChange` "create-character" soft-deletes a card (`library/writes.ts:484`; Forward sets `isDeleted: false`, :527). If such a card has a cast member, the boot pass makes it card-less, and a later Forward shows the card again with its member no longer linked (the member still plays with the card's words). Built as briefed. **Recommend:** leave it (needs an assistant-made card added to a book, then taken back by Back). Trade-off: excluding these would mean reading `state_proposals`, which the state module owns (P2) — needs a library contract helper. The live path already leaves members linked to a hidden card until the next boot.

## Queued for the lead: NOMENCLATURE §25
- ⏳🚧 boot task `deleted-card-members` (between `character-versions` and `seat-keys`, `failsHealth`): members still linked to a soft-deleted card made card-less by the delete steps (`resolveFollows({ cardId })`, `makeMemberCardless`, cause `card-delete`); delete at the RC1 squash with the attic.
- ⏳🚧 `deletedCardMembers(db)`, `DeletedCardMembersReport { cards, members, failed }` (`cast/deletedCardMembers.ts`); not `seatMembers`' deleted-card step (that mints for empty seats; this converts linked members).
- §9 **card-less** row (~352): add "and, at boot, members left linked to a card deleted earlier (`deleted-card-members`)".

## Scope review
No objection; two notes: (1) the test's `boot()` copies the startup order by hand — accepted (importing `startup` starts `appReady`; `seatKeys.attic.int.test.ts` does the same); (2) swapped members — see above.

## Noticed, not done
- Library Back soft-deletes cards without the delete steps (★rul-f-1).
- The check error in lane s4-rul-e's `cardlessWords.dom.test.ts:30`.
- Prettier failures on untouched `startup/index.ts` lines.
- `seatKeys(db)` runs in this test's `boot()` with nothing to do; not a new pin on `seat-keys`.
