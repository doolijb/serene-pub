# BRIEF pl4-w1 — own-book turn ties in `state/write.ts`: held changes on an own-book person; own-book places take the turn

Lane **pl4** (supervisor: lane-supervisor). Worker 1. App root `/home/jody/github/serene-pub`. Report in your hand-back message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Vocabulary — read this first
Every session has a lorebook: its **own book** (shown to people as **Session notes**) or an **overlay** on a parent book. The code says "notes" / "own book" for the session's own lorebook. **Never write or say "no book" / "no lorebook" / "a session that reads no book"** in code comments, test names, or your report — say "a session whose lorebook is its own book". A **real book** = any lorebook that is not some session's own book.

## Goal
Two fixes in `src/lib/server/state/write.ts` plus int tests in `src/lib/server/state/worldScope.int.test.ts`.

### 1. Accepting a held change on an own-book person (regression from lane pl3)
Today `proposeChange` (~line 2379; the anchor block ~2408–2422) files every book-layer proposal under the WORLD's turn: it calls `anchorFor(db, ctx, isBookLayer(change.owner.kind) ? { kind: "session", id: ctx.sessionId } : change.owner, messages)`. Since pl3, `anchorFor` (~585) checks an own-book `cast_member` row against **that character's own turn** (private `notesTurnOwnerOf`, ~537). `decideProposal` (~2536) accepts with `messageId: proposal.messageId` (no `ownAnchor`), so an accept of a held change on an own-book person is refused as sealed whenever someone else spoke after the character — even though the character hasn't spoken since.

Fix: `proposeChange` files a row of the session's own book under the **same turn owner `anchorFor` will use for it** — i.e. pass `change.owner` itself to `anchorFor` when `notesTurnOwnerOf(db, ctx.sessionId, change.owner)` is non-null (as `session_cast` proposals already do); every real book's row keeps the world's turn as now. Keep the existing `isBookLayer && ctx.messageId === null ? null` branch unchanged. Don't touch `decideProposal`'s write. Correct the comment above the anchor block: the sentence "The row an accept writes carries no message: authoring has no turn to be after (`anchorFor`)." is now false for own-book rows — say a real book's row carries none (authoring has no turn to be after) while a row of the session's own book is held under the turn `anchorFor` gives it (that character's, or the world's) and the accept writes it there.

### 2. Own-book places take the turn (lead decision, 2026-11-05, after the owner's "There's always a lorebook")
One rule for every row of the session's own book: its `lorebook` row, its cast members **and its places** (`location` owners whose entry's `lorebookId` is the own book) take the turn. In `notesTurnOwnerOf`, a `location` whose `lorebook_entries.lorebook_id` equals the own book id → `{ kind: "session", id: sessionId }` (the world's turn: "a place moves on every turn as the world does", see `turnOwnerOf` ~468). Every real book's rows stay `null` — **"author layers are never anchored" stands.** Rewrite `notesTurnOwnerOf`'s doc comment (drop the "An own-book `location` is `null` on purpose…" reasoning; say the rows lose their tie when they leave the own book into a real book — Clone with changes and Apply to the lorebook drop it, done by another worker in `lorebooks/ownBook.ts`) and the matching sentence in `anchorFor`'s doc ("its `lorebook` row and its cast members take the turn…" → include its places). Keep the 🚧 marker and cite "(★pl2-2; places: lead decision 2026-11-05, lane pl4)".

## Tests (`src/lib/server/state/worldScope.int.test.ts`, describe "the session's own notes are tied to the turn like a session value (★pl2-2)" ~line 889)
Reuse the file's helpers (`memberOnProvidedBook`, `seatCharacter`, `writeAge`, `castValuesOf`, `postMessageBy`, `postMessage`, `placeIn`, `placeRows`, `applyOne`, `backOf`, `proposalsOf`, `ownBookFor`, `restoreRetractedState`, `LAMPS`, `AGE`…). Read them before writing.
- **Replace** the test "a notes place's value (an own-book location) is not anchored" with: a value on a place in the session's own book is anchored to the newest message (world's turn); `backOf(thatMessage)` takes it (the read value of the place goes back to what it was — use `lampsAt`/`lampsInState` or `placeRows` as fits); `restoreRetractedState(…, back.taken)` brings it back.
- **Add** (item 1): a seated character with an own-book member (as in the "the same for a person's value…" test); the character speaks (`postMessageBy(…, hero.id)`), then someone else speaks (`postMessageBy(…, null)`); a run proposes a change to the member (`proposeChange` with `updatedBy: "run:<some-uuid>"`-style writer as other tests in `state/` use — check `state/write.int.test.ts` for a proposal example; no `messageId`); the proposal's `messageId` is the character's reply; `decideProposal(db, id, true)` → `status: "accepted"` and the value reads as proposed, its row anchored to the character's reply.
- **Add** (item 1, sealed): same, but the character speaks again after the proposal is filed → `decideProposal` rejects with a `StateRefusal` whose message is the existing words (`that reply is sealed: <name> has spoken since. Edit their latest reply instead.` — match on `/sealed/`).
Proposal ids/structure: read `proposeChange`/`decideProposal` and an existing proposal int test before writing.

## Files owned
`src/lib/server/state/write.ts` (only `proposeChange`'s anchor block + comment, `notesTurnOwnerOf`, `anchorFor`'s doc comment), `src/lib/server/state/worldScope.int.test.ts`.
## Files readable
Anything. Don't edit anything else. Other lanes are editing `db/schema.ts`, `drizzle/**`, `sessions/*` and `sockets/*` right now.
## Out of scope
`lorebooks/ownBook.ts`, `lorebooks/tableRegistry.ts`, docs, NOMENCLATURE — the supervisor and worker 2 do those. No new exported names, settings, migrations. No other fixes — list anything you notice under "Noticed, not done".

## Rules (CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Code decides what code can… Same inputs, same result." Keep `anchorFor` the one place an anchor is decided.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Never `kill -9` anything. `write.ts` is dirty at HEAD: **don't reformat it** — no `prettier --write`; make additive, minimal hunks; re-read the region right before each edit (others may have touched the file).
- Never pipe vitest into `head`/`tail` (the SIGPIPE leaks PGlite temp dirs); redirect to a file in `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/pl4-w1-*.log` and read it.
- An int test that opens a DB inside an `it` needs a 60 s timeout under load (follow the file's existing pattern).

Verbatim:
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo.

## Stop and ask (in your report, don't decide) when
A new name/setting/migration seems needed; the fix needs a file outside "Files owned"; an existing test outside the two named behaviours breaks and the fix isn't obvious.

## Done means
`npx vitest run src/lib/server/state/worldScope.int.test.ts src/lib/server/state/write.int.test.ts src/lib/server/state/handEdits.int.test.ts src/lib/server/sessions/rewind.int.test.ts src/lib/server/lorebooks/imprints.int.test.ts` all green (report counts), and `npx tsc --noEmit -p .` shows no errors in `state/write.ts` or `worldScope.int.test.ts` (grep the output for those paths; others' errors are not yours — list them). Report: the diff summary per item, test counts, any `/tmp/serene-pub-vitest-*` dirs your runs left (by name), Noticed-not-done.
