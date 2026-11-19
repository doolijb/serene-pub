# INVENTORY — turn controls today (programme 2.3; read-only, 2026-11-17)

App paths under `src/lib/server/` unless `sdk:` (`../serene-pub-sdk/`). Re-verify every file:line.

**Short answer:** the turn order is already an event pipeline. Each genre has one turn-order spec, registered
once per event that can change whose turn it is (`sdk:core-catalog/src/genres/defaults.ts` 152–155). Its
**strategy** node is the swappable step, and it writes the session's order through `core:outlet/set-turn-order@1`.
The Turn order select is a **node swap** (`pipeline_node_rebinds`), not a choice between registrations. Only Story
offers it, and only behind **Show advanced controls**. "The model" is a second control (genre field `turnMode`),
and Auto-advance is a third (genre field `autoAdvance`: `off` / `next` / `round`). Core supplies `next` when no
genre declares it. Nothing today keeps one registration per event active per session: all registrations on a
trigger run (R24).

## 1. Who decides the next speaker

| Part | Where |
|---|---|
| The decider: `core:spec/<genre>-turn-order`, event → history → pool → mentioned → strategy (or `decide` junction) → voices/unprompted → `set-turn-order` | `sdk:core-catalog/src/factories/turnOrder.ts` 207–440 |
| Inputs: pool (removed and benched seats out, `on-action` envoys out; characters / personas / envoys params) | `pipelines/runtime/bindings.turnOrder.ts` 214; mention orderer 348; strategies 200–206 (one `turnEntries` implementation, six ids) |
| Story's voices (`sideCast`, `narratorInterjections`) put one unprompted entry at the head | factory 66–83, 346–366 |
| The Lair's plan (`via: 'plan'`; seated players wait) | `sdk:…/genres/lair/turnOrder.ts` 16–29; `sessions/turnPlan.ts` 342–383 |
| The model path: `core:oracle/turn-advise@1` when `turnMode = model` | factory 316–345; `pipelines/runtime/host.helpers.ts` 109–120 |
| State: `sessions.turn_order` jsonb, `TurnOrderV1 { order, candidates, basedOnAt, computedAt, runId, event, strategy }` | `db/schema.ts` 2708–2720; `sdk:sdk/src/turnOrder.ts` 60–90, 118 |
| The write: outlet handler, which drops entries the pool did not admit or on undeclared channels, then `writeTurnOrder` (a newer `basedOnAt` wins) | `pipelines/runtime/host.ts` 4023–4135; `sessions/turnOrder.ts` 57–80; emits `turn-order-changed` 4162, 4206 |
| Other writer: skipping a waiting Lair turn | `sessions/turnPlan.ts` 383 |

**Firing** (one door, `sessions/fireTurn.ts` 185; a person's entry is never generated, 147, 222–224). There are
three callers:
- Continue (with no entry) and Pick who speaks (`via: 'pick'`): `sockets/sessions.turns.ts` 82, 388. When nothing
  is prepared, Continue falls back to `carryOnEntry` (`fireTurn.ts` 78) for the owner, or for a guest who has sent
  a line since the last reply (`sessions.turns.ts` 274–281).
- Auto-advance: `sessions/autoAdvance.ts` 233, called from `pipelines/runtime/sessionEvents.ts` 567.
- Retake, which regenerates the whole turn: `sessions/retakeTurn.ts` 126.

Routines take no turns (S10). "Next turn" and "Whole round" are values of the Auto-advance field. Nobody presses
them.

## 2. Turn order options

| Option | Declared | Offered by |
|---|---|---|
| Round robin `core:task/turn-round-robin@1` | `sdk:contracts/src/tasks.ts` 2835 | pinned by Story 37, Chat 29, Guide 27 |
| Round robin by user `turn-user-split` | 2854 | Story swap |
| Random `turn-random` | 2843 | Story swap |
| Scripted `turn-scripted` (`select` script point) | 2866 | Story swap; pinned by Dungeon Crawler 64 |
| Manual `turn-manual` (always empty) | 2885 | Story swap |
| Narrator replies `turn-narrator` | 2893 | Story swap; pinned by the Lair 39 |
| The model `core:oracle/turn-advise@1` | `sdk:contracts/src/oracles.ts` 74 | Story only (`advise`, field `turnMode`) |

- Story's swap list is `STORY_SWAPS` (`genres/story/turnOrder.ts` 25). The factory shows a control only when a
  spec has swaps (factory 278–282). The other four genres show none.
- **Stored:** `pipeline_node_rebinds` (session scope, node `strategy` or `decide.rules.strategy`;
  `db/schema.ts` 6389–6418). It is written by `sessions:setNodeRebind`, and its options come from
  `sessions:nodeSwapOptions` (`sockets/sessions.pipelines.ts` 425, 564). A preset can carry `swaps`
  (`sdk:sdk/src/announce.ts` 316, 532).
- **UI:** the `PipelineCards` swap picker in Edit session. It shows only with Show advanced controls on
  (`client/components/sessionForms/EditSessionForm.svelte` 2993–2998), and guests see it read-only. `turnMode`
  and `autoAdvance` are genre fields in group "Turns", reach owner (`sdk:core-catalog/src/registry/genres.ts`
  77–123; Story 618–619). The Turn order widget names the strategy (`sdk:…/shared/ui/turn-order/index.ts` 77–85).
- **Silent defaults:**
  - Every spec pins a strategy, labelled "Pipeline default (Round robin)" (`docs/group-sessions.md` 61).
  - `autoAdvance` falls back to `next` when undeclared (`autoAdvance.ts` 196–204; field default `next`,
    `genres.ts` 92). Chat, the Guide, the Lair and Dungeon Crawler declare no Auto-advance field, so they run on
    this silent `next`.
  - `turnMode` defaults to `rules` (`genres.ts` 115).

## 3. Auto-advance today

- **The listener:** `onTurnOrderChanged` (`autoAdvance.ts` 117) fires on `turn-order-changed`. Only a person's
  cause, an automatic run's cause or a planned head may fire (189–194).
  - `next`: the head fires once, on the send.
  - `round`: keeps firing on its own cause until a person's entry or an empty order.
  - The cap is `MAX_AUTO_ADVANCE_PER_SEND = 12` (53).
  - A planned (Lair) head fires under `next` too.
- **Per genre:** only Story declares the field (`round`, `genres.ts` 618). The docs list all three values
  (`docs/group-sessions.md` 84–94).
- **Importers write no Auto-advance at all.** They map *manual* to a strategy rebind instead:
  - Import: `mapGroupReplyStrategy` turns `2` or `"manual"` into `core:task/turn-manual@1`, and everything else
    becomes null, meaning round robin (`utils/sillyTavernParsers.ts` 383–391). It is applied at
    `sockets/import.ts` 1561–1585.
  - Attic: `STRATEGY_REBINDS` maps `manual` and `userSplit` (`attic/finish.ts` 40–43), written at 188–210.

## 4. Events and registrations as the proposed home

- **A core event:** `defineEvent({ slug, version, family, causedBy | declaredRoot, payload, carries, name })`
  (`sdk:sdk/src/events.ts` 37–103), listed in `CORE_EVENTS` (380).
  - Precedent for an internal event: `turn-order-changed` (624–634), which `genre()` refuses in `events`
    (`sdk:sdk/src/genres.ts` 149–152).
  - "Decide who speaks next" does not exist.
- **Registering:** `register(trigger, pipeline, opts)` (`sdk:sdk/src/registrations.ts` 369); `RegistrationDecl`
  131–158 (`when`, `values`, `order`, `label`). The registrations are merged by `effectiveRegistrations` (1002).
  Many run per trigger, in `order` (R24, 150).
- **Exactly one active per session: none.** No field, no table and no select picks one registration among
  several. The nearest mechanisms:
  - (a) `when` over the session's published values (R31; `ConditionDecl`, `sdk:sdk/src/conditions.ts` 102). For
    example, each option registered with `when: turnOrder equals '<key>'`.
  - (b) Today's node swap.
- **Registrations shown as select entries:** none found. Routines show as rows with a mode (`SessionRoutineRow`),
  not as one-of options.
- **What a pipeline returns to core:** the outlet. `set-turn-order` is the return port for an order (host.ts 4023).
  `speakMessage.ts` is *Read aloud* (`sdk:core-catalog/src/shared/speakMessage.ts` 1–25), not turn order.
- **Swap fit:** a swap must have the same kind, ports and slots, and no connection slot from a plugin
  (`sdk:sdk/src/descriptors.ts` 2562–2590; pinned by `turnAdvise.int.test.ts` 306). A registered pipeline avoids
  this rule, because it runs on an administrator's loadout.

## 5. Scripts

- Dungeon Crawler pins `turnScripted` and attaches `DUNGEON_CRAWLER_ROUND_SCRIPT` by seed key at the `select`
  point (`genres/dungeon-crawler/turnOrder.ts` 57–69; `roundScript.ts` 64, 162).
- Story's generic **Scripted** entry runs whatever script an administrator attaches at the "Order the turns" seam
  (`docs/group-sessions.md` 66).
- "Scripts per genre" would remove Scripted from `STORY_SWAPS`, keep `C.turnScripted` published, and leave the
  round script as Dungeon Crawler's own option (settings plan 126–127, 252–261).

## 6. S10 (`plans/PLAN-session-settings-cleanup-2026-11-15.md` 228–250)

Owner, 2026-11-15: "the purpose for turn order/auto continue should be properly defined … "Turn order and
continue determine how the session responds to a user sending a message, it doesn't determine when routines and
custom events fire"".

The lead's charter: core owns `sessions.turn_order` and firing the next due turn (on Continue, Pick, a narrator's
turn, or Auto-advance, up to 12 per send). It does not own routines, custom events, scenes, read aloud or
vectorization. While it writes, it blocks behind the generation lock.

## 7. Shapes that would break, and stored data

- **SDK:**
  - `TURN_MODE_FIELD`, `AUTO_ADVANCE_FIELD` (members `next` / `round`)
  - `turnOrderSpec({ strategy, swaps, advise, scripts })`, `turnStrategyNode`, `TurnOrderHandle.strategyNode`
  - `TURN_ORDER_EVENTS` / `TURN_ORDER_NARRATOR_EVENTS` (a single event would replace them)
  - `C.turnManual` and the Scripted entry in Story's swaps
  - node keys `decide.*`
  - `TURN_STRATEGY_NAMES` (widget)
  - the widget input `turnOrder.v1.strategy` (`sdk:sdk/src/sessionSettings.ts` 86–102)
- **Stored data that would need a forward pass:**
  - `genre_fields.autoAdvance`: 3 values
  - `genre_fields.turnMode`: 2 values
  - session rebinds: 6 definition ids on 2 node keys
  - preset `swaps`
  - each genre's turn-order registrations: 9, 4 or 6 events each (Story and Chat 9; Guide 9; the Lair 4;
    Dungeon Crawler 6)
- **Precedent for the pass:** the boot pass in `pipelines/boot/seed.ts` 697–850 already re-keys rebinds
  (`turn-none` → `turn-manual`, `speaker` → `strategy`).

## 8. Open questions

1. **D6 against ★S1-a.** ★S1-a (2026-11-15): "Auto-advance is on / off; the genre or preset states how far 'on'
   runs". D6 (2026-11-16): "On / off everywhere, and Story keeps Next turn / Whole round as its own option".
   Options:
   - (a) a toggle plus a Story-only field for how far it runs;
   - (b) Story keeps the 3-value field and other genres get a toggle.

   Programme row 2.3 still marks this ★ open; it is stale.
2. **When core fires the event.** Options:
   - (a) on today's union of nine events (cheap: those emit sites exist);
   - (b) per genre (each genre lists them today).
3. **How "exactly one" is stored.** Options:
   - (a) `when` on a session field (no new table);
   - (b) a new session column or row naming the registration key;
   - (c) keep the swap, and only rename the select.
4. **What each option shares.** The pool, mention, voices and empty-cast gate are shared steps. Options:
   - (a) the factory builds one spec per option per genre;
   - (b) shared steps stay in a core part and only the strategy varies, which is close to today.
5. **Does Manual go**, since it means Auto-advance off? Stored `turn-manual` rows and imports would re-key to
   round robin plus Auto-advance off.
6. **Where the select shows.** Today it is behind Show advanced controls. S1 says "with the other turn settings".

## 9. Tests that pin today's behaviour

| Test | What |
|---|---|
| `sessions/autoAdvance.int.test.ts` 136, 163, 181, 228, 270, 327–357 | next / round / off, cap, planned turns |
| `pipelines/runtime/turnAdvise.int.test.ts` 190–306 | model path, rebinds, plugin refused |
| `sessions/fireTurn.int.test.ts`, `sessions.turnOrder.int.test.ts`, `turnOrder.write.int.test.ts` | firing, state, write rule |
| `utils/sillyTavernParsers.test.ts` 262 | manual → `turn-manual` |
| `attic/upgrade.int.test.ts` 445–458 | attic rebinds on `decide.rules.strategy` |
| `client/…/applyPresetDefaults.test.ts` 32, `createSession.test.ts` 83 | preset `swaps` with `turn-manual` |
| `sdk:sdk-tests/turnOrder.test.ts` 47–287 | events, turn-order-changed internal, inlet lock |
| `sdk:sdk-tests/modderPass.test.ts` 139–214 | `turnOrderSpec`, Story's registrations |
| `sdk:sdk-tests/coreTurnOrder.test.ts` 99–311 | widget, strategy names |
| `sdk:sdk-tests/deriveDontSpell.test.ts` 209, 256 | one of the four known failures; it names `factories/turnOrder.ts` (likely the `as any` at 357, 411, 418) and `shared/speakMessage.ts` (`REPORT-timeline-c-2026-11-14.md` 128) |

**Noticed, not done:** the NOMENCLATURE **turn order** row (455) says `sessions.metadata.turnOrder`, but the
column is `sessions.turn_order` (`db/schema.ts` 2720). The docs say the select is under "How replies are made"
without saying it needs Show advanced controls.
