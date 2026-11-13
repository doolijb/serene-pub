# REPORT ed-w2 (lane ed) — 2026-11-05

Status question: none relayed. All 7 items done; nothing committed, no sdk:build, no git stash/checkout.

## Changed files
App (`/home/jody/github/serene-pub`)
- `src/lib/server/sessions/settings.ts` — `sessionHonourMode` -> `sessionKeepsEveryTurn(db, sessionId): Promise<boolean | undefined>` reading `fields.keepEveryTurn` (`undefined` when undeclared, else `=== true`); doc names the turn delete as its one read.
- `src/lib/server/messages/verbs.ts` — `turnDeleteVerdict` / `turnDeleteRefusedThrough` read it; **ON refuses** the owner's delete of the latest turn (`keepsEveryTurn === true`; the old `honour !== true` branch). `TURN_DELETE_REFUSALS.honourOff` -> `.keepEveryTurn`, sentence exactly as briefed. Comments rewritten (one "was Honour mode, renamed 2026-11-05" note). No other user of `honourOff` outside the FixTurn test.
- `src/lib/server/sessions/honorModeRetired.ts` (new, charter-shaped header) — `fromHonorMode(record)` and `retireHonorMode(db)`; `HONOR_MODE_KEY` const exported. Leaf imports only (drizzle, schema); `db` a parameter; `Db` is the ambient type.
- `src/lib/server/sessions/honorModeRetired.int.test.ts` (new, 8 tests): `fromHonorMode` true / false / absent / wrapper / new key present / non-boolean / input unchanged; the pass over 4 sessions + core, plugin-owned and plain presets; second run returns `{0,0}` and every row is unchanged.
- `src/lib/server/db/defaults.ts` — one hunk in `sync()` after the servers block (dated comment, dynamic import, `console.log` only on change, `console.warn` on failure).
- `src/lib/server/sockets/sessions.dungeonCrawlerFixTurn.int.test.ts` — helper `honour(sessionId, on)` -> `keepEveryTurn(sessionId, on)` writing `{ keepEveryTurn: on }`; default (ON) = refused with the new sentence; "Honour mode on" step now sets `keepEveryTurn: false`. Describe title and header comment re-worded; dated `// Moved 2026-11-05 (lane ed, plan §25)` comments; every case kept.
- `src/lib/server/pipelines/boot/specHashes.test.ts` — `core:spec/dungeon-crawler-create@1.0.0` re-pinned `58a64edcadb97` -> `97d4fff3d70ce` with a dated note. It was the only pin that moved.
- `src/lib/client/admin/sections/rulesets/rulesetWords.ts` — `rules` option gains the hint. `RulesetInlinePick.svelte` renders `c.hint` (line 117), so it will show.

SDK (`/home/jody/github/serene-pub-sdk`)
- `core-catalog/src/shared/ui/session-state/stateView.ts` — new `handLockOf(owner, slotId): string | undefined` (`@experimental` 🚧; name grepped first, unused anywhere). `giveTargets`: from-side unchanged (not `handLocked`); a place is always listed and `direct`; a person is `direct` iff `editable !== false && !slotLocked && !handLockOf`, else an offer (seats-only rule unchanged). Docs updated.
- `core-catalog/components/shared/state/SlotControl.svelte` — new optional prop `handLocked?: string`; a hand-locked slot is read-only, `data-locked` set, the `stat-slot.lock` part titled (and labelled) with the sentence; the old "Locked: only the story changes this" stays for a `config.lock` with no sentence. For a piece list it passes `writable=false` when hand-locked (so no Add), and `targets` only while the viewer can write the slot (`!readonly && slotWritable`).
- `core-catalog/components/shared/state/PieceCard.svelte` — Edit and Remove need `editable && !locked`; Give to… needs `targets.length > 0 && !locked` (its own condition).
- `core-catalog/components/shared/stats/StatsWidget.svelte` — passes `handLocked={handLockOf(shown.owner, one.slot.slotId)}` at the 4 SlotControl uses; import added.
- `sdk-tests/coreStatsPieces.test.ts` — `sheet()` gains `annHandLocked` / `strangerHandLocked`; "Honour turned on mid-session" test renamed and driven by `handLocked` (dated comment); new: hand-locked stat shows lock with sentence and no Edit/Remove/Add; hand-locked inventory still offers **Give to…** (direct) without Edit/Remove and asks `give-piece`; `giveTargets` place = direct, person with `handLocked` = offer, hand-locked giver still gives.

## Tests run
- `npx vitest run honorModeRetired.int.test.ts specHashes.test.ts sessions.dungeonCrawlerFixTurn.int.test.ts` — 3 files, 13 tests pass (8 + 2 + 3). No other `turnDelete*` suite exists (grep: only the FixTurn file references `turnDeleteVerdict` / `turnDeleteRefusedThrough` / `TURN_DELETE_REFUSALS`).
- SDK, capped scope: `coreStatsPieces.test.ts` + `sheetLatitude.test.ts` + `sheetLatitudeFields.test.ts` — 61 pass, 0 fail (coreStatsPieces alone: 21). No other test imports `giveTargets`.
- `cd ../serene-pub-sdk/sdk-tests && npx tsc --noEmit` — clean.
- `npx tsc --noEmit -p .` — 2 errors, neither mine: `src/lib/client/sessionLayout/arrangeCanvas.dom.test.svelte.ts(11)` (`NARROW_SIDE_PX`, pre-existing) and `src/lib/server/sockets/sessions.dungeonCrawler.int.test.ts(1728)` (`PLAYER_SHEET_REFUSAL` no longer exported by `state/write` — w1's removal; that Crawler test file is w1's).
- Prettier: ran `--write` only on my two new files.

## Choices
- Polarity: `keepsEveryTurn === true` refuses. A genre that does not declare the field returns `undefined` -> no verdict (as before).
- `fromHonorMode`: wrapper = a plain object having a `value` key; the new wrapper is `{ ...oldWrapper, value }` (so `lock`, `askAtStart` and any other wrapper key carry). Applied to sessions too, harmlessly. The pass prefilters with `column::text like '%"honorMode"%'` (the columns are `json`, not `jsonb`, so no `?` operator) and then maps in JS. It does not touch `updated_at`.
- PieceList (not in my owned files) is unchanged. I avoided editing it: SlotControl hands it `writable=false` when hand-locked, so PieceCard's `editable` carries the hand lock; PieceCard therefore has no separate `handLocked` prop (it would have been dead). Behaviour is what the brief asks: Edit/Remove hidden, Give kept, Add hidden.
- Tests moved: I did not touch the lock title on `piece-card.lock` (still "Locked", for `config.lock`).

## ★ (copy)
- 🚧 `rules` changer hint: *"Not by hand — unless the session lets people edit everything by hand"* (the supervisor's text, used exactly).
- 🚧 Boot log line: *"[sessions] Mapped the old Honour mode setting onto Keep every turn: N session(s), M preset(s)."* — a server log, not UI; it still says "Honour mode" because it names the old setting being migrated. Say if you want it reworded.
- The lock's `aria` label for a hand lock is the host's sentence (not translated: it arrives in the viewer's words from the host).

## Import files (item 3, grep)
No native session or preset import-from-file exists in `src/lib/server`: `sockets/import.ts` (~1326/1463) writes only `genreFields: { authorsNote }` (SillyTavern); `appletSessions.ts` takes `genreFields` from the launcher (checked against declared keys, so a stale `honorMode` is refused there); `sessions.ts` ~993/1054 read the create form. `plugins/exportPackage.ts` carries no preset `settings`. If a session export/import or `.serene` file reader lands, call `fromHonorMode(genre_fields)` there. Plugin preset settings: the call belongs on the registry-projection side (supervisor's), where a plugin declaration's `settings` is projected (`pipelines/registrations/presetRows.ts` has no `settings` handling I could find; `registrySync.ts` has no `honorMode` either).

## Noticed, not done
- `src/lib/server/sockets/sessions.dungeonCrawler.int.test.ts:1761` and `sessions.dungeonCrawlerWalk2.int.test.ts:673` still write `genreFields: { honorMode: true }` (w1's files); after this lane they set a retired key, which nothing reads — the intent ("players edit sheets / host deletes") is now `playerSheetLatitude` / `keepEveryTurn: false`.
- `session_presets.defaults` ("pre-fill for creation (fields…)") could in principle carry `honorMode` too; the ruling names only `settings`, so the pass leaves it. Core presets are re-seeded from the catalogue; only an admin-made preset could hold it.
- `docs/` and NOMENCLATURE still say "Honour mode" (out of scope; the ledger needs `keepEveryTurn`, `sessionKeepsEveryTurn`, `fromHonorMode`, `retireHonorMode`, `handLockOf`).
- `Header.svelte:56` comment mentions "Honour mode" (historical walk note; left).
