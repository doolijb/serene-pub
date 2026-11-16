# BRIEF — `perf-N` worker 4 — prove `dossierFor`'s every branch keeps its reference while its inputs hold (test only)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

`SessionLayoutRender.svelte:203-222` hands each conversation mount `{@const dossier = model.dossierFor(id)}` as
`scoped={dossier ? { session_full: dossier } : undefined}` (Svelte compiles both to deriveds). The widget wire now skips
a scoped section by reference, so the mount stops serialising the dossier only if that derived does not rerun while a
reply streams. The page's dossier is now held across streamed frames (perf-N w3). `dossierFor`
(`src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts:649-680`) has four branches:

1. a Messages copy that nothing narrows: the page's own object (`narrowedDossier`, `:559-567`);
2. a Messages copy that claims a channel: a new spread (`narrowedDossier` `:566`);
3. a Messages copy while a Dialogue box is drawn: a new spread (`oneVoice`, `:586-590`);
4. a Composer / Turn line: a new object built per call (the `targetPick` branch, `:655-679`).

Branches 2–4 build a new object **per call**, so they are stable only because the derived around the call does not
rerun. Write a dom test that proves, per branch: with the model's inputs held (the same page dossier reference handed
again and again, nothing else moving), a `$derived(model.dossierFor(id))` **does not rerun** and keeps its reference
over 50 rounds; one real change reruns it once and hands a new reference carrying the change.

## Test — new `src/lib/client/sessionLayout/dossierFor.identity.dom.test.svelte.ts`

- Harness: copy `src/lib/client/sessionLayout/dialogueBoxPage.dom.test.svelte.ts` (`SurfaceManager` +
  `coreDefaultWidgets(true)` + `createSessionLayoutModel` inside `$effect.root`, roots stopped in `afterEach`, and
  `clearShownLine()`). Pass the input as an object with **getters** over test state so it can change:
  `get conversationDossier() { return held.d }` with `let held = $state.raw({ d: page })` or a `$state.raw` variable.
- Per branch, `const d = $derived.by(() => { runs++; return model.dossierFor(id) })` read once inside an effect or
  directly after `flushSync()`.
- Layouts: WITHOUT_BOX and WITH_BOX from that file (Messages + Turn line + Composer; and with `dialogue-box`). For branch 2
  a Messages copy that claims a channel: read `channelClaims.ts` / `channelClaims.test.ts` and
  `conversationTarget.test.ts` for how a copy (`messages#<suffix>`) claims a channel through its stored settings
  (`setWidgetSettingValues` in `src/lib/client/stores/widgetSettings.svelte.ts`) and how the page dossier's
  `composer.channels` must look (e.g. `["main", "sanctum"]`); reset widget settings in `afterEach`
  (`setWidgetSettingValues({})`).
- For each branch:
  - 50 rounds of handing the **same** page dossier again (`held.d = held.d`, or re-assigning the same reference) with a
    `flushSync()` each → `runs` unchanged, the same reference every round.
  - One replaced page dossier with a changed field (e.g. `settledThrough` or a composer label) → `runs` +1 and a new
    reference carrying the change. For branch 1 the reference is the new page object itself.
  - Branch 4 also: one settings change on its target Messages copy (`lineWidth: "full"` via `setWidgetSettingValues`)
    → `runs` +1, new reference, `composer.target.lineWidth === "full"`; an equal settings write afterwards → the
    derived may rerun (the store replaces its map) — assert what happens and say so in a comment; the wire's JSON
    fallback covers an equal new object.
- Log the counts (`console.log`).

If a branch reruns while nothing moved, **stop**: report the read that moves (file:line); do not change
`sessionLayoutModel.svelte.ts`.

## Files owned (edit only this)

- new `src/lib/client/sessionLayout/dossierFor.identity.dom.test.svelte.ts`

## Files readable

Anything under `src/`. Not yours to edit: every source file.

## Rules (quoted from the lane brief and CLAUDE.md)

- P1: "a skipped post is one whose value is identical; a missed real change is a bug, not a saving. Tests prove both
  directions for every section touched."
- Svelte 5: "`$effect`/`$derived` reruns on any tracked read; use `untrack` deliberately and say why in a comment;
  `$state(new Map())` is not reactive."
- "NOMENCLATURE §24/§25 for any new name" — you add none.

## Commands

- Capped: `systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/client/sessionLayout/dossierFor.identity.dom.test.svelte.ts src/lib/client/sessionLayout/dialogueBoxPage.dom.test.svelte.ts src/lib/client/sessionLayout/conversationTarget.test.ts src/lib/client/sessionLayout/channelClaims.test.ts`
  from `/home/jody/github/serene-pub`.
- `npx tsc --noEmit -p .` filtered: `| grep dossierFor.identity`.
- `npx prettier --check` on the new file (`--write` it is fine; it is new).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

Never pipe vitest into `head`. Run int and dom tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`.

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`. Never `prettier --write` a file that was unclean at HEAD.

## Stop and ask when

CLAUDE.md §Decisions applies; a branch reruns with nothing moved; you would need another file.

## Done means

The test file green with all four branches × both directions; the four listed files green; `tsc` clean on it; prettier
passes.

## Report

Final message: the file; per branch the rerun counts over 50 held rounds and after each change; anything that reran
unexpectedly; test counts. Nothing written to disk as a report.
