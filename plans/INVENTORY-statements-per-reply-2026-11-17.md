# INVENTORY — statements per reply (programme 0.5, lane `perf-1`, 2026-11-17)

Profiled with scratch copies of the two baseline tests (deleted after), the same `client.query` counter
the baselines use, each statement logged with its SQL and stack. Test **a** of each, two fresh worlds.
The counter sees `client.query` only: statements a PGlite `transaction` runs on its own handle are not
counted (same blind spot as the baselines).

| World | first / second | Notes |
|---|---|---|
| Story (`unknownEntries.reply`) | 2802 / 2076 | first world also runs 3 extra `session_cast` reads (11 vs 8) |
| Lair (`sessions.lairUnknownEntries`) | 4672 / 4668 | three runs per turn: `lair-reply`, `lair-turn-order`, `round-tick` |

## Buckets (second world)

| Bucket | Story | Lair | Owned here? |
|---|---|---|---|
| A `narratorNameFor` → `buildWorld(story-narrate)` from the host (112 statements per call; Story 8 calls, Lair 18) | 896 | 2016 | yes (`host.helpers.ts`, `host.read.sessionCast.ts:469`, `host.ts` narration) |
| B `runTurn.ts:996` → `buildWorld` (2 per run) | 160 | 199 | no (`runTurn.ts`) |
| C `session_cast` read, rest of it (~53 per read; Story 8 reads, Lair 13) | 424 | 663 | yes |
| D `sessionActions.ts:311/325/506/902` from the actions push (`sockets/sessions.pipelines.ts:1319/1327`) | 0 | 736 | no (sockets, entities) |
| E `sessions/rewind.ts:148/149` from the same push | 0 | 204 | no |
| F every other host read / write | 321 | 351 | yes, small and spread |
| G `sessionEvents.ts` (moments, routines) | 54 | 157 | no |
| H run start/end: `runReply`, turn socket, `runStatus`, `liveRow`, loadouts, boot store | 221 | 342 | no |

## Top shapes (Story second world; Lair counts in brackets)

| Shape | Count | Caller(s) | Why it repeats | Remedy |
|---|---|---|---|---|
| `pipeline_variable_templates` by id / by variable (4 shapes) | 548 [1152] | `config/world.ts:1276–1407` (`variableTemplates.ts:98/226`, `seedVariableTemplates.ts:298/311`) | per variable, per `buildWorld` (~17 variables × 4 reads × 10 builds) | A: per-run memo of the narrator name removes the builds; inside `buildWorld` an `IN (…)` batch per build (not owned) |
| `pipeline_spec_versions` / nodes / clauses / edges / includes / presets / preset values / `pipeline_specs` by id | ~170 [~620] | `boot/store.ts:1036–1091` via `config/panel/declarations.ts:769/964`, `config/world.ts:651/768` | per `buildWorld`, per spec version | same: A removes most; rest in `config/` (not owned) |
| `node_definitions` | 48 [96] | `declarations.ts:857`, `sessionGenres.ts:252` | per build; per genre lookup | A; genre lookups in C |
| `sessions` reading (`state/reading.ts:332`) + `lorebooks` clock (`reading.ts:416`) | 57 + 57 [104 + 104] | `cast/memberAsRead.ts:504` (per member, per cast read), `host.loreWrites.ts:410`, `storyTime.ts:383`, `host.read.lorebookEntries.ts:204` | per member, per cast read, per lore read | a per-run reading memo needs invalidation on clock moves / forks: not taken (see Rejected) |
| `character_versions` | 54 [92] | `memberAsRead.ts:601/813` via `seatCards.ts:215`, `host.read.sessionCast.ts:398` | per seat set, twice per cast read | C |
| `sessions.branch_ancestry` + `lorebooks by session_id` | 23 + 23 | `state/reading.ts:308/314` ← `memberAsRead.ts:515` | per member | value in hand in `memberAsRead` (not owned) |
| loadouts | 45 [116] | `loadouts/index.ts:77/114/129` | per `buildWorld` and capability default | A |
| registrations resolve (`resolve.ts:122/341/372/395`) | 17 each [45–63] | `registrations/values.ts:68` ← `config/world.ts:993` | per `buildWorld` (its own cache keys on generation, still reads the session row) | A |
| `sessionGenres.ts:148/172` genre lookups | 25 each [52] | `host.read.sessionCast.ts:625/670` (`genreFieldsFor`, `playerLabelFor`) | per cast read | C: per-run memo, invalidated by any genre-field write the run makes |

## Cuts (both baselines re-run after each; every sha byte-identical to `plans/wt-1b-fix-shas-sup.txt`)

| # | What | Where | Story a (1st / 2nd) · c · d · e | Lair a (1st / 2nd) · c · d · e | Invalidated by |
|---|---|---|---|---|---|
| 0 | baseline | | 2802 / 2076 · 2784 · 2554 · 2391 | 4672 / 4668 · 4668 · 3806 · 4681 | |
| 1 | narrator name memo per host (`narratorNameOf`) | `host.ts` beside `diceHiddenBySession`; `readSessionCast` takes it; the narration outlet uses it | 2338 / 1612 · 2320 · 2206 · 1927 | 4092 / 4088 · 4088 · 3458 · 4101 | nothing a run writes reaches its inputs (config, prompts, presets, registrations, connections, the session's genre and preset; `convert-ruleset` writes only `ruleset_version`); a failed read is dropped; next run = new host. Test `host.narratorNameMemo.int.test.ts` |
| 2 | `session_cast` read memo per host (`sessionCastReads`), every hit a `structuredClone` | `host.ts` `session_cast` case; `host.call` / `host.commit` wrappers | 2122 / 1396 · 2104 · 2044 · 1711 | 3936 / 3932 · 3932 · 3299 · 3948 | cleared when any `host.call` or `host.commit` starts and ends (outlets; the generate step's live row); a failed read is dropped; next run = new host. Test `host.sessionCastMemo.int.test.ts` (a bench commit in the same run is seen by the next read) |

Story −33 % (2076 → 1396), the Lair −16 % (4668 → 3932), second worlds.

## Rejected

- **Per-run `reading` memo** (`state/reading.ts:332/416`, ~41 + 41 Story): most calls come from
  `cast/memberAsRead.ts` per member, outside the host, with no run object to carry; the host-side ones (lore
  read, lore writes, story time) move with the clock outlet and forks. Not cheap enough to be provably safe.
- **Memo of the lore read's session row / own book / reading** (`host.read.lorebookEntries.ts:144/161/204`):
  ~16 Story, ~28 Lair. Safe under the cut-2 rule, but ~1 % for another invalidation surface. Left.
- **One `membersAsRead` per cast read instead of two** (`host.read.sessionCast.ts:214` via `seatCards` and
  `:399`): ~10 per remaining cast read; changes the read's structure for little. Left.

## Remains (outside this lane's files; expected savings, second world)

| Item | Where | Story | Lair |
|---|---|---|---|
| `buildWorld`'s variable templates read per variable (4 reads × ~17 variables per build): one `IN (…)` per build | `config/world.ts:1276–1407`, `variableTemplates.ts`, `seedVariableTemplates.ts` | ~290 (308 today) | ~700 |
| `resolveSessionSettings` builds a host of its own for its cast read (`sessions/settings.ts:306`): a second cast read + narrator build per run; `runTurn.ts:1064` reads settings before it makes the run's host (`:1137`), the in-run `session-settings` query (`host.ts` case) and `sessionSpeech` too | `sessions/settings.ts`, `runTurn.ts` | ~330 | ~500 |
| `turnYield.ts:243` → `narratorNameFor` per rewind check in the actions push | `sessions/turnYield.ts`, `sessions/rewind.ts:148/149/481/520` | 0 | ~560 + rewind's own ~200 |
| actions push after the turn: `sessionActions.ts:311/325/506/902` | `sockets/sessions.pipelines.ts:1319/1327`, `messages/verbs.ts:455/726` | 0 | ~740 |
| `runTurn.ts:996` `buildWorld` twice per run | `runTurn.ts` | ~160 | ~200 |
