# BRIEF — worker `kn-4b-w3` — one app integration test per knowledge recipe

Supervisor: lane `kn-4b`. App repo `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You change no SDK source and need no `sdk:build`; if you think you do, stop and report.)

Also: never `git checkout / restore / stash` in either repo; never `prettier --write` or a scratch-copy equivalent
(not even on your own new file); never `pkill -f` anything; no migration; no `npm run build`, no full `npm test`.

## Goal

The SDK outlet `core:outlet/note-entry-knowledge@1` (`C.noteEntryKnowledge`; read its doc comment in
`/home/jody/github/serene-pub-sdk/contracts/src/outlets.ts`) is bound in the app (commit
`noteEntryKnowledgeWrite` in `src/lib/server/pipelines/runtime/host.loreWrites.ts`, case in `host.ts`; its own
tests in `src/lib/server/pipelines/runtime/host.noteEntryKnowledge.int.test.ts` — reuse that file's world
fixture ideas). The SDK guide `guides/genres-presets-and-routines.md` (section *Noting that a character came to
know an entry*, ~541–717) has **three recipes**, each a ` ```ts ` spec fragment plus a small ` ```js ` script body
for its `run-script` step(s):

1. `my:spec/told-in-the-scene` (~560–602): routine → session-history → entries-named → session-cast → script
   `members` → nested `each` → the outlet with `was_told`.
2. `my:spec/has-been-there` (~610–630): routine suiting `scene-closed` → session-state → session-cast → scripts
   `place`, `members` → `each` → the outlet with `has_been_there`.
3. `my:spec/told-what-was-revealed` (~638–717): one model call (`generate-json`) picks the revealed entry ids,
   then nested `each` → the outlet.

Write **one app integration test per recipe** in a new file
`src/lib/server/pipelines/runtime/noteEntryKnowledge.recipes.int.test.ts`: build the spec from the guide's
fence **text taken verbatim** (copy it into the test; a comment names the guide section), with the guide's script
bodies registered the way the app runs a `run-script` step's script (find how: `pipelines/scripts/`,
`guideRecipes.int.test.ts`, `scriptsChain.int.test.ts`, the scripts seed), run it through the app's real runtime
and host (find the harness existing int tests use to run a whole spec with the real host: e.g.
`pipelines/runtime/knownToSpeaker.defaultsOff.int.test.ts`, `bindings.entryKnowledge.reads.int.test.ts`,
`receipts.int.test.ts`, the routine runner), and then show **`knownToSpeaker` letting the entry through for that
member**: with the entry marked not common knowledge (`setEntryCommonKnowledge` in
`src/lib/server/lorebooks/entryKnowledge.ts`), a lore read with `knownToSpeaker` on for that member leaves the
entry out before the recipe runs and returns it after (use the host's lorebook-entries read path as
`bindings.entryKnowledge.reads.int.test.ts` does; `loadEntryKnowledge` before/after as a second assertion is fine).
For recipe 3, stub the one model call so the judge answers `{ "revealed": [<the entry id>] }` (find how other
int tests stub a generate call or a connection), and assert that a named entry the judge did **not** pick gets no
tie. Each test that opens a DB gets a 60 s timeout. Use the lorebook on **Full** (owned by the session's owner)
for 1 and 3, and Review changes (ties land in the session's notes) for 2, so both routes are covered.

## Files owned

- New: `src/lib/server/pipelines/runtime/noteEntryKnowledge.recipes.int.test.ts`.
- Only if a recipe is **wrong at run time** in the app (a script reads a field the value does not have, a port
  path does not resolve, the outlet gets a shape it refuses): the guide's recipe text (the three fences and their
  script bodies, ~541–717 of the SDK guide) **and** the same text in `sdk-tests/noteEntryKnowledge.test.ts`, kept
  identical; after such a change run that SDK test and `guideSnippets.test.ts`. Change as little as possible and
  list every change with its reason.
Not owned: every source file in both repos. If the app's runtime cannot run a recipe for a reason in app source
(not in the recipe), stop: report what fails and why, with the log; do not change app source.

## How to run tests

Before each run wait for other lanes: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then
start immediately. App tests only as:
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4b-w3-<n>.log 2>&1"`
SDK test files (only if you changed the recipes) as:
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd ../serene-pub-sdk/sdk-tests && npx tsx --test noteEntryKnowledge.test.ts guideSnippets.test.ts > /home/jody/github/serene-pub/plans/kn-4b-w3-sdk-<n>.log 2>&1"`
Never pipe a test run into `head`. `npx prettier --check` your new file (report; do not rewrite it with prettier).

## Stop and ask (in the report) when

A recipe cannot run in the app without changing app source; a recipe needs a node that does not exist; the
judge cannot be stubbed without a source change.

## Report (your final message)

Changed files; per recipe: how the spec is run, what is asserted, pass/fail; any recipe text you changed (old →
new, why); tests run with pass counts and log paths; **Noticed, not done**. Under 450 words.
