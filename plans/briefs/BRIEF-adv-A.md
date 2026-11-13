# BRIEF — adv-A: the advanced controls switch (data, wire, helper, hidden line, settings card)

Plan: `plans/PLAN-advanced-controls-2026-11-10.md`. Read **§ The rule this plan applies**, **§1 items 1–4**, **§6 items 22–23**, **★B**, **★C** and **★D** (all four ★ are RULED as recommended, 2026-11-10). You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need.

## Goal

Ship the per-user **Show advanced controls** switch end to end so lanes B, C and D can gate on it:

1. **Column** `user_settings.show_advanced_controls`: boolean, NOT NULL, default false, placed next to `show_all_character_fields` in `src/lib/server/db/schema.ts:155`. Then run `npm run db:generate` to produce `drizzle/0149_*.sql` and its meta. Never hand-write the DDL. The new index must be 0149, since 0148 is the highest (`drizzle/meta/_journal.json:1045`).
2. **Data upgrade (★B)** `src/lib/server/db/dataUpgrades/0149_<tag>.ts`, registered in `dataUpgrades/index.ts` with `afterMigration: "<the generated 0149 tag>"`. Follow `0142_scenes_unfiled_default_names.ts` and its `index.ts:181` entry. It sets `show_advanced_controls = true` where `show_all_character_fields = true`, using raw SQL through `tx` only and writing no ids down. Its int test (copy `0142_scenes_unfiled_default_names.int.test.ts`) proves three things: a row with show-all on comes out with advanced on; a row with it off stays off; **a second run changes nothing**. Give DB-in-`it` tests a 60 s timeout.
3. **Wire** (`src/lib/server/sockets/userSettings.ts`, `src/lib/shared/sockets/types.ts` userSettings part only):
   - add `showAdvancedControls: boolean` to `userSettings:get` (built at `userSettings.ts:194-210`; type at `types.ts:14281-14290`);
   - include `showAdvancedControls: false` in the default insert (`:171-172`);
   - add the new event **`userSettings:updateShowAdvancedControls`**, params `{ enabled: boolean }`, response `{ success: true, enabled }`. Copy `userSettingsUpdateShowAllCharacterFields` (`:472-500`), including its `emitToUser` of the response and the lazy `userSettings:get`;
   - register it wherever the show-all handler is registered (grep for `userSettingsUpdateShowAllCharacterFields`), and in any gated/typed-event lists that name that handler (`typedSocket.ts`, `interest.ts`, `gatedEvents.test.ts`, whatever grep shows). Only add entries; don't reshape those files.
4. **Client helper:** new `src/lib/client/advancedControls.ts` exporting `showsAdvancedControls(settings: { showAdvancedControls?: boolean } | null | undefined): boolean`, which returns `settings?.showAdvancedControls ?? false`. Add a unit test.
5. **`src/lib/client/components/AdvancedHiddenLine.svelte`:** one muted line, `text-surface-600-400 text-xs` like the existing field help.
   - Copy, exact: *"Some controls are hidden."* followed by a button-styled anchor or small tonal button **Show advanced controls**.
   - Clicking it emits `userSettings:updateShowAdvancedControls` `{ enabled: true }` through the same socket path `UserSettingsTab.svelte` uses for `onShowAllCharacterFieldsClick` (copy that handler's emit pattern).
   - The component never calls `toaster` and never registers a socket listener (Sockets standing rule: the domain context is the only listener and the only place that toasts). The surface redraws when the context's `userSettings:get` arrives.
   - Optional prop `class` only. Add a dom test that the button emits the event.
6. **User tab** (`src/lib/client/components/settingsTabs/UserSettingsTab.svelte`):
   - a new `SettingCard`, **first** (before Language at `:604`), `layout="switch"`, title **Show advanced controls**, help **"More choices on sessions, lorebooks and characters. Off keeps the everyday ones."**, shaped exactly like the *Show all character fields* card (`:735-756`), with its own handler emitting the new event;
   - **remove** the *Show all character fields* card (`:735-756`) and its now-unused handler and imports;
   - keep *Easy character creation* and every other card unchanged.

## Files owned

- `src/lib/server/db/schema.ts` (this one column only)
- `drizzle/0149_*.sql`, `drizzle/meta/*` (generated only)
- `src/lib/server/db/dataUpgrades/0149_*.ts` + `.int.test.ts`, `src/lib/server/db/dataUpgrades/index.ts` (one entry)
- `src/lib/server/sockets/userSettings.ts` and the socket registration file that lists its handlers (one entry)
- `src/lib/shared/sockets/types.ts` (the userSettings namespace only)
- the typed/gated event lists that already name `userSettings:updateShowAllCharacterFields` (one entry each)
- new `src/lib/client/advancedControls.ts` + test
- new `src/lib/client/components/AdvancedHiddenLine.svelte` + dom test
- `src/lib/client/components/settingsTabs/UserSettingsTab.svelte`
- existing tests that assert the `userSettings:get` shape, if adding the field breaks them (update only)

## Files readable

Anything. In particular: the plan, `CLAUDE.md`, `src/lib/client/components/settingsTabs/SettingCard.svelte`, the client userSettings context (grep `userSettingsCtx`), `src/lib/server/db/dataUpgrades/runner.int.test.ts`.

## Out of scope (write down, never build)

- Gating any surface. That is lanes B, C and D.
- `CharacterForm.svelte`, including its inline show-all switch (lane D).
- Dropping `show_all_character_fields` or its handler or event. The column and event stay; only the User tab card goes.
- Docs, NOMENCLATURE, STYLE-GUIDE (lane E). Queue any wording notes in your report.
- A pub-wide default, an admin control, or any other new setting.

## Stop and ask when

CLAUDE.md §Decisions applies; `db:generate` produces anything other than one new `0149` file adding this column (stop, don't edit it, report); a name beyond those in this brief is needed; a test outside your files breaks and the fix is not a one-line shape update.

## Hard rules (quoted from CLAUDE.md)

- "Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest applied or it is *silently skipped*. Never seed a row at a hardcoded id."
- "Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
- "Never `kill -9` the dev server."

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Never pipe vitest into `head`. Run vitest inside a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files>; echo test-exit=$?'`.
- Scratch files start with `adv-A-`.

## Done means

- Targeted tests pass: the new helper test, the `AdvancedHiddenLine` dom test, the 0149 data-upgrade int test, any userSettings socket test you touched or that exists (grep `userSettings` under `src/**/*.test.ts`), and `UserSettingsTab` tests if any exist.
- `npx tsc --noEmit -p .` is clean for your files. Run it in a capped scope with `NODE_OPTIONS=--max-old-space-size=8192` and `MemoryMax=12G`, and report any errors outside your files without fixing them.
- No full suite.

## Report

`plans/REPORT-adv-A-2026-11-10.md`: changed files, the generated migration's filename and tag, tests run with results, wording notes for lane E, open ★, **Noticed, not done**.
