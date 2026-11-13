# BRIEF — `s4-verify-w1` (worker of lane s4-verify) — the branch gap test, the queued schema type, docs and canon lines — 2026-11-08

Repo `/home/jody/github/serene-pub` (SDK in `../serene-pub-sdk` — do not touch it). Supervisor: lane `s4-verify`. Use absolute paths; your cwd resets between shell calls.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Background (read, don't re-derive)

Lane s4-last made branching a session that reads its **own notes** alone copy the notes' durable rows into the branch's notes: `src/lib/server/lorebooks/ownBook.ts` private `copyNotesStatsAndLinks` (~835), called from `copyOwnBookToBranch` (~693). It copies a **cast member's** value rows only from the copied line chain (`inArray(t.branchId, lineIds)`), never the member's rows on the notes' **main** (no line, no session) — its comment says "main's are read by both sessions". The branch reads the *same* member (members are not copied). Whether the branch really reads those main rows the way the parent does is unchecked. What I suspect (verify, don't trust): `state/reading.ts` `loadEntryDates` (~500) dates a row's `historyEntryId` only by entries of `reading.lorebookId` — the branch's reading is on the branch's own notes book, so a parent member row dated by a history entry of the parent's notes reads **undated** in the branch, and `datedOnReading` / `inForce` (`state/resolve.ts` ~534) then cut and order differently than in the parent.

## Goal A — the gap test (write it, run it, report; **do not fix anything**)

Add a new `describe` to `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts` (reuse its `setup`, `member`, `put`, `read`, `ownBookOfSession` helpers and the HP slot declaration pattern of the existing test; keep the file's 60 s `vi.setConfig`). Title: "a member's value on the notes' main reads the same in the branch at the fork". Three plain `test`s (not `test.fails`), each: build, read in the parent, `branchSession` at the last message before an extra message, read in the branch, read in the parent again. Assert parent-before = branch = parent-after for every value:

1. **Parent on its notes' main** (`setup({ line: false })`, clock Year 15). Member M: write a main row dated `mainFifteen` (value 4) **first**, then a main row dated `mainFive` (value 3) — the later *date* must win (4), not the later id. Member N: one undated main row (value 6).
2. **Parent on a line of its notes** (`setup({ line: true })`; the line forks at Year 10). Member M: main row dated `mainFive` (3), then main row dated `mainFifteen` (4) — main after the fork is cut on the line, so the parent reads 3. Member N: undated main row (6).
3. **Parent at an early moment** (`setup({ line: false, clock: { year: 3 } })`): member M has one main row dated `mainFive` (3) only — the parent reads the slot default (10). The branch must read 10 too, and the parent must still read 10 after branching.

A "main row" = `put("cast_member", m.id, HP, v, { historyEntryId })` with no `branchId`, no `sessionId`, no `validFromMessageId`. Read with `read(sessionId, { kind: "cast_member", id: m.id }, HP)`.

Report for each test: pass/fail and the actual values read (parent before, branch, parent after). If a test fails, **leave it failing** (plain `test`), don't loosen it, don't touch `ownBook.ts` or `reading.ts` — the supervisor decides the fix.

## Goal B — the queued schema type and the guard

1. `src/lib/server/db/schema.ts` ~2850: widen `branchAncestry`'s `$type` to `{ sessionId: number; mark: number; lineId?: number }[] | null` (type only; touch nothing else). Add one JSDoc sentence to the column's existing comment: "🚧 `lineId` — the line the ancestor read its own notes on at the fork, set only when it read them alone on a line; missing reads main (★s4-fold2-1)."
2. Confirm no migration: `SERENE_PUB_DATA_DIR=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-gen-data npx drizzle-kit generate --config ./src/lib/server/db/drizzle.config.ts --name s4_verify_check` from the repo root (mkdir the dir first). Expected output: no schema changes. **If it writes any migration file, stop: do not delete it, do not edit `drizzle/meta/_journal.json`; report the file names and the drizzle output.** Run `git status --short drizzle/` before and after and report both.
3. `src/lib/server/cast/memberAsRead.ts` `ancestorLinesOf` (~541–544): drop the local cast now the stored type carries `lineId` — the filter becomes a plain type predicate on `a.lineId != null`. Keep behaviour identical. `src/lib/server/state/reading.ts` ~235 has a private `BranchAncestry` type widened by hand: leave it (it accepts `null` too) unless it no longer compiles.
4. Typecheck only the touched files' consumers through the targeted tests below (the supervisor runs the full tsc later).

## Goal C — docs and canon lines (exact text; ★ copy — the supervisor flags it)

1. `docs/lorebooks.md` ~237, in the **Merge ‹book› into these notes** bullet, replace "and a **Branch from here** of it keeps that line, with its entries, in the branch's notes." with "and a **Branch from here** of it keeps that line, with its entries, values and the links between its entries, in the branch's notes, and reads its people as the session did."
2. `docs/session-actions.md` "### What a branch copies" table (~129–141): add two rows to the table, after the "the active cast, envoys, …" row:
   - `| characters and player seats with no character card, each still played by whoever seated it | |`
   - `| for a session whose lorebook is its own notes: the line it reads with its entries, and the notes' values, sheets and the links between their entries, as they stood at the fork | in a session's own notes, the links between its people and its entries |`
   Keep the table's existing column layout (leading/trailing pipes, one space padding).
3. `NOMENCLATURE.md` (lane s4-verify holds it):
   - Row at ~3336 (starts `| a session branch read its parent's later turns on a shared line`): in its middle cell replace "`sessions.branch_ancestry jsonb` (`[{sessionId, mark}]`, nearest first;" with "`sessions.branch_ancestry jsonb` (`[{sessionId, mark, lineId?}]`, nearest first; 🚧 optional `lineId` — the line the ancestor read its own notes on at the fork, written only when it read them alone on a line, a missing one reading main, no boot pass (★s4-fold2-1, lane s4-last);"; in its last cell append "; `lineId` lane s4-last 2026-11-08".
   - Row at ~3354 (starts `| a branch copied its parent's lines with no record`): at the end of its middle cell (before the ` | §32 §5, §33.2; lane cv-time. |` cell) append: " **Lane s4-last (2026-11-08):** a live seat is kept when it holds a card, an envoy **or a cast member** — a card-less character or player seat is seated again through `seatCast` / `seatPlayer` with `castMemberId`, keeping its seater, and a refusal throws `BranchError` rather than dropping a person (★s4-fold2-3); the parent's ancestry entry carries `lineId` and a member read in the branch reads each ancestor's notes along it (`cast/memberAsRead.ts`, ★s4-fold2-1); a parent reading its notes alone also has the notes' stat values, configs and sheets and their entry–entry links on main and the copied line copied into the branch's notes (private `copyNotesStatsAndLinks`, `lorebooks/ownBook.ts`; links with a member at either end stay with the parent's notes, ★s4-last-1; ★s4-fold2-2)." and in its last cell append "; lane s4-last".
   - Append at the very end of the file (after the `lane s4-fold2` bullet, same format): `- **2026-11-08 (lane s4-last; ★s4-fold2-1…4, built as recommended):** a branch keeps card-less character and player seats with their seater (★s4-fold2-3); 🚧 optional \`lineId\` on a \`branch_ancestry\` entry, so a branch reads an ancestor's people on the line it played (★s4-fold2-1); a branch of a session on its own notes copies the notes' values, configs, sheets and entry–entry links (★s4-fold2-2); the edit form shows **Line** and **Story clock** for a session's own notes when they have lines (★s4-fold2-4). Rows edited: \`sessions.branch_ancestry\`, \`branchSession\`. No other new names (private helpers only). Merged by lane s4-verify.` (unescape the backticks).
4. `npm run docs:build` from the repo root (regenerates `src/lib/generated/docs/**`); report its exit and output tail.

## Rules you depend on (quoted)

- CLAUDE.md: "Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest applied or it is *silently skipped*." · "Inside `db.transaction(async (tx) => …)` use only `tx`." · "It is a **session**, never a *chat*."
- Memory rule: never write copy that frames a session as having no lorebook — say own notes / overlay.
- NOMENCLATURE R1 one word, one meaning; R3 qualify, never the bare noun. Mark new names 🚧.
- An int test that opens a DB inside an `it` needs a 60 s timeout. **Never pipe vitest into `head`.**
- Tests run only in a capped scope, logged:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w1-tests.log'`
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so. (Skip prettier for `NOMENCLATURE.md` and docs.)
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo.

## Files owned

`src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts` (new describe only), `src/lib/server/db/schema.ts` (the one `$type` + its comment sentence), `src/lib/server/cast/memberAsRead.ts` (`ancestorLinesOf` guard only), `docs/lorebooks.md` and `docs/session-actions.md` (the lines above), `NOMENCLATURE.md` (the three edits above), `src/lib/generated/docs/**` (by docs:build). Nothing else. Another Claude session owns image-generation files — never touch them.

## Done means

Targeted run green except Goal A tests that fail on the gap: `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts`, `src/lib/server/cast/memberAsRead.ancestryLine.int.test.ts`, `src/lib/server/lorebooks/foldInParent.int.test.ts`, and every `src/lib/server/sessions/branch*.int.test.ts` (list them with `ls`). Report exact pass/fail counts per file.

## Stop and ask when

drizzle writes a migration; any edit seems to need a file outside the list; a test outside Goal A fails.

## Report

Your final message (no report file): changed files; Goal A per-test results with values; drizzle output + `git status` before/after; test counts; prettier results; anything noticed (under **Noticed, not done**).
