# BRIEF — adv-C: the session view (Branch from here, layout editor entries, Author's note)

Plan: `plans/PLAN-advanced-controls-2026-11-10.md`. Read **§ The rule this plan applies**, **§4 items 15–17**, **§6 item 23** (all ★ RULED as recommended, 2026-11-10). You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Lane adv-A's report (`plans/REPORT-adv-A-2026-11-10.md`) describes the helper `showsAdvancedControls` in `src/lib/client/advancedControls.ts`.

The SDK is a sibling repo, `/home/jody/github/serene-pub-sdk`. Read `../serene-pub-sdk/INTEGRATING.md` by section before touching anything core imports from `@serene-pub/sdk`.

## Goal

With advanced controls off:

15. **Branch from here** (SDK `CORE_ACTIONS` entry `key: 'branch'`, `sdk/src/actions.ts:1227`) is not offered in the session view.
    - **Where to filter:** core-side, in `src/lib/client/components/sessionPage/actionList.svelte.ts`, next to `withinAudience` (applied at :280 and :287, including other channels' venues). The filter must react to the switch flipping mid-session without waiting for the next `sessions:actions` push, so derive it at read time rather than baking it into the stored venues.
    - **Fallback list:** `MessageControls.svelte` (core-catalog, `components/shared/messages/MessageControls.svelte:99-117`) has a built-in fallback list (Stop/Edit/Branch) used when the server sends no list. Confirm that filtering *branch* out never leaves an empty list that triggers this fallback and brings Branch back. If it can, stop and report before changing the SDK component.
    - **Branch modal:** the modal itself (`routes/sessions/[id]/+page.svelte:1237`) stays.
16. **Layout editor entry points** are not rendered:
    - the header **Layout** button (`src/lib/client/components/.../Header.svelte` ~380-384);
    - the header menu's **Customize layout** (`Header.svelte:167`);
    - the fullscreen-exit entry (`src/lib/client/components/Layout.svelte:3511`).

    If any other caller of `requestLayoutEditor()` (`layoutEditor.svelte.ts:24`) is a visible entry point, gate it too and list it in the report. Leave keyboard shortcuts that open the editor alone unless one exists and is visible in UI; report any you find.
17. **Author's note:** the depth and interval numbers (core-catalog `components/genres/story/authors-note/AuthorsNoteWidget.svelte:275-297`) and the *Sent as* fold (`:304-311`) are not rendered. The note text and Save/Discard stay.
    - **SDK field:** add the **optional** field `advancedControls?: boolean` to `SessionDossier` beside the required `debugPrompts` (`sdk/src/sessionDossier.ts:303`), with a one-line doc comment: "The viewer's own advanced controls switch; absent means shown."
    - **Core side:** fills it from the viewer's user settings in `src/lib/server/...` or `src/lib/client/components/sessionPage/sessionPageProjections.ts` (where `debugPrompts` is filled, :805/:936; it already reads `userSettingsCtx` settings at :893/:928).
    - **Widget side:** reads `advancedControls !== false`.
    - **First find how this widget reaches the dossier** (or any per-viewer host data). It doesn't reference `dossier` today. If it has no existing path to the dossier, **stop and report**. Don't invent a new host channel, prop or event.
    - **Fixtures:** keep the conformance fixture (`conformance/src/components.ts:263`) and sdk-tests untouched; that's why the field is optional.

No hidden line in any of these (plan item 23).

## Files owned

- `src/lib/client/components/sessionPage/actionList.svelte.ts` + its test
- `Header.svelte` (the two entries only), `src/lib/client/components/Layout.svelte` (the one entry only)
- `src/lib/client/components/sessionPage/sessionPageProjections.ts` (the one dossier field) + its test
- SDK `sdk/src/sessionDossier.ts` (the one optional field)
- SDK `core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte`
- a new or existing targeted test for each of the above; SDK widget tests go under `sdk-tests` only if a file for this widget already exists there

## Files readable

Anything. In particular: the plan, `audienceVenues.ts`, `routes/sessions/[id]/+page.svelte`, `MessageControls.svelte`, `layoutEditor.svelte.ts`, `SessionLayout.svelte`, lane A's report.

## Out of scope (write down, never build)

- Any other action, composer or widget. The admin-only Runs, Inspect run and Prompt details stay as they are.
- The layout editor itself and channel settings inside it.
- The session forms (lane B); characters and lorebooks (lane D); docs and NOMENCLATURE (lane E). Queue the NOMENCLATURE row for `SessionDossier.advancedControls` in your report.
- Removing or renaming any published SDK name.

## Stop and ask when

CLAUDE.md §Decisions applies; the widget has no existing path to the dossier; filtering Branch could trigger the fallback list; any SDK change beyond the one optional field seems needed; a name beyond those in the plan is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted.
- Never commit. Never `npm test` or `npm run build` at the SDK root (`/home/jody/github/serene-pub-sdk`). Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- After the SDK edits, run the app's `npm run sdk:build`, then `npm run sdk:test`, inside a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npm run sdk:test; echo test-exit=$?'`. Never hand a DOM node to an assertion (compare `x === null` to `true`).
- Never pipe vitest into `head`. App vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files>; echo test-exit=$?'`.
- `socket.off(event)` with no handler removes every listener app-wide; always pass the handler. Views never call `toaster`.
- Scratch files start with `adv-C-`.

## Done means

- **Targeted tests pass:** the `actionList` test (Branch gone when off, back when on, reacting without a new push); a projections test (the dossier carries `advancedControls`); a check that the header entries hide when off; and, if the widget is testable, that the numbers and fold hide when `advancedControls === false` and show when absent.
- **SDK:** `npm run sdk:build` and `npm run sdk:test` green.
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-adv-C-2026-11-10.md`: changed files in both repos, tests and results, the NOMENCLATURE row to queue for lane E, open ★, **Noticed, not done**.
