# BRIEF — `sense-b1-w3` — every reader sees a session's held change, and only that session; a branch copies them

You are a `lane-worker` for lane `sense-b1` (supervisor: the agent that launched you). Repo
`/home/jody/github/serene-pub`. Use absolute paths. Return your report as your final message (no report file).
Another worker (`w2`) is editing `pipelines/runtime/host.ts`, `state/write.ts` and `annotations/index.ts` at the
same time: **never edit a file outside your list below.**

## The lane in one paragraph

Stage B's thin slice: a pipeline's change to an entry of the session's **attached lorebook** is stored as a
**held amendment** 🚧 — an `entry_amendments` row whose `lorebook_id` is the session's **own book**
(`lorebooks.session_id = the session`), whose `entry_id` is the attached lorebook's entry, with
`source_message_id` (the turn's anchor) and `base` (what the changed fields read when the session wrote).
**A held amendment is exactly a row with `base IS NOT NULL`.** Only the session that holds it reads it; another
session of the same lorebook, and the lorebook's own pages, never do. Apply (a later worker) folds it into the
lorebook. Owner ruling for branches: **"One cut at the fork message."** It is a session, never a chat; every
session has a lorebook.

## Already built (by w1) — read, do not change

- Migration `drizzle/0156_nappy_paladin.sql`: `entry_amendments.source_message_id` (int, no FK), `base` (jsonb),
  `year` nullable (CHECK: undated ⇒ `base` set, no month).
- `src/lib/shared/lorebooks/amendments.ts` / `lineReading.ts`: `Amendment = LineAmendment | HeldAmendment`
  (`held: { anchor }`); `amendmentsOnLine` applies held rows last.
- `src/lib/server/state/reading.ts`: `LineReading.holderBookId`, set by `sessionReadingOf` for a session with an
  attached lorebook. `src/lib/server/state/entriesOnReading.ts`: `entryOverlaysFor(db, book, reading, ids?)`
  adds the holder's held rows whenever `reading.holderBookId` is set, so any reader handed the session's reading
  sees them, and the main reading never does.
- Already excluded by w1: the Amendments list (`sockets/amendments.ts` `buildAmendmentsList`), the story-time
  axis (`state/storyTime.ts`), `heldBy` in `sockets/entries.ts`.

## Goal

1. **The readers through `entryOverlaysFor` (challenger C1).** For each reader below, confirm the reading it hands
   `entryOverlaysFor` / `entriesAsRead` / `entryAt` is the session's own `sessionReadingOf` result (so it carries
   `holderBookId`). Where a reader rebuilds or narrows the reading and drops the holder, fix **only that line** to
   keep it. Then write **one test per reader**: two sessions on one lorebook (each with its own book, which the
   test helpers or `insertOwnBook` make), a held row inserted directly in session A's own book changing entry E
   (e.g. its name, or its content where the reader shows content), and the assertion that A's read shows the
   change, B's read does not, and the lorebook's own read (no session) does not. The readers:
   - **retrieval** — the lore query the host answers (`pipelines/runtime/host.ts` `readBook`, ~4380–4470; read
     only, do not edit host.ts) and `embedding/ragContext.ts` (~538 `context.reading`). Drive it the way the
     existing retrieval int tests do (`src/lib/server/pipelines/runtime/loreReading.int.test.ts`,
     `retrieval.int.test.ts`). Retrieval ranks by the lorebook entry's vector; that is accepted — assert what is
     rendered or matched, not the score;
   - **keyword match** — `pipelines/runtime/loreMatch.ts` (~34, ~50, `findLoreMatch`);
   - **places** — `sockets/sessionPlaces.ts` (~111, ~127) and `placesOnReading` with the session reading;
   - **supply** — `state/supply.ts` (~85–107);
   - **side characters** — `pipelines/entities/sideCharacter.ts` (~161);
   - **graph links** — `utils/graphEntryLinks.ts` (~214);
   - **the entries workspace** — the session's entry list in `sockets/entries.ts` (~1379, the handler that reads
     `sessionReadingOf(db, params.sessionId)`).
   (The names vocabulary is w2's.)
2. **Readers that query by entry id or copy a book exclude held rows explicitly** (`isNull(entryAmendments.base)`):
   - `utils/lorebookEntries.ts` `amendmentPatternLayers` (~636);
   - `lorebooks/imprints.ts` the entry subject's `holds` (~193–219) — only this; the retraction rule must not
     change — so taking back a row a run made is never blocked by another session's held change to it;
   - `lorebooks/tableRegistry.ts` the `entryAmendments` copy (~770) — copying an own book never carries held rows
     (today they were dropped by accident because their entry is not in the copied book; make it explicit, with a
     one-line comment). Purge is unchanged;
   - `utils/forkHistory.ts` the three `entryAmendments` queries (~218, ~348, ~467): a held row is the session's,
     never a line's — exclude it from each, with a one-line comment;
   - `sockets/amendments.ts` the edit and delete lookups by id (~1772, ~1914): a held row is never edited or
     deleted through the lorebook's amendment screen — it answers "That amendment is not in this lorebook." as
     any other id outside the book does.
   Leave `sockets/lorebooks.ts` `countIn` (an overwrite's loss count) and `utils/castTags.ts` (tag rewrite) as they
   are; say in your report what each does with held rows.
3. **A branch** (`lorebooks/ownBook.ts` `copyOwnBookToBranch`, ~677–822, only that function): when the branch reads
   an attached lorebook (`input.created.lorebookId != null`), copy the parent's held amendments
   (`lorebook_id = parent own book AND base IS NOT NULL`) whose `source_message_id` is at or before
   `input.forkMessageId` — moved onto the copied message through `input.remap` (skip one whose message did not
   come across, as entries do) — and those with a null anchor. Into the branch's own book (`made.id`),
   `entryId` unchanged (it is the lorebook's entry), `branchId` null, `base`, `fields` and date as they are.
   Update the function's doc comment in one or two sentences. Confirm whether `sessions/branch.ts` needs any
   change (it already calls this function); change it only if it must.

## Files owned

- The reader lines named in Goal 1 (only where a reading drops the holder) and Goal 2: `state/supply.ts`,
  `embedding/ragContext.ts`, `pipelines/runtime/loreMatch.ts`, `sockets/sessionPlaces.ts`,
  `pipelines/entities/sideCharacter.ts`, `utils/graphEntryLinks.ts`, `sockets/entries.ts`,
  `utils/lorebookEntries.ts`, `lorebooks/imprints.ts` (`holds` only), `lorebooks/tableRegistry.ts`,
  `utils/forkHistory.ts`, `sockets/amendments.ts` (the two lookups only), `lorebooks/ownBook.ts`
  (`copyOwnBookToBranch` only), `sessions/branch.ts` (only if it must). All under `src/lib/server/`.
- Tests: one new file `src/lib/server/state/heldAmendments.readers.int.test.ts` for Goal 1 and Goal 2 (split into
  two or three files if one grows past ~600 lines), and new `src/lib/server/sessions/branch.heldAmendments.int.test.ts`
  for Goal 3. You may extend an existing test file beside a reader instead, if that is the established pattern.

## Files readable

Anything. Useful: `src/lib/server/utils/testDb.ts`, `src/lib/server/state/entriesOnReading.int.test.ts` (w1's
held-amendment block shows how to build two sessions and a held row), `src/lib/server/sessions/branch.asOfFork.int.test.ts`
and `branch.ancestry.int.test.ts` (how a test makes a branch), `src/lib/server/lorebooks/ownBook.ts`.

## Out of scope

`host.ts`, `state/write.ts`, `annotations/*` (w2's); Apply, the "This session only" list, take-back, settle, docs,
NOMENCLATURE, the SDK, any socket payload; links, members, values, scenes, new entries.

## Stop and ask (in your report, then stop) when

- a reader cannot get the session's reading without a signature change that ripples past the files above —
  report the call sites, do not thread a global;
- a held change is visible to another session or to the lorebook's own reading and you cannot close it inside your
  files;
- you need a new exported name (name it and why);
- an existing test fails for a reason you did not cause (report it verbatim; do not fix other people's code).

## Done means

- One passing test per reader in Goal 1 (A sees, B does not, the lorebook's own read does not), and one per
  exclusion in Goal 2 (`amendmentPatternLayers` ignores a held row; a made entry another session holds a change to
  is still taken back by its run's retraction; copying an own book carries no held row; the fork-history queries
  ignore one; the amendment edit/delete refuse a held row's id).
- `branch.heldAmendments.int.test.ts`: a branch cut before the turn that held the change does not see it; a branch
  cut at or after it does (and its copy's anchor is the branch's copied message); the parent's held row is
  untouched.
- The existing suites of every file you touched still pass (find them beside each file: e.g.
  `ownBook.branchNotes.int.test.ts`, `ownBook.int.test.ts`, `branch.*.int.test.ts`, `imprints.int.test.ts`,
  `tableRegistry.copyInto.int.test.ts`, `supply`, `sessionPlaces`, `graphEntryLinks`, `loreMatch` tests).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean for your files (report others' errors
  verbatim without fixing them; w2 is mid-edit, so an error in host.ts, write.ts or annotations is theirs).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not need `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never
  `kill -9` anything. Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite.
  It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- No migration in this task. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- **No reference to any other project or product** in code, comments, tests or docs.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Never run the
  whole suite. `npx prettier --check <file>` on each file you changed (the repo is not prettier-clean to start
  with: report only what your edits introduced). Do not start a dev server.
- Other sessions are editing this repo (a visual-novel layout lane, speech). Do not touch their files and do not
  "fix" failures that are theirs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything; line numbers have drifted.
- NOMENCLATURE R3: "held amendment", never bare "held" in a name. ⚠ "held" is already used elsewhere (a ruleset's
  *held entry*, a change *held for review*); never reuse those names.

## Report (your final message)

For each reader: file:line, what it reads, whether it already carried the holder or what you changed, and the
test that proves it. For each exclusion: file:line and the test. The branch copy and its tests. Changed files;
tests run with pass/fail counts; anything that stopped you; **Noticed, not done**.
