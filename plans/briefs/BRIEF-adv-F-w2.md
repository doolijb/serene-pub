# BRIEF — adv-F-w2: the Author's note learns advanced controls from `viewer.v1`

Supervisor: adv-F. Repos `/home/jody/github/serene-pub` (core) and `/home/jody/github/serene-pub-sdk` (SDK). Report back in your final message (the supervisor reads it); don't write a report file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

With a person's **advanced controls** switch off (a per-user preference, off by default; core reads it with `showsAdvancedControls(settings)` in `src/lib/client/advancedControls.ts`), the Author's note widget hides its depth and interval numbers and the *Sent as* fold. The note text and Save/Discard stay. The widget learns the switch from the base **`viewer`** envelope section.

### Rules the work applies (quoted)

- ★adv-C-1 (ruled 2026-11-10): *"the Author's note learns the switch from the base `viewer` section, not the dossier and not its own answer. … there is no dossier field and no new scope."*
- Plan rule: *"Advanced controls is a preference, never a permission. … Hidden never means changed. A hidden control keeps its stored value, and the session keeps using it."* Plan §6: *"No line in … the Author's note widget."* (no "Some controls are hidden" line in the widget).
- SDK file header rule (`sdk/src/widgets.ts:~25`): *"ADDITIVE keys go straight into the existing `v1` — no bump."*
- CLAUDE.md: core runs the SDK; edit the SDK in the sibling repo. Its `main` is `./dist/index.js`, so the app sees SDK changes only after `npm run sdk:build`.
- No new names beyond `advancedControls` on `ViewerV1`. No new user-facing strings.

### Steps

1. **SDK** `/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts` ~541, `interface ViewerV1`: add
   ```ts
   /** 🚧 The viewer's own advanced controls switch (a preference, never a permission). Absent means shown. */
   advancedControls?: boolean
   ```
   Nothing else in this file.
2. **Core** `/home/jody/github/serene-pub/src/lib/client/components/sessionPage/envelopeSections.svelte.ts` ~160-166: the `viewer` getter adds `advancedControls: showsAdvancedControls(d.userSettingsCtx.settings)` (the deps already carry `userSettingsCtx`; import from `$lib/client/advancedControls`). It must stay a getter so the value is live. Nothing else in this file.
3. **core-catalog registry** `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/widgets.ts` ~1520: `authors-note` changes `reads: []` to `reads: ['viewer']`. Only that line.
4. **Widget** `/home/jody/github/serene-pub-sdk/core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte`:
   - `const advanced = $derived(widget?.current?.viewer?.v1?.advancedControls !== false)`, following `core-catalog/components/shared/routine-log/RoutineLogWidget.svelte:31` (`widget?.current?.viewer?.v1?.isAdmin`). Doc comment: one line, 🚧 2026-11-10, absent means shown.
   - When `!advanced`, don't render the `authors-note.numbers` block (~275-297), the `authors-note.help` sentence right after it (it explains only those numbers) or the `authors-note.advanced` accordion (*Sent as*, ~304-311). Text, Save/Discard, alerts, the last-reply line and the Scenario section stay as they are.
   - **Hidden never means changed:** Save sends `readAuthorsNote(draft)`, and `draft` comes from the page's answer, so stored depth, interval and role go back untouched when those inputs aren't mounted. Confirm this by reading the code and prove it in the test. If you find any path where hiding would change what Save sends, STOP and report it.
   - Update the widget's top doc comment with one sentence saying the numbers and *Sent as* show only with the viewer's advanced controls on (`viewer.v1.advancedControls`).
5. **Test** in the existing `/home/jody/github/serene-pub-sdk/sdk-tests/coreAuthorsNoteComponent.test.ts` (it mounts the BUILT module through `mountComponent` with `context.viewer`):
   - `advancedControls: false` → no `input[data-widget-part~="authors-note.number"]`, no `[data-widget-part~="authors-note.advanced"]`, the text area is there; edit the text, Save, and the `set-authors-note` params carry the stored `depth`, `interval` and `role` exactly (use a stored note with non-default values, e.g. depth 4, interval 3, role `'user'` — check `AUTHORS_NOTE_ROLES` for a valid non-default role);
   - viewer without the field → the numbers and the fold render (the absent case).
   - Assert on counts, strings and booleans. **Never hand a DOM node to an assertion.**
6. **Core test** of the envelope's `viewer` getter: a new small `src/lib/client/components/sessionPage/envelopeViewer.test.svelte.ts` (or `.dom.test.svelte.ts` if the runes need the DOM env — check `vite.config` / vitest config for how `.svelte.ts` tests are picked up). Build `createEnvelopeSections` with minimal stubs (`as never` for deps the getter doesn't read; deriveds are lazy). Assert `viewer.current.advancedControls` is `false` with settings `{ showAdvancedControls: false }` and with no settings yet, `true` with `{ showAdvancedControls: true }`, and that it follows a change to the settings object (live getter). If constructing it turns out to need heavy real deps, stop and report rather than restructuring the file.

### Build and SDK test — read carefully

- **Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.** At the time of this brief one IS up (port 5234, another session's instance). Check again when your edits are done; if it's still up, do not build and do not run `sdk:test` (it tests the built module). Report "blocked on your dev server" and list what still needs building and testing.
- If no serene-pub `vite dev` runs: `cd /home/jody/github/serene-pub && npm run sdk:build`, then
  `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npm run sdk:test; echo test-exit=$?'`.
- The core envelope test runs regardless (vitest doesn't typecheck): `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <file>; echo test-exit=$?'`. Until `sdk:build` runs, `tsc` on `envelopeSections.svelte.ts` may report an excess-property error from the stale dist type; say so rather than working around it.

## Files owned (edit only these)

- SDK: `sdk/src/widgets.ts` (the one field), `core-catalog/src/registry/widgets.ts` (the one `reads` line), `core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte`, `sdk-tests/coreAuthorsNoteComponent.test.ts`
- Core: `src/lib/client/components/sessionPage/envelopeSections.svelte.ts`, the new envelope viewer test file

## Files readable

Anything. Useful: `cli/src/testing.ts` (`mountComponent`, its `reads` and `context` options), `sdk-tests/coreAuthorsNoteScenario.test.ts`, `core-catalog/components/shared/context.ts`, `src/routes/sessions/[id]/+page.svelte` (~544, how the page builds the envelope).

## Out of scope (never build)

`SessionDossier`, any scope or grant, the Author's note answer type (`AuthorsNoteV1`), conformance fixtures, docs, NOMENCLATURE, any other widget or registry entry. Findings go under **Noticed, not done**.

## Stop and ask when

Any SDK change beyond steps 1, 3, 4 seems needed; Save would change stored values with inputs hidden; a name beyond `advancedControls` is needed; another sdk-test breaks because of `reads: ['viewer']` (report which and why; don't edit it).

## Hazards (verbatim lane rules)

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- **Never run `prettier --write` on a file**; these files hold other sessions' uncommitted work. Format only your own hunks by hand.
- Never commit. Never `npm test` or `npm run build` at the SDK root (`/home/jody/github/serene-pub-sdk`). Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted.
- Never pipe vitest into `head`.
- Scratch files start with `adv-F-w2-`, in `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad`.

## Done means

- The core envelope test green.
- `sdk:build` + `sdk:test` green, or "blocked on your dev server" with the exact list of what is unbuilt/untested.
- Report: diff summary per file, tests run with results, the Save-sends-stored-values check, **Noticed, not done**.
