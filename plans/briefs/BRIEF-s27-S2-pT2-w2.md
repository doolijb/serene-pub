# BRIEF s27-S2-pT2-w2 — host.ts: revert three unreachable hunks, door the stat-config owner; side-character picker overlays only seated cards

Lane **s27-S2-pT2** (seat-cast programme, stage S2: readers switch onto the seated cast member; refs in accept 🚧 `seated-member:<memberId>`). Supervisor: the lane-supervisor that wrote this. App `/home/jody/github/serene-pub`. Another worker (w1) edits `sessions/seats.ts` and `pipelines/prompt/seatCards.ts` at the same time (internals only; every exported signature stays). Concurrent lanes edit `state/**`, `rulesets/**` and more. Touch nothing outside **Files owned**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: no SDK edit in this lane.)

## Items

### 1. Revert three unreachable hunks — `src/lib/server/pipelines/runtime/host.ts`
They only ever see `namedRef`, which is gated by `isParticipantRef` (~7193), and the SDK grammar keeps `seated-member:` out — so they can never fire. Put back exactly the HEAD text (check with `git diff HEAD -- src/lib/server/pipelines/runtime/host.ts`; `git diff` / `git show HEAD:<path>` are fine, `git checkout`/`restore`/`stash` are **forbidden** — the file carries other lanes' uncommitted work):
- **`personLineOf`** (~2577–2582): the 3 comment lines + `parseParticipantRef((await cardFormRef(db, sessionId, speaker)) ?? speaker)` go back to
  `		const parsed = parseParticipantRef(speaker)`
- **The cast-row speaker** (~7564–7573): the 3 comment lines and `const speakerCardRef = …` go away; `namedRow` goes back to
  ```ts
  						const namedRow = speakerRef
  							? parseParticipantRef(speakerRef)
  							: null
  ```
- **`speakerParsed`** (~7629–7631) goes back to
  ```ts
  						const speakerParsed = speakerRef
  							? parseParticipantRef(speakerRef)
  							: null
  ```
Leave every other `cardFormRef` use in `host.ts` alone (the lore visibility speaker ~4004, the turn-order write ~8147 — it has a test — and `retire` ~8529); the `cardFormRef` import stays (still used). Re-read each hunk immediately before editing; never reformat `host.ts`; never run `prettier --write` on it.

### 2. The stat-config owner goes through the state lane's door — `host.ts` `core:outlet/set-stat-config` (~8592–8616)
Today `castOwnerOfRef(ref)` gets the raw ref, so `seated-member:<id>` is refused. Read the ref through `storedSeatRef(db, sessionId, ref)` from `src/lib/server/state/seatRefs.ts` (dynamic `await import(...)`, like the `castOwnerOfRef` import beside it) **before** `castOwnerOfRef`, for every ref except `"world"`. `storedSeatRef` turns `seated-member:<memberId>` into the seat's stored ref (`character:<cardId>` / `player-seat:<id>`), returns any other ref unchanged, and `null` for an unseated member. On `null`, take today's halt — **its sentence unchanged**:
`${JSON.stringify(p.owner ?? null)} is not an owner here — name a seat (player-seat:<id>, character:<id>) or world`
(`JSON.stringify(p.owner)` — the ref as given, not the translated one). Add a 🚧 comment line in the style of the neighbouring ones ("`seated-member:<memberId>` is accepted (seat-cast S2) through `storedSeatRef`…").

### 3. Side-character picker — `src/lib/server/pipelines/entities/sideCharacter.ts` `listSideCharacterOptions` (~322–333)
Today every offered card goes through `cardsAsSeatsRead`, which also reads an **unseated** library card through the attached book's member — so a card no seat holds shows a member's name in the picker. That is a visible change nobody ruled. Fix: read through the member **only for cards a seat holds** (the departed character seats in `cast`: "a removed member offered again"); every other offered card keeps its card `name`/`nickname`, as before S2. Keep the output shape `{ id, name, nickname }` and the name sort. Update the comment above it to say exactly that.

### 4. Tests
- `src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts` — add to the `describe("refs in accept seated-member:<memberId>")` block a test for `core:outlet/set-stat-config` (`host.commit!(p, node)` like the turn-order test there): `owner: "seated-member:<m>"` for a seated member does what `owner: "character:<cardId>"` does — prefer asserting a real write (look at how `setStatConfig` in `src/lib/server/state/write.ts` and `src/lib/server/rulesets/seatedMemberRefs.int.test.ts` set up a stat slot); if a real write needs more fixture than is reasonable, assert both calls return equal results and say so in your report. And an unseated `seated-member:<id>` returns exactly the halt sentence above.
- `src/lib/server/sockets/sessions.sideCharacter.int.test.ts` — add two tests: (a) a removed (departed) seat whose member has an `ownName` is offered again under the member's name; (b) an unseated library card whose card has a member with an `ownName` in the session's attached book is offered under the **card's** name. Reuse the file's fixtures; re-read the file before editing (it has uncommitted work).
- Existing tests stay green **unchanged**. If one needs editing, stop and say why in your report.

## Rules (quoted from the lane's sources)
- S2 contract: "Refs your code **emits** stay as today (`character:<cardId>` for a carded seat, `player-seat:<id>`) until S3/S4." "Keys stay … Do not rekey or rewrite them (S4 owns that)." "No migration, no SDK edit, no boot-pass change, no new setting, flag or event." "Anything a user sees that changes — copy, a click target, a new line — is a ★ for the lead": so the halt sentence is not reworded.
- Shared file: "`runtime/host.ts` … Re-read the hunk immediately before each edit; never reformat."
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx`." No static import of `$lib/server/db` in modules tests mock (pass `db`).
- "Never write 'no book', 'no lorebook', 'bookless', 'reads no lorebook' in code, comments, tests or copy; say 'a session whose lorebook is its own book'."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." No new exported name.
- Tests: "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." Int tests touching the DB keep 60 s timeouts.

## Files owned
- `src/lib/server/pipelines/runtime/host.ts` — the three hunks in item 1 and the set-stat-config owner lines in item 2 only
- `src/lib/server/pipelines/entities/sideCharacter.ts` — `listSideCharacterOptions` only
- `src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts`, `src/lib/server/sockets/sessions.sideCharacter.int.test.ts`

## Files readable
Anything. Especially `src/lib/server/state/seatRefs.ts`, `src/lib/server/pipelines/runtime/bindings.state.ts` (`castOwnerOfRef`), `src/lib/server/pipelines/prompt/seatCards.ts`.

## Out of scope
`seats.ts`, `seatCards.ts` (w1's), `seatRefs.ts` (lane s27-S2-state's), NOMENCLATURE, the report, every other file and every other host.ts hunk.

## Stop and ask when
A test must change; a hunk's HEAD text is unclear; you'd need a new name, setting or a copy change.

## Done means
Green, run from the app root with `npx vitest run <files>`:
`src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts src/lib/server/sockets/sessions.sideCharacter.int.test.ts src/lib/server/pipelines/scripts/chains.sideCharacterExtras.int.test.ts src/lib/server/pipelines/runtime/pickSprite.seatedMember.int.test.ts src/lib/server/sessions/turnOrder.write.int.test.ts`
plus `npx tsc --noEmit -p . 2>&1 | grep -E "host\.ts|sideCharacter"` empty. Report `npx prettier --check` status of `sideCharacter.ts` and the two test files without reformatting a file that already failed before you.

## Report
Return as your final message: changed files with the line ranges, tests run with counts, whether the stat-config test is a real write, any test you had to touch (should be none), the `/tmp/serene-pub-vitest-*` dirs you made and deleted, Noticed-not-done.
