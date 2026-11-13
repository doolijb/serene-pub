# BRIEF — `sense-eng-w1` — turn pool honours the bench; session delete never writes a book the owner does not own

You are a `lane-worker` under lane supervisor `sense-eng`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.
Report back in your final message (not a file): changed files, tests run with exact results, anything you could
not do, and **Noticed, not done**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

### Item 1 — `core:task/turn-pool@1` never admits a benched seat

File: `src/lib/server/pipelines/runtime/bindings.ts`, the `"core:task/turn-pool@1"` binding only (about lines
4436–4565). Edit nothing else in that file.

The rule (owner 2026-11-10), quoted from `src/lib/server/sessions/seats.ts` ~1745: *"In play, as SQL … The pure form
is `inPlay` (`$lib/shared/sessions/inPlay`); every reader of turns, speaking seats, the prompt and the lore gate uses
one of the two and never spells the condition again."* `inPlay(seat)` is
`!seat.removedAt && seat.isActive !== false && seat.enabled !== false`. The cast read hands a benched seat out with
`enabled: false` (characters and player seats both; `host.ts` ~5196 and ~5253).

Do:
- Import `inPlay` from `$lib/shared/sessions/inPlay` (as `speakerRotation.ts` does).
- **Character seats:** replace `!cc.removedAt` and `(characters === "all" || cc.enabled === true)` with one
  `inPlay(cc)` test. After this, `characters: "all"` and `"active"` admit the same seats; `"none"` still admits none.
  Keep the ref test (`cc.ref || cc.character.id != null`) and `cc.character`. Rewrite the comment above it so it says
  the bench is read by `inPlay`, the one rule, whatever `characters` says (no comment may claim `all` admits a
  switched-off seat).
- **Player seats:** the filter `(cp.persona ? !cp.removedAt : isCardlessPlayerSeat(cp))` gets the same bench test:
  a benched player seat (card or card-less) is never a candidate. Use `inPlay(cp)` (check what
  `isCardlessPlayerSeat` already tests in `src/lib/server/sessions/seatName.ts` and keep its other conditions).
- **Envoys:** leave as they are (`inTurnEnvoys`). Do not touch `speakerRotation.ts`.
- **Do not change the node's declaration, its params list or its option list** (a published SDK name). Do not edit
  the SDK repo.

Tests — `src/lib/server/pipelines/runtime/turnStrategies.test.ts`, `describe("the pool")` (~329):
- The existing test "`characters: 'all'` admits one switched off in the cast" (~378) asserts the old behaviour.
  Replace it with: a benched character (`enabled: false`, `removedAt: null`) is **not** a candidate with
  `characters: "all"`, nor with the default.
- Add: a benched player seat (`enabled: false`) is not a candidate — one with a card and one card-less
  (`persona: null`, `seatName` set); an in-play one beside it still is.
- Confirm each new test fails against the old code (run once before your edit, or reason it from the diff, and say
  which in your report).

### Item 2 — deleting a session never writes to a lorebook its owner does not own

File: `src/lib/server/state/durable.ts`, `recordToTimeline`, the `opts.reason === "delete"` branch (~175):

```ts
if (opts.reason === "delete") {
	if (!links.lorebookId || mode === "off") return report
	lorebookId = links.lorebookId
	route = "book"
}
```

Add the ownership test `loreWriteRoute` applies (`src/lib/server/lorebooks/ownBook.ts` ~345:
`if (facts.bookOwnerId !== facts.sessionOwnerId) return "own-book"`): read the session's `userId`
(`schema.sessions.userId`) and the attached book's `userId` (`schema.lorebooks.userId`); when they differ, return
`report` (nothing recorded). Keep the rest exactly: Full and Review changes write the book; Off and no attached book
record nothing. Do not route a delete to the notes. Do not touch the non-delete branch or any caller (the scene-close
callers in `sockets/scenes.ts`, the delete caller in `sockets/sessions.ts` are out of scope). Update the header
comment's "The delete safeguard keeps the A22 table…" sentence and the block comment inside the function to say a
book someone else owns records nothing on delete.

Tests — `src/lib/server/state/durable.int.test.ts`, `describe("the delete safeguard")` (~327). Read the file's
`world()` helper first. Add:
- a delete on a session whose attached book is owned by **another user** (session owner ≠ book owner, mode not Off)
  records nothing on that book (no durable rows for the book or its cast members), and the session is still deleted;
- the existing "the session's state survives the session" test still passes (the owner's own book still records).
Call `recordToTimeline(db, sessionId, { reason: "delete" })` directly if driving `sessionsDeleteHandler` with a
foreign book is awkward (that handler may refuse access); say which you did. Any `it`/`test` that opens a DB needs a
60 s timeout (this file sets `vi.setConfig({ testTimeout: 60_000 })` already).

### Docs (only the sentences these changes make untrue)

- `docs/group-sessions.md` line ~68: "**Characters** (active ones, all, or none)". Add, within that sentence, that a
  benched character is out of the turns whichever is picked. Keep it to a clause.
- `docs/stats-and-states.md` line ~216: "Deleting a session records its values onto the world under **Full** and
  **Review changes** (…), and records nothing under **Off**." Add: and nothing on a lorebook someone else owns.
List every new or changed sentence in your report, verbatim, marked 🚧 provisional copy.

## Files owned (the only files you may edit)

- `src/lib/server/pipelines/runtime/bindings.ts` — the `core:task/turn-pool@1` binding and one import line only
- `src/lib/server/pipelines/runtime/turnStrategies.test.ts`
- `src/lib/server/state/durable.ts`, `src/lib/server/state/durable.int.test.ts`
- `docs/group-sessions.md`, `docs/stats-and-states.md` — the two sentences above only

Readable: everything. Out of scope: `runtime/host.ts`, `sockets/*`, `db/schema.ts`, migrations, the SDK repo,
`speakerRotation.ts`, `storyTime.ts`, `clockMoves.ts` (another worker owns those two).

## Rules (quoted)

- No new name, setting, flag, event, table or migration. If you think one is needed, stop and say so in the report.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an overlay): never write
  "no lorebook" in code comments, copy or your report.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You should need no `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` in either repo. Never pipe vitest into `head`.

## Done means

Run only, in a capped scope:

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/turnStrategies.test.ts src/lib/server/pipelines/runtime/bindings.cardless.test.ts src/lib/server/pipelines/runtime/bindings.s4Emit.test.ts src/lib/server/state/durable.int.test.ts"
```

All pass. Then `npx prettier --check` on each file you changed (if prettier reports a file that was already
unformatted before you, say so rather than reformatting the whole file). Report exact pass/fail counts.
