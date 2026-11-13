# BRIEF — build lane `sense-b4`, worker 4 — the Lair's tests to the new rule; the room flows checked

You are a `lane-worker`. Supervisor: build lane `sense-b4` (`plans/briefs/BRIEF-sense-b4.md`, readable for
context; this brief is your contract). Words: a **build lane** is this stream of work; a **channel** is a
session's message channel (the Lair's Sanctum is a channel). Never write bare "lane" for a channel.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What is built (do not change production code)

**The rule (owner-ruled):** for a session that reads an attached lorebook **and whose scenes end by themselves**
(the scenes routine runs and the scene mode is Automatic — the Lair, Story Living/Rule Based and the Dungeon
Crawler register it), a **pipeline's** new entry, place, history day or link goes to the session's **own book**
(`lorebooks.session_id` = the session; "Session notes" in the interface) whatever the lorebook's write setting,
Full included. It is read by that session (its reading is the two books: `lorebooksReadBy`,
`sessionEntriesAsRead`, the places reader), by nobody else, and reaches the lorebook only by **Apply**, which runs
by itself when a scene closes (`closeScene` → `applyHeldAutomatically`) if the session's owner owns the lorebook
and its write setting is Full. The predicate is `scenesEndByThemselves` in `src/lib/server/lorebooks/ownBook.ts`.
Every other session writes exactly as before.

## The failures to resolve (supervisor's run after the change; 18 failed, before the change all passed)

- `src/lib/server/sockets/sessions.lairKnock.int.test.ts` — 12 cases, e.g. `roomsNamed(w.lorebookId, "The Drowned
  Hall")` finds nothing (~442, ~483); `knockLinks(w.lorebookId)` is empty (~873).
- `src/lib/server/sockets/sessions.lairWalk.int.test.ts` — "the knock: a drafted room …" and "a typed room's Exits
  line becomes links on save (D10)" (~614 reads the room from `lorebookId`).
- `src/lib/server/sockets/sessions.lairFileRoom.int.test.ts` — 4 cases, `rooms(w.lorebookId)` count (~357).

## Build

1. **For each failing case, decide which it is, with evidence:**
   - **(a) the test reads the lorebook where the row now is in the own book** — rewrite the expectation to the new
     rule, never weaker: the room / link is in the session's **own book** (`ownBookOf(db, sessionId)`), the session
     reads it, and the lorebook does not hold it yet. Keep every other assertion of the case (typed fields, review
     gate, verbatim content, one link both ways, nothing stacked, planner hint) exactly as strong. Prefer changing
     the helper (`rooms`, `roomsNamed`, `knockLinks`) to read the session's two books, or the own book, over
     editing each case.
   - **(b) a Lair flow itself fails** because a row it just wrote is not where it looks (the planner does not read
     the new room, a link to the party's room is not written, the map or places list does not show it, the review
     gate's approve writes nowhere, "File as a room" cannot find the row). **Do not change production code.** Stop
     work on that case and report: the flow, the file:line where it looks only in the lorebook, and the smallest
     fix you see.
2. In **each of the three files**, add one case that proves the rest of the new rule for the Lair: after a room is
   filed this way, closing the scene the turn is in (`openScene`/`closeScene`, or the path
   `src/lib/server/scenes/liveScenes.autoApply.int.test.ts` uses) puts the room (and its links) **in the lorebook**.
   One such case per file is enough; if a file has no natural place for it, put it only in `lairKnock`.
3. **Item 6 check — report, do not fix:** a place written this turn is usable at once by the same session. Using
   these suites (and reading code where a suite does not reach), say for each yes / no / not reached with the
   file:line that shows it: the places list (`session places` reader), the map, the Lair's room flows (knock, walk,
   file the current room), retrieval, keyword match, the names list, and a place's stat values written by the same
   run finding the place (`state/write.ts`'s place lookup — read only).
4. **Run unchanged** (they must pass; a failure is reported with its cause, not "fixed" unless it is case (a) in a
   test file — then say so): every other `src/lib/server/sockets/sessions.lair*.int.test.ts` and every
   `src/lib/server/sockets/sessions.dungeonCrawler*.int.test.ts`. Run them in batches of at most 6 files per command.
   A Dungeon Crawler failure of kind (a) may be rewritten the same way; kind (b) is reported.

## Run

Only inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
These suites are slow (bootstrap, 30 s cases): give the command a long timeout. Never pipe vitest into `head`;
redirect to a log file in `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/`
named `sense-b4-w4-*.log` and grep it. `npx prettier --check` on each file you changed (if a file already failed
before your edit, say so; never `--write` a file you did not otherwise change, never a directory).

## Files owned (edit only these)

The three Lair test files above, and — only for a kind (a) rewrite — another `sessions.lair*` or
`sessions.dungeonCrawler*` int test that fails for that reason. **No production file.**

## Out of scope

Every production file; host-level tests (another worker); docs; stat values, cast members, scenes code.

## Stop and ask (in your report) when

Any kind (b) case; a failure you cannot classify; a suite fails for a reason that is not this build lane's (another
session's work — speech, a visual-novel layout): report it as theirs with the error, do not touch it.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — and in this build lane: **do not run `npm run sdk:build` at all.**
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. Inside `db.transaction(async (tx) => …)` use only `tx`. Never run npm at the SDK repo root. It is a
  **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Other sessions are editing this repo: never touch their files, never "fix" failures that are theirs.

## Report (your final message)

Per failing case: kind (a) or (b), with evidence, and what you changed; the new cases; item 6's answers with
file:line; every file run with pass/fail counts; failures that are not this build lane's; **Noticed, not done**.
