# REPORT — adv-A: the advanced controls switch — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-adv-A-w1.md` (server), `BRIEF-adv-A-w2.md` (client).

## Changed files

**Server and data (w1)**
- `src/lib/server/db/schema.ts`: `showAdvancedControls: boolean("show_advanced_controls").notNull().default(false)`, placed after `showAllCharacterFields`.
- `drizzle/0149_familiar_silk_fever.sql`, generated: `ALTER TABLE "user_settings" ADD COLUMN "show_advanced_controls" boolean DEFAULT false NOT NULL;`. Also generated: `drizzle/meta/0149_snapshot.json` and journal idx 149.
- `src/lib/server/db/dataUpgrades/0149_familiar_silk_fever.ts` (★B): `UPDATE user_settings SET show_advanced_controls = true WHERE show_all_character_fields = true AND show_advanced_controls = false`. Raw SQL through `tx`; no ids written. Its `.int.test.ts` covers show-all on → advanced on, show-all off → stays off, and a second run changes nothing. Registered in `dataUpgrades/index.ts` with `afterMigration: "0149_familiar_silk_fever"`.
- `src/lib/server/sockets/userSettings.ts`:
  - the default insert sets `showAdvancedControls: false`;
  - `buildUserSettingsGet` returns the field;
  - new handler `userSettingsUpdateShowAdvancedControls`, with error event `userSettings:updateShowAdvancedControls:error`, registered next to the show-all handler.
- `src/lib/shared/sockets/types.ts` (UserSettings namespace only): `showAdvancedControls` added to `Get.Response`, plus a new `UpdateShowAdvancedControls` namespace.
- `src/lib/client/sockets/typedSocket.ts`, `src/lib/shared/sockets/interest.ts`: one entry each. The event is account-wide, so it is not in `SCOPED_EVENTS`.

**Client (w2)**
- `src/lib/client/advancedControls.ts`: `showsAdvancedControls(settings)`, with a test.
- `src/lib/client/components/AdvancedHiddenLine.svelte`: the copy *"Some controls are hidden."* followed by the quiet link **Show advanced controls** (a `button.anchor`). The link emits `userSettings:updateShowAdvancedControls { enabled: true }`. No listener, no toast; dom test included.
- `src/lib/client/components/settingsTabs/UserSettingsTab.svelte`: a new first card, **Show advanced controls**. The *Show all character fields* card is removed along with its handlers and its interest entry.

**Lead (★adv-A-1, applying ★B to the 0.5.3 path)**
- `src/lib/server/attic/etl/accounts.ts`: `showAdvancedControls: s.showAllCharacterFields === true`.
- `src/lib/server/attic/upgrade.int.test.ts`: asserts `show_advanced_controls` is true for the fixture admin.

## Choices made inside scope
- **The User tab doesn't listen for the new reply and doesn't toast.** Following STYLE-GUIDE §6.21, the switch is silent: the shell's `userSettings:get` redraws it, and Layout's `:error` catch-all reports failures.
- **The hidden line's action is a quiet `anchor` link** (§6.1).

## Tests
- Supervisor's grouped run: 8 files, 98 tests, all green. The files: `advancedControls.test.ts`, `AdvancedHiddenLine.dom.test.svelte.ts`, `0149_familiar_silk_fever.int.test.ts`, `runner.int.test.ts`, `userSettings.test.ts`, `userSettings.backgroundPathValidation.int.test.ts`, `gatedEvents.test.ts`, `client/sockets/interest.test.ts`.
- Workers also ran these, all green: `scopedReplies.test.ts`, `server/sockets/interest.test.ts`, `index.interestGate.test.ts`, `displayNameField.ssr.test.ts`, `importCompletion.test.ts`.
- `npx tsc --noEmit -p .`: 0 errors. `npm run check` was not run; it's left for the grouped verification.

## Wording notes for lane E
- `docs/themes-and-settings.md:47`, and the generated `src/lib/generated/docs/pages/themes-and-settings.html:63`, still describe *Show all character fields*.
- NOMENCLATURE rows to add: `show_advanced_controls`, `showAdvancedControls`, `userSettings:updateShowAdvancedControls`, `AdvancedHiddenLine`, and the helper **`showsAdvancedControls`** (missing from plan item 25's list).

## Noticed, not done
- Migrations 0142–0148 and their snapshots are untracked in git. The owner's commit needs them along with 0149.
- The `show_all_character_fields` column, its event and its handler stay. `CharacterForm.svelte` (lane D) is their last reader until D lands.
