# REPORT — lane s4-rul-a (2026-11-10)

Saved by the lead from the supervisor's final message.

All four goals are built; the lane's targeted tests pass (22 files, 258 tests final run; 4 files, 22 tests after the admin fix). Not as briefed: the seater's **configure** (★s4-rul-a-1) and the gallery refusal for session guests (★s4-rul-a-2). No `sdk:build` (owner's `vite dev` on :5173). No relayed status question.

## Goals

### 1. Card stats refused at the session sheet (★s4-fb-1) — worker w3
- `sockets/state.ts` `stateSet` (~1576) and `stateConfigure` (~1679) refuse `target.kind === "card"` with **"Card stats are edited in the card editor."** (module-local const `CARD_STATS_ELSEWHERE` ~221). Runs right after `owner(...)` resolves, before `handEditRefusal` and any write. In `stateSet` it goes through `reply.emitToUser`, so it carries the `requestId`. `write.ts` and `state:setCarry` untouched.
- `state.ownerScope.int.test.ts`: card dropped from "the session's own durable owners still write"; new test — set and configure on the caller's own card and another user's card are refused with the sentence and write no row; expectations ~225, ~285, ~288 now expect the sentence; direct `configure()` calls ~291–292 still pin the write layer's rule.
- `worldScope.int.test.ts` ~867: one expectation (a guest sets the host's card) now expects the sentence.
- Session UI check: no session UI offers a card-owned stat control (`describeState` builds no `card` owner row; client `requests/setAttributeValue.ts` already refuses a card owner). Nothing removed.

### 2. The seater edits hidden stats while showing them (★s4-fb-3) — worker w3
Showing counts as hearing. Only the `heard` input to the one judge (`sheetLatitudeAllows`) changes; latitude, lock and `changedBy` checks untouched; no second decider.
- `state/handEdits.ts`: `handEditRefusal(db, q, known = {})` takes optional `known: { links?, hearing? }` and passes it to `handEditJudge`. `give.ts` unchanged.
- `sockets/state.ts`: `stateSet` / `stateConfigure` pass `{ links, hearing: callerView }`; `stateProposals` lists with `callerView`; `stateDecide` uses `callerView` for the "Proposal not found." gate and the reply; `describeState` gives the judge `viewHearing`, so `editable` / `handLocked` match the write gate; `callerView` adds only seats the caller seated (`seated_by_user_id`) **and** asked to show.
- Comments rewritten (`callerView` ~381, `describeState`'s `viewHearing`, `hearingWithHiddenStats` in `earshot.ts`), each citing ★s4-fb-3.
- **Configure not built (★s4-rul-a-1).** The seater's `state:configure` is still refused (*"Only the session owner changes how a stat is set up."*): the SDK judge refuses every non-owner configure (`owner-locks`, `sdk/src/sheetLatitude.ts:197`) before earshot. Pinned by a test naming the open ★.
- `state.hiddenStats.int.test.ts` (12 cases, carded and card-less seat): seater view on — set written, proposal listed, accept and reject answered, configure refused (★); view off — set refused, proposal not listed, decide "Proposal not found."; third user even sending `showHiddenStats` — refused / not listed either way; session owner unchanged.
- `docs/stats-and-states.md` ~232: while the view is on the seater can also change those values and answer changes proposed to them; lists who can change a whisper; doesn't promise configure.

### 3. Rename overhear → hidden stats — worker w2
| Old | New |
|---|---|
| SDK request `'overhear-seat'` (request map, grant, reach) | `'show-hidden-stats'` |
| SDK `SessionStateOwnerV1.overhearing?` | `showingHiddenStats?` |
| app `StateOwnerRow.overhearing?` | `showingHiddenStats?` |
| app `State.Get.Params.overhear?` | `showHiddenStats?: string[]` |
| `overheard()` (`earshot.ts`) | `hearingWithHiddenStats()` |
| `overheardMembers()` | `hiddenStatsShownMembers()` |
| `socket.data.overhear` | `socket.data.hiddenStatsShown` |
| `describeState` param / local / row field | `hiddenStatsShown` / `showingHiddenStatsOf` / `showingHiddenStats` |
| client `overheard` / `setOverhearing` | `hiddenStatsShown` (`SvelteSet`) / `setShowingHiddenStats` |
| `answerOverhearSeat` / `OverhearSet` | `answerShowHiddenStats` / `ShowHiddenStatsWrite` |
| widget parts `stats.overhear*` | `stats.hidden-stats`, `-switch`, `-help`, `-error` |
| widget locals | `hiddenStatsBlock`, `setShowHiddenStats`, `hiddenStatsError` |

- UI: `t("Show hidden stats")` (label and `aria-label`), `t("Stats only {name} knows, on your screen only. The AI still plays {name}.")`.
- Renamed files: `requests/overhearSeat.ts` → `showHiddenStats.ts` (+ test); `sockets/state.overhear.int.test.ts` → `state.hiddenStats.int.test.ts`; `state/earshot.overheard.test.ts` → `earshot.hiddenStats.test.ts`.
- INTEGRATING ~1256 moved; `guides/widgets.md` regenerated; `docs/stats-and-states.md` carries the label.
- No `overhear` / `Show secrets` left in `src` (outside `generated`), `docs`, `sdk/src`, `core-catalog/components`, INTEGRATING or guides. Never published: no migration note.

### 4. Card files a member draws, through the member (★s4-fb-4) — worker w1 + supervisor fix
- `media/access.ts`: one new branch (after member-art and seating, before account-avatar). Admits a file a cast member draws from its card: **card sprite** (card-owned set; member linked by `lorebook_bindings.character_id` or a version whose parent card version is that card; member draws no sprites of its own, `spriteLabelsForMembers`), **followed face** (version follows `faceMediaId`, parent card version's `face_media_id` is the file), **followed likeness image** (same with `likeness->>'imageMediaId'`).
- Reader rule `canReadCastMember` (book readable, or in a live session seating the member), reused. `canViewCharacter` unchanged. Retired versions count, as `wornByVersion` already does. Only new name: local alias `parentVersion`.
- Supervisor fix after scope review: `canReadCastMember(db, memberId, userId, { isAdmin: false })` — the default would have given admins every private card's sprites, face and likeness. A live provided book still counts as shared (`lorebookAccessFor`, ★M3-1).
- New `access.cardCascade.int.test.ts`, 7 cases: shared-book reader and session guest load sprite, followed face, followed likeness; stranger refused; admin without share refused; card gallery picture refused for the shared-book reader; member owning its face doesn't open the card avatar; member drawing own sprites doesn't open the card sprite.
- `sprites.fromCard.int.test.ts`: the "media finding" test now expects `true`, renamed.

## Changed files
- App: `src/lib/server/sockets/state.ts`, `src/lib/server/state/handEdits.ts`, `src/lib/server/state/earshot.ts`, `src/lib/server/media/access.ts`, `src/lib/shared/sockets/types.ts` (2 lines, 17238 and 17374), `src/lib/client/state/sessionState.svelte.ts`, `src/lib/client/styles/widgets.css` (~5290, ~5329), `src/lib/client/components/sessionPage/projections/sessionState.ts`, `.../requests/index.ts`, `.../requests/showHiddenStats.ts` + test (renamed), `docs/stats-and-states.md`.
- App tests: `sockets/state.hiddenStats.int.test.ts` (renamed, reworked), `state/earshot.hiddenStats.test.ts` (renamed), `sockets/state.ownerScope.int.test.ts`, `state/worldScope.int.test.ts` (one expectation), `media/access.cardCascade.int.test.ts` (new), `sockets/sprites.fromCard.int.test.ts` (one test).
- SDK: `sdk/src/widgets.ts` (request and flag), `core-catalog/components/shared/stats/StatsWidget.svelte`, `INTEGRATING.md`, `guides/widgets.md` (regenerated).
- Worker briefs: `plans/briefs/BRIEF-s4-rul-a-w1.md`, `-w2.md`, `-w3.md`.

## Tests
- Final lane run (capped): 22 files, 258 passed, exit 0 — every `sockets/state.*.test.ts`, `state/earshot*`, `state/*handEdit*`, `media/access.*`, `media/media.int`, `sprites.fromCard.int`, `worldScope.int`, `sessionAccess.seatMember.int`, and the `showHiddenStats`, `setAttributeValue`, `sessionState` client tests.
- After the admin fix: `access.cardCascade`, `sprites.fromCard`, `access.memberArt`, `access.memberFace` — 4 files, 22 passed.
- SDK widget parts: `cd ../serene-pub-sdk/sdk-tests && npx tsx --test widgetParts.test.ts` 2/2 (node:test, not vitest).
- Waiting on the SDK build: the rest of the SDK suite, any core-catalog DOM test of the Stats widget.

## tsc / check
- Before: 3 errors each, all waiting on `sdk:build` (`overhear-seat` ×3).
- After, tsc 4: the same 3 renamed (`requests/index.ts(627,2)` TS2353 `"show-hidden-stats"`, `requests/index.ts(627,24)` TS7006, `requests/showHiddenStats.ts(11,30)` TS2339) + 1 from lane s4-rul-c (`startSessionBookSources.dom.test.svelte.ts(270,56)` TS2345).
- After, check: the same 4 errors, 8 warnings, none in lane files.
- After the SDK build: drop the TODO cast in `projections/sessionState.ts` (~130).

## Open ★
- **★s4-rul-a-1 — the seater's configure.** Owner 2026-11-10: *"…can also change and configure its hidden stats and answer its hidden proposals."* The one judge refuses every non-owner configure (`owner-locks`) before earshot; its root is plan §25 B, owner 2026-11-05: *"`configure`: only the session owner sets/clears a lock."* — locks only; refusing a non-lock configure was supervisor-proposed copy. **Recommend:** in the SDK's `sheetLatitudeAllows`, judge a non-owner configure with **no** lock key like a set (earshot → lock → latitude → `changedBy`); lock changes stay owner-only. Trade-off: players could configure non-lock settings on their own sheets wherever latitude lets them set; SDK behaviour change, needs `sdk:build`. Alternative: keep configure owner-only and change the docs wording.
- **★s4-rul-a-2 — gallery refusal for session guests is impossible as briefed.** `canViewCharacter` already admits a session guest to every file whose `files.character_id` is the card (walks sessions seating a member linked to it). Gallery test pinned for the shared-book reader only. **Recommend:** leave it (today's rule). Trade-off: narrowing changes `canViewCharacter` for every card file.
- **Confirm (built narrow):** no admin exception in the fb-4 branch; a live provided book counts as shared; the guest half uses live seats only.

## NOMENCLATURE rows queued (lead merges)
- §9 seat row (~418): replace 🚧 **overhear** with 🚧 **hidden stats view** — showing is hearing; set and answer pending changes, judged by `sheetLatitudeAllows` (configure stays the owner's; ★s4-rul-a-1 open); never `mine`; UI and code names as in the table; `handEditRefusal(db, q, known?)`; SDK 🚧 `'show-hidden-stats'` (`'core'` grant, `'session'` reach), 🚧 `SessionStateOwnerV1.showingHiddenStats?`, parts `stats.hidden-stats*`.
- New short **Earshot** group: earshot · holder-only · hearing · hidden stats view; cast lore (S5) is not in it; ⚠ against toolState *Hidden* (~1712), retired per-seat *Hidden* (§23 ~1530), message **Hide** / *Hidden from the story* (~1711), hidden plugin carrier cards (★S4-1, ~354), plugins' "hidden state" (~1758).
- §25 2026-11-10 (lane s4-rul-a): the rename (retired names never published, no §23 row); ★s4-fb-1 refusal retiring plan B0's card write; ★s4-fb-4 media branch. Amend the 2026-11-09 entry (~3769) that calls overhear read-only.

## Noticed, not done
- `givePiece` and `state:setCarry` still judge with `callerHearing`: a shown seat's holder-only item move would be refused while `state:set` passes.
- `state/write.ts` `assertSeatDecider` (~3093) calls `handEditJudge` without `known` (reads role and whose only; doesn't block).
- `docs:build` not run; `src/lib/generated/docs` carries old wording.
- Prettier fails on lines the lane didn't write in several touched files; left alone.
- INTEGRATING ~1256 and the `widgets.ts` JSDoc wrap raggedly after the word swap.
- `/tmp/serene-pub-vitest-*` dirs 17:06–17:17 can't be told apart from s4-rul-c's; none deleted.

## Scope review
1. (medium) fb-4 branch opened card files to admins — fixed (`isAdmin: false` + test).
2. (low) new names not yet in NOMENCLATURE — queued above.
Otherwise: all edits in owned or granted files; `types.ts` exactly 2 lines; no new settings, flags, events or abstractions; judge untouched; copy matches the owner's words.
