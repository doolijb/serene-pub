# BRIEF — adv-A-w1: the advanced controls switch, server half (column, migration, data upgrade, wire)

Repo: `/home/jody/github/serene-pub`. Supervisor: lane adv-A. You type; the supervisor checks your report against this brief. Use absolute paths in every command (your cwd resets between calls).

## Goal

A per-user boolean **Show advanced controls** (owner-ruled 2026-11-10), stored and on the wire, so client code can read it and turn it on.

1. **Column.** In `src/lib/server/db/schema.ts`, in the `userSettings` table, add directly after `showAllCharacterFields` (around line 155):
   ```ts
   showAdvancedControls: boolean("show_advanced_controls")
   	.notNull()
   	.default(false),
   ```
   Give it a one-line doc comment in the style of neighbouring columns, e.g. `/** 🚧 Show advanced controls (2026-11-10): the per-user switch that shows the less everyday controls on sessions, lorebooks and characters. A preference, never a permission. */`. No other schema change.
2. **Generate the migration.** Run `cd /home/jody/github/serene-pub && npm run db:generate`. Expected: exactly one new file `drizzle/0149_<random_tag>.sql` containing one `ALTER TABLE "user_settings" ADD COLUMN "show_advanced_controls" boolean DEFAULT false NOT NULL;`, plus `drizzle/meta/0149_snapshot.json` and a new idx-149 entry in `drizzle/meta/_journal.json`. **If it produces anything else** (more SQL statements, a different index, an interactive prompt, changes to other tables): stop, don't edit the generated files, and report exactly what it produced. Never hand-write or edit the DDL. Record the generated tag in your report.
3. **Data upgrade (★B, ruled).** New `src/lib/server/db/dataUpgrades/0149_<same tag as the migration>.ts`, modelled on `0142_scenes_unfiled_default_names.ts`: a header comment (what and why: people who had *Show all character fields* on keep the full forms by getting advanced controls on), then
   ```ts
   export async function run(tx: MigrationTx): Promise<void> {
   	const carried = rawRows<{ id: number }>(await tx.execute(sql`
   		UPDATE user_settings
   		SET show_advanced_controls = true
   		WHERE show_all_character_fields = true
   		  AND show_advanced_controls = false
   		RETURNING id
   	`))
   	if (carried.length) console.log(`[upgrade 0149] …`)
   }
   ```
   Register it at the end of the array in `src/lib/server/db/dataUpgrades/index.ts` exactly like the `0142` entry (around line 181), with a `// 🚧` one-line comment and `afterMigration: "<the generated 0149 tag>"`.
4. **Int test.** New `src/lib/server/db/dataUpgrades/0149_<tag>.int.test.ts`, copied from `0142_scenes_unfiled_default_names.int.test.ts` (same harness and setup). It proves three things: a `user_settings` row with `show_all_character_fields = true` comes out with `show_advanced_controls = true`; a row with it false stays false; **a second run changes nothing** (same values, and the second run's UPDATE touches no row). Create the users/rows the test needs through the same means the 0142 test uses; never insert at a hardcoded id (let ids default and read them back). Every `it` that opens or uses a DB gets a **60_000 ms** timeout.
5. **Wire, `src/lib/server/sockets/userSettings.ts`:**
   - default insert (around lines 165-173): add `showAdvancedControls: false` after `showAllCharacterFields: false`;
   - the `userSettings:get` response built in `buildUserSettingsGet` (around lines 194-210): add `showAdvancedControls: settings.showAdvancedControls,` after `showAllCharacterFields`;
   - new exported handler `userSettingsUpdateShowAdvancedControls`, a copy of `userSettingsUpdateShowAllCharacterFields` (around lines 472-505) with: event `"userSettings:updateShowAdvancedControls"`, `.set({ showAdvancedControls: params.enabled })`, the same `emitToUser` of the response, the same lazy `await emitToUser("userSettings:get", () => buildUserSettingsGet(userId))`, error log `"Update show advanced controls error:"`, error event `"userSettings:updateShowAdvancedControls:error"` with `{ error: "Failed to update show advanced controls setting" }`. Place it right after the show-all handler;
   - register it in the register list (around line 848) on the line after `register(socket, userSettingsUpdateShowAllCharacterFields, emitToUser)`.
6. **Types, `src/lib/shared/sockets/types.ts`, the `namespace UserSettings` only:**
   - in `Get.Response.userSettings` (around line 14291) add after `showAllCharacterFields: boolean`: `/** 🚧 Show advanced controls (2026-11-10): shows the less everyday controls on sessions, lorebooks and characters. A preference, never a permission. */ showAdvancedControls: boolean`;
   - add `namespace UpdateShowAdvancedControls { interface Params { enabled: boolean } interface Response { success: boolean; enabled: boolean } }` right after `namespace UpdateShowAllCharacterFields` (around line 14493), formatted like it.
7. **Event lists (add one entry each, never reshape):**
   - `src/lib/client/sockets/typedSocket.ts` (around line 3814): a `"userSettings:updateShowAdvancedControls"` entry with params/response from the new namespace, placed right after the show-all entry (alphabetical order there is not strict; keep it beside its sibling). If the map also lists `...:error` siblings for the show-all event, add the matching `:error` sibling; if it doesn't, don't;
   - `src/lib/shared/sockets/interest.ts` (around line 1194): `"userSettings:updateShowAdvancedControls",` in alphabetical position (it sorts before `"userSettings:updateShowAllCharacterFields"`);
   - then `grep -rn "updateShowAllCharacterFields" /home/jody/github/serene-pub/src --include=*.ts` and add the matching entry to any other list that names the show-all event, **except** `CharacterForm.svelte` and `UserSettingsTab.svelte` (another worker / lane). Report every list you touched.

## Files owned (edit only these)

- `src/lib/server/db/schema.ts` (the one column)
- generated `drizzle/0149_*.sql`, `drizzle/meta/0149_snapshot.json`, `drizzle/meta/_journal.json` (generated only, never hand-edited)
- new `src/lib/server/db/dataUpgrades/0149_*.ts` and `0149_*.int.test.ts`; `src/lib/server/db/dataUpgrades/index.ts` (one entry)
- `src/lib/server/sockets/userSettings.ts`
- `src/lib/shared/sockets/types.ts` (the `UserSettings` namespace only)
- `src/lib/client/sockets/typedSocket.ts`, `src/lib/shared/sockets/interest.ts` (one entry each), and any other `.ts` list that already names `userSettings:updateShowAllCharacterFields` (one entry each)
- an existing test that asserts the `userSettings:get` shape, only if the new field breaks it (one-line shape update)

## Files readable

Anything. In particular: `src/lib/server/db/dataUpgrades/0142_scenes_unfiled_default_names.ts` and its `.int.test.ts`, `src/lib/server/db/dataUpgrades/runner.int.test.ts`, `src/lib/server/db/rawRows.ts`.

## Out of scope (never build)

- Any client component (`UserSettingsTab.svelte`, `AdvancedHiddenLine.svelte`, `CharacterForm.svelte`), docs, NOMENCLATURE, STYLE-GUIDE.
- Dropping or changing `show_all_character_fields`, its handler or its event. They stay.
- `src/lib/server/attic/**`.
- Any other setting, default, admin control or name.

## Stop and ask when

- `db:generate` produces anything other than one new 0149 migration adding this column (stop; don't edit; report what it produced).
- You need a name not in this brief.
- A test outside your files breaks and the fix is not a one-line shape update.

## Rules (quoted from CLAUDE.md)

- "Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest applied or it is *silently skipped*. Never seed a row at a hardcoded id."
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- "An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing." (This event is about the signed-in account and is **not** scoped; don't add it to `SCOPED_EVENTS`.)
- "Never `kill -9` the dev server: PGlite's WAL corrupts."
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Never pipe vitest into `head`. Run vitest inside a capped scope: `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files>; echo test-exit=$?'`.
- Scratch files start with `adv-A-w1-`.

## Done means

Run and report results for:
- the new `src/lib/server/db/dataUpgrades/0149_*.int.test.ts`;
- `src/lib/server/db/dataUpgrades/runner.int.test.ts`;
- `src/lib/server/sockets/userSettings.test.ts` and `src/lib/server/sockets/userSettings.backgroundPathValidation.int.test.ts`;
- `src/lib/shared/sockets/gatedEvents.test.ts`, `src/lib/shared/sockets/scopedReplies.test.ts`, `src/lib/client/sockets/interest.test.ts`, `src/lib/server/sockets/interest.test.ts`, `src/lib/server/sockets/index.interestGate.test.ts`.
- `npx prettier --check` on every file you edited (not the generated ones).

Don't run the full suite or `tsc` (the supervisor runs tsc).

## Report

Reply with (as your final message, not a file): changed files, the generated migration filename and tag and its SQL verbatim, every event list you touched, tests run with pass/fail counts, anything that surprised you, and **Noticed, not done**.
