# BRIEF — hist-C: SDK teaching and the new contracts (scenes first)

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read the rulings sections, **§ Build scope items 3, 4, 5** and the research section **"Scenes first in the SDK"**. GO 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. The SDK is the sibling repo `/home/jody/github/serene-pub-sdk`. Read its `INTEGRATING.md` by section (grep), never whole.

**⚠ A serene-pub `vite dev` is running (another session's, :5234).** This lane **edits SDK source only**. It must NOT run `npm run sdk:build`. Check `pgrep -af "vite dev"` at the end. If a server is still up, report "blocked on your dev server" for the build and for the tests that need a build; the lead runs them in the grouped verification. SDK tests that run straight from source may be run (find out which by reading `sdk-tests/package.json` and how tests import packages). Never run `npm test` or `npm run build` at the SDK root.

## Rulings this lane applies (owner, 2026-11-10)

- **Scenes first:** "encouraging pipelines/modders to be targeting scenes first for granular history updates, then history entries second, optimally compiling from scenes to history entries."
- **★S4:** `note-scene@1` now. **★S5:** "Docs recipe only": no new query nodes.
- **S3 (default):** compile stays a person's press. **S6 (default):** a warning, not an error.
- **Story-now default date** for pipeline history writes (round 4); the append to the day's entry (★H1).

## Goal (SDK source)

1. **Outlet contract prose** (`contracts/src/outlets.ts`):
   - `create-lore-entry@1` (~1607-1720): replace "a summarizer writes history every time it runs" with a non-history example (*"a room-builder writes locations every time it runs"*), and add the paragraph: *"History is compiled, not written. Put events into scenes (`note-scene@1`, or a story line); a person's Compile files them under the day's one entry. A history write here is the second choice: it files onto its day's entry (the session's story day when no date is given), appending a paragraph."*
   - Drop history from the `entryType` param text (~1695).
   - Update `update-lore-entry@1`'s doc to say a history re-date is checked like a person's.
2. **New outlet `core:outlet/note-scene@1`** (contract only), placed beside `propose-scene-cue@1` (~756):
   - in-ports `text` (required), optional `scene` (a scene id; else the lane's open scene), `sources`;
   - `effects: 'write'`, review on `text`;
   - doc: *"Adds a note to a scene: a fact that isn't a story line (a death, a treaty, a clock jump). Notes reach the scene's summary and Compile. Never writes history or messages. Refused when the genre writes no scenes, when the scene is another session's, or when no scene is open."*
   - Follow how sibling outlets declare ports, effects and review exactly, and add it to whatever registry or list the outlets are enumerated in.
3. **`update-cast-member@1`** (~2105-2152): its contract accepts `nodeState` (and `nodeVisibility`) beside the profile fields. Doc: checked against `CAST_STATE_WORDS` (`sdk/src/ties.ts:137`) and the visibility words, dated at the session's story time and tied to the turn like the profile fields. Contract and doc only; the core checker change is lane hist-B2's.
4. **Packager warning `W_WRITES_HISTORY`** (`cli/src/compiler.ts`, after ~:1642, following the P5 `W_SETTING_UNDESCRIBED` pattern at ~:1764-1795):
   - for each `core:outlet/create-lore-entry` node whose resolved `entryType` is bare `core:entry/history` (or derived from it), warn: *"pipeline '‹p›' node '‹n›' writes history entries directly — history is compiled from scenes"*, with the fix *"write the event as a scene note (note-scene@1) or a story line; Compile files it under the day's entry"*;
   - documents whose inlet is `core:inlet/summarize-request@1` are exempt (their save is previewed);
   - resolve `entryType` like conformance C39's `declaredParams` (`conformance/src/index.ts:2214-2255`): node params merged with default-preset params. **Move that helper into the SDK** (`sdk/src`, exported) so the CLI and conformance share one copy; conformance imports it;
   - test it next to the existing warning's test (`sdk-tests/permissionGroups.test.ts` pattern): a history create warns; history set through a `rememberNote` / `fileLore` default warns; world lore stays silent; a summarize-request spec is exempt;
   - **do NOT add the conformance law over the catalogue**: it lands in hist-D with the Dungeon Crawler fix (challenge 5).
5. **Docs (SDK):**
   - `guides/writing-lore-from-a-pipeline.md`: a new section **Story events: scenes first** before "Choosing an entry type" (scenes → compile → history; `note-scene@1`; history as the second choice that appends to the day's entry; compile is a person's press). Fix `:36` so a running summary points at world lore or the annex, not history.
   - `guides/genres-presets-and-routines.md` Summaries (~282-301): a summarizer writes a *scene*, held for review.
   - `INTEGRATING.md`: a short subsection near ~:1333 saying the same.
   - The history entry type's doc in `core-catalog/src/registry/entries.ts` (~185-235): "written by Compile from scenes".
   - **The ★S5 recipe:** a short "Advanced: reading what changed, when" section (in the lore guide or a new guide page linked from it), showing how to combine the existing dated reads (`history-entries@1`, `stat-trail@1`, `lorebook-state@1` at a date, `current-date@1`) into a context template. Docs only; no new node.
   - Fix the stale `core:var/current-date@1` description (`sdk/src/variables.ts:~755`): the session's clock wins, then the line's present, then the newest history entry.

## Files owned (SDK repo)

- `contracts/src/outlets.ts` (the three outlets)
- `cli/src/compiler.ts` (the warning), the new shared helper in `sdk/src/` (+ its export), `conformance/src/index.ts` (importing the helper only)
- `sdk-tests/` (the warning's tests)
- `guides/writing-lore-from-a-pipeline.md`, `guides/genres-presets-and-routines.md`, `INTEGRATING.md`, any new guide page
- `core-catalog/src/registry/entries.ts` (the history doc only), `sdk/src/variables.ts` (the description only)

## Out of scope (write down, never build)

- Core host code (hist-B2 builds `note-scene@1`'s host side, the `scenes.notes` column, and the `nodeState` checker).
- Dungeon Crawler and the conformance law (hist-D). The app's `docs/` and `NOMENCLATURE.md` (hist-F): queue names.
- New query nodes (★S5).
- Removing or renaming any published SDK name.

## Stop and ask when

CLAUDE.md §Decisions applies; a new name beyond `note-scene@1`, `W_WRITES_HISTORY` and the shared helper is needed (name the helper and report it); moving `declaredParams` would change C39's behaviour.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root (`/home/jody/github/serene-pub-sdk`).
- **Never `npm run sdk:build` while `pgrep -af "vite dev"` shows a serene-pub server.** Report "blocked on your dev server".
- Never hand a DOM node to an assertion. Any SDK test run goes in a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 <cmd>; echo test-exit=$?'`.
- Scratch files start with `hist-C-`.

## Done means

- Source edits done; SDK `tsc` for the touched packages clean if it can run without a build (try `npx tsc --noEmit -p <package>` per package).
- The warning's tests pass if they can run from source; otherwise listed for the grouped run.
- Build and `sdk:test`: run if no dev server, else "blocked on your dev server".
- **No full suite.**

## Report

`plans/REPORT-hist-C-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, what ran and what is blocked, names for lane F, open ★, **Noticed, not done**.
