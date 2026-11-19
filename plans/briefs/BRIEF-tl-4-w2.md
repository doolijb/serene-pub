# BRIEF — worker `tl-4-w2` — history entries are left out of a run while the lorebook keeps no timeline

App repo `/home/jody/github/serene-pub`. Supervisor: lane `tl-4`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to build the SDK in this task: don't.)

Also: never `prettier --write`; never `git checkout / restore / stash` anywhere; never `pkill -f` a generic pattern; no
migration; no `npm run build`; no full test run. Other lanes are editing nearby files right now (lane `kn-5` owns
`src/lib/server/lorebooks/entryKnowledge.ts`, the Pipelines panel and the Apply review in `lorebooks/ownBook.ts`; lane `lb-1`
owns lorebook delete paths; worker `tl-4-w1` is editing `lorebooks/ownBook.ts`): **never edit those; re-read every file right
before you edit it.**

## Owner rulings (quoted)

- D55, 2026-11-16: "Leave them out while the timeline is off"; earlier, 2026-11-14: "No history entries for undated lorebooks,
  maybe scenes only".
- Standing: "comprehension and fidelity first" (prompts). "Go with the safest option for existing lorebooks".
- CLAUDE.md P1: "Code decides what code can; the model only judges. Same inputs, same result. … every automatic action shows
  its cause". Hence the receipt line.
- CLAUDE.md Decisions: anything a user (or the model) sees as **new copy** is proposed (★), never ruled by you: write the
  sentence as a 🚧 provisional constant and list it in your report as ★.

## Goal

When the session's reading says the governing lorebook keeps no timeline — `readingOrNone?.timelineOff === true` in
`src/lib/server/pipelines/runtime/host.read.lorebookEntries.ts` (`sessionReadingOf`, `state/reading.ts` ~330–380; this is the
same test lane `tl-2e` used, and costs **no extra statement**) — **no history entry reaches a run**: not in any lore lane, not
in `core:query/history-entries@1`, not in the listing `core:query/lorebook-entries@1`, not in `lorebook-triggers@1`, not in
entity search or vector search, not in the tools `search_entries`, `get_entry`, `read_summary`. They come back when the
timeline is switched on; **nothing is deleted or written**. A lorebook that keeps a timeline: **byte-identical** output, same
statements.

Known reads (the lead's corrected list; verify each and find any it misses — every host read that can hand a run a row of the
history entry type):

- The lore lanes and the history lane: `host.read.lorebookEntries.ts` (`readBook`, the union ~745–800); `bindings.retrieval.ts`
  `loreFor`, `world-lore@1`, `character-lore@1`, `history-entries@1` (~732–813).
- Entity search and vector search (`bindings.retrieval.ts` ~943, ~1440; the "withheld" rule `LORE_SOURCES` /
  `VECTOR_SOURCE_ALIASES` ~517–549 says a hit on a lore source with no row in the lore read is withheld). Check whether
  filtering the lore read already withholds history hits there; if yes, that is the "after" (test it); if not, make it so.
- The tools, through `entriesFor` (`pipelines/runtime/tools/coreTools.ts` ~365, which reads `lorebook_entries` = the same host
  read). `read_summary` offers kind `history` in a static enum. With the timeline off, do what the tool already does for a kind
  it cannot serve: it throws `ToolError` (see the unknown-kind branch ~335). Throw `ToolError` with the existing sentence
  `TIMELINE_OFF_SENTENCES.history` ("This lorebook has no timeline, so no history is kept.", `lorebooks/timeline.ts`). Leave the
  descriptions as they are (say so in the report).
- **Not this lane:** `session-history@1` (the transcript, not history entries); `scenes/earlierScenes.ts` (do **not** change;
  see Gap below); the person's own lists and views; `entryKnowledge.ts`.

**Where to filter:** once, in the shared read (`host.read.lorebookEntries.ts`), over every book the session reads (attached
lorebook and notes: the notes copy the attached book's switch, and the reading of the notes beside a book is `MAIN_HEAD`, so use
the session-level flag, not each book's reading). Pick the point that keeps the keyword scan, `skipped`, hits, the vector
withholding and `withLinks` consistent (a left-out history entry must not appear anywhere, including as a link far end or a
scan hit); prefer filtering rows already read in JS (no extra statement) so you can count them. Keep the memo
(`lorebookReads`) correct.

**The receipt:** say it the way the knowledge filter does (`noteKnowledgeDrop` / `knowledgeDropOf` in `entryKnowledge.ts`: a
`WeakMap` note on the returned rows, logged by the binding with `ctx.log("info", sentence)`, e.g. `bindings.retrieval.ts` ~432,
~697). Write your own small note + sentence in a file you own (not `entryKnowledge.ts`). One line, only when the timeline is
off and at least one history entry was left out, and only from reads whose answer would have held history (the history lane,
the listing when its `entryTypes` allow history, entity / vector search when they withheld one); never from the world or
character lane alone. Proposed sentence (★, 🚧 constant), modelled on `historyReceipt` in `sessions/firsthandFilter.ts`:
*"3 history entries left out: this lorebook keeps no timeline"* / *"1 history entry left out: this lorebook keeps no timeline"*.

**Stop and ask (report, don't decide)** when: a shipped pipeline relies on history entries on a timeline-off lorebook to work
at all (not just to be richer); a prompt baseline sha changes for any reason other than a timeline-off world with history; a new
exported name seems needed beyond the note helper and the sentence constant; anything outside this brief.

## Gap — report, do not build

`earlier-scenes` skips a scene already compiled into a history entry (`scenes/earlierScenes.ts:59`). On a lorebook whose
timeline was switched off **after** days were compiled, those days now leave both blocks. Do not change it. In your report:
the case in one sentence and the **count of shipped paths** (shipped pipelines / presets whose prompt places both
`earlierScenes` and history) that reach it.

## Tests

- Per read (lore lane via `history-entries@1` or `readLorebookEntries` directly, the listing, entity or vector search where a
  test harness exists, each tool): timeline off → no history rows, and the receipt line (assert the logged sentence); timeline
  on → unchanged; switch on again → they are back. A good harness: `src/lib/server/pipelines/runtime/promptAtReading.int.test.ts`
  (lane tl-2e added a describe there with the timeline switched off and dated history stored); tools:
  `pipelines/runtime/tools/coreTools.test.ts` / `coreTools.knowledge.int.test.ts`. Int tests that open a DB inside an `it` need
  a 60 s timeout.
- **Prompt baselines**, before AND after your change (other lanes move the tree; the before-run is your reference):
  `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts` and
  `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts`, with `KN2_SHA_LOG=plans/tl-4-shas-before.txt` (then
  `…-after.txt`) before `npx` inside the quotes. Last lane's file for comparison: `plans/tl-2e-fix-shas.txt`. Shas must be
  unchanged unless a world plays timeline-off with history: then show the diff and that this is the only cause. Note
  statement counts (must not rise).

## How to run tests — only this form, one at a time, wait first

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-4-w2-<n>.log 2>&1"
```

Never pipe vitest into `head`. Run your touched/new test files plus the existing tests of every file you edit
(`host.read.lorebookEntries`, `bindings.retrieval`, `coreTools` — grep for their test files; don't run more than ~15 files at
once). Then (wait first) `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p /home/jody/github/serene-pub` and report
the error count in your files. `npx prettier --check` your changed files (pre-existing drift is fine; report it).

## Docs (yours)

- `docs/lorebook-time.md` ~59 (the **History** bullet under what the timeline off hides): history entries are hidden in lists
  **and left out of what sessions send the model**; they come back when it is switched on. One clause, plain words.
- `docs/context-templates.md` ~190 (`history`): with the lorebook's timeline off, `history` is absent. One clause.
- Nothing else.

## Files owned

`src/lib/server/pipelines/runtime/host.read.lorebookEntries.ts`, `src/lib/server/pipelines/runtime/bindings.retrieval.ts`,
`src/lib/server/pipelines/runtime/tools/coreTools.ts`, their test files and new test files, `docs/lorebook-time.md`,
`docs/context-templates.md`. Any other file: stop and ask.

## Report (your final message, under ~500 words)

Changed files; **the table of reads: part → before → after** (one row per read, incl. ones you found beyond the list);
receipt sentence(s) as ★; tests run (log paths, pass/fail), tests changed old → new; baseline shas and statements before/after;
the Gap paragraph with the count; anything noticed but not done.
