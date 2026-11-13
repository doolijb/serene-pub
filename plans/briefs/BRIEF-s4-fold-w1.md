# BRIEF — s4-fold worker 1 — own notes read on the session's own line and moment (★bk-fold-1) — 2026-11-08

Supervisor: lane `s4-fold` (brief `plans/briefs/BRIEF-s4-fold.md`). You are a lane-worker; you cannot spawn agents.

## Goal

Owner ruling ★bk-fold-1 (2026-11-08): **"a session on its own notes reads them on its own line and moment (like any book; the fold carries the session's line and clock over)."**

Background. Every session has its own notes book (the **own book**: `lorebooks.session_id = sessionId`; `lorebooks/ownBook.ts` `ownBookOf`, `lorebooksReadBy` ~306 → `{ attachedId, ownBookId, ids }`). A session may also read an **attached** (shared) book (`sessions.lorebook_id`). Owner ruling ★27-10 (2026-11-05): _"All sessions have a lorebook, [own book] or overlay."_ — never write code or comments that frame a session as having "no lorebook"; say *own book* / *own notes* / *attached book*.

Today `state/reading.ts` `sessionReadingOf` (~307) returns the reading on the **attached** book (line `sessions.lorebook_branch_id`, moment = the session's clock `momentOf(session)` else the line's present `linePresentOf`, fork cut, session cuts for branch sessions), and **null** when `lorebook_id` is null; union readers then read the own book separately at `MAIN_HEAD` (`state/entriesOnReading.ts:52`: main line, head). A coming feature (the fold, next worker) copies a shared book with all its lines into the own book and sets `lorebook_id = null`, `lorebook_branch_id` = the copied line on the own book — after which a MAIN_HEAD read of the own book would not see the session's line at all.

**The design (decided by the supervisor — "option A"):**

1. **`sessionReadingOf` answers for the own book** when `lorebook_id` is null and the session has an own book: `{ lorebookId: ownBookId, branchId, moment, forkedAt, line (+ sessionCuts), onOwnBook: true }` — built exactly as for an attached book (`readingOf(db, ownBookId, { branch: lorebook_branch_id ?? "main", moment: own clock })`, `linePresentOf(db, ownBookId, branchId)` when the session has no clock, session cuts via `cutsOfAncestry`, a stale branch id → main as the existing `BranchRefusal` catch does). Add the field 🚧 `onOwnBook?: true` to `LineReading` (one JSDoc sentence: "Set when the reading is of the session's own notes, which the session reads alone (no attached book)."). A session with an attached book: unchanged (no `onOwnBook`). A session with neither (never in production; some test helpers make one): null as today. Rewrite the comment block at ~320–323 ("A session with none has its own book alone, which every union reader adds itself… read it twice (pr-6 B review)") to state the new rule: with an attached book the reading is the attached book's and union readers add the notes at main's head; with none, the reading IS the own book's and union readers must not add it again.
2. **Union readers read the own book at the session reading when it is `onOwnBook`, never twice:**

| Site | Change |
|---|---|
| `lorebooks/ownBook.ts` `sessionEntriesAsRead` ~1084–1101 | own book at `books.attachedId == null ? (reading ?? MAIN_HEAD) : MAIN_HEAD` (read `sessionReadingOf` once); entries stay marked `sessionOnly`. Update its JSDoc ("then its own notes' at their head (the notes are never branched as a book)" is no longer true for a session that reads its notes alone). |
| `cast/memberAsRead.ts` `readingAndChainOf` ~483–503 | now gets the own reading; keep the fallback for a null reading. |
| `cast/memberAsRead.ts` `pickVersions` ~522–551 | the book the reading is of (`reading.lorebookId` when `onOwnBook`) reads **along the line** (`onLine`), not `onBookMain`; the other chain books (ancestors' notes) keep `onBookMain`. Keep `chain` for overlay inclusion and `overlayDepth`. |
| `state/resolve.ts` ~797 | `const reading = await sessionReadingOf(db, sessionId)` (drop the `lorebookId ?` guard) so `links.reading` is set for an own-book session and `valueRows`/`configRows` (~1204/~1233) filter on it. Check every consumer of `links.reading` in resolve.ts and its callers that reach an attached book is guarded by `links.lorebookId` (the audit says supply:149, durable:206/445, sockets/state:1116 are). |
| `state/resolve.ts` ~843 | own-book places at `lorebookId ? MAIN_HEAD : (reading ?? MAIN_HEAD)`. |
| `state/durable.ts` ~362 (`recordOwnBookOwners`) | own-book places at `links.lorebookId ? MAIN_HEAD : (links.reading ?? MAIN_HEAD)`. Do **not** change ~205–210 (write routing). |
| `state/write.ts` ~1481–1493 | the own book reads at the session reading when `onOwnBook` (`ownAt`), else MAIN_HEAD; use `ownAt` in `readingOf` and in `onHead: entryOnLineSql(ownAt)`. |
| `state/write.ts` ~1849–1861 | skip the MAIN_HEAD fallback re-check of the own book when the first check already read it (`reading?.onOwnBook`). |
| `state/statTrail.ts` ~411 | **would break otherwise:** take the durable branch (`lorebookLinks` / `durableOwnerFor` / `statTrailFor`) only when the reading is of an attached book (`!reading.onOwnBook`); an own-book session keeps the session layer as today, passing `reading?.line` where it already does. |
| `sockets/state.ts` ~1123 | own-book places at `links.lorebookId ? MAIN_HEAD : (links.reading ?? MAIN_HEAD)`. |
| `sockets/state.ts` ~1321 | `(await sessionReadingOf(db, sessionId)) ?? MAIN_HEAD` for the own book (reached only with no attached book). |
| `sockets/sessionPlaces.ts` ~96 | **would break otherwise** (the own book read as "book" and again as `sessionOnly`): `const shared = read && !read.onOwnBook ? read : null` for the book reads; the own reads (`ownBookPlaces` ~283, far entries ~177) take `ownAt = read?.onOwnBook ? read : MAIN_HEAD` (reorder so the reading is known first). |
| `utils/graphEntryLinks.ts` ~111 | own book at the session reading when the session has no attached book. |
| `embedding/ragContext.ts` ~118 | `reading: await sessionReadingOf(db, sessionId)` (drop the `lorebookId ?` guard) so ~537 reads the own book on it; check `allLorebookIds` is `[own]` in that case and nothing reads it twice. |
| `sessions/rowProjection.ts` `seatMembersAsReadForSessions` `groupKeyOf` ~518 | an own-book session shares the one Main group (`null`) **only** when its reading is main at the head with no cuts (no `lorebook_branch_id`, no moment); otherwise it gets its own group (`sessionId`). Update the JSDoc ~404–414. |

`state/presencesOnReading.ts` ~68, `state/storyTime.ts`, `sockets/entries.ts`, `messages/writes.ts`, `sessions/settle.ts`, `sprites/choices.ts`, `utils/graphContextFormatter.ts`, `state/write.ts` ~449 / ~3190 become right with no edit (the audit) — **do not edit them**; if a test shows one is wrong, stop and say so in your report.

**Do not touch** `src/lib/server/pipelines/runtime/host.ts` (another lane owns it; its sites ~4197 and ~4874 are queued by the supervisor). Do not change any write routing (`durable.ts` ~205, `characters/versions.ts`, `sessions/branch.ts`, `sockets/sessions.ts`).

Why nothing changes for today's sessions: nothing writes `lorebook_branch_id` for a session whose `lorebook_id` is null (create clears it; `ensureSessionLine` acts only when attached; branch copies the parent's null), so today's own-book sessions read their own **main** — the same as MAIN_HEAD **except** when the session (or its own book) has a clock: then dated notes rows after the clock stop showing. That is the ruling's intent; the tests pin it.

## Tests (Done means)

New `src/lib/server/state/ownNotesReading.int.test.ts` (60 s timeouts for DB work inside `it`):
- **Today's own-book session reads the same:** an own-book session (own book with undated and dated entries, a member with versions, a place, world/cast values) with no clock — `sessionReadingOf` is the own book on main at the head with `onOwnBook: true`; `sessionEntriesAsRead`, `membersAsRead` (with `sessionId`), the places read (`sockets/sessionPlaces.ts` / `resolve.ts` path you can reach), and the resolved values equal what MAIN_HEAD gave (assert against explicit expected rows, not against the new code).
- **The rare case:** the same session with a session clock earlier than a dated notes entry, a dated member version (e.g. "deceased" dated after the clock) and a dated place value — they are hidden now; undated rows still show. Also the own book's clock with no session clock.
- **A session on a line of its own book** (the fold's shape): own book with a branch `B` (a `lorebook_branches` row of the own book, forked from main at a date), rows on `B` and on main after the fork date; set `sessions.lorebook_branch_id = B` directly. Entries, members, places and values read `B` and main up to the fork cut, not main's later rows; a stale `lorebook_branch_id` reads main.
- **Attached session unchanged:** a session with an attached book reads its notes at main's head as before (no `onOwnBook`; notes entries `sessionOnly`), nothing read twice.
- **Not read twice:** an own-book session's `sessionEntriesAsRead` and session places list each own entry/room once.
- **Stat trail:** an own-book session's `sessionStatTrail` still answers from the session layer.
- Then run the existing tests of every file you touched (find them: `ls src/lib/server/state/*reading* src/lib/server/state/resolve* src/lib/server/state/durable* src/lib/server/state/statTrail* src/lib/server/state/write* src/lib/server/cast/memberAsRead* src/lib/server/lorebooks/ownBook* src/lib/server/sockets/sessionPlaces* src/lib/server/sockets/state* src/lib/server/utils/graphEntryLinks* src/lib/server/embedding/ragContext* src/lib/server/sessions/rowProjection*` and any `*.int.test.ts` that imports `sessionEntriesAsRead` or `membersAsRead` — `grep -rl`). A pre-existing failure you did not cause: confirm it fails the same way without your change by reading the assertion, and list it; don't fix it.
- tsc: no new errors.

## Files owned

`src/lib/server/state/reading.ts`, `src/lib/server/cast/memberAsRead.ts`, `src/lib/server/lorebooks/ownBook.ts` (`sessionEntriesAsRead` only), `src/lib/server/state/resolve.ts` (~797 and ~843 only), `src/lib/server/state/durable.ts` (~362 only), `src/lib/server/state/write.ts` (~1481–1493 and ~1849–1861 only), `src/lib/server/state/statTrail.ts` (~411 only), `src/lib/server/sockets/state.ts` (~1123, ~1321 only), `src/lib/server/sockets/sessionPlaces.ts`, `src/lib/server/utils/graphEntryLinks.ts` (~103–111 only), `src/lib/server/embedding/ragContext.ts` (~118 only), `src/lib/server/sessions/rowProjection.ts` (`groupKeyOf` + its JSDoc only), the new test file, and fixture/assertion fixes in existing tests of these files **only** where they assert the old MAIN_HEAD behaviour for the rare case (say which, and why).

## Files readable

Everything. Useful: `src/lib/shared/lorebooks/lineReading.ts` (`rowReadsOnLine`, `lineOf`), `src/lib/server/state/lineSql.ts` (`onLineAtSql`), `src/lib/server/state/entriesOnReading.ts`, `src/lib/server/lorebooks/sessionLine.ts`, `src/lib/server/utils/testDb.ts`, and existing int tests of these files for fixtures (`lorebook_branches` rows, dated history entries, `insertCastMember` from `characters/versions.ts`).

## Out of scope

Writes (where an own-book write lands), branching a session, the fold, `host.ts`, the story clock socket, NOMENCLATURE (queue rows in your report), docs.

## Rules you must follow (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." · "Never add a top-level `await` to `src/lib/server/db/index.ts`." · "It is a **session**, never a *chat*."
- Memory rule "There is ALWAYS a lorebook": never frame a session as having no lorebook; say own book / own notes.
- NOMENCLATURE R1 one word one meaning, R3 qualify never the bare noun, R6 mark provisional 🚧. The only new name you may add is `LineReading.onOwnBook` 🚧.
- P1 "Deterministic, never hidden. … Same inputs, same result."
- Comment style: plain present-tense sentences; no "previously / used to / changed from" history comments (a comment-history ratchet test fails on them).

## Commands

- Tests, capped and logged (never pipe vitest into `head`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w1-tests.log'`
- tsc: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && npx tsc --noEmit -p . > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w1-tsc.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w1-tsc.log'` — another lane edits other files; report errors in your files only (baseline before your edits: 2 errors, one at `src/lib/client/stores/runProgress.svelte.ts:120`).

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Prettier: run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.

## Report

Final message (no report file): changed files with the hunks' line ranges; tests run with counts (new + existing); tsc for your files; any site from the table you did not change, or changed differently, and why; any site outside the table you found reading the own book at main's head (list, don't fix); **Noticed, not done**; NOMENCLATURE row to queue (`LineReading.onOwnBook` 🚧 and the own-notes reading rule).
