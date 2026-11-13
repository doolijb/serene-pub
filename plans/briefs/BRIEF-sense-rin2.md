# BRIEF — lane `sense-rin2` — four fixes from the scope review of `sense-rin`

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-sense-rin-2026-11-11.md`, `plans/briefs/BRIEF-sense-rin.md` (the goal these fixes serve),
NOMENCLATURE §1, §24 and the row for **verdict** (about line 163) and **decision** (§7), and
`src/lib/server/pipelines/ranking/keywordQuery.ts` about 558–580 (the order the server skips an entry in).
A scope reviewer read lane `sense-rin`'s code and found four things. All four are accepted. Re-read each cited line
before changing it.

## Goal

1. **The tab must name the gate that actually stopped the entry.**
   - `src/lib/client/lorebooks/editor/signals.ts` about 119 checks the **base row's** Off first, and
     `src/lib/client/components/lorebookForms/EntryFireTest.svelte` about 274 no longer passes
     `marksHere ? !marksHere.off : enabled`. An amendment can decide `enabled` either way at a session's reading
     (`src/lib/server/sockets/entries.ts` about 1260–1270), so an entry whose base row is off but which is **on** as
     this session reads it now reports "it is switched off" for any other "no". Decide Off from the reading when
     the reading is known: off in the base row and not switched on by the reading → switched off; on in the base
     row and off in the reading → off for a while.
   - The server skips **archived before disabled**; the client checks off before archived (about 119–120). Use the
     server's order.
   - `signals.ts` about 123 turns `reading === null` into "not on this session's line, or dated after its clock".
     `src/lib/client/lorebooks/editor/teachMarks.ts` about 87–92 says null also means archived there, or a book that
     is not the asker's. Say only what null can mean, or treat it as the honest catch-all, and list in your report
     what null covers.
2. **The new name `verdict` clashes with a ruled term.** NOMENCLATURE rules **verdict** as the function that judges
   a rule, "⚠ Not a decision (§7, selection's answer on a candidate)". The lane renamed the sentence field
   `reason` → `verdict` (`readIn.ts` about 38, `signals.ts` about 48) and added `skipVerdict` and `storeVerdict`:
   these are selection's answer on a candidate, which the canon calls a **decision**. Rename the three to the
   canon's word (for example `decisionLine`, `skipDecisionLine`, `storeDecisionLine`; grep first, §24), keep
   `reason` for the code and `why` for the stored sentence, and list the names for §25 in your report. Do not
   rename the existing wire field `RetrievalRow.verdict`: report it as noticed.
3. **Stop parsing server prose.** `readIn.ts` (about 59 and 93–100) recovers a skipped row's raw reason by stripping
   "Never reached the ranker — ", a string copied from `src/lib/server/sockets/pipelines.ts` about 4676, and the
   test copies the same template. Add the raw reason to the skipped `RetrievalRow` in **that one handler**
   (`pipelines.ts` about 4667–4678) and in its type, and read it directly. The verdict sentence stays as it is.
4. **One mapping for one skipped row.** `readIn.ts` about 116 maps the "entry is disabled" skip to "it is switched
   off" on the line; `signals.ts` about 121–122 maps the same skip, with the base row on, to "it is off for a
   while at this point in the story" in the tab. Share one mapping (pass the base row's state where the line can
   know it; where it cannot, say which sentence the line uses and why).

## Files owned

`src/lib/client/lorebooks/editor/readIn.ts`, `editor/signals.ts`, their tests,
`src/lib/client/components/lorebookForms/EntryFireTest.svelte` (the one call), the skipped-row builder in
`src/lib/server/sockets/pipelines.ts` (that one handler only) and the `RetrievalRow` type where it is declared,
the test that covers that handler, `docs/lorebooks.md` (the Read in? paragraph, only if a sentence changes).

## Out of scope

The ranker and its gates; `entries:recentDecisions` beyond what item 4 needs; NOMENCLATURE.md itself (another lane
owns it now: list your names in the report); anything about who knows what.

## Done means

Tests that fail before and pass after: an entry off in the base row but on at the session's reading, stopped by
budget, says budget; archived-and-off says archived; a null reading does not claim the line or the clock unless
that is all null can mean; the client reads the raw skip reason from the row and a changed prefix does not break
it; the line and the tab give the same sentence for the same skipped row.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-rin2-2026-11-11.md`).

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
