# BRIEF sl-w2 — the shared genre fields (sheet latitude, item moves, Honour mode's new key), the rulesets' marks, the guide paragraph, and their tests

Lane **sl** (SDK), worker 2. Supervisor: the sl lane-supervisor. Report: in your final message (your hand-back), not a file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Owner rulings 2026-11-05 (plan §25 and its rulings bullet):
- "★1 two shared fields + a per-stat lock on the sheet — as proposed": declare the **sheet latitude** fields core reads, the AUTO_ADVANCE precedent.
- "★7 → moves are their own permission: a separate per-role control for moving items (give, drop, pick up), declared the same way as sheet latitude, so a strict table can let players hand items over while sheets stay locked."
- "★6 → rename the key instead of inverting stored values: Honour mode (label kept) gets a new key meaning 'keep every turn'; the old `honorMode` is read once … then dropped." The old `HONOR_MODE_FIELD` stays exported, marked ⏳ deprecated — **do not remove it and do not change the Crawler's declaration** (lane `ed` switches genres and the app together).
- Ruleset marks (owner, 2026-11-05): "Vis Itineris — every attribute `changedBy: ['rules']` except Mood; Wherewithal — Nerve, Favour, Provisions `['rules']`, Mood free." Mark them only inside the two rulesets, never on the shared slots globally.

Worker 1 has already added (read, never edit) `/home/jody/github/serene-pub-sdk/sdk/src/sheetLatitude.ts`: `SHEET_LATITUDES` (`'as-ruled' · 'no-edits' · 'all-own' · 'all-any'`), `SheetLatitude`, `ITEM_MOVE_LATITUDES` (`'follow-sheet' · 'no-moves' · 'own-items' · 'any-items'`), `ItemMoveLatitude`, `sheetLatitudeAllows`, exported from `@serene-pub/sdk`. Read its module doc for what each level means.

## Files owned (edit only these)

- `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/genres.ts` — **the shared field declarations only** (insert after `HONOR_MODE_FIELD`, ~line 300; edit `HONOR_MODE_FIELD`'s doc comment). No genre declaration changes (`shape.fields`, `settings` of any genre stay exactly as they are).
- `/home/jody/github/serene-pub-sdk/core-catalog/src/rulesets/vis-itineris/ruleset.ts` (the `ATTRIBUTES` list, ~45–51)
- `/home/jody/github/serene-pub-sdk/core-catalog/src/rulesets/wherewithal/ruleset.ts` (the `attributes` line, ~47)
- `/home/jody/github/serene-pub-sdk/sdk-tests/sheetLatitudeFields.test.ts` — **new**
- `/home/jody/github/serene-pub-sdk/sdk-tests/catalogueParity.test.ts` — only the attribute comparison (~119–151): a dated allowance for the new marks, as `SINCE_FIX8_TAGS` does for tags
- `/home/jody/github/serene-pub-sdk/guides/genres-presets-and-routines.md` — one paragraph, at the end of `### What a session's owner may change` (~363–370)

## Files readable

`core-catalog/src/registry/genres.ts` ~46–90 (`AUTO_ADVANCE_FIELD`, the precedent), ~280–325 (`HONOR_MODE_FIELD`, `SHOW_OUTCOMES_FIELD`); `sdk/src/settings.ts` ~179–215 (`FieldDecl`) and ~1199–1220 (`undescribedSettingParts`); `sdk-tests/visItineris.test.ts`, `sdk-tests/wherewithal.test.ts`, `sdk-tests/rulesetSections.test.ts`, `sdk-tests/coreCatalog.test.ts` (to see which pins your edits move — **report** a moved pin with its old and new value; the supervisor decides who moves it).

## Out of scope

No app code. No genre declaration change (the Crawler keeps `honorMode: HONOR_MODE_FIELD`; Story/Lair/DC/Chat/Guide `fields`/`settings` untouched). No removal of `HONOR_MODE_FIELD`. No Mundi edits. No new exported constant beyond the five fields below (a module-private label map is fine). No edits to `sdk/src/**` or `sdk-tests/sheetLatitude.test.ts` (worker 1's).

## What to build

### 1. Five shared `FieldDecl`s in `genres.ts` (each 🚧, `@experimental`, exactly ONE stability tag)

Each JSDoc says: what it is, the **key core reads** (a genre opts in by placing the object under that key in its `shape.fields` with its own default, or pins it silently in `settings` — the R32 cascade; the AUTO_ADVANCE wording is the model), what the host does with it (the app's write gate judges each hand edit with the SDK's `sheetLatitudeAllows`; lane `ed` wires it), the ruling and date, and what it is **not** (NOMENCLATURE §24 step 5): not `changedBy`, not a slot lock, not `reach`, not earshot.

Members are derived, never spelled twice: import `SHEET_LATITUDES`, `ITEM_MOVE_LATITUDES` and the types from `@serene-pub/sdk`, and build `members` from a module-private `Record<SheetLatitude, string>` / `Record<ItemMoveLatitude, string>` of English labels, in the constants' order. (`enum` + `members`, as `AUTO_ADVANCE_FIELD` does — no `select`, no `options`.)

| Export | Key core reads | `label.en` | `group` | `reach` | `default` | `description.en` |
|---|---|---|---|---|---|---|
| `OWNER_SHEET_LATITUDE_FIELD` | `ownerSheetLatitude` | Session owner edits sheets | Players | owner | `as-ruled` | How much the session owner may change by hand on the sheets. The world, the places and the people nobody plays count as theirs. |
| `PLAYER_SHEET_LATITUDE_FIELD` | `playerSheetLatitude` | Players edit sheets | Players | owner | `as-ruled` | How much players may change by hand on the sheets. Their own are the characters they play; watchers never change them. |
| `OWNER_ITEM_MOVES_FIELD` | `ownerItemMoves` | Session owner moves items | Players | owner | `follow-sheet` | Whether the session owner gives, drops and picks up items by hand, and whose. |
| `PLAYER_ITEM_MOVES_FIELD` | `playerItemMoves` | Players move items | Players | owner | `follow-sheet` | Whether players give, drop and pick up items by hand, and whose, so a table can let them hand items over while their sheets stay locked. |
| `KEEP_EVERY_TURN_FIELD` (boolean) | `keepEveryTurn` | Honour mode | Players | owner | `true` | Every turn is kept: nobody deletes the latest turn — retake it instead. Off: the host may delete the latest turn where deleting is on. |

Member labels (owner-accepted words, ★8):
- sheet: `as-ruled` _As the rules say_ · `no-edits` _No editing by hand_ · `all-own` _Everything on their own characters_ · `all-any` _Everything on anyone's_
- moves: `follow-sheet` _Follow sheet editing_ · `no-moves` _No moving by hand_ · `own-items` _Their own items_ · `any-items` _Anyone's_

`KEEP_EVERY_TURN_FIELD`'s doc: 🚧 **Honour mode** under its new key (owner ruling ★6, 2026-11-05): ON = keep every turn — nobody deletes the latest turn (retake from the latest instead); Back/Forward and the retake are untouched. Read by the app's `turnDeleteVerdict` once lane `ed` switches it. It no longer says anything about sheets (that is sheet latitude now). Declared by no genre yet.

### 2. `HONOR_MODE_FIELD` — doc only

Keep the object byte-identical (label, group, reach, description, default). Prepend to its doc: ⏳ **Deprecated 2026-11-05** (owner ruling §25 ★6): Honour mode moved to `KEEP_EVERY_TURN_FIELD` under the key `keepEveryTurn`, its meaning flipped (on = keep every turn); its sheet half is sheet latitude (`PLAYER_SHEET_LATITUDE_FIELD`). The app's data mapping reads a stored `honorMode` once (sessions, preset settings, import files, plugin presets) and drops it. New genres never declare this; it stays exported so packages compile, and removing it is the owner's call. Add a `@deprecated` line (precedent: `core-catalog/src/registry/widgets.ts` ~897 `@deprecated REMOVE in 0.7.0 — …`): `@deprecated — declare KEEP_EVERY_TURN_FIELD under \`keepEveryTurn\`.` Keep its `@experimental` (one stability tag).

### 3. Ruleset marks

- Vis Itineris `ATTRIBUTES`: every entry gains `changedBy: ["rules"]` — the three borrowed (level, class, health) and every own slot in the `.map`. VI declares no Mood, so nothing is excepted (say so in a short comment with the ruling and date).
- Wherewithal `attributes`: the three pools (`WHEREWITHAL_OWN_SLOTS.map`) gain `changedBy: ["rules"]`; the borrowed Mood entry stays without `changedBy` (free).
- Type: `changedBy` is `readonly AttributeChanger[]`; use `["rules"] as const` or a typed const if TS needs it.

### 4. `catalogueParity.test.ts`

Today it compares `after` attributes with `before` (stripping `SINCE_FIX8_TAGS`). Add a dated allowance the same way: strip `changedBy` from `after`'s attributes before the deepEqual, then assert each `after` attribute's `changedBy` is what the 2026-11-05 ruling says (VI: every one `['rules']`; Wherewithal: the three pools `['rules']`, mood absent). A comment: `// 🚧 Owner ruling 2026-11-05 (plan §24/§25 ★5): the rules' own marks — …`. Change nothing else in the file.

### 5. `sdk-tests/sheetLatitudeFields.test.ts` (new)

Header doc (what, why, 2026-11-05, plan §25). Import the fields from `'../core-catalog/src/index.js'` (as `catalogueParity.test.ts` does) and the levels from `'@serene-pub/sdk'`. Assert per field: `type`, `label`, `group`, `reach`, `default`, `description`, and the member keys equal `SHEET_LATITUDES` / `ITEM_MOVE_LATITUDES` in order, with the labels above; `undescribedSettingParts(field)` is `[]`; `KEEP_EVERY_TURN_FIELD` is boolean, default `true`, label _Honour mode_; `HONOR_MODE_FIELD` is still exported and unchanged (label _Honour mode_, default `false`); the Dungeon Crawler genre still declares `honorMode` and no genre declares any of the five new keys yet (find the genres through the catalogue's exports — read `core-catalog/src/registry/genres.ts` for the exported genre names); the two rulesets' marks (resolve each ruleset's sections with `rulesetSections`, as `catalogueParity` does).

## Tests to run

Tests resolve the SDK and core-catalog from source (no build needed):
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test sheetLatitudeFields.test.ts catalogueParity.test.ts visItineris.test.ts wherewithal.test.ts rulesetSections.test.ts coreCatalog.test.ts scopes.test.ts`
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p .` — report errors in your files; name others, don't fix them.
- `npx prettier --check <file>` on each file you touched (match the file's style: core-catalog uses tabs, double quotes, no semicolons; sdk-tests single quotes — check a neighbour).

A pin (a hash or golden) your edits move: **don't move it** — report the test, the old and the new value, and which of your edits moved it. The supervisor moves pins with dated notes.

## Rules you work under (quoted)

- NOMENCLATURE R1 "One word, one meaning." · R3 "Qualify, never abbreviate to the bare noun." · R6 "⏳ **Transitional** — real today, expires on a known event." / "🚧 **Provisional** — designed but not built, so the words may still move on contact with implementation."
- NOMENCLATURE §24: "5. Say what it is **not**, in the declaration, if a near-neighbour exists." · "6. UI labels are prose and need not match internal names — but must not _contradict_ them."
- CLAUDE.md P5: "A user-facing declaration without purpose, group and reach gets a validation **warning** and lands under Advanced." Every new field has a description, `group` and `reach`.
- CLAUDE.md: "Removing or renaming a published SDK name is the owner's call." — ruled here for Honour mode's key only: the old field stays.
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for." A name not in this brief is a question — put it in your report.
- The surface audit: every export carries exactly ONE of `@public` / `@experimental` / `@internal`.
- CLAUDE.md Hard rule: "Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted." Other lanes' uncommitted edits sit in `genres.ts` and the sdk-tests — touch only your hunks.

Verbatim:
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — you do not run `sdk:build` at all; the supervisor does.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies, a ★ is unruled, a name is new beyond this brief, or anything outside the owned files seems needed.

## Done means

`sheetLatitudeFields.test.ts` and `catalogueParity.test.ts` green; the other listed tests green or each failure named as a moved pin (old → new, cause); no new `tsc` error in your files; prettier clean on your files. Report: changed files, tests run with results, moved pins, decisions, Noticed-not-done.
