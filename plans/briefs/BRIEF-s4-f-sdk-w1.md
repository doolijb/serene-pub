# BRIEF — lane `s4-f-sdk`, worker 1 — S3G's "For S4" list (core-catalog) + ★K-1 docs/examples — 2026-11-08

You are a lane-worker for supervisor `s4-f-sdk`. SDK repo: `/home/jody/github/serene-pub-sdk` (edit SDK code **there**). App: `/home/jody/github/serene-pub`.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*

You do **not** run `sdk:build` at all (the supervisor does). Never `git checkout` / `restore` / `stash` in either repo — most of the SDK is uncommitted. Prettier: `--check` changed files, and **only reformat lines you changed** (never a whole-file `--write`). Scratch files go in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, named `s4-f-sdk-w1-*`.

## Context (what the programme is doing — read, don't build beyond your goal)

Seat-cast S4 "the flip": in wave 3 core stops emitting **card forms** and emits **member forms**. Rekey rule (plan §34.1): a character seat's state owner `session_cast` id=<card> (state key `<cardId>`, e.g. `"12"`) becomes owner kind `seated_member` id=<cast member id>, state key **`seated_member:<id>`** (★K-1, ruled 2026-11-08: "`cast.byId` key `seated_member:<id>` (mirrors `player_seat:<id>`; a stale card-key reader finds nothing rather than the wrong person)"). A player seat — carded or not — becomes owner `player_seat` / key `player_seat:<seatId>`, participant ref `player-seat:<seatId>` (★27-3). Participant refs: character seat `seated-member:<castMemberId>` (⏳ `character:<cardId>` before the flip and until S5).

⚠ **Waves 1–3 are one unit.** Your changes must leave everything working while core still emits card forms: everything you add is **additive and tolerant of both forms**. Never remove a name or a reading core still emits (that's S5). Card ids and cast member ids share one number range: a card-form value must never match a member-form value of the same number (never the wrong person).

**Modder rule (owner 2026-11-08):** plugins never parse ref strings (typed, host-filled fields and helpers do it); one JSDoc sentence per new field; INTEGRATING and the guide examples move in the same change; a refusal says what to do instead.

Vocabulary (NOMENCLATURE, quoted): "A **seat** is a place at the table … never a type name alone (R3): always one of its two kinds. A **character seat** is a `session_characters` row … A **player seat** is a `session_personas` row." R1 one word one meaning; R6: mark ⏳ transitional (expires on a known event — here "until S5") / 🚧 provisional. **Do not introduce any new exported name** (function, type, field, constant). If you find you need one, stop and say so in your report.

## Goal

1. **`core-catalog/components/shared/stats/StatsWidget.svelte` ~336 `hasFace`**: today `o.kind === "session_cast" || o.kind === "player_seat"`; a `seated_member` owner must get its face too. Test: add a case to `sdk-tests/coreStateWidgets.test.ts` (the "core's Stats component" describe) where the cast owner is `kind: 'seated_member'` and the face button (`button[data-widget-part~="stats.face"]`) is drawn. This is a happy-dom suite — run it only in the capped scope below.

2. **Owner matching in `core-catalog/src/shared/ui/scene-portraits/portraits.ts`**: `stateOwnerKeyOf` (~390) and `pinnedPortraitsOf` (~480) match only `session_cast`/`seated_member` owners. A **`player_seat` owner matches by the seat's `ref`** (exact `o.ref === ref`) like `seated_member` does — **by `ref` only, never by `castMemberId`** (a member holding a character seat and a player seat shares one `castMemberId`; matching a player seat by member id would hand a character the seat's stats). Update the JSDoc. Tests in `sdk-tests/scenePortraits.test.ts` (or `sdk-tests/seatCastViews.test.ts`, whichever already tests `stateOwnerKeyOf`/`pinnedPortraitsOf`): a `player_seat` owner with `ref: 'player-seat:4'` is found by a member/pin whose ref is `player-seat:4`; a `player_seat` owner whose `castMemberId` equals the member's is **not** matched by member id; today's card-form cases unchanged.

3. **Scene Portraits stored lines** (same file): `chosenImagesOf` already reads `seated-member:<id>=` and ⏳ `character:<id>=`. But in `scenePortraitsOf`, a member's line is found by `chosen.get(m.ref)` then `seated-member:<castMemberId>` — after the flip `m.ref` is the member form, so a stale `character:<cardId>=` line is no longer read. Add a ⏳ third fallback: `m.cardId != null ? chosen.get(\`character:${m.cardId}\`)` (host-filled `cardId` only — never `characterId`, never a member id). Same ⏳ tolerance in `scenePortraitMembersOf`'s `pick` matching: a `character:<cardId>` line also matches a member whose `cardId` equals it. Fix the two settings JSDoc lines (~69 `pickMembers` "or a `character:<id>`", ~76 `chosenImages` "`character:<id>=<image ref>` pair") to say `seated-member:<id>` (🚧) with ⏳ `character:<id>` still read until S5. Tests: S4-shape member (`ref: 'seated-member:7'`, `castMemberId: 7`, `cardId: 3`) with a stored `character:3=` line gets that image; a `character:7=` line does **not** reach it (id collision); pick by `character:3` finds it; today's cases unchanged.

4. **Crawler round script `hasDeclared`** (`core-catalog/src/genres/dungeon-crawler/roundScript.ts` ~128, a plain-ES5 string): today, once `s.ref` is set, only `declared.indexOf(s.ref)` counts. A declaration must count when stamped with the seat's current `ref` **or** its pre-flip card form `"character:" + s.persona.id` (when `s.persona && s.persona.id != null`) — so wave 3's flip doesn't orphan a declaration made mid-round. Keep `user:<id>` and the `player-seat:<seatId>` reading as they are. Update the header comment (~11-14) in one sentence. Tests in `sdk-tests/seatCastScripts.test.ts` (or `dungeonCrawler.test.ts`, whichever runs the round script): seat with `ref: 'player-seat:4'`, `persona.id: 12` → declared under `player-seat:4` counts; under `character:12` counts; under `character:4` does not; a seat with no ref behaves as today.

5. **★K-1 docs** — say that the session-state `cast.byId` / `resolved.cast` key is an opaque owner key (`player_seat:<id>`, 🚧 `seated_member:<id>` from the flip, ⏳ the card id before it), and that a reader looks an entry up by its host-filled `ref` / `castMemberId` (or the owner's `key`), **never by building or parsing the key**:
   - `sdk/src/widgets.ts`: `SessionStateOwnerV1` block comment (~886-896) and its `key` field doc (~901), `SessionResolvedStateV1.cast` (~788).
   - `contracts/src/queries.ts` `sessionState` JSDoc (~2913-2927): the `configs['player_seat:4']` example is fine; the sentence "(the key is ⏳ the card id until the flip)" becomes the K-1 wording. Do **not** touch `lorebook-state@1`'s doc (its cast is keyed by cast member id; a different document).
   - `core-catalog/src/shared/ui/scene-portraits/portraits.ts` `SceneFigure.key` doc (~300, "`player_seat:4`, `12`").
   - `INTEGRATING.md` (`/home/jody/github/serene-pub-sdk/INTEGRATING.md`): §1c ~line 885-888 ("`state.configs[<owner key>][<slot id>]` (`world`, or a `cast.byId` key)") — add the K-1 sentence once; read §1d (~922-996) and §1f (~1035-1083) and correct any sentence that implies a card-id key or tells a reader to build a key/ref (likely none in §1d/§1f — then leave them and say so).
   - Changing a JSDoc in `contracts/src/**` may move no hash (hashes are over contracts, not prose) — if any SDK golden moves, report which; don't repin anything yourself.

6. **The widget example** (`guides/widget-examples.md` ~223-305, and its tested fixture `sdk-tests/fixtures/widget-examples/components/MoodDial.svelte` + `sdk-tests/fixtures/widget-examples/src/index.ts` + `sdk-tests/widgetExamples.test.ts`): it finds the viewer's owner by `o.kind === 'session_cast' && o.label === persona.name` — after the flip the viewer's owner is a `player_seat`, so the example breaks. Change it to the host-filled `mine` flag (`SessionStateOwnerV1.mine`: "True on the one owner that is the viewer's own: their player seat (card-less or carded), else the persona they play"): `owners.find((o) => o.mine) ?? owners.find((o) => o.kind === 'session')`. Then the `persona` scope is unused: drop it from the example's declared scopes (fixture `index.ts:32`, the guide's scopes table row and the comment) — keep guide and fixture identical. Update the bullet "**Whose stats.**" (~302-305) — it says "A cast owner does not name its character yet, so the widget finds the persona's owner by its label" → say it finds the viewer's own owner by `mine`, never by a kind or a key. Update `widgetExamples.test.ts` fixtures (`mine: true` on Mira; the "without a persona the world's stats are drawn" step becomes "with no owner of the viewer's" — push a state with no `mine`). The written request `{ owner: { kind: owner.kind, id: owner.id } }` stays. This suite is happy-dom — capped scope only.

## Files owned (edit only these)

SDK: `core-catalog/components/shared/stats/StatsWidget.svelte` (the `hasFace` line only), `core-catalog/src/shared/ui/scene-portraits/portraits.ts`, `core-catalog/src/genres/dungeon-crawler/roundScript.ts`, `sdk/src/widgets.ts` (doc comments only), `contracts/src/queries.ts` (the `sessionState` JSDoc only), `INTEGRATING.md` (§1c–§1f only), `guides/widget-examples.md`, `sdk-tests/fixtures/widget-examples/components/MoodDial.svelte`, `sdk-tests/fixtures/widget-examples/src/index.ts`, and the test files named above (`coreStateWidgets.test.ts`, `scenePortraits.test.ts` / `seatCastViews.test.ts`, `seatCastScripts.test.ts` / `dungeonCrawler.test.ts`, `widgetExamples.test.ts`).

Worker 2 runs beside you on `contracts/src/outlets.ts`, `sdk/src/executor.ts`, `sdk/src/registry.ts`, `sdk/src/descriptors.ts`, `guides/forms-and-effects.md`, `INTEGRATING.md` (a **new section at the end** only — don't touch the end of the file) and app files. Don't edit those.

## Out of scope

`sdk/src/turnOrder.ts`, `core-catalog/src/shared/ui/conversation/**`, `core-catalog/components/shared/messages/**` (a later worker). Any app file. Changing `character:<id>` examples in other guides (channels, forms-and-effects, storage, time, genres-presets-and-routines, writing-lore) — list them under Noticed. Any golden repin.

## Tests (capped scope, logged)

SDK tests run with `node:test` via tsx from the `sdk-tests` dir:

```
cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx tsx --test scenePortraits.test.ts seatCastViews.test.ts seatCastScripts.test.ts dungeonCrawler.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w1-tests.log'
```

Run the two happy-dom suites (`coreStateWidgets.test.ts`, `widgetExamples.test.ts`) **one at a time**, each in its own capped scope as above. Never pipe test output into `head`. Typecheck: `cd /home/jody/github/serene-pub-sdk && npx tsc --noEmit -p sdk-tests` (report before/after error counts). Run the touched suites once **before** your edits to record the baseline.

## Done means

Every test file above green (or failures shown pre-existing in your baseline), the new cases listed in each goal present, `tsc -p sdk-tests` no new errors, prettier clean on lines you changed.

## Report (your final message — the supervisor reads it)

Changed files (each with a one-line why); tests run with before/after results; tsc before/after; any SDK golden that moved; anything you couldn't do and why; **Noticed, not done**.
