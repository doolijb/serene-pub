# BRIEF — adv-F: follow-ups (Author's note via the viewer section; session-form fixes)

Plan: `plans/PLAN-advanced-controls-2026-11-10.md`. Read **§ The rule this plan applies** and **§4 item 17**. Also read the reports `plans/REPORT-adv-B-2026-11-10.md` and `plans/REPORT-adv-C-2026-11-10.md`; this lane finishes what they left. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents (w1 = part 1, w2 = part 2), and quote into their briefs the rules they need. Lanes B and C are closed, and lane adv-D is running on characters and lorebooks; never edit its files.

## Rulings this lane applies (2026-11-10)

- **★adv-C-1 (decided by the lead on the owner's criteria "less likely to drive future changes into a corner and more intuitive"):** the Author's note learns the switch from the **base `viewer` section**, not the dossier and not its own answer. This *replaces* plan item 17's `SessionDossier.advancedControls`; there is no dossier field and no new scope.
- **★adv-B-2 (owner: "Owner-aware wording"):** when the owner sees *Where this session's story stands* read-only only because advanced controls are off, the closing sentence is *"Turn on advanced controls to change them."* Guests keep *"The session owner chooses both."*
- **★adv-B-1 (lead, applying the plan's rule "never hides anything that explains a refusal"):** with the switch off, the start form keeps the adopted-rules sentence and the preset hint as plain text. The hidden line shows only when a rules choice or How strict would actually have rendered.

## Part 1 — session forms (w1)

1. **`StartSessionForm.svelte`, Rules-card path** (~3108-3136, line at ~3310). With the switch off:
   - still render, as plain text where the card was: the adopted-rules sentence (`rulesAdoptedLine`, *"From the starter lorebook: X"*) and the preset hint (`start-rules-preset-hint`, *"‹Rules› keeps no numbers, so ‹preset› runs in words here."*), each under its existing condition;
   - render `AdvancedHiddenLine` only when the rules list (a real choice) or How strict would have rendered with the switch on;
   - **book-pick path:** do the same for the preset hint in the book-pick How strict card (~2848-2897), and fold that into `bookPickHides` (~1373) so the line shows only for a real hidden choice.
2. **`SessionLorebookReading.svelte`** gets one new optional prop, **`lockedByAdvanced?: boolean`** (default false). When `readOnly && lockedByAdvanced`:
   - the closing sentence becomes *"Turn on advanced controls to change them."*;
   - the clock is spelled with the book's calendar, and the branch shows by its name, exactly as the editable view spells them, not `formatDate(clock, null)` and *"A branch of this lorebook"* (~216-229). If that needs the data the editable view loads through `time.listen`, keep that listening on for this case. Guests' read-only branch is unchanged.
   - `EditSessionForm.svelte` passes `lockedByAdvanced={!isGuest && !advanced}` at both mounts (2888, 2899).
3. **Tests:**
   - in `startSessionAdvanced.dom.test.svelte.ts`, with the switch off, add assertions that the starter-kit picker, the creation-mode picker and a start ask render (scope finding 4); that the adopted-rules sentence and the preset hint stay; and that there is no hidden line when the card held only text;
   - in `editSessionAdvanced.dom.test.svelte.ts`, check the owner's off copy and calendar spelling, and that guests are unchanged.

## Part 2 — Author's note through `viewer.v1` (w2)

4. **SDK** `/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts:541` `ViewerV1`: add the optional field `advancedControls?: boolean`, doc comment *"🚧 The viewer's own advanced controls switch (a preference, never a permission). Absent means shown."* This is an additive `v1` key, so there is no version bump (the file's header rule, :25).
5. **Core** `src/lib/client/components/sessionPage/envelopeSections.svelte.ts:160-166`: the `viewer` getter adds `advancedControls: showsAdvancedControls(<the userSettingsCtx this file already receives>)` (import from `$lib/client/advancedControls`). It must stay a getter, so the value is live.
6. **core-catalog registry** `core-catalog/src/registry/widgets.ts:~1520`: `authors-note` changes from `reads: []` to `reads: ['viewer']`.
7. **Widget** `core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte`: `const advanced = $derived(widget?.current?.viewer?.v1?.advancedControls !== false)`, following how `RoutineLogWidget.svelte:31` reads the viewer. When `!advanced`, don't render the depth and interval numbers (:275-297) or the *Sent as* fold (:304-311). The note text and Save/Discard stay. Hidden never means changed: Save must still send the stored depth, interval and role untouched. Check what Save sends when those inputs aren't mounted.
8. **Test** for the widget's off case and the absent case, under `sdk-tests` only if a test file for this widget already exists there; otherwise a core-side test of the envelope's `viewer` getter carrying the field.
9. **Build:** check `pgrep -af "vite dev"`. If a serene-pub server is up, stop and report "blocked on your dev server". Otherwise run `npm run sdk:build`, then `npm run sdk:test` (capped scope).

## Part 3 — comments (supervisor, or either worker)

10. `Header.svelte:32-35`: the comment still calls the Layout button "the ONE way into the session layout editor". Correct it to say it is one of the ways in, with the full-screen menu's *Customize layout*. Re-wrap the long line. Make the same one-line correction in `src/lib/client/sessionLayout/layoutEditor.svelte.ts` and `SessionLayout.svelte` wherever they make that claim.

## Files owned

- `src/lib/client/components/sessionForms/StartSessionForm.svelte`, `EditSessionForm.svelte` (only the mounts in item 2), `SessionLorebookReading.svelte`, `startSessionAdvanced.dom.test.svelte.ts`, `editSessionAdvanced.dom.test.svelte.ts`
- `src/lib/client/components/sessionPage/envelopeSections.svelte.ts` (+ a test)
- SDK: `sdk/src/widgets.ts` (the one field), `core-catalog/src/registry/widgets.ts` (the one `reads` line), `core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte`
- `src/lib/client/components/Header.svelte`, `src/lib/client/sessionLayout/layoutEditor.svelte.ts`, `src/lib/client/sessionLayout/SessionLayout.svelte` (comments only)

## Out of scope (write down, never build)

- `SessionDossier`, any scope or grant, the Author's note answer type.
- Characters and lorebooks (lane D).
- Docs and NOMENCLATURE (lane E). Queue the row for `ViewerV1.advancedControls` and the prop `lockedByAdvanced` in your report.
- The Branch flash before the first actions push (noticed, not done).

## Stop and ask when

CLAUDE.md §Decisions applies; the Author's note's Save would change stored values when its inputs are hidden; any SDK change beyond items 4 and 6-7 seems needed; a name beyond `advancedControls` (on ViewerV1) and `lockedByAdvanced` is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted.
- **Never run `prettier --write` on a file**; these files hold other sessions' uncommitted work. Format only your own hunks by hand.
- Never commit. Never `npm test` or `npm run build` at the SDK root (`/home/jody/github/serene-pub-sdk`). Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- `sdk:test` in a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npm run sdk:test; echo test-exit=$?'`. Never hand a DOM node to an assertion.
- Never pipe vitest into `head`. App vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `adv-F-`.

## Done means

- **Targeted tests pass:** `startSession*.dom.test.svelte.ts`, `editSession*.dom.test.svelte.ts`, the envelope test, any Author's note test.
- **SDK:** `npm run sdk:build` + `npm run sdk:test` green, or "blocked on your dev server".
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-adv-F-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files in both repos, tests and results, NOMENCLATURE rows to queue, open ★, **Noticed, not done**.
