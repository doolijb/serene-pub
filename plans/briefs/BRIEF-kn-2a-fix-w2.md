# BRIEF — worker `kn-2a-fix-w2` (app): core tools judge lore like the reads; an app test for switching the param off

Supervisor: lane `kn-2a-fix` (`plans/briefs/BRIEF-kn-2a-fix.md`). App repo `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`: do not run one.)

Also: never `git checkout / restore / stash` in either repo; never `prettier --write`; never `pkill -f` a generic pattern. Inside `db.transaction(async (tx) => …)` use only `tx`.

## Goal

### Task 1 — `entriesFor` drops what the speaker does not know

`src/lib/server/pipelines/runtime/tools/coreTools.ts` ~362, `entriesFor(ctx)`, reads `lorebook_entries` for the
tools `search_entries`, `get_entry` and `read_summary`, without the knowledge judgement. Every lore read in a run
already passes `knownToSpeaker: true` to the same host read (see `bindings.retrieval.ts` ~407–416): the host
(`host.read.lorebookEntries.ts` ~812–862) resolves the speaker from the query (`currentCharacterId`, or
`currentCastMemberId` for a card-less seat), loads the judgement once per run and speaker, applies the
standing-place exception, and reads everything when the query names no speaker (`kind: "reads-all"`).

Change `entriesFor` to pass `knownToSpeaker: true` in its query (beside `currentCharacterId`), so a tool call in a
run that speaks as a cast member drops unknown entries exactly as the reads do, and a run with no speaker
(`currentCharacterId` null: Chat's assistant, the Guide's envoy, a narrator turn) is unchanged. Comment states the
rule in one or two lines, not the story. Update the function's doc comment accordingly.

**Do not** touch `tools/index.ts` (`ToolContext`) or `host.call.ts`: a card-less seat's id does not reach a tool
today (`ToolContext` carries only `currentCharacterId`; `host.call.ts` ~706 builds it). Leave that gap; the
supervisor queues it. Do not add a receipt note from the tool (a tool has no `ctx.log`).

Tests:
- `tools/coreTools.test.ts` (unit, stand-in `ctx.read`): one test that the `lorebook_entries` query the tools send
  carries `knownToSpeaker: true` and the run's `currentCharacterId`.
- New int test `src/lib/server/pipelines/runtime/tools/coreTools.knowledge.int.test.ts` through the real host
  (`createHost(db, { sessionId, … })` and `host.read`), modelled on
  `src/lib/server/pipelines/runtime/bindings.entryKnowledge.reads.int.test.ts` (its `vi.mock`s, `world()` setup,
  `setEntryCommonKnowledge`, `releaseDataDir`, 60 s timeouts; temp dir prefix `serene-pub-vitest-coretools-knowledge-`).
  Cases: an entry marked not common knowledge, untied to the speaking card —
  (a) `search_entries`, `get_entry` (by its id: refuses with the "there is no entry" sentence) and `read_summary`
  with `currentCharacterId` = the seated card: absent;
  (b) the same three with `currentCharacterId: null` (no speaker): present;
  (c) tied with a *knows* tie (as the reads test does) or not marked: present for the card.
  Optionally (d) the standing-place exception: a marked place entry the card stands in is still found — only if
  the reads test's setup gives it to you cheaply.

### Task 2 — app test: a `false` set as a pipeline's declared default reaches the read and the entry comes back

The correct way to switch the param off is the node's `params: slot.params()` plus the pipeline's declared
defaults, `.defaults((d) => d.params('<nodeKey>', { knownToSpeaker: false }))`. That stores a row in the spec's
**default preset** (`pipeline_presets.is_default` + `pipeline_preset_values`, slot `params`), which the host
projects at `author` (`src/lib/server/pipelines/config/world.ts` ~1038, `shippedConfigValuesOf`) into the config
the executor reads `input.params` from.

New int test `src/lib/server/pipelines/runtime/knownToSpeaker.defaultsOff.int.test.ts`, built on the harness of
`src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts` (copy its `world()`, `reply()`, mocks and
bootstrap; do **not** edit that file — it is a byte-identical prompt baseline). After bootstrap, add the value to
Story respond's (`core:spec/story-respond`) default preset for its world-lore read node (find the node whose
`definitionId` is `core:query/world-lore` in the active version; its key ends `worldLore.read`): slot `params`,
`knownToSpeaker: false` — written in exactly the shape `.defaults().params()` stores (read how bootstrap writes
preset values and how `shippedConfigValuesOf` reads them; merge into an existing params row for that node if one
exists rather than replacing other fields). Find out whether anything caches the declared defaults per process
and clear it the supported way if so. Then: the entry marked not common knowledge, untied, Mira's own turn
(`asMira`): the secret **is** in the prompt, and the world-lore read's receipt notes do not say entries were left
out. Control in the same file, before the row is written (or in a separate world with the row removed): the
same turn lacks the secret. If the row cannot be written so that the run reads it, stop and report exactly why —
do not change production code to make it work.

## Files owned

`src/lib/server/pipelines/runtime/tools/coreTools.ts`, `tools/coreTools.test.ts`,
`tools/coreTools.knowledge.int.test.ts` (new), `src/lib/server/pipelines/runtime/knownToSpeaker.defaultsOff.int.test.ts` (new).

## Files readable

Anything. In particular the files named above, `lorebooks/entryKnowledge.ts`, `host.read.lorebookEntries.ts`,
`config/world.ts`, `boot/bootstrap.ts`, `db/schema`.

## Out of scope

Any other production file; `ToolContext` / `host.call.ts`; docs; the SDK; new names beyond test-local helpers.

## Stop and ask when

A production change outside `coreTools.ts` seems needed; Task 2's row is not read by the run; a test can only pass
by changing behaviour. Report it instead.

## Tests — how

Before each run wait for every other vitest to end, then start immediately:
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
Run only as (one run at a time, never piped into `head`):
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-2a-fix-w2-<n>.log 2>&1"`
Typecheck your files: `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "coreTools|knownToSpeaker.defaultsOff"` (0 lines). `npx prettier --check` your files.

## Done means

`tools/coreTools.test.ts`, `tools/coreTools.knowledge.int.test.ts`, `knownToSpeaker.defaultsOff.int.test.ts`
green in the capped form; tsc clean for these files.

## Report

Final message: changed files; the exact change to `entriesFor`; each test and its result (log path); how Task 2
writes the preset row and why the run reads it; anything you could not do. Under 400 words.
