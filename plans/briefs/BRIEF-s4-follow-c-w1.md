# BRIEF — s4-follow-c worker 1 (2026-11-09): your own surfaced book, started on directly

Supervisor: lane `s4-follow-c`. Repo: `/home/jody/github/serene-pub`. Use absolute paths; your cwd resets between shell calls.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*

*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*

*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no SDK build. The owner's `vite dev` runs on :5173, so never run one.)

## The owner's ruling you build (quote, never reinterpret)

Owner, 2026-11-09: **"Own: start on; shared: copy"**. Before that: "If the book is real (surfaced) then it should start on the lorebook. The user should pick to continue the most recently active branch or branch off at a certain point."

So: a **surfaced book** (`lorebooks.surfaced_from_session_id` set, made by **Share as a lorebook**) that the asker **owns** (`lorebooks.user_id` = the asker) is an ordinary book they may start a new session **on**, reading it directly. Picking it, they choose one of two starts:
- **Continue the latest line**: the session reads the book's most recently played line. That is the server's existing default (`mostRecentBranchOf` in `src/lib/server/state/reading.ts`, used by `sessionLinePatch` when the create names no line). The client sends no line.
- **Branch off at a point**: a line plus a story date. The session starts on that line with that clock and `lineOnFirstWrite: true`; on its first write to the book, the existing `ensureSessionLine` (`src/lib/server/lorebooks/sessionLine.ts`) forks a new line from it at the session's date. This is the same machinery a branch session uses (`sessions/branch.ts:150`). No new reading rule.

A surfaced book someone **else** shares with the asker stays copy-only (the `new-world` mode). That keeps pl3 (2026-11-05: "Sharing a lorebook doesn't make it useable, but clone able") for other people's books.

## Files owned (edit only these)

- `src/lib/server/lorebooks/ownBook.ts`: `surfacedBookRefusal` (~l.1068–1087) only.
- `src/lib/server/sockets/sessions.ts`: the `sessions:create` handler only (starts ~l.854). Touch nothing else in this file.
- `src/lib/client/components/sessionForms/StartSessionForm.svelte`: the lorebook list split (~l.715–738), `handleLorebooksList` (~l.231), the surfaced group snippet (~l.2202–2260), the two book lists that render it (~l.2450–2590 and ~l.2740–2820), and `sendCreate` (~l.1386).
- Tests: `src/lib/server/lorebooks/surfacedBooks.int.test.ts`, `src/lib/server/sockets/sessions.creationModes.int.test.ts` (the `a surfaced book (★B-3)` block, ~l.358), `src/lib/client/components/sessionForms/startSessionModes.dom.test.svelte.ts`.
- Docs: `docs/lorebooks.md` (l.174), `docs/sessions.md` (l.20–30 step 6 bullets, and l.54 Next chapter's last sentence).

Readable, never edited: `src/lib/client/components/sessionForms/SessionLorebookReading.svelte` (reuse it as is), `createSession.svelte.ts`, `state/reading.ts`, `lorebooks/sessionLine.ts`, `shared/lorebooks/sessionNotes.ts`.

## Server

1. `surfacedBookRefusal(db, { lorebookId, creationMode, userId })`: add `userId`. Return `null` also when the book's `userId` equals the asker. Keep the rest (null for an ordinary book, `next-chapter`, `new-world`). Update its JSDoc: "a surfaced book is read directly by its owner (owner 2026-11-09, 'Own: start on; shared: copy'), its session's branches and next chapters; anyone else starts on a copy." Pass `userId` from the one caller in `sessions:create` (~l.1016).
2. In `sessions:create`, take `lineOnFirstWrite` off `params.session` by name in the destructure at ~l.1217–1245 (beside `lorebookBranchId: requestedBranchId`), so the bare spread never writes it. Then:
   - Write `lineOnFirstWrite: true` on the inserted row only when it was sent `true` **and** the mode is `new` (absent) **and** the session reads, directly, a book the asker owns: `sessionDataWithoutTags.lorebookId` non-null, no starter kit, not `new-world`, and that book's `userId` is the asker. Read the owner outside the transaction, before it (the handler already does its reads up front).
   - Sent `true` in any other case: refuse with `refuse(...)` (never throw) and this sentence (★ copy, build it): **"Only a lorebook of your own can be branched off at the start. Choose one of yours, or start on its latest line."**
   - Otherwise the row gets `false` (the column default; you may omit it).
   - `requestedBranchId` and the `storyClock*` fields already flow into `sessionLinePatch` (~l.1513); keep that untouched.
3. Inside `db.transaction(async (tx) => …)` use only `tx`. Never add a top-level `await` to `src/lib/server/db/index.ts`.

## Client (`StartSessionForm.svelte`)

Read STYLE-GUIDE §6.4's pick-one list rule (l.1195): "a radio list, not a grid of cards: one row per option — a radio mark, the 15px name, one 13px muted line truncated to the row — and the chosen row in `.sidebar-row-active` (tonal plus the 3px bar, never a fill)". Copy is sentence case and says what happens; help is one sentence.

1. **Own surfaced books become ordinary rows.** `lorebookList` already holds only the asker's own books plus provided ones (`handleLorebooksList`), so every row in `lorebookOptions` with `surfacedFromSessionId != null` is the asker's own. Put them back in `readableBookOptions` (drop the split for them), so they show under **Your lorebooks** in both layouts with the rules line like any book.
2. **The start choice.** When the chosen book (`flow.fields.lorebookId`) is an own surfaced book and `flow.mode === "new"`, unfold under its row (after any **Play it with** block) a `role="radiogroup"` with `aria-labelledby` on a muted heading, two `role="radio"` rows, `data-surfaced-start` on the wrapper and `data-start="continue"` / `data-start="branch-off"` on the rows. Copy (★, build it):
   - heading **How it starts**
   - **Continue the latest line** · *Picks up the line played most recently, where the story stands now.*
   - **Branch off at a point** · *Pick a line and a date. The first time this session writes to the lorebook, a new line forks there.*
   Write it as one snippet rendered in both layouts. "Continue" is chosen by default.
   With **Branch off** chosen, render `<SessionLorebookReading lorebookId={…} bind:branchId={…} bind:clock={…} />` under the radios (its own line and story-clock controls; import it). Hold the draft in component `$state`: the start (`"continue" | "branch-off"`), the line (`number | null`, null is main) and the clock (`StoryClock | null`). Reset all three whenever the chosen book or the mode changes.
3. **Shared surfaced books, copy only.** In `handleLorebooksList`, also keep, in a separate `$state` list, the rows with `isSharedWithMe` true, `surfacedFromSessionId != null` and no `provided`. The existing `surfacedBooksGroup` snippet now lists only these, each row still choosing `new-world` on that book (`chooseSurfacedBook`). Copy (★, build it): heading **Start from a shared session's lorebook**; the note *Someone shared their session's lorebook with you. The new session starts on a copy; theirs stays as it is.*; under each name a muted line *Shared by ‹ownerName›* (the list row carries `ownerName`; leave the line out when it is null). Keep `data-surfaced-books` and `data-book-row`.
4. **The create.** In `sendCreate`, after `flow.payload(finalName)`: when the start choice is showing and **Branch off** is chosen, merge into `payload.session`: `lorebookBranchId` (the line; null is main), `lineOnFirstWrite: true`, and, when a clock is set, `storyClockYear`, `storyClockMonth`, `storyClockDay`, `storyClockHour`, `storyClockMinute` from it. **Continue** adds nothing. Do not edit `createSession.svelte.ts`.
5. Runes rules: never `$state(new Set())` / `new Map()` (use `SvelteSet` / `SvelteMap`); browser code has no `crypto.randomUUID` and no `navigator.clipboard`; `socket.off` always with its handler; no `toaster` / `notify` calls from this view.
6. It is a **session**, never a chat. Every session has a lorebook (its own notes or a shared one): never write copy that says a session has none.

## Docs

- `docs/lorebooks.md` l.174: a lorebook shared from a session is read directly by its owner (who may start a new session on it: continue the latest line, or branch off at a point), by that session's branches and next chapters; anyone else it is shared with starts on a copy (the start screen lists those under *Start from a shared session's lorebook*). Keep the last sentence about older shares.
- `docs/sessions.md`: in step 6's bullets, add one line under **Your lorebooks** for a lorebook you shared from a session (the two starts, in the words above); one bullet for the shared group. In l.54, replace "any other new session starts on a copy of it" with the owner/shared split.

## Tests (Done means: all green)

Server (`sessions.creationModes.int.test.ts`, the surfaced block; DB-opening tests need the existing 60 s timeouts):
- The owner's plain create on their surfaced book now **succeeds**: `lorebookId` is the book, `lorebookBranchId` is `mostRecentBranchOf` of it (the surfacing session's line), `lineOnFirstWrite` false. Replace the old "a plain create on it is refused" test.
- The owner's **branch off**: create with `lorebookBranchId` (make a line first: insert a `lorebook_branches` row for the book, or use main = null), a clock and `lineOnFirstWrite: true` → the row has that line, that clock and the flag. Then call `ensureSessionLine(testDb, newSession.id)` and see a new `lorebook_branches` row forked from that line at that date, the session moved onto it, the flag cleared.
- **Another user's** surfaced book, shared with them (find how a book is shared to a user: `assertReadableBook` in `src/lib/server/utils/ownedBook.ts` names the table): their plain create is refused (today's access-denied throw or the refusal — assert it does not start on the book), their `new-world` starts on a copy.
- `lineOnFirstWrite: true` on a `new-world` start, on a start with no book, and on a book the asker does not own → refused with the sentence above.
- The surfacing session and its branch are unchanged after the owner's two starts (their `lorebookId`, `lorebookBranchId`, `lineOnFirstWrite`).
- Keep the next-chapter, copy and branch tests green.

`surfacedBooks.int.test.ts`: `surfacedBookRefusal` → null for the owner, the sentence for another user; update the existing call sites for the new `userId`.

Client (`startSessionModes.dom.test.svelte.ts`): an own surfaced book lists under **Your lorebooks** and picking it keeps mode `new` and shows the two starts; **Branch off** shows `session-lorebook-reading` and the sent `sessions:create` carries `lineOnFirstWrite: true` and `lorebookBranchId`; **Continue** sends neither; a shared surfaced book lists in the shared group and picking it starts in `new-world`. Look at how the file already mocks the socket and the list replies; `SessionLorebookReading` asks `BookTime` for the book's lines, so answer or stub those the way the file's harness allows.

Run only these, capped, logged into the scratchpad:

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run src/lib/server/lorebooks/surfacedBooks.int.test.ts src/lib/server/sockets/sessions.creationModes.int.test.ts src/lib/client/components/sessionForms/startSessionModes.dom.test.svelte.ts src/lib/server/lorebooks/ownBook.int.test.ts --maxWorkers=2 > $S/s4-follow-c-w1-tests.log 2>&1; echo test-exit=\$? >> $S/s4-follow-c-w1-tests.log"
```

Never pipe vitest into `head`. Then `npx prettier --check` your changed files; `--write` only the lines you changed (never a whole file); if a file fails only on lines you didn't touch, leave it and say so. No tsc/check run: the supervisor runs those.

## Stop and ask (write it in your report and stop that item) when

- anything needs a new column, migration, setting, event or name beyond what is written here;
- `SessionLorebookReading` can't be reused without editing it;
- a test outside your list breaks because of your change.

## Report

Your final message: changed files with one line each; tests run and results (file:passed/failed); the ★ copy as built; anything you decided (name it); **Noticed, not done**.
