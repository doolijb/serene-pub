# BRIEF s27-S2-promptText-w1 — host.ts reads the seated cast member (seat-cast S2)

Worker for lane **s27-S2-promptText** (supervisor: Opus). App `/home/jody/github/serene-pub`. Model: Sonnet. Report back as your final message (the supervisor reads it; do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build: this lane makes no SDK edit.)

## Goal
Stage S2 of "sessions seat cast members, not cards": switch the **readers** in `src/lib/server/pipelines/runtime/host.ts` so what a seated character *is* (name, nickname, retold text fields, greetings, example dialogues) comes from the **cast member the seat seats**, read over the card the seat holds. No stored key, no stored data, no emitted ref changes.

## Files owned (edit ONLY these)
- `src/lib/server/pipelines/runtime/host.ts` — **except lines ~6347–6361 (the sprite node hunk: another lane's; do not touch)**.
- New test file(s) you create: `src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts` (name it so).

`host.ts` is dirty at HEAD with other lanes' uncommitted work: **re-read each hunk immediately before you edit it; make additive, minimal hunks; never reformat; never run prettier --write on host.ts** (`npx prettier --check` only, and only report the result — it may already be dirty).

## Files readable (read, never edit)
- `src/lib/server/pipelines/prompt/seatCards.ts` — **the helpers you use** (written by the supervisor; tested in `seatCards.test.ts`):
  - `seatCardsAsRead(db, sessionId, rows)` — rows `{ castMemberId?, character? , ...anything }` → same rows, each `character` (a card row) read as the member its seat seats (member's own name/nickname, each retold field), over the card the seat holds. A row whose `castMemberId` is null reads the member the seat writer would find for its card (attached book, then the session's own book), so seats the boot pass has not filled read exactly what they read before. Rows keep every other key.
  - `cardsAsSeatsRead(db, sessionId, cards)` — card rows → the same cards, each read through the session's seat holding it (live before departed). For readers with card ids rather than seat rows.
  - `cardFormRef(db, sessionId, ref)` — a `seated-member:<memberId>` ref → today's card form (`character:<cardId>`, or `player-seat:<id>` for a card-less player seat), null when nobody is seated as that member; **any other ref returned unchanged, no query**.
  - `cardFormRefInCast(cast, ref)` — the same, pure, over a `session_cast` read's rows (needs `castMemberId`, `seatId`, `position`, `removedAt` on the rows).
- `src/lib/server/cast/memberAsRead.ts`, `src/lib/server/cast/seatedCast.ts`, `src/lib/server/sessions/seats.ts` (`seatOf`, `parseSeatRef`, `seatCast`, `seatPlayer`, `settleSeats`), `src/lib/server/lorebooks/retold.ts` (the old overlay), `src/lib/server/lorebooks/retold.int.test.ts` (its `session_cast` and greeting tests are the regression guard; copy its setup pattern for your new test).

## Items
1. **`case "session_cast"` (~4678–5170).**
   - In the `sessionCharacters` select add `castMemberId: schema.sessionCharacters.castMemberId` and `seatId: schema.sessionCharacters.id`. In the `sessionPersonas` select add `castMemberId: schema.sessionPersonas.castMemberId` (it already has `seatId`).
   - Replace the `retoldCards` / `retoldByCard` / `applyRetold` overlay with one call: `const castRows = await seatCardsAsRead(db, sessionId, sessionCharacters)` and map `castRows` where the return maps `sessionCharacters` (drop the `...(retoldCards.has(...) ? { character: applyRetold(...) } : {})` spread). Every seat — live, departed, switched off — goes through it (seat sets keep today's query).
   - Remove the retold columns from the `stored` lorebook-bindings select and the `retoldCards` variable; **keep** `lorebookBindings`, `absorbedByCharacter`, the overlays and `castMemberCards` (the roster and absorbed aliases are unchanged — they still read the attached book).
   - **Player seats (`sessionPersonas`) are NOT layered** — they keep their card + `withSeatName` exactly as now; only `castMemberId` rides along. (Open ★ for the lead; do not decide it.)
   - Remove imports that become unused (`applyRetold`, `retoldByCard`, `RetoldMember`) only if nothing else in host.ts uses them.
2. **Transcript names (~3640–3735, the `characterName` map from `retoldMembersForSession` + `memberNames`).** Replace with `const read = await cardsAsSeatsRead(db, sessionId, characters)` and `characterName = new Map(read.map((c) => [c.id, c.name]))` — the plain name (never nickname-first), exactly as the comment says. Drop the `retoldMembersForSession` import there.
3. **The lore read's seated set (~4150–4180, `seated` / `bindingCharacter`).** Add `castMemberId` to the `seated` query (keep it otherwise identical — departed seats included, as now). For each binding `b`: if seats whose `castMemberId === b.id` hold a card, pick the linked card `b.characterId` when one of them holds it, else the first such seat's card; otherwise fall back to today's card-based rule unchanged. (Today's data gives the same answer; a member seated by id is found even when its card mapping says otherwise.)
4. **Refs in accept 🚧 `seated-member:<memberId>`** (refs your code *emits* stay `character:<cardId>` / `player-seat:<id>`):
   - `loreVisibilitySubject` (~875) is sync; at its caller (~4003) normalise `q.speaker` with `cardFormRef(db, sessionId, …)` first when it is a string (null result → treat as `NO_SUCH_CHARACTER`, i.e. pass a speaker that resolves to nobody — keep that outcome identical to an unknown character ref today).
   - The person's-message speaker parse (~2577, `parseParticipantRef(speaker)`): normalise with `cardFormRef` before parsing. Do not change the stamp writing (wave 2 owns speaker stamps).
   - The speaker-row reads at ~7548 and ~7606 (`parseParticipantRef(speakerRef)`): normalise `speakerRef` once with `cardFormRef` before both.
   - The turn-order write (~8130, `liveCastRefs` / `admitted`): normalise each candidate's `ref` (and each order entry's ref, if the node reads an order) with `cardFormRef` before the `live.has(ref)` check, so what is stored stays the card form. `liveCastRefs` itself is unchanged.
   - `retire` (~8491: `/^character:(\d+)$/`): normalise `ref` with `cardFormRef` first.
   - Find any other `parseParticipantRef(`/`/^character:` ref-IN site in host.ts outside the sprite hunk and list it in your report (do not change emitters).
5. **Tests** — new `src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts` (copy the `retold.int.test.ts` harness: `vi.mock("$lib/server/db", …createTestDb…)`, `serene-pub-vitest-<name>-` data dir, `releaseDataDir`, 60 s timeouts). Seat with the real seat writer (`seatCast` from `sessions/seats.ts`, inside `testDb.transaction(async (tx) => …)` using only `tx`) or insert `session_characters` with `castMemberId` set explicitly. Prove:
   a. a member with `retold: { description: true }` and `ownName` → the `session_cast` read's `character.name` / `.description` are the member's, and `resolveContextInput` (from `pipelines/prompt/promptFields`) output contains the member's description and own name, not the card's;
   b. **the intended change**: a session whose lorebook is its own book (`sessions.lorebook_id` null; the member lives in the session's own book — create it with `ownBookOf`/the own-book helper the existing tests use, grep `ownBook` in `src/lib/server/**/*.int.test.ts`) — its member's own name and retold text reach the read (before S2 they did not);
   c. a seat holding a **dated card** (a cast amendment drawing the member with card B from a date the session's clock has passed, while the seat holds card A) reads card A's text with the member's retold fields — not card B's (`overCards`);
   d. a seated card with no member anywhere reads the card untouched (`toEqual` the card row);
   e. two live seats on one member holding different cards each read over their own card;
   f. the rows carry `castMemberId` (and `seatId` on character rows);
   g. transcript names (the read at item 2 — find its `case` name) give the member's own name;
   h. a `seated-member:<memberId>` speaker is accepted at one ref-in site of your choice (the turn-order write is easiest if a test for it exists; else `loreVisibilitySubject` via the `lorebook_entries` read).

## Rules (quoted from CLAUDE.md and the lane contract)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`." No static `$lib/server/db` import in modules tests mock — pass `db`.
- "Refs your code **emits** stay as today (`character:<cardId>` for a carded seat, `player-seat:<id>`) until S3/S4." "Keys stay": `session_cast:<cardId>` owners, `state.cast.byId[<cardId>]`, the turn order, `turnTally`, speech picks — **unchanged**.
- "Do not change SDK types or objects handed to plugins (`CastEntry`, `SessionCharacterV1`, `ParticipantRef`, …)". No SDK edit, no `sdk:build`, no migration, no new setting/flag/event.
- "Two live seats can share one member until the next boot … Resolve per seat, never per member."
- "Behaviour stays the same for today's data — with one intended change": a seat's member is read wherever it lives, including the session's own book. "The existing tests in your files stay green **unchanged** (a test you must edit is a finding — say why)."
- "Every session has a lorebook — its own book (Session notes) or an overlay of a book. Never write 'no book', 'no lorebook', 'bookless', 'reads no lorebook' in code, comments, tests or copy; say 'a session whose lorebook is its own book'."
- It is a **session**, never a *chat*. Comments explain why, in the file's existing voice; mark new provisional vocabulary 🚧.
- No new exported names. If you think you need one, stop and say so in your report.
- Targeted tests only. **Never pipe vitest into `head`** (SIGPIPE leaks PGlite temp dirs). 60 s timeouts on int tests that touch the DB.

## Done means
- `npx vitest run src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts src/lib/server/lorebooks/retold.int.test.ts src/lib/server/pipelines/runtime/transcript.castNames.test.ts src/lib/server/pipelines/prompt/seatCards.test.ts` green, plus every existing test file whose name matches `src/lib/server/pipelines/runtime/host*.test.ts` and `src/lib/server/pipelines/runtime/*cast*.test.ts` (list what you ran and the counts). Any pre-existing failure: run it once on its own and say whether your change caused it.
- `npx tsc --noEmit -p . 2>&1 | grep "runtime/host"` shows nothing new.
- Report: each item → what changed (line ranges), the ref-in sites found, tests with counts, any existing test you had to change (with old and new value and why), anything you could not do.
