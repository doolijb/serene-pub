# BRIEF m3b-W-w1 — a world-scope attribute of a seated character the attached book does not hold lands on the session's own book (code + int tests)

Worker for lane **m3b-W** (supervisor: lane-supervisor m3b-W). Work from `/home/jody/github/serene-pub`. Report to `plans/briefs/REPORT-m3b-W-w1.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK change is expected in this task; if you think one is needed, stop and say so.)

## Goal — the owner's ruling (2026-11-05)

"Why not just cast/char attribute?" → **the player's persona is a cast member of the session's own book**, and a world-scope attribute (owner `cast`, scope `world`, e.g. a game's `age`) files on that row — held on the session's own book instead of the pub-wide provided book, which stays untouched. Today `worldOwnerOf` refuses both cases: _A player's seat holds nothing that lives on the world._ and _This character is not in this world's cast, so a value that lives on the world has nowhere to go._ They become the landing below. **A provided book gains no member rows for anyone** (the gate in `runLorebookBindingCheck` stays — do not touch `sockets/sessions.ts`).

## Files owned (the only files you may edit)

- `src/lib/server/state/worldScope.ts`
- `src/lib/server/state/write.ts` — **dirty at HEAD and shared with other programmes**: re-read the exact hunk immediately before each edit, additive minimal hunks only, never reformat the file, never run prettier `--write` on it.
- `src/lib/server/state/resolve.ts` — same care (re-read before edit, minimal hunk, no reformat).
- `src/lib/server/state/worldScope.int.test.ts` (extend it; it is the test home).

## Files readable

`src/lib/server/lorebooks/ownBook.ts` (`ownBookFor`, `attachedOrOwnBookOf`, `lorebooksReadBy`), `src/lib/server/state/lorebookState.ts` (`lorebookLinks`, `normalizeOwner`), `src/lib/server/state/owners.ts` (`resolutionChain`), `src/lib/server/utils/characterBindingSync.ts` (`resolveOrCreateBindingRow` — **call it, never edit it**), `src/lib/server/utils/castMemberCards.ts`, `src/lib/server/sockets/state.ts` ~1415–1425 and `src/lib/server/pipelines/runtime/bindings.state.ts` ~610–650 (the two callers of `worldOwnerOf` — neither runs inside a transaction), `src/lib/server/sockets/sessions.castFromLorebook.int.test.ts` ~150–240 (the provided-book fixture: `extraJson.provided = { plugin, slug, version, uuid }` with `uuid` equal to the book's `uuid`, owned by an admin).

## What to build

### 1. `worldOwnerOf` (`state/worldScope.ts`)

Keep the signature `worldOwnerOf(db, sessionId, owner): Promise<StateOwner>`. New rule, in order:

a. **`player_seat`** → read that `session_personas` row (`id = owner.id`, this `sessionId`, `removedAt IS NULL`). With a `personaId` (a carded seat) the owner becomes `{ kind: "session_cast", id: personaId }` and continues below. With none (a card-less seat, or no such seat) keep today's refusal **word for word**: `throw new StateRefusal("A player's seat holds nothing that lives on the world.")`.
b. For a `session_cast` owner, first check the character is in this session: call `assertSessionOwner(db, sessionId, owner)` from `state/write.ts` **with no userId** (it checks a live seat or a live voiced persona and throws `that character is not in this session's cast.`). Nothing is minted for a character the session does not hold.
c. `book = attachedOrOwnBookOf(db, sessionId)`; `links = lorebookLinks(db, book)`; `filter = normalizeOwner(...)` — as today. A `lorebook` filter: as today (only the session's own layer is re-owned). A `cast_member` filter **with a member (id ≥ 0)**: today's landing, unchanged (the attached book's row, under its write mode).
d. A `cast_member` filter with **no member** (`id === undefined || id < 0`) and an owner of kind `session_cast`: the owner becomes the **cast member row of the session's own book** for that character: `own = await ownBookFor(db, sessionId)`; `row = await resolveOrCreateBindingRow({ lorebookId: own.id, characterId: owner.id }, db)` (the lorebook module's own find-or-mint door, the one `runLorebookBindingCheck` uses — never a raw insert; it finds an existing member by any of the character's cards, so a second write never mints a second row). Return `{ kind: "cast_member", id: row.id }`. When it returns `null` (a deleted card), throw the old sentence: `This character is not in this world's cast, so a value that lives on the world has nowhere to go.` A session with no attached book: `attachedOrOwnBookOf` is already the own book, so the same rule mints into it.
e. Update the file's header comment to say the new rule in two or three sentences (no new vocabulary; say "the session's own book" in code comments, **Session notes** is the interface word only). Never the word "phantom" (retired, NOMENCLATURE §23).

### 2. The write door accepts the own book's members (`state/write.ts`, `assertSessionOwner`)

The `cast_member` branch today requires the member's book to be in `sessionLorebookIds` (the attached book only), so the own book's member would be refused with _that is not a cast member of this session's lorebook._ Widen **only the `cast_member` branch**: accept a member whose `lorebookId` is the attached book **or the session's own book** — use `lorebooksReadBy(db, sessionId).ids` (already imported in write.ts) for the list. `assertBookWriter` stays as is (the own book is owned by the session's owner, so the owner and the owner's runs pass; a guest does not — that is the existing rule, keep it). Do **not** widen the `lorebook` branch, `assertBookWritesOn`, `applyAutomatic`, `bookWritePlace` or any write-mode logic.

### 3. Reads find the same row (`state/resolve.ts`)

A world-scope read for that character must resolve to the own book's row. Today `sessionLinks` sets each cast member's `castMemberId` from the **attached** book only, and `chainFor` builds the read chain `session_cast → cast_member → card` from it. Do **not** change what `castMemberId` means (`state/durable.ts`, `presencesOnReading.ts`, `statTrail.ts` and `sockets/state.ts` read it as "the attached book's member"). Instead:

- add one optional field to `CastMemberLink`: `ownBookMemberId?: number | null` with a doc comment: _🚧 This character's cast member in the session's own book, when the attached book holds none (or the session reads no book) — where a world-scope value of theirs is kept (`worldOwnerOf`)._
- in `sessionLinks`, after `castMemberId` is filled: if any member has `castMemberId == null`, read `ownBookOf(db, sessionId)` (already imported; never create on a read) and, when it exists and differs from the attached book, `castMemberCards(db, ownBook.id).memberOf`, and set `member.ownBookMemberId` for those members. One extra query pair, only when needed.
- in `chainFor`: `castMemberId: member?.castMemberId ?? member?.ownBookMemberId ?? null`.

Nothing else in resolve.ts changes.

## Tests — extend `src/lib/server/state/worldScope.int.test.ts`

Keep its setup (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, its own `mkdtemp` dir under `os.tmpdir()` with prefix `serene-pub-vitest-world-scope-`, removed in `afterAll`). Declare a cast world-scope slot alongside the existing ones in `declareSlots()` (e.g. `test:slot/age@1` — a test-only id; `type: "number"`, `appliesTo: ["cast"]`, `scope: "world"`) and add it to the test genre's `slots`. Fixture: seat characters with `sessionCharacters`, a persona with `sessionPersonas` (`personaId` set); a card-less seat is a `sessionPersonas` row with `personaId: null` and a `seatName`. Use the provided-book fixture shape from `sessions.castFromLorebook.int.test.ts` (an admin-owned book with a genuine `extraJson.provided` mark) for "a session on a provided book", in a **member's** session (the member owns the session; `lorebookId` = the provided book).

Required cases (write through `set-state@1` apply and/or the socket `stateSet.handler`, as the existing tests do; read back with `valueOf` on the `session_cast` owner):

1. A member's session on a provided book with a persona seated: a world-scope write for the **player's seat** (owner `player_seat` = the persona's `session_personas.id`) lands on the **own book's** cast member row for the persona; it reads back for `session_cast:<personaId>`; the provided book gains **no** `lorebook_bindings` row and **no** `attribute_values` row (count before/after).
2. The same for a **non-persona seated character** the provided book does not hold (owner `session_cast`).
3. **A world person's write unchanged**: in a session whose owner owns the attached book (lore write mode Full, the existing `world()` fixture), a seated character who IS a member of that book (mint the member with `resolveOrCreateBindingRow` in the fixture) — a world-scope write lands on **that book's** member row, and the own book gains no binding.
4. **A second write updates, never duplicates the row**: two writes (e.g. 24 then 25) for the same persona → exactly one own-book `lorebook_bindings` row for the persona; the read returns 25. Report how many `attribute_values` rows the owner+slot holds and why (setValue's semantics), and assert that number.
5. **No persona keeps the refusal**: a card-less player seat → rejects with `A player's seat holds nothing that lives on the world.`
6. **No attached book**: a session with `lorebookId` null and a persona seated → the write lands on the own book's cast member row and reads back.
7. Replace the existing test _"a character outside the cast refuses with the sentence"_ (`session_cast` 999_999): it now rejects with `that character is not in this session's cast.` and mints nothing.

**Probe, do not fix:** in a no-book session, a world-scope write on the `session` owner (the existing `SHOP_SHUT` slot) — does it land on the own book's `lorebook` row, or is it refused (`that lorebook is not this session's lorebook.`) and/or not read back? Run it once, report the exact outcome; do **not** keep a failing or bug-asserting test for it and do not change code for it.

## Run (targeted only)

- `npx vitest run src/lib/server/state/worldScope.int.test.ts`
- then the regression set: `npx vitest run src/lib/server/sockets/sessions.castFromLorebook.int.test.ts src/lib/server/sockets/sessions.castBindings.int.test.ts src/lib/server/sockets/sessions.ownBookCreate.int.test.ts src/lib/server/plugins/providedBooksPubWide.int.test.ts src/lib/server/state/write.int.test.ts src/lib/server/state/durable.int.test.ts src/lib/server/state/resolve.int.test.ts`
- `npx tsc --noEmit -p . 2>&1 | grep -E "state/(worldScope|write|resolve)"` — must print nothing from your files.
- Never pipe vitest into `head` (the SIGPIPE leaks PGlite temp dirs). Redirect to a file under your scratch area and read it.

## Rules you work under (quoted)

- CLAUDE.md Hard rules: _"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."_ · _"Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`."_ · _"Never `kill -9` the dev server."_ · _"`$state(new Set())` / `new Map()` is not reactive"_ (n/a server-side).
- CLAUDE.md Decisions: _"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."_ · _"Say each assumption when you make it."_ · Propose-and-wait (★) on any new name, setting, flag, abstraction, event, table, migration, or behaviour beyond this brief. The one new name you may add is the field `ownBookMemberId` (🚧) above.
- CLAUDE.md P1: _"Deterministic, never hidden."_ P2: _"A module owns its data and every write to it"_ — hence the binding door, never a raw insert into `lorebook_bindings`.
- NOMENCLATURE R1 one word, one meaning · R3 qualify, never the bare noun · R6 mark provisional vocabulary 🚧. §23: never reintroduce a retired word ("phantom", "chat" for a session).
- Sockets ruling: an event in `SCOPED_EVENTS` must carry its scope key (you add no event).
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.

## Stop and ask (in your report) when

A needed change falls outside the four owned files; a test of the regression set goes red and the cause is not your change (report it with the failing assertion, don't fix); you need a new name beyond `ownBookMemberId`; the binding door can't be called where `worldOwnerOf` runs.

## Done means

`worldScope.int.test.ts` green with the seven cases; the regression set above green (or each red explained as not yours with evidence); `tsc` clean on your files. Report: changed files with a one-line purpose each, tests with pass/fail counts, the probe's outcome, assumptions, Noticed-not-done.
