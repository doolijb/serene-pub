# BRIEF — lane `lore-match`, worker 3 — app: end-to-end tests of the sweep and Remember things

You are a `lane-worker`. Your supervisor owns lane `lore-match`; this brief is your whole contract. App repo
`/home/jody/github/serene-pub`. Use absolute paths. **Tests only**: you change no source file.

## Verbatim rules (from the lane guide; they bind you)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — you do **not** run `sdk:build`; it has been run.
- Never `git checkout` / `restore` / `stash`. Never `prettier --write` on a directory. Never `kill -9`. No dev server.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- No reference to any other project or product. Comments state the rule, not the story (no "no longer", "used to").
- It is a **session**, never a *chat* (Chat is only a genre's name).
- Tests run only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > /home/jody/github/serene-pub/plans/lore-match-w3-<n>.log 2>&1"`
  from the app root — targeted files only, never two runs at once, never piped into `head`. Before each run check
  `pgrep -af "vitest run"`; if another session's run is going, wait for it to finish first. An int test that opens a
  DB inside an `it` needs a 60 s timeout.
- Findings go under **Noticed, not done**. If a test shows the code is wrong, **do not fix the code**: keep the test,
  mark it `it.fails` only if the supervisor must decide, and report the failure with the evidence.

## Files owned

New test files only: `src/lib/server/sockets/sessions.sweepShown.int.test.ts` and
`src/lib/server/sockets/sessions.chatMemoryShown.int.test.ts` (copy the setup of the two suites below; do not edit
them).

## What was built (read these to know what to test)

- Lane brief `plans/briefs/BRIEF-lore-match.md` (the five-sentence rule, **Done means**).
- `src/lib/server/pipelines/runtime/loreMatch.ts` (`entriesNamedIn`, `lookLoreMatch`, `appendedContent`), the
  `create-lore-entry` case of `host.ts` (search `lookLoreMatch`), the `core:query/entries-named@1` binding in
  `bindings.ts`.
- SDK: `../serene-pub-sdk/core-catalog/src/shared/lore.ts` (`ENTRIES_NAMED_BRIEF_SCRIPT`: the block's exact text),
  `genres/story/reckon.ts` `sweepBranch` / `entryWrites`, `genres/chat/memory.ts`.
- Worker 2's notes on the e2e suites: both mock `getConnectionAdapter` with a `FakeAdapter` whose `generateText()`
  answers by a substring of `JSON.stringify(this.injected)`; `sessions.taskSweep.int.test.ts` answers the hoisted
  `script.sweep` when the prompt contains "You keep the books of a story"; `sessions.chatMemory.int.test.ts` answers
  `{notes:[…]}` on "You keep an assistant's notes" and pushes each prompt into a module-level `prompts[]`.
  `withCompiledPrompt(p)` stores the prompt in `this.injected`.

## Tests to write

Sweep (`sessions.sweepShown.int.test.ts`), through the real routine run as `sessions.taskSweep.int.test.ts` runs it:

1. A world-lore entry and a character-lore entry the history names (one by its name, one only by a key), and one
   the history does not name: the prompt the model gets carries the block with exactly the two named ones, in order
   (own book first), each as `- {"name":…,"content":…}`, a `provenance: "human"` one with
   `(written by a person: keep its facts and wording unless these lines changed them)`.
2. The model returns a shown entry's name (different case or a leading "The" is fine) with new text: the entry is
   rewritten and keeps its name — for an entry of the attached lorebook a held amendment (lorebook row untouched),
   and for an own-book entry in place (pick session setups the existing suites or `host.ownBookRoute.int` use);
   the run's receipt shows no `core:event/lore-entry-created@1` for that write.
3. The model returns the name of an entry it was not shown: a paragraph is added onto it.
4. Two entries of one name in one book: nothing written for that item, the run completes (not failed), the
   receipt's notes name both.
5. A key-only name: a new entry, and the note.
6. Identical text: nothing written, no amendment.
7. **The prompt with nothing named is byte-identical to today's**: run once with no entry named and assert the brief
   turn contains no `Already kept:` and equals the sweep crib's brief exactly; and run with an entry named and
   assert the prompt equals the empty-list prompt with exactly `"\n\n" + block` inserted after the brief.
8. **The `scenes` duty is unchanged**: with **File the places** on and an existing place of the returned name, the
   place write behaves as before this lane (no match: a second place, or whatever the existing suite pins).
9. Back (or a swipe / regenerate) of the turn the routine ran on takes a rewrite (find how the existing suites
   retract a routine's writes; if none does end to end, say so and test it at the closest seam you can reach
   without editing source).

Remember things (`sessions.chatMemoryShown.int.test.ts`), as `sessions.chatMemory.int.test.ts` runs it: tests 1
(world lore only), 2, 3, 7 for the memory prompt (`MEMORY_BRIEF`).

Run your two files, then `src/lib/server/sockets/sessions.taskSweep.int.test.ts` and
`sessions.chatMemory.int.test.ts` (they must still pass unchanged). `npx prettier --check` your two files.

## Stop and ask (report instead of improvising) when

A test needs a source change to pass; the setup cannot reach a case without editing an existing suite.

## Report

Return as your final message: files written; each test and its result; any test that shows the code wrong, with
the evidence; logs paths; **Noticed, not done**.
