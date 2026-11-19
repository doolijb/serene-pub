# BRIEF — worker `kn-2a-fix-w1` (SDK + docs): the recipe for switching `knownToSpeaker` off, proven

Supervisor: lane `kn-2a-fix` (`plans/briefs/BRIEF-kn-2a-fix.md`). SDK repo `/home/jody/github/serene-pub-sdk`,
app repo `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task changes no SDK source: do not run `sdk:build`.)

Also: never `git checkout / restore / stash` in either repo (most of the SDK is uncommitted); never `prettier --write`;
never `npm` at the SDK root; never `pkill -f` a generic pattern.

## Facts (verified by the supervisor; re-check what you rely on)

- The guide `guides/genres-presets-and-routines.md` ~506–510 and `INTEGRATING.md` §1p ~1594 ("Switching it off")
  teach `C.worldLore.v1({ scope: …, knownToSpeaker: false })`. That puts `knownToSpeaker` at the **top level** of
  the node's config (`builder.ts` ~897 copies the config object as given). The executor hands a binding
  `{ ...node.config }` with slot references resolved (`executor.ts` `resolveInput` ~1252); the read bindings read
  `input?.params?.knownToSpeaker`. So the top-level key reaches the binding as `input.knownToSpeaker`, which
  nothing reads: **the recipe silently does nothing.** The guide fence is `nocheck` because
  `sdk-tests/guideSnippets.test.ts` holds every literal config key to the node's in-ports and slot names.
- What works (as `core-catalog/src/genres/lair/reply.ts` ~1247–1262 sets params): the node takes
  `params: slot.params()` (Story's and the Lair's lore reads already do), and the pipeline's declared defaults
  state the value: `.defaults((d) => d.params('<nodeKey>', { knownToSpeaker: false }))`. That is the spec's default
  preset (`builder.ts` `defaults()` ~1517, slug `default`, `default: true`, a `values` row with `slot: 'params'`).
  The host projects it at the `author` layer; the executor's `params` branch (`executor.ts` ~1446) resolves
  `config[node.key].params` (schema defaults under the stored values) from `world.authorDefaults` +
  `world.overrides` (`config.ts` `resolveConfigSources` ~358). The node key inside a gather chain is qualified
  (`gather.worldLore.read`). A preset or a genre registration's values can set it the same way, and an
  administrator can switch it in the step's panel (the field's label is *Only what the speaker knows*).
- A literal `params: { knownToSpeaker: false }` on the node also reaches the binding, but replaces the whole
  slot (no schema defaults, no panel, no layer): do **not** teach it.

## Goal

1. **SDK test** — extend `sdk-tests/knownToSpeaker.test.ts` with a `describe('knownToSpeaker · switching it off
   reaches the read')`. Build a minimal pipeline with the SDK builder (find the pattern in existing sdk-tests that
   build a spec with `C.worldLore.v1({ scope: $.input.sessionScope, params: slot.params() })` and run it with
   `run()` and stub `bindings`, e.g. `sdk-tests/lorebookEntries.test.ts`, `lair.test.ts`, `helpers.ts`). The stub
   binding for `core:query/world-lore@1` records the `input.params` it receives. Project the document's default
   preset `params` rows into `world.authorDefaults[nodeKey].params` exactly as the host does (say so in a
   one-line comment). Cases:
   (a) `.defaults((d) => d.params(<key>, { knownToSpeaker: false }))` → the binding sees
       `params.knownToSpeaker === false` (and the other params keep their schema defaults);
   (b) no defaults → `true`;
   (c) the old spelling, top-level `knownToSpeaker: false` in the node config (cast as needed) → the binding sees
       `params.knownToSpeaker === true`: the top-level key does nothing.
   Separately (not in the test, do not add a law): run `validate()` once on the case (c) document and report
   verbatim whether any finding names the unknown key `knownToSpeaker`.
2. **Guide** `guides/genres-presets-and-routines.md`, section *What a character does not know*: replace the
   `nocheck` fence with a **checked** fence (no `nocheck`; a hidden `<!-- prelude: … -->` comment if it needs
   declarations, see the convention at the top of `sdk-tests/guideSnippets.test.ts`) showing the working spelling:
   the read with `params: slot.params()` and the pipeline's `.defaults((d) => d.params('<key>', { knownToSpeaker:
   false }))`, with a one-line comment giving a reason. Say in one sentence that a preset, a genre registration
   or the step's panel can switch it the same way, and that the key belongs in `params`, never at the top level of
   the node. Keep the guide's voice (plain sentences, no story).
3. **`INTEGRATING.md` §1p** (~1594, "Switching it off"): the same correction, one or two sentences.
4. **The standing place, exactly** (no behaviour change): `lorebooks/entryKnowledge.ts` ~359–376 in the app. The
   seat's own location value is read from its state owner (`castOwnerOf`); with seats stored in card form
   (`memberFormOn()` false — ⏳ transitional, on in every shipped build since S4) a seat with no card has no owner
   of its own (`session_cast` of no card), so its own value is skipped and it stands in the session's world
   location. In `INTEGRATING.md` §1p (the sentence "The place entry the speaker stands in …") and the guide's rule
   5, add that clause, marked ⏳. `docs/pipelines.md` (user docs) stays as it is for this point: it is exact for
   every shipped build.
5. **`docs/pipelines.md`** ~376 "Switching it off": `knownToSpeaker: false` "on the node" is wrong — say it is set
   in the step's params (the pipeline's declared defaults, a preset, or the step's panel). One sentence.

## Files owned

SDK: `sdk-tests/knownToSpeaker.test.ts`, `guides/genres-presets-and-routines.md` (only the section *What a
character does not know*), `INTEGRATING.md` (only §1p's `knownToSpeaker` bullet). App: `docs/pipelines.md` (only
the *What a character does not know* section).

## Files readable

Anything.

## Out of scope

SDK source (`sdk/src`, `contracts/src`, `core-catalog/src`): no change, no law in `validate()`. Other guide
sections; the Limits lines (a later brief); NOMENCLATURE; new names.

## Stop and ask when

The working spelling does not reach the binding in your test; the checked fence cannot compile without changing
SDK source; anything outside the owned sections seems to need a change.

## Tests — how

Before each run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` (also wait while
`pgrep -f "tsx --test"` shows another SDK test run), then start immediately. Run SDK test files from the app root,
capped, one run at a time, never piped into `head`:
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd ../serene-pub-sdk/sdk-tests && npx tsx --test knownToSpeaker.test.ts guideSnippets.test.ts guides.test.ts docs.test.ts > /home/jody/github/serene-pub/plans/kn-2a-fix-w1-<n>.log 2>&1"`
Typecheck the test file: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p . 2>&1 | grep knownToSpeaker` (0 lines; other files' errors are not yours, note their count).
`npx prettier --check` the test file.

## Done means

`knownToSpeaker.test.ts`, `guideSnippets.test.ts`, `guides.test.ts`, `docs.test.ts` green (if one of the last three
fails on something outside your sections, report it verbatim and say whether it failed before your change).

## Report

Final message: changed files and sections; the test cases and results (log path); the `validate()` verbatim
answer for case (c); anything you could not do. Under 400 words.
