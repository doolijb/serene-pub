# Turn controls (programme 2.3; TC1, TC2) — lane plan, 2026-11-18

Status: **GO (owner 2026-11-18, fifth answers: TN1 "Use these names", TN3 Round robin with an upgrade note, TN4 "Remove them in this work"; TN2 lead's choice: each entry keeps its own settings).** The six points in §6 are settled: 1, 2, 5 by the lead as recommended; 3 = TN2; 4 = TN3; 6 = TN4. Originally a draft from a read-only planning pass. Facts: `INVENTORY-turn-controls-2026-11-17.md` (five line references drifted: `EditSessionForm.svelte` Turn order card gate now 3578–3584; `host.ts` `set-turn-order` handler 4114; `turnMode` read in `host.helpers.ts` 118; `sillyTavernParsers.test.ts` 268, 272; `createSession.test.ts` 125, 139). `swapFitFinding` (`sdk/src/descriptors.ts` ~2567) still demands the same kind: the 2026-11-15 swap-fit relaxation was never built and this plan does not need it.

## 1. Target shape

**(a) Event and entries.** Core declares one event with `defineEvent` in `CORE_EVENTS`, flagged "one registration runs". The host raises it after each event that can change whose turn it is; the payload carries the causing event and its `EventCause`. An author writes `register(coreEvents.turnOrderAsked, roundRobinTurnOrder(genre), { label, default: true })`; a preset adds or removes entries with its existing `register` / `drop` / `change`. `effectiveRegistrations` merges layers as today; `registrationsOn(db, sessionId, event)` (`pipelines/registrations/resolve.ts` 488) lists them. For this event the host runs exactly one: the session's stored key, else the one marked `default`. An entry's name is the registration's `label`, else the pipeline's name. Each option is a whole pipeline built by `turnOrderSpec` (event → history → pool → mentioned → one strategy → voices → `set-turn-order`); the factory loses `swaps`, `advise` and the `decide` junction. The model-backed option is the same factory with the `turn-advise` oracle as its strategy step. Dungeon Crawler's round script is its own registration. `registrationFindings` gains: no default, two defaults, a genre with no registration on the event. Precedent: `message-deletion-asked`.

**(b) Auto-advance.** One boolean `genre_fields.autoAdvance`, declared by every genre from `AUTO_ADVANCE_FIELD` (`core-catalog/src/registry/genres.ts` 77). How far "on" runs is a second key `autoAdvanceRuns` (`next` / `round`): Story declares it as its own owner-reach field; Chat, the Guide, the Lair and Dungeon Crawler state `next` as a pinned setting with no control (today's behaviour). `sessions/autoAdvance.ts` 196–204 reads both from `resolveSessionSettings` and stops supplying `next`. Stored `off` → switch off; `next` → on + `next`; `round` → on + `round`. A boot pass, not read-time mapping (the settings form validates stored values against the declared type). One pure mapping function serves the pass, the reader (bridge until the pass has run) and the importers.

**(c) Rendering.** Both controls sit in the genre's group of `SessionSettingsForm` under "Turns", built by `sessions/settingsForm.ts`, written through `sessions:updateSetting`. Turn order is a new address kind, emitted only when the session has more than one registration on the event; owner reach; ignores Show advanced controls. Story's "how far" shows under the switch only when it is on. The turn-order swap picker leaves `PipelineCards`.

## 2. Names proposed (★; none ruled)

| Thing | ★ | New SDK name? |
|---|---|---|
| Event | `core:event/turn-order-asked@1`, `coreEvents.turnOrderAsked`, "Turn order asked" | yes |
| Event flag | `EventDef.runsOne: true` | yes |
| Registration field | `RegistrationDecl.default?: true` | yes |
| The option | **turn order option**; column `sessions.turn_order_option` | no |
| Switch | `autoAdvance: boolean` (key kept, type changed) | changed |
| Extent | `autoAdvanceRuns: 'next' \| 'round'` | yes |
| Field visibility | `FieldDecl.presentWhen?: ConditionDecl` | yes |
| Builders | `roundRobinTurnOrder`, `byUserTurnOrder`, `randomTurnOrder`, `narratorTurnOrder`, `modelTurnOrder` | yes |

Labels: **Turn order** "Who is prepared to speak next, and in what order." · **Auto-advance** "After you send, the next reply starts by itself. Off: nothing starts until you press Continue." · **Auto-advance runs** (Story; *Next turn* / *Whole round*) "How far it goes before waiting for you."

Published names removed or changed (owner's call): `TURN_MODE_FIELD`; `AUTO_ADVANCE_FIELD` members; `turnOrderSpec({ swaps, advise })`; `turnStrategyNode({ advise })`; `TURN_ORDER_EVENTS` / `TURN_ORDER_NARRATOR_EVENTS`; `TurnOrderHandle.events` / `strategyNode`; `TURN_STRATEGY_NAMES`.

## 3. Lanes (in order; SDK lanes one at a time)

- **tc-1a SDK declarations (sdk:build).** Event, `runsOne`, `default`, `presentWhen`, door findings; all additive. SDK: `sdk/src/events.ts`, `registrations.ts`, `settings.ts`, `genres.ts`, conformance (C35–C37 file), `index.ts`; `sdk-tests/turnOrder.test.ts`, new `sdk-tests/turnOrderAsked.test.ts`.
- **tc-1b app runtime and column.** Host raises the ask, runs one registration, stores the choice; old per-event registrations keep working. App: `pipelines/runtime/host.ts`, `host.helpers.ts`, `sessionEvents.ts`, `pipelines/registrations/resolve.ts`, `pipelines/boot/eventMapCheck.ts`, `db/schema.ts` + generated `0171`, `sessions/settings.ts`, `sessions/turnOrderPush.ts`, `sockets/sessions.ts` (only if the push frame needs the option's name); new `sessions/turnOrderAsked.int.test.ts`. Unchanged and green: `sessions.turnOrder.int.test.ts`, `turnOrder.write.int.test.ts`, `fireTurn.int.test.ts`.
- **tc-1c stored-data pass.** New `pipelines/boot/turnControlsPass.ts`, `bootstrap.ts`, new `sessions/turnControlsMapping.ts`, new `pipelines/boot/turnControlsPass.int.test.ts` (second boot writes nothing).
- **tc-1d catalogue options (sdk:build).** Removes the implied strategy. SDK: `core-catalog/src/factories/turnOrder.ts`, `genres/{story,chat,guide,lair,dungeon-crawler}/turnOrder.ts`, `genres/defaults.ts` (152–155), `shared/ui/turn-order/index.ts`; `sdk-tests/modderPass.test.ts`, `coreTurnOrder.test.ts`, `deriveDontSpell.test.ts`. App: `pipelines/runtime/turnAdvise.int.test.ts`. Snag: the factory throws when `advise` is given without `turnMode`, so `advise` goes here and Story's `turnMode` line in tc-1e.
- **tc-1e Auto-advance (sdk:build).** Removes core's silent `next`. SDK `core-catalog/src/registry/genres.ts`; app `sessions/autoAdvance.ts`, `autoAdvance.int.test.ts`, `sessions/settingsForm.ts`.
- **tc-1f importers.** `utils/sillyTavernParsers.ts`, `sockets/import.ts`, `attic/finish.ts`; tests `utils/sillyTavernParsers.test.ts`, `attic/upgrade.int.test.ts`.
- **tc-1g owner's controls.** `sessions/settingsForm.ts` (after tc-1e), `sockets/sessionSettings.ts`, `SessionSettingsForm.svelte`, `SessionSettingField.svelte`, `sessionSettingsForm.ts`, `EditSessionForm.svelte`, `PipelineCards.svelte`, `applyPresetDefaults.ts`, `createSession.svelte.ts`; tests `sessionSettingsForm.dom.test.ts`, `applyPresetDefaults.test.ts`, `createSession.test.ts`.
- **tc-1h words.** `NOMENCLATURE.md` (rows 465, 469, 470, 472, 650; fix `sessions.metadata.turnOrder` → `sessions.turn_order`), `docs/sessions.md` (432, 610, 753, S10 charter), `docs/group-sessions.md`, `docs/genres.md`, SDK `INTEGRATING.md` §1e, §6, the modder starter.

**A genre with no turn order registered:** the package build and the door warn, never refuse. In a session no order is prepared, nothing fires by itself, Pick who speaks and Continue work as today; the Turn line says "This genre sets no turn order. Pick who speaks, or press Continue."

## 4. Stored data (all in tc-1c except the column)

| Shape | Change |
|---|---|
| `sessions.turn_order_option` | new nullable text; null = the default (generated 0171) |
| `genre_fields.autoAdvance` (sessions; preset / genre values in `registrations` rows) | string → boolean, plus `autoAdvanceRuns` where declared |
| `genre_fields.turnMode` | `model` → the model option's key; field deleted |
| Session `pipeline_node_rebinds` on `strategy` / `decide.rules.strategy` | user-split, random, narrator → option keys; round robin → null; `turn-manual` → null + `autoAdvance: false`; row deleted (precedent `seed.ts` 697–850) |
| Preset `swaps` naming a turn-order strategy | folded into the preset's turn-order value |
| Session step values on old turn-order registrations (pool, mentioned) | copied to the chosen option's registration |
| Per-event turn-order registrations (9, 4 or 6 per genre) | re-projected at boot by `registrations/project.ts`; session rows on old keys dropped |

Importers: "manual" writes `autoAdvance: false` and no rebind; `userSplit` writes the by-user option key. Not verified: whether a session export file carries `genre_fields`.

## 5. Tests pinning today

Must change: `autoAdvance.int.test.ts`; `turnAdvise.int.test.ts` 190–306; `sillyTavernParsers.test.ts` 268, 272; `attic/upgrade.int.test.ts` 445–458; `applyPresetDefaults.test.ts` 32, 41; `createSession.test.ts` 125, 139; `sdk-tests/turnOrder.test.ts`; `sdk-tests/modderPass.test.ts` 139–214; `sdk-tests/coreTurnOrder.test.ts`; `sdk-tests/deriveDontSpell.test.ts` 209, 256.

## 6. Open with the owner

1. Which events raise the ask. ★ one core list (today's nine plus `annex-changed`), cause in the payload; a pipeline that should not answer some causes starts with its own gate step.
2. Where the choice lives. ★ the new column (one migration); alternative: N−1 "dropped" rows, but a later-added option would become active unasked.
3. Pool and mention settings on switching option. ★ each option keeps its own; the pass copies today's values to the chosen one.
4. Story sessions on Scripted with an administrator's script. ★ move to round robin with an upgrade note naming the session.
5. A genre that declares the switch but states no extent. ★ nothing fires, the Turn line says why; conformance fails shipped genres.
6. Removing the published names in §2. ★ remove in tc-1d / tc-1e (programme line 213 lists "turn-order registration" among breaking shapes before 0.7).

## 7. Rulings that disagree

- 2026-11-15 evening "★S1-b: the SDK's swap-fit rule is relaxed so a model-backed strategy can fill the turn-order slot" vs 2.3 "Turn order options are pipelines registered on one built-in core event … a model-backed one … are all such pipelines." Plan follows 2.3.
- 2026-11-15 "the genre or preset states how far 'on' runs" vs TC1 2026-11-18 "Story adds a second setting for how far it runs." Plan follows TC1.
- 2026-11-15 evening "only Story shows a select at first; behaviour unchanged" vs 2.3 "Core's silent default goes. Importers map 'manual' to Auto-advance off." Sessions on Manual change.
- Programme 212 "Modders must declare a turn order" vs standing "genres expect, never lock." Plan reads "must" as a warning plus the degrade above.

## Cold review corrections (2026-11-18) — these rule over the text above

**Lane order is now: tc-1a → tc-1b → tc-1d → tc-1e → tc-1c → tc-1g → tc-1h.** tc-1f is folded into tc-1d. Every lane leaves a working app with `tsc` clean. All turn-control lanes finish before `rg-1b` starts (both edit `db/schema.ts`, `registrations/resolve.ts`, `boot/bootstrap.ts` and generate a migration). A migration takes **the next free index at generation** (0171 is taken), never a number written here.

1. **The stored-data pass (tc-1c) runs after the shapes it writes exist** (after tc-1d and tc-1e). Until it has run, tc-1e's reader accepts both the old strings (`off` / `next` / `round`) and the new values through the one mapping function (§1b's bridge), and tc-1d's options read an old rebind / `turnMode` through the same function, so no session changes behaviour between lanes. tc-1c's second-boot test is written against the new catalogue.
2. **tc-1d also owns** `src/lib/server/pipelines/boot/seed.ts` (`moveSpeakerRebinds`, 727–849, run from `bootstrap.ts` 523–526), `attic/finish.ts` 188–210, `sockets/import.ts` 1570–1585, `utils/sillyTavernParsers.ts` (+ the tc-1f tests) and the `host.helpers.ts` 109–120 cleanup of `turnMode === "model"`. `moveSpeakerRebinds` must not delete an older row it can no longer place (its drop rule ~818–826): until tc-1c it leaves turn-order rebinds alone; tc-1c's pass then maps the old `speaker` rows and retired-spec rows too, and retires `moveSpeakerRebinds`' turn-order half.
3. **TN3 in the pass.** §4's rebind table gains: `core:task/turn-scripted@1` → null (round robin). Where an administrator's script is attached at the `select` point, the pass writes one record naming the session, in the same transaction that deletes the rebind (so a second boot has nothing to note). Scripted with no script attached is plain round robin already (`contracts/src/tasks.ts` 2857–2865) and needs no note. The record goes to the place administrators already read upgrade or activity notes on 0.6; the lane finds it and names the writer and topic in its report. If no such place exists for a 0.6 boot pass, the lane stops that part and asks (a new surface is the owner's).
4. **Create and branch write the choice.** `sockets/sessions.create.ts` (1114–1150: a preset's or the create form's turn-order choice is written to `sessions.turn_order_option`, not as a rebind) and `sessions/branch.ts` (160–228: the column is copied) join tc-1b. A preset states its turn order as a registration-layer change that marks one entry `default: true`; no new stored key and no new name.
5. **Which causes an option answers.** Core raises the ask on one list with the cause in the payload; each ready-made builder takes the causes its genre answers today (`core-catalog/src/factories/turnOrder.ts` 107–127 leaves some out on purpose for the Lair and Dungeon Crawler) and gates on them as its first step, so no genre recomputes on more events than today. tc-1d proves it with `npm run test:budgets` (statements per reply unchanged for Story and the Lair).
6. Line references drifted again: `set-turn-order` handler `host.ts` ~4119; the Turn order gate in `EditSessionForm.svelte` ~3591 (`PipelineCards`). No session export module exists; only the importer and the attic write `genre_fields`.

7. **`FieldDecl.presentWhen` is not added** (found in tc-1a): `FieldDecl.showIf { field, equals }` already means it. Story's extent field uses `showIf: { field: 'autoAdvance', equals: true }`; tc-1g makes the session settings form honour `showIf`. Asked of the owner as TN5 (D84), since TN1 approved the other name.
8. **From tc-1a's scope review, done in tc-1b:** the word is "option", never "entry", for a registration on a runs-one event; the genre warning says what is true while per-event registrations still run; `pipelines/registrations/door.ts` applies the `registration default` law over the whole list; a session change row cannot carry `default`.

**TN5 ruled (owner, 2026-11-18):** "Use the existing showIf; add no new name". Correction 7 stands as the rule.
