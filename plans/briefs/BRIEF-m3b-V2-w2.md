# BRIEF m3b-V2-w2 — int tests + docs: world-scope values in the session's own notes when the session can't write its book

You are a `lane-worker` (Sonnet) for lane **m3b-V2**. Work from `/home/jody/github/serene-pub`. Write your report to `plans/briefs/REPORT-m3b-V2-w2.md`. Worker **w1** builds the server code at the same time (brief `plans/briefs/BRIEF-m3b-V2-w1.md` — read its "The build" section: it is the behaviour your tests pin).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal — the owner's rulings (2026-11-05), quoted
- **★M3b-W-1 → yes, with the landing condition:** attribute values land in the session's own notes **only when the session can't write its book** — the attached book is not the session owner's (a member's session on a pub-wide/provided or shared book), or there is no attached book. On the owner's own book, values land on the book as today, under its Full/Review/Off mode, and world-scope values keep being shared between the owner's sessions. Reads: where the notes hold a value for that owner/slot it wins; else the book's.
- **★M3b-W-2 → check the writer first, then create** the own-book row (no empty cast rows from refused writes).
- **★M3b-W-3 → the session's own notes are exempt from the write mode** (as lore writes already are via `loreWriteRoute`).
- The provided book still gains **no** binding or value row for anyone (§23).

The code (w1): `worldOwnerOf(db, sessionId, owner, userId: number | null)` — **a new required 4th argument** (the person writing; `null` for a run). In a session that can't write its book: `session` → `{ kind: "lorebook", id: <own book id> }`; `session_cast` (seated; a `player_seat` with a persona becomes its persona) → that character's member row in the own book (found or created), after checking the writer may write the own book (a guest is refused with the `assertBookWriter` sentence starting _that is not your lorebook_, and nothing is created). On the owner's own book: unchanged. Writes to own-book rows apply under Review and Off without a proposal (`applyAutomatic`, `assertBookWritesOn`). Reads: own book's member / own book's `lorebook` row first, then the attached book's, only in a session that can't write its book.

## Files owned (edit ONLY these)
1. `src/lib/server/state/worldScope.int.test.ts` — extend (this lane's file; uncommitted from last night — re-read before each edit, additive, never reformat).
2. `docs/lorebooks.md` — the **Your session's own notes** section only (~220–228).
3. `docs/stats-and-states.md` — the **Kept** bullet only (~109).

## Files readable
Anything. `src/lib/server/state/worldScope.ts`, `state/write.ts`, `state/resolve.ts`, `lorebooks/ownBook.ts`, `sockets/state.ts` (`stateSet`, ~1380–1440), `pipelines/runtime/bindings.state.ts` (set-state's output: `ok({ main, applied, proposed, refused })` ~1040), the schema (`schema.stateProposals`, `schema.sessionGuests` ~3862, `schema.userSettings.loreWriteMode`, `schema.lorebooks.loreWriteMode`, `schema.lorebookBindings`, `schema.attributeValues`). `plans/REPORT-m3b-W-2026-11-05.md`.

## Tests to write (in `worldScope.int.test.ts`, reusing its helpers `world`, `memberOnProvidedBook`, `seatPersona`, `seatCharacter`, `writeAge`, `readAge`, `bindingsOf`, `ownBookIdOf`, `castValuesOf`, `allValuesOnBook`, `valuesOf`, `socketOf`)
First: update every existing `worldOwnerOf(...)` call to pass the 4th argument (`w.user.id` where a person writes, `null` in `writeAge`, which models a run). Existing expectations must stay as they are, except where the new rule changes them — say which in the report (expected: none; the member-on-provided-book tests already expect the own book).

New `describe("a session that can't write its book keeps world values in its own notes", …)`:
1. **One of the provided book's own people** (a card owned by the admin, bound to the provided book by a `lorebook_bindings` row you insert, seated in the member's session): the provided book's member already holds age 40 (an `attribute_values` row, `session_id` null, owner `cast_member` = that binding) → `readAge` reads 40 before any write; a run write (`writeAge`, 41) lands on a **new own-book member** for that card (filed = `{ kind: "cast_member", id: <own-book binding> }`), reads 41; a second write (42) uses the same own-book row (still one own-book binding) and reads 42; the provided book's binding and value counts (`allValuesOnBook`) unchanged throughout.
   (You need `memberOnProvidedBook` to also return the admin, or insert the card with the book's `userId` — extend the helper additively, e.g. return `admin` too.)
2. **A world (`session`) value** in that session (`SHOP_SHUT`, the world-scope flag): `worldOwnerOf(..., { kind: "session", id }, null)` → `{ kind: "lorebook", id: <own book> }`; set-state apply lands one row on the own book's `lorebook` owner, none on the provided book's (`valuesOf(w.book.id)` unchanged), and `read(w, SHOP_SHUT)` returns true. Also: with the provided book holding `SHOP_SHUT` = false (a `lorebook` row, session null) before the write, the read is false, and true after (the notes win).
3. **The owner's own book, as before:** the existing "a character the attached book does hold" test covers Full; add: under **Review** (set the owner's `user_settings.lore_write_mode` = `review`, as `world()` sets `full`) a run write of a held character's age → `out.value.proposed` non-empty, a `state_proposals` row for the session, and no new `attribute_values` row on that member (you can't use `writeAge` here: it asserts no refusal but call set-state yourself and inspect `out.value`).
4. **The own book is exempt from the mode:** in a member's session on the provided book, set the **admin's** `user_settings.lore_write_mode` (the book owner's mode governs) to `review` → a run write of the persona's age applies (`out.value.applied` non-empty, `proposed` empty, one own-book value row, no `state_proposals` row); then `off` → applies too, no refusal. Also on the owner's own book under `review`, a seated character the book does **not** hold (own-book row) → applies without a proposal.
5. **A guest's refused write creates nothing:** in a member's session on the provided book, add a guest (`createTestUser`, a `session_guests` row for the session — check the table's required columns), seat a persona owned by the guest (`session_personas` with `userId` = guest); `worldOwnerOf(db, sid, { kind: "session_cast", id: persona.id }, guest.id)` rejects with a message containing `not your lorebook`, and the own book has **no** binding rows (`bindingsOf(own)` length 0 — `ownBookIdOf` may be undefined before; use `ownBookFor` semantics carefully: if the own book did not exist it may now exist, that is fine; assert its bindings are 0) and no `attribute_values` row anywhere for that persona. Then the socket path: `stateSet.handler(socketOf(guest.id), { sessionId, owner: { kind: "session_cast", id: persona.id }, slotId: AGE, value: 30 }, () => {})` → still no own-book binding and no value row (it may be refused earlier for another reason — the assertion is only that nothing was created).
6. **A pipeline write with no user lands:** covered by 1/2 (`writeAge` passes `null`) — assert it explicitly once with a short test if 1 does not already make it obvious.
7. **A session with no book keeps world values:** `world()`, then `lorebookId: null`; `worldOwnerOf(..., { kind: "session", id }, null)` → the own book's `lorebook` row; set-state apply `SHOP_SHUT` true → one row on the own book's `lorebook` owner, `read(w, SHOP_SHUT)` true. Also the socket write by the owner (`stateSet.handler(socketOf(w.user.id), …)`) lands the same way.

Every test inside the file's existing `vi.setConfig({ testTimeout: 60_000 … })`. Use `crypto.randomUUID()` only in test code (it is Node; fine).

## Docs (user-facing; plain words; never "phantom", never "chat" for a session; screen name **Session notes**)
- `docs/lorebooks.md`, **Your session's own notes**: replace the last sentence of the first paragraph ("A world attribute of someone the lorebook doesn't hold, …") with two or three sentences saying: in a session that reads a lorebook you don't own (a pub-wide or shared one) or none, the values that live on the world (a world attribute, such as a character's age) are kept in the notes — for your own character and for the lorebook's own people alike — and the session reads its notes' value before the lorebook's; the lorebook itself never changes. Because the notes are the session's own, **Review changes** and **Off** don't hold these back. On your own lorebook they go onto the book, under its **Writes from sessions** setting, and every session reading it shares them. A world attribute of someone your own lorebook doesn't hold is kept in the notes too (keep that half of today's sentence).
- `docs/stats-and-states.md`, the **Kept** bullet: after "a change made in one session shows in the others." add one sentence: a session that reads a lorebook you don't own, or none, keeps these values in its own notes instead (link `./lorebooks.md#your-sessions-own-notes`), so its changes stay in that session.
Check the anchor exists (`## Your session's own notes` → `#your-sessions-own-notes`).

## Rules (quoted)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- NOMENCLATURE §23 retired words: never "phantom"; it is a **session**, never a *chat*.
- "An int test that opens a DB inside an `it` needs a 60 s timeout under load."
- "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs."
- The test file makes its own `/tmp/serene-pub-vitest-world-scope-*` dir and removes it in `afterAll`; if a run is killed, delete only that dir by its full name.

## Done means
- Run `npx vitest run src/lib/server/state/worldScope.int.test.ts` **only once w1's report exists** (`test -f plans/briefs/REPORT-m3b-V2-w1.md`). If it does not exist when you finish writing, do not wait or poll: report "not run, w1 pending" and stop; the supervisor runs it. If you run it and a failure looks like w1's code rather than your test, describe it (file:line, expected vs got) — do not edit w1's files.
- `npx tsc --noEmit -p . 2>&1 | grep worldScope.int` empty (once w1's signature exists).

## Report (`plans/briefs/REPORT-m3b-V2-w2.md`)
Changed files, the tests added (names), test results with counts (or "not run"), assumptions, Noticed-not-done.
