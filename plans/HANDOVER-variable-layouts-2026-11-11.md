# Handover: variable layouts (2026-11-11)

From session be7b28c7 to whoever picks this area up next. Nothing is committed: the owner commits on their own schedule.

## State

**Built, verified and closed. No ★ is open.**

- **Plan:** `plans/PLAN-variable-layouts-2026-11-10.md`. Its header records every owner ruling.
- **Lane reports:** `plans/REPORT-vl-{S,D,A,E,F,N,G}-2026-11-10.md` and `plans/REPORT-vl-H-2026-11-11.md`. The vl-H report ends with the lead's follow-up and the known-issue fixes.
- **Briefs:** `plans/briefs/BRIEF-vl-*.md`. These are historical only; nothing is in flight.
- **Memory:** `project_variable_layouts_built_2026_11_11.md`.

## The design in five lines

- **One layout per variable for the whole pub.** In the UI it is a *variable layout*; in code it is a `variable template`. It is stored as `pipeline_variable_templates.pub_default`.
- **A preset can choose its own layout per variable,** but only where it says so: `session_presets.variable_layouts` and `PresetDecl.variableLayouts`.
- **A context template can name a layout in place** with `{{{layout key "owner/slug@major"}}}` (Liquid: `{{ key | layout: "ref" }}`). Names must be literals, and Assemble renders them first.
- **Resolution order:**
  1. a name in the template;
  2. a ⏳ leftover pick;
  3. the preset's choice;
  4. the pub's layout;
  5. the package default;
  6. the automatic layout or floor.
- **Upgrade:** migration `0151_shallow_marvel_zombies` and its data upgrade (`db/dataUpgrades/0151_*.ts`) promote an old per-step pick only where no prompt changes. Every other pick stays as a ⏳ leftover pick, to be dropped at the 0.7 squash.

## Where things are

- **SDK:** `../serene-pub-sdk/sdk/src/variableLayouts.ts`, `templateCheck.ts` (`variableLayoutCalls`), `announce.ts` (`presetVariableLayoutFindings`), and `INTEGRATING.md` §5a.
- **Server:** `src/lib/server/pipelines/config/{variableLayoutsView,leftoverPicks,library}.ts`, `entities/variableTemplates.ts`, `sockets/pipelinesVariableLayouts.ts`, and the leftover and library handlers in `sockets/pipelines.ts`.
- **Admin:** `src/lib/client/admin/sections/variable-layouts/` (W1 list, W2 variable page, W3 form) and `session-presets/PresetVariableLayouts.svelte` (W6).
- **Pipeline panel and editor:** `components/pipelines/StepVariableLayouts.svelte` (W4 leftovers) and `templates/TemplateEditor.svelte`, `TemplateLayoutsList.svelte`, `ScopeTree.svelte` (W5).
- **Docs:** NOMENCLATURE §15/§22/§23/§25, STYLE-GUIDE §6.11/§6.12/§6.17, `docs/context-templates.md`, `docs/pipelines.md`, `docs/getting-around.md`.

## Rules that bit this build

- **Name a step with its opaque handle, never its node key.** Step-addressed sockets take `stepKeyFor(secret, nodeKey)` and find the step by search (`locateStep`). The node key never appears in a panel payload (05 §0a). Lane tests that used raw keys hid this bug; only a walk on a real instance caught it.
- **One rule for who uses a layout:** `layoutRowUses`. The variable page's counts, the library's *Used by* and the delete refusal all read it. Don't add a second rule.
- **References are unique per variable only.** Look a row up by `(variable_id, reference)`, never by reference alone.
- **Never run `prettier --write` on a directory.** A worker reformatted 151 files under `src/lib/shared`. A few still carry formatting-only noise.
- **Run tests in a memory-capped scope with few workers.** In this session an 8 GB cap was too small for an unbounded worker count. Use `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`. `tsc` needs `NODE_OPTIONS=--max-old-space-size=10240`.

## Last verification (2026-11-11)

- **Tests:** 14 files and 478 tests pass: the layout socket suites, the delete and other write tests, the preset tests, the W1–W6 DOM tests, and `layoutHandledErrors.test.ts`. `tsc` is clean.
- **Earlier grouped run:** svelte-check reported 0 errors, `sdk:test` was at its baseline of 5 failures, and the build was OK.

## Noticed, not done (none ruled; none blocking)

- **Scripts admin:** `Library.LibraryPipeline.scriptSeams[]` and `Scripts.UseRow` carry raw `nodeKey`. These are scripts admin payloads, which 05 §0a's panel rule doesn't cover.
- **W3 form:** drops the `warnings` returned with a create or update, because the save leaves the page.
- **Leftover lines:**
  - A leftover step whose node has no panel declaration gets no heading, so its line reads *here*.
  - Picks from two genres on one variable count as one level.
- **W5 template editor:** loads its layout data once per mount.
- **W5 store:** has no timeout.
- **Layout preview:** shows only the first root of a variable with several.
- **SDK:**
  - core-catalog's preset seed type has no `variableLayouts`.
  - The "did you mean" list for an unknown helper omits `layout`.
  - There is a runtime import cycle between `variableLayouts.ts` and `templateIds.ts`. It is safe while both uses stay inside functions.
- **Unowned leftover:** the untracked `src/lib/shared/sessions/narratorCadence.ts` was reformatted by the prettier accident. It is now in use by another session's work and passes `prettier --check`.

## Not this area: failures passed on by serene-pub-d9 on 2026-11-11, unclaimed

**Speech** (from commit 1859099b):
- The `core:oracle/speak@1` step has inputs nothing fills and outputs nothing reads, and its connection and sampling slots aren't wired (`wiring`, `paramsSlotWiring`).
- It has no dispatch path (`allPipelines`).
- Speech files break the import-boundary rules: `voicebank.ts` imports `speechFacts`, and `modelSync.ts` and `speechTarget.ts` import `getSpeechAdapter` directly.
- Genre, preset and registration expectations don't include the read-aloud, narrator-voice and session-language fields.
- `presetFallback` copy.
- `scoreLedAllocation` 7296 → 6809.
- Ratchet hit at `0137_loadout_voices.ts:11`.
- SDK `deriveDontSpell` in `speakMessage.ts`.
- SDK `widgetParts`: run `gen:widget-parts`.

**Other:**
- `plugins/coreRow.int` (2).
- `narrateDraft.dom`: the code line the test looks for is now broken over two lines.
- `sessions.forms.int` R-15: the payload now carries `askedRunId`.
- `guideGrounding.int`: the SDK guide `your-first-plugin` isn't retrieved at all; the SDK `vocabulary.test` flags the same file.
- SDK `surface.test`: three untagged names.
- About ten comment-ratchet hits.

The owner was asked whether to take the speech list on. They have not answered yet.
