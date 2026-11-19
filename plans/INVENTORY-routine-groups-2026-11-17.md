# INVENTORY — routine groups and running while nobody plays (programme 2.6, 2.8; read-only, 2026-11-17)

Paths under `src/lib/server/pipelines/` unless `sdk:` (`../serene-pub-sdk/sdk/src/`) or `cat:` (`../serene-pub-sdk/core-catalog/src/`). Re-verify every file:line.

**Short answer:** no routine group exists in code, UI or vocabulary. A routine is one **registration**: cadence, `when`, `order`, `mode`, `allowStacking`, `caps`, `values`, `minAge`, all on the one row, and the cadence is part of its key. Each session has **one queue, one firing at a time**, behind every action and event run. Stacking is decided per registration key, and caps per routine: they count per session and pause per routine. Only system-clock cadences (`when-idle`, `system-cron`, `schedule` on the system clock) fire with nobody present. They fire for any session interacted with since the process started. Whether anyone has the page open is never checked. They stop at the cron caps: 3 days idle and 12 runs in a row. There is no session-level "keep running" setting.

## 1. What a routine is (SDK)

- `RegistrationDecl` (`sdk:registrations.ts` 131–158) has `trigger: {family:'routine', cadence: CadenceRef}`, `when` (138), `values`, `order` (142, "run in this order, then by key"), `mode` (144, `off|review|full`, 106–110), `allowStacking` (146, default false), `caps` (148, `RoutineCaps {idleTimeoutMinutes, maxRunsInRow}`, 118–123, system clock only), `minAge`, `label`. Only `mode`, `allowStacking` and `caps` are routine-only (659–666). Caps on a non-system clock draw a warning, and caps above the system's are an error (~691–720).
- **Key** = `<cadence slug>→<pipeline>` (`triggerKeyOf` 268–269, `registrationKeyOf` 285–296): the options are not in the key, so all `on-event` routines share the prefix `on-event→`.
- `CadenceDef` (`sdk:cadences.ts` 292–313) has `options`, `wakesOn`, `carries`, `clock`, `evaluate`. Core's cadences, 592–780: every-n-turns, after-each-turn (turn-ended), every-n-rounds, after-each-round (round-ended), after-each-scene (scene-closed), **when-idle (system tick, `clock:'system'`)**, on-event (any event), when-value (any), **system-cron (system)**, timeline-cron (story-clock-moved, story), schedule (tick + story clock, `clock` option). Tick = 5 min (503).
- No cooldown, condition-per-group, concurrency or sequential field exists. **Duties** are params of a pipeline's duties step (`core:task/reckoning-duties@1`, `sweep-duties@1`), read at the routine's mode (`routines/sessionRoutines.ts` 111–175; params by `dutyParamsOf` 62–109 from `registrations.values` under locks).
- Layers: preset `RegistrationChange` (`sdk:registrations.ts` 891–905) and `SessionRegistrationRow` (928–945) can change `values, mode, when, allowStacking, caps, minAge, order`, but not the cadence. The one cadence change is the owner's R52 swap (§6).

| Genre | Routine (key) | Cadence | Mode | Stacking / caps | Does |
|---|---|---|---|---|---|
| Story | reckoning | after-each-round | full | none | notes what changed (`cat:genres/defaults.ts` 253) |
| Story | sweep | every-n-turns n=5 | full | none | looks back (255) |
| Story | illustrate | on-event scene-opened | **off** | none | a picture (257) |
| Story, DC | afterRest | on-event rest-taken | full | none | moves the clock after a rest (262, 415) |
| Story, Lair, DC | scenes | every-n-rounds n=2 | full | none | scene boundaries (135; 266, 348, 417) |
| Story, Lair, DC | sceneSummaries | every-n-rounds n=2, `minAge:0` | full | none | summarizes closed scenes (142; 268, 350, 419) |
| Chat | memory | every-n-turns n=5 | **off** | none | *Remember things* (284) |
| Lair | keeper | after-each-round | **review** | none | keeps the books (344) |
| Lair | scratchpad | on-event message-completed + `where` | full | none | Castellan notes (~358) |
| Lair | fileCurrentRoom | on-event scene-opened | **off** | none | files a room (371) |

Presets: `story-minimal` drops reckoning, sweep, illustrate, scenes and sceneSummaries (`cat:seed/presets.ts` 66). `lair-words-only` drops fileCurrentRoom and sets keeper Off (178–179). Guide declares no routines. **No shipped routine sets `allowStacking`, `caps`, `order` or `when`; none is on the system clock.** The guide's examples use `allowStacking: true` (`guides/genres-presets-and-routines.md` 250, 272). The round tick is an *event* registration, not a routine (`cat:genres/defaults.ts` 131).

## 2. How routines run

- **Wake:** `onSessionEvent` (`routines/evaluate.ts` 320–416) turns turn-ended, round-ended, scene-opened, scene-closed, story-clock-moved, any event (`on-event`) and value-changed into moments. It ignores turn-order-changed and Back/Forward. Turns and rounds count only the main lane (R51, ~350). Another source is `systemTick` every 5 min (`routines/tick.ts` 50–90), and a third is **Run now** (`routines/run.ts` 476–521, owner only).
- **Evaluate:** `evaluateMoments` (evaluate.ts 200–282) skips Off routines and the routine's own key (72–83). It also skips unserved pipelines (R56), and system-clock routines that are not resumed or are cap-paused (234–236). It checks `cadenceDue` on a per-key state (state.ts) and fires each due routine **separately**, in effective order (`order`, then key). ⚠ **A routine's `when` is never evaluated on this path**: `whenHolds` (`registrations/resolve.ts` 464) is called for events only (495; `entities/sessionGenres.ts` 1074).
- **Chain depth (R19):** a depth-0 routine's write can wake *other* routines once (depth 1), never further (evaluate.ts 209, 333; pinned in `evaluate.test.ts:129`).
- **Queue** (`routines/queue.ts`): per session, in memory, FIFO, **one running at a time** (drain 168–197). It waits while `sessionBusyForRoutines` holds: an action or event run, the generation lock or the event chain (`run.ts` 93–97). A run parked at review frees the queue (run.ts 34–35).
- **Stacking:** the unit is the registration key, within the session's waiting list (queue.ts 99): off refuses with *Skipped: already waiting*, and a firing while it runs still queues one.
- **Caps** (`routines/interaction.ts` 108–155; `run.ts` 337–350): system-clock routines only. The effective cap is min(system, owner's user setting, registration). The count `sessions.routine_runs_since_interaction` is **per session**; the threshold is per routine; the pause (`pause`) is per (session, key) and lifts at the next interaction (54–67).
- **Concurrency:** within a session, none. Across sessions, queues run independently. Model calls queue by family priority (interactive 0, event 1, routine 2; `utils/llmQueue.ts` 68–105) into per-host LLM lanes (cloud width 4, bounds 1–16, `connections/llmLanes.ts` 9–14). So async within a group would put several routine calls into one host lane at priority 2.
- **Shared cadence today:** scenes and sceneSummaries (every-n-rounds n=2) fire as two firings, scenes first by key order. They keep **two separate counters** (state per key) that stay in step only because both start together.

## 3. "Groups" today

None: no type, table, label or NOMENCLATURE row. The settings form shows one flat **Routines** card (`sessions/settingsForm.ts` 1000–1201). The Pipelines panel's **Where it runs** lists each registration's trigger in words (`client/components/pipelines/workspace/PresetPanel.svelte` 22–30). The Turn line lists runs one by one (ss-7). Allow stacking is the queue's only dedup.

| Field | Today | Row 2.6 wants |
|---|---|---|
| cadence + options | per routine (key half) | group |
| `when` | per routine (unenforced) | group (S9: "trigger (cadence, its options, the condition)") |
| `allowStacking` | per routine | group |
| `caps` | per routine (≤ user ≤ system) | group |
| sequential / async | none (always sequential) | group |
| `order`, `mode`, `values`, `minAge`, `label` | per routine | stay |

## 4. Unattended running

- **Can fire with nobody present:** system-clock cadences on the tick, for every **resumed** session, meaning one interacted with since boot (`tick.ts` 54, `interaction.ts` 54–76). Event and story-time routines also fire with nobody present when their moments come unattended: Auto-advance turns (≤12 per send, `sessions/autoAdvance.ts` 53), and a cron that moves the clock (one chain level). No shipped routine is system-clock, so today this is reachable only by plugin or admin registrations.
- **"Somebody is playing" is known in two places that never meet.** One is *interaction* (`noteInteraction` from line / action / form / setting / run-now; callers `sessions/offerMessage.ts:134`, `sockets/sessions.shared.ts:617`, `sockets/sessionSettings.ts:67`, `storyClock.ts:302`, `run.ts:502`). The other is *attendance* (`sessions/attendance.ts` `usersHere` 72–77: a socket holding `sessions:attendance#id`). Nothing in routines reads attendance.
- **The system limit:** `system_settings.cron_idle_timeout_minutes` (4320) and `cron_max_runs_in_row` (12) (`db/schema.ts` 4320–4328); per user ≤ system (148–150); UI **Background routines** card in Admin › General and User settings (`RoutineCapsCard.svelte` 99–107: "Stop after nobody has played for (minutes)", "Most runs in a row"). Separately, each step has a 1 h ceiling (`runtime/callTether.ts:46`), which the dbg-1 switch turns off.
- **What stops a session running forever:** the two caps (system clock only); R21, under which nothing runs on the system clock after a restart until an interaction (evaluate.ts 234); R19 depth; Auto-advance 12; the run-tree cap pause; the archive refusal. **Story-time and turn routines have no caps.**

## 5. Stored data and SDK names

- `registrations` (`db/schema.ts` 8529–8615): scope `genre` | `preset` | `session`; `trigger_family`, `trigger_ref` (cadence id), `cadence_options`, `when`, `values` (the only store for step values after ss-2a), `order`, `mode`, `allow_stacking`, `caps`, `min_age`, `dropped`, `origin`, `state` (cadence state; `routine-state` change rows, `routines/state.ts` 26). Genre rows re-project and shipped preset rows are re-forced at boot, so **a boot pass moves only admin preset rows and session rows** (stacking, caps, cadence options, R52 `trigger_ref` swaps, state). Also `sessions.last_interaction_at`, `routine_runs_since_interaction` (2598–2606).
- **Published SDK names that would change:** `register(cadence, pipeline, opts)`; `RegistrationDecl.trigger` (routine), `.allowStacking`, `.caps`; `RegistrationOptions` / option keys; `RoutineCaps`; `RegistrationChange` and `SessionRegistrationRow` `.allowStacking` / `.caps`; `RegistrationContext.caps`; `triggerKeyOf` / `registrationKeyOf` for routines (**every stored routine key embeds the cadence**); `RoutineFiring.cadence`; `registrationFindings` rules *routine fields* / *registration caps*; the `Trigger` routine arm; core-catalog's `storyRegistrations().sweep` etc. if they become groups.

## 6. Settings UI today

- **Routines** card (`SessionSettingsForm.svelte` 194–210), one `SessionRoutineRow` per routine: name, purpose, *When it runs* in words, status, **Off / Review / Full** (owner and admin).
- **When it runs** (turn ↔ round, R52): the owner's choice, with the key unchanged (`settingsForm.ts` 1074–1100, 1213–1218).
- **Cadence ·** fold (admin): the options, **Allow stacking**, both caps (`SessionRoutineRow.svelte` 171–190; `settingsForm.ts` 1124–1188).
- Guests get no form (`EditSessionForm.svelte` 3061). Also: the preset page's **Routines** (`admin/sections/session-presets/IdPage.svelte` 269, 1212) and the composer's **Routines** menu for Run now.
- A group row would take over the Cadence fold and the R52 choice, plus sequential / async. Mode stays on each routine row.

## 7. Open questions

1. **Vocabulary:** bare *trigger* is retired (NOMENCLATURE 591, §23), *group* (tab group) is retired (1548), and *cap* means a band ceiling (313). The group needs its own words (e.g. **routine group** owns a **cadence**).
2. The group is declared (S9, "Good." 2026-11-15). Who may declare one: the genre only, or a preset or an admin too? And may a preset move a routine between groups? Today no layer can change a cadence except R52. Cheapest boot pass: one group per distinct cadence + options + `when` per scope.
3. Can a routine be in two groups? Today's key (cadence + pipeline) allows one per cadence. One group per routine keeps keys unique.
4. Group identity: a new key (cadence keyed) vs keeping routine keys (the stored state rows depend on them).
5. One cadence counter per group (fixes the scenes / sceneSummaries twin counters) or per routine.
6. What a cap counts: group runs or routine runs. The counter is per session today.
7. Async: side by side within the group only, still ahead of the next queued work (lead's S9 reading, unruled)? And what two routines writing one entry at once do (untested).
8. Should `when` be enforced for routines first (§2 ⚠)?
9. 2.8: is "nobody is playing" no interaction (today) or no attendance? Does it cover story-time and event-driven groups, which have no cap today? Does it replace the user-level caps card or sit under it?

## 8. Tests that pin today

`routines/queue.test.ts` 58 (one at a time), 67 (waits for busy), 83, 97, 110 (stacking), 122 (sessions apart); `evaluate.test.ts` 123 (Off), 129 (R19 depth), 175, 181, 192 (restart, interval, cap pause), 227, 236 (jump); `runtime.test.ts` 14, 28 (caps min, pause words); `routines.int.test.ts` 202, 235, 251 (Run now), 278 (tick + caps), 352 (stacking); `sessions/settingsForm.int.test.ts` 106, 196, 428 (who sees mode / cadence / stacking), 869, 1053; `sockets/routineCaps.int.test.ts` 39, 62; SDK `sdk-tests/registrations.test.ts` 212, 245; DOM `sessionSettingsForm.dom.test.ts`, `composerRoutinesMenu.dom.test.ts`.

**Noticed, not done:** `docs/pipelines.md:70`, NOMENCLATURE 185 and `INTEGRATING.md` 1325 say a routine never wakes another, but the code allows one level (§2). A routine's `when` is stored, validated and shown but never applied.
