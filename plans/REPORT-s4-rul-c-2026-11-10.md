# REPORT — lane s4-rul-c (2026-11-10): seats of a deleted card, and start-form books grouped by source

Saved by the lead from the supervisor's final message.

**Status:** all three goals built. Targeted tests: 14 files, 241 passed. tsc 3 → 3; `npm run check` 3 errors / 8 warnings → the same (the 3 SDK-build errors, now `show-hidden-stats` in `requests/index.ts:627` ×2 and `requests/showHiddenStats.ts:11`, not this lane's). No migration, schema change, new socket field or SDK change. No `sdk:build`, commit or stash. No `/tmp/serene-pub-vitest-*` dirs left (compared before/after).

Worker briefs: `plans/briefs/BRIEF-s4-rul-c-w1.md` (server, goals 1–2), `-w2.md` (client, goal 3). Logs in the session scratchpad, `s4-rul-c-*` (`tests3.log`, `tsc-before`, `tsc-after2`, `check-before`, `check-after2`, `w1-tests`, `w2-tests`).

## Goal 1: one seat-filling step at card delete (★RF-1, both halves)
- New 🚧 `fillSeatsBeforeCardDelete(tx, cardId)` in `sessions/seats.ts` (~1414–1480):
  1. takes the card's sync lock `hashtext('charBindingSync:character')` before any lorebook lock;
  2. finds every session with a **live** seat holding the card and no member (character seats `session_characters.character_id`, player seats `session_personas.persona_id`);
  3. per session reads books with `seatBookOf`, **finds before it mints**: `findSeatMembers` (attached, own, ancestor — the RF-1 fallback); only if none, `resolveSeatMember(..., { mint: true })` (attached if mintable, else own);
  4. names a new member **inside the transaction** with `syncLorebookBindingsForCharacter(cardId, tx, { lorebookId })` (savepoint on `tx`, re-entrant lock);
  5. writes the member onto the live seats. A fill reports no `SeatChange` and no event. Only `tx`.
- Both delete paths call it: `sockets/characters.ts` `charactersDelete` (~1185–1235) — select the ids, fill, then `isDeleted`; the `resolveFollows` / `makeMemberCardless` loop is unchanged, so new members also become card-less with the card's words. `plugins/providedBooks.ts` `deleteProvidedBooks` card block (~1541–1565) — fill before `resolveFollows`.
- Departed seats: nothing done, nothing possible — `session_characters_pk` / `session_personas_pk` are unique on (session, card), so a session with a live seat of the card can't also have a departed one. A departed-seat pass was removed as dead code. A session with only a departed seat is not visited.

## Goal 2: `resolveSeatMember` and the boot pass, together
- `resolveSeatMember` (`seats.ts` ~357–410): when the attached book is mintable but `findOrInsertBinding` returns null (deleted card), falls through to the member found in the own book or an ancestor's. Live cards unchanged. JSDoc and module header updated.
- `sessions/seatMembers.ts` `resolvable` (~58–110): `found(attached) OR found(own) OR ((mintable OR own exists) AND live)`, the formula from `REPORT-s4-review-fix:14`. Ancestors still not looked in (can only miss, never re-select). Scope reviewer found no drift.

## Goal 3: start-form books grouped by source (c-3)
- `StartSessionForm.svelte`: 🚧 derived `ownBookOptions`, `pluginBookGroups` (by `providedRowLine` heading), `sharedBookGroups` (by `ownerName`); row markup moved into snippets `bookPickRow` and `plainBookRow`; `surfacedBooksGroup(prefix)` draws one group per person.
- Order, both layouts: 1. Your lorebooks (with **How it starts** under own surfaced books; in the plain card, with **None**) · 2. one group per plugin, by name · 3. one group per person, by name · 4. **Start blank** (book pick only) · 5. **Start from a starter lorebook**.
- What a row does is unchanged: plugin rows `chooseLorebook` (direct), shared rows `chooseSurfacedBook` (copy, `new-world`), starters via `StarterKitPicker` (untouched).
- `lorebooks:list` needed no new field (`provided.pluginName`, `ownerName` exist); `types.ts` and `sockets/lorebooks.ts` untouched.
- Post-review fixes: plugin headings from canon `providedRowLine`; groups keyed by heading (a person named "Shared with you" no longer collides); worker ids removed from comments; test fixes; a tsc error in the new test fixed.

## Changed files
- `src/lib/server/sessions/seats.ts`, `src/lib/server/sessions/seatMembers.ts`, `src/lib/server/sockets/characters.ts` (import + `charactersDelete`), `src/lib/server/plugins/providedBooks.ts` (import + card block), `src/lib/client/components/sessionForms/StartSessionForm.svelte` (lorebook groups).
- Tests: new `sessions/seats.cardDelete.int.test.ts`, new `sessionForms/startSessionBookSources.dom.test.svelte.ts`; `seatMembers.int.test.ts` (~577 inverted: candidate once, filled from the own book, **second boot changes nothing**); `seats.int.test.ts` (~403 fall-through); `startSessionModes.dom.test.svelte.ts` (~288).
- Docs: `docs/lorebook-cast.md:177`, `docs/characters.md` §Delete a character, `docs/sessions.md` (step 6 bullets **Comes with ‹plugin›** / **Shared by ‹name›**; ~483).

## Tests
- Final: 14 files, 241 passed — `seats.cardDelete`, `seatMembers`, `seats`, `seats.cardless`, `characters.softDelete`, `providedBooks`, `cast/cardless`, `sessions.seatEvents`, six `startSession*.dom` files.
- `seats.cardDelete` runs both delete paths (`describe.each`): (a) member in the attached book; (b) member only in the notes, mintable attached book (nothing minted there); (c) no member anywhere, mintable attached and own-book-only. Each filled seat has a member named as the card, holding its description, card-less, nothing following the card. Card-less seat and another session's other card unchanged.
- `startSessionBookSources`: both layouts — labels, headings, order, rows in their groups, unique ids, plugin row creates in `new`, shared row in `new-world`.

## Open ★ (built as recommended)
- **★rul-c-1** plugin heading **Comes with ‹plugin›** (core: **Comes with Serene Pub**) — canon `providedRowLine`; *From ‹owner›* already means a person on the Characters view (R1). Recommend keep.
- **★rul-c-2** one group per person: **Shared by ‹name›** / **Shared with you**, note *Their session's lorebook. The new session starts on a copy; theirs stays as it is.*; per-row *Shared by* line dropped. Replaces c-2's heading **Start from a shared session's lorebook** and its note (c-3 asked for categories). Recommend keep.
- **★rul-c-3** starter group stays **Start from a starter lorebook** (canon in three rows). Recommend keep.
- **★rul-c-4 (info)** a member minted at card delete goes through `makeMemberCardless`, so its sessions get `tellMemberSessions` (`pushSessionToParticipants`) after commit — a session refresh, not a member event or `SeatChange`. Recommend keep.
- Still open, not this lane: minting at boot for seats of cards already deleted with no member anywhere.

## Queued for the lead
- NOMENCLATURE §24 surfaced book row (~1740): shared group → **Shared by ‹name›** / **Shared with you** (one per person, `data-surfaced-books`). Book pick rows (~3270, ~3616): Your lorebooks · **Comes with ‹plugin›** · **Shared by ‹name›** · Start blank · Start from a starter lorebook. §25 2026-11-10 (lane s4-rul-c): 🚧 `fillSeatsBeforeCardDelete`; the RF-1 fall-through in `resolveSeatMember` and `resolvable`; client 🚧 `ownBookOptions`, `pluginBookGroups`, `sharedBookGroups`, `bookPickRow`, `plainBookRow`, `data-book-group` / `data-book-group-label`.
- STYLE-GUIDE.md ~1056: the same group list.
- docs/lorebooks.md:174: *Start from a shared session's lorebook* → *Shared by* their name.

## Scope review (answered once each)
1. Medium — stale canon / missing §25 rows: queued.
2. Low — plugin heading rebuilt by hand: fixed (`providedRowLine`).
3. Low — departed-seat pass untested: removed (dead code).
4. Info — extra session refresh: ★rul-c-4.
No files outside the owned set, no predicate drift, no outer `db` in a transaction, rows keep what they do.

## Noticed, not done
- w2 ran `prettier --write` on the **whole** `StartSessionForm.svelte` against its brief; says only its regions changed; `--check` passes; not independently confirmed.
- Pre-existing prettier failures on unwritten lines: `seats.ts:347`, `characters.ts`, `providedBooks.ts`, `seats.int.test.ts` (~560, ~1182).
- Pre-existing: shared-book groups render only inside `lorebookOptions.length > 0`, so someone with no own and no provided books never sees a book shared with them.
- Pre-existing copy *You have no lorebooks yet. This genre can start without one.* sits badly with "there is always a lorebook".
- A fill can leave two live seats on one member (as `settleSeats` fill-only does); the boot pass merges such pairs.
- `deleteProvidedBooks` purges the plugin's books before the card block, so a seat in a session reading that book falls to the own book; correct, but only case (c) covers it.
- `docs/sessions.md` ~483 still says another session "starts from a copy" of a surfaced book — no longer true for its owner.
