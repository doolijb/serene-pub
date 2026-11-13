# BRIEF sl — the SDK's hand-edit controls ("sheet latitude"), the move control, Honour mode's new key, and the rulesets' locks (owner rulings 2026-11-05, plan §25 + its rulings bullet in §24)

You are a `lane-supervisor` (fresh, Opus). Read `.claude/guides/multi-agent.md` first, then this brief, then plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` **§25 whole** and the §24 bullet "Owner rulings on §25 (2026-11-05)", `../serene-pub-sdk/INTEGRATING.md` (by section: settings fields / genre declarations), NOMENCLATURE §1, §24, the attributes, settings and rulesets group sections, and the memory note `/home/jody/.claude/projects/-home-jody-github-serene-pub/memory/feedback_honour_mode_split_sheet_edits.md`. Lane id **sl**. Two workers at most (Sonnet). Work in `../serene-pub-sdk` (never `git checkout`/`stash`/`restore` there — most of it is uncommitted). The app is NOT yours (lane **ed** wires the server gate, the data mapping and the genre switch-over next); lane **pl** runs app int tests concurrently.

## Rulings (quote to workers)
- §25 ★1 **two shared fields core reads** (the AUTO_ADVANCE precedent, `core-catalog/src/registry/genres.ts` ~50–57): 🚧 `OWNER_SHEET_LATITUDE_FIELD` / `PLAYER_SHEET_LATITUDE_FIELD` (`enum`, `members` `as-ruled · no-edits · all-own · all-any`, group _Players_; labels _As the rules say_ · _No editing by hand_ · _Everything on their own characters_ · _Everything on anyone's_), plus the per-stat lock fact 🚧 `handLocked?: Record<slotId, sentence>` on the sheet's owner view (`sdk/src/widgets.ts` ~883–906 `SessionStateOwnerV1`), plus one pure judge 🚧 `sheetLatitudeAllows(...)` the server and the sheet share. Names per NOMENCLATURE §24 (qualify; not `changedBy`, not a slot lock, not `reach`, not earshot; no `none` — slot locks use it for "unlocked").
- §25 ★2/3/4/5 as proposed (read §25 A): genre silent → owner and players `as-ruled`; Story/Lair will pin owner `all-any` (ed switches the declarations); world/NPCs/places = the owner's; watchers never edit; override passes `changedBy` incl. `rules`, never a lock `all` or earshot; only the owner locks; rulesets lock as `['rules']`.
- **★6 → rename the key:** Honour mode keeps its **label** _Honour mode_ and its new meaning **ON = keep every turn** (no deleting the latest turn); declare it under a **new key** (🚧 name per §24 — e.g. `keepEveryTurn`; propose, build the recommendation) as a new shared field, **default ON**, description _Every turn is kept: nobody deletes the latest turn — retake it instead. Off: the host may delete the latest turn where deleting is on._ The old `HONOR_MODE_FIELD` (key `honorMode`) stays exported, marked ⏳ deprecated (doc: read once by the app's mapping, then dropped; not to be declared by new genres) — **do not remove it and do not change the Crawler's declaration** (ed switches genres and the app together, so the app never sees a half state).
- **★7 → moves are their own permission:** a per-role control for moving items (give, drop, pick up), declared the same way: 🚧 `OWNER_ITEM_MOVES_FIELD` / `PLAYER_ITEM_MOVES_FIELD` (names per §24) with levels you propose (★ — recommendation, e.g. _Follow sheet editing_ · _Their own items_ · _Nobody_ · _Anyone's_), and the judge covers it (`act: 'take-from' | 'put-on'` judged per side as §25 D says). Write the recommendation into the report as ★ with its trade-off.
- **Ruleset marks (§24, owner 2026-11-05):** Vis Itineris — every attribute `changedBy: ['rules']` **except Mood**; Wherewithal — Nerve, Favour, Provisions `['rules']`, Mood free. (`core-catalog/src/rulesets/vis-itineris/*`, `rulesets/wherewithal/*`, and where core's borrowed health/level/class are declared for VI — mark them only inside VI's ruleset, not globally.) The editor already shows `changedBy`.
- **Words accepted (★8):** the §25 B/C sentences.

## Items
1. `sdk/src/sheetLatitude.ts` (new): the levels, the move levels, the judge, types; `index.ts` exports; doc comments with the charter.
2. `widgets.ts`: `handLocked` on the owner view (optional, additive).
3. `core-catalog/src/registry/genres.ts`: the four latitude/move fields and the new keep-every-turn field as shared `FieldDecl`s; `HONOR_MODE_FIELD` ⏳ deprecated in its doc; **no genre declaration changes**.
4. The two rulesets' marks.
5. Conformance/golden pins (`sdk-tests`): move them with dated notes; `vocabulary.test` (no bare canon words in guides); a test for the judge (each level × own/other × `changedBy` × lock `all`/earshot) and for each new field's shape.
6. Guide: `../serene-pub-sdk/guides/` the genres/settings section — one paragraph on sheet latitude and item moves.
7. `sdk:build` at the end — **first check `pgrep -af "vite dev"` (no serene-pub server) and `pgrep -af vitest` (no test run in the app tree; wait if one is)**; then `cd ../serene-pub-sdk/sdk-tests && npx tsx --test *.test.ts` (known other-programme failures: `derive, don't spell`, the 1.0 surface audit, the spelling allowance, `every export is tagged` — name any NEW failure).
8. NOMENCLATURE (app repo, §25 rows only, appended at the end of §25 — the one app file you may edit): the new names.

## Files owned
`../serene-pub-sdk/sdk/src/sheetLatitude.ts` (new), `sdk/src/index.ts`, `sdk/src/widgets.ts` (additive), `../serene-pub-sdk/core-catalog/src/registry/genres.ts` (the shared fields only), `core-catalog/src/rulesets/vis-itineris/**`, `core-catalog/src/rulesets/wherewithal/**`, `../serene-pub-sdk/sdk-tests/**` (new tests + pins), `../serene-pub-sdk/guides/**` (one paragraph), `/home/jody/github/serene-pub/NOMENCLATURE.md` (§25 rows).
## Out of scope
No app code; no genre declaration switch (ed); no removal of `HONOR_MODE_FIELD`; no Mundi edits.
## Rules (quote into the worker brief)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24; "Removing or renaming a published SDK name is the owner's call" — ruled here for Honour mode's key only.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
## Done means
`sdk:build` clean; sdk-tests with no new failure; the new tests green. Report in your hand-back in full (the lead saves it to `plans/REPORT-sl-2026-11-05.md`): the final names FIRST (fields, keys, judge, `handLocked`, the move levels), changed files, tests, §25 rows, open ★ (incl. the move levels), Noticed, not done.
