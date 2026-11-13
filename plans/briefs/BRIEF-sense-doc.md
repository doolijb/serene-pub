# BRIEF — lane `sense-doc` (wave 3) — docs and the storage page for modders

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then what this lane triggers (named
below). Plan: `plans/PLAN-sensible-engine-2026-11-11.md` (Part 5 is what the owner's go covers). Evidence for each
item: `plans/REVIEW-sensibility-2026-11-11.md`, by row id.

Read down: plan §1.2, §1.3 and §1.5 (the storage model: what is true **today** and what is a target), review
section G, `docs/sessions.md` (Back and Forward; Session data; The session's lorebook; Close out),
`docs/lorebooks.md` ("What a session may write"), `docs/stats-and-states.md`, `docs/system-settings.md`,
`../serene-pub-sdk/guides/storage.md`, NOMENCLATURE §1, §23 (retired words) and §27 (Documentation), the docs' own
style in their neighbours. **This lane changes words only: docs, comments, and the user-facing strings item 7 names. No behaviour.**

## Goal

1. **ST1 — the storage page for modders, true to today.** At the top of `../serene-pub-sdk/guides/storage.md`,
   replace the opening "A plugin can keep two kinds of data" and reconcile the later "The three storages" so the
   page gives one list: the three story homes (Messages, Annex with its `session` and `lorebook` scopes, Lorebook
   including stats) and the two outside the story (your plugin's files, the user annex). Then one table, a column
   per home, with the rows of plan §1.3: swipe or regenerate, Back or delete, Forward, branch, next chapter, session
   deleted, reaches other sessions, who sees it. **Fill each cell with what the code does today**, and name each
   exception in a line under the table (review G2.1's five Back behaviours for a lorebook write; a swipe keeps
   annex writes, clock ticks and scene boundaries; a press-started annex write has no anchor; a stat value on your
   own lorebook is not taken back). Verify each cell against the code before writing it; where you cannot, write
   "to verify" in your report, not in the guide. Lead the page with the story homes; say of files: for hidden state
   only, and anything the story should take back does not belong there.
2. **A11 — defaults the docs get wrong.** `docs/system-settings.md` (about line 66) and `docs/stats-and-states.md`
   (about 214) say lorebook writes default to **Review changes**; the code defaults to **Full**
   (`src/lib/shared/lorebooks/loreWriteMode.ts` about 41).
3. **G2.1 — two sentences that contradict each other.** `docs/sessions.md` (about 243): "Everything that message
   or turn changed goes back with it." `docs/lorebooks.md` (about 216): a value on your own lorebook "is the
   book's, and **Back** doesn't take it", and its claim that Review and Off do not hold the notes back (review G2.3
   found scenes and summaries refused under Off). Make each say what happens.
4. **G2.8 — close-out's triggers.** `docs/sessions.md` (about 356–362) names the action and Archive; the code also
   runs it from **Catch up** and at next-chapter creation (`src/lib/server/sockets/sessionArchive.ts` about 96, 142;
   `sockets/sessions.ts` about 1522–1535). Confirm, then say all of them.
5. **ST10, words only.** Stale statements: the schema comment at `src/lib/server/db/schema.ts` about 2707–2714
   ("retrieval reads the book as of NOW… ruling 4 parks") — the session's line is read now and retrieval is
   line- and date-aware (`src/lib/server/state/reading.ts` about 312, `state/entriesOnReading.ts` about 66); the
   `sessions/coreAnnex.ts` header ("five pieces" while it lists six; "never retracted" about two records Back
   replays); the line-reading comment that values are not cut by session (`src/lib/shared/lorebooks/lineReading.ts`
   about 104–107) against `state/reading.ts` about 583–598. Comments only: not one line of behaviour.

6. **Handed over by lane `sense-eng`.** (a) `src/lib/server/state/durable.ts`'s header comment keeps "No lorebook:
   the session's own notes" and "a session with no world recorded nothing": reword in the own-book vocabulary,
   comment only. (b) A move by an amount now starts the clock on a story that has none
   (`plans/REPORT-sense-eng-2026-11-11.md`, and `plans/REPORT-sense-eng2-2026-11-11.md` for the keeper's path):
   sweep `docs/genre-story.md`, `docs/genre-dungeon-crawler.md`, `docs/genre-lair.md` and `docs/session-actions.md`
   for sentences that still say a move needs a clock, and correct them.

7. **The ledgers the other lanes queued.** You are the one lane that edits `NOMENCLATURE.md` and `STYLE-GUIDE.md`
   for lanes `sense-eng`, `sense-mod`, `sense-lay` and `sense-rin` (read each `plans/REPORT-sense-*-2026-11-11.md`,
   "Queued for other owners" and "New names"). Read NOMENCLATURE §1 and §24 first; add §25 entries and correct the
   rows named; never reintroduce a §23 word. From `sense-lay` also: the two refusal sentences in
   `src/lib/server/pipelines/config/leftoverPicks.ts` (about lines 719 and 756) and the comments and test name
   that still say **Use the pub's** now say **Remove this pick** — string and comment text only, and the one
   test's expected string with it.

8. **From the scope review of `sense-eng`.** `docs/stats-and-states.md` about line 58 says "A session with no
   lorebook doesn't offer it." Every session has a lorebook. Find the condition that really hides that control and
   say that instead.

9. **Names to record from the model set-up lanes** (NOMENCLATURE §25): `fillReplyIfEmpty`, `managedBaseUrl`,
   `noteCoLoadReason`, `coLoadReason`, `coLoadUnmeasured`, `doneHeading`, `replyFilled`, `storyMoveStartOf`, and
   whatever `plans/REPORT-sense-rin2-2026-11-11.md` and `plans/REPORT-sense-mod3-2026-11-11.md` list, with their
   provisional 🚧 copy strings.

10. **From lanes `sense-clk` and `sense-age`** (read `plans/REPORT-sense-clk-2026-11-11.md` and
   `plans/REPORT-sense-age-2026-11-11.md`). Both recorded their own NOMENCLATURE rows; do not redo those.
   (a) `docs/lorebook-time.md` (about 110) and `docs/sessions.md` ("Where the session reads its lorebook",
   "Pipeline settings in a session") say the per-reply tick sits under **The story** below the story clock; the
   code has drawn it on the Reply card since 2026-10-21 (`src/lib/client/components/sessionForms/EditSessionForm.svelte`
   about 3324). Confirm and correct. (b) In the SDK, description and comment text only:
   `../serene-pub-sdk/contracts/src/outlets.ts`, the *Advance story clock* `cause` port's text says "`'tick'` — a
   reply's fixed tick" and should say a reply's or a round's; `contracts/src/tasks.ts`, the `clock-step@1` docblock
   says "Chat's reply" where it is Story's. If either text is inside a hashed descriptor and a golden pin moves,
   stop and report instead of re-pinning.

## Files owned

- `../serene-pub-sdk/guides/storage.md`; `../serene-pub-sdk/contracts/src/outlets.ts` and `contracts/src/tasks.ts`
  (the two texts in item 10 only).
- `docs/sessions.md`, `docs/lorebooks.md`, `docs/stats-and-states.md`, `docs/system-settings.md`, `docs/lorebook-time.md`,
  `docs/genre-story.md`, `docs/genre-dungeon-crawler.md`, `docs/genre-lair.md`, `docs/session-actions.md`.
- `NOMENCLATURE.md` and `STYLE-GUIDE.md` (item 7 only); `src/lib/server/pipelines/config/leftoverPicks.ts` (those two
  sentences and the comments), `src/lib/client/components/pipelines/leftoverPicks.svelte.ts` (a comment),
  `src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts` (a comment, a test name, the expected string).
- **Comment text only** in `src/lib/server/db/schema.ts` (that one comment), `src/lib/server/state/durable.ts` (the header), `src/lib/server/sessions/coreAnnex.ts`
  (the header), `src/lib/shared/lorebooks/lineReading.ts` (that comment). A comment-history check exists in the
  test suite: a comment says what is true now, with no dated narrative of what it used to say.

## Out of scope

Any behaviour; the plan's target model presented as today's; the Genre page Events card; the `scope` value sets;
NOMENCLATURE or STYLE-GUIDE edits beyond item 7.

## Done means

The docs' own guard tests for the files you touched pass (find them: `grep -rln "docs/" src --include=*.test.ts`),
and the SDK's guide checks for `storage.md` (`vocabulary.test`, the guide examples test). Every changed claim is
listed in your report with the file:line of the code that backs it.

## Report

`plans/REPORT-sense-doc-2026-11-11.md`.

**Return the full report as your final message** (the harness refuses a supervisor's write of a report file; the
lead saves it at the path above).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
