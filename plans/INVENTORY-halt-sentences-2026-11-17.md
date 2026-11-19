# INVENTORY — halt sentences a person in a session can act on (`dg-1d-0`, read-only, 2026-11-17)

All file:line under `src/lib/server/` unless SDK. **Re-verify every line before building.** Who: S = sender / presser, O = session's owner, M = any member. "Plumbing" is judged after any `${node.key}: ` prefix.

Corrections to earlier documents: `routines/evaluate.ts` 160, 176, 183, 185 never reach the routine log (`evaluate.ts:274` logs a verdict only when its reason starts with "Skipped:", itself text matching). `host.ts` has 24 commit-returned `{halt}` lines plus 8 through `halted()` (`host.ts:6134`); 9 of the 58 binding `halt()` calls in `bindings.outlets.ts` pass a commit halt through. 48 `${node.key}: ${value}` wrappers exist across runtime code.

## Part A — candidates (lead's ruling in the last column: **P** = for people, mark it; **D** = stays detail; **W** = needs rewording first, the owner's)

| # | Site | Road | Sentence | Who | Plumbing | Member pin | Ruling |
|---|---|---|---|---|---|---|---|
| 1 | host.ts:1488, 1504 (`personLineOf` `refuse`, 1463) | thrown, prefixed | "You can only send messages with personas you own." | S | no | offerMessage.int:351; sessions.actions.modelCallWording:132; sessions.ownerCardForGuest:117 | P |
| 2 | host.ts:1492 | thrown, prefixed | "a person's message is written as the person who sent it" | S | no | offerMessage.int:421 | P |
| 3 | host.ts:1513 | thrown, prefixed | "a person's message speaks from their own seat, not another's" | S | no | none | P |
| 4 | host.ts:1578 (`assertMayAct`) | thrown, prefixed | `MESSAGE_ACTION_REFUSAL` (messages/permissions.ts:261) | S | no | builtins.int:1077 | P |
| 5 | host.ts:5995 | thrown, prefixed | "only the session's owner may branch it." | S | no | builtins.int:1114 | P |
| 6 | host.ts:5777, 5848 | thrown, prefixed | "message ${id} is still being written — stop it first, or wait." | S | a message id | none | P |
| 7 | host.ts:5153 | thrown, prefixed | `SettledRefusal` / `StoryClockRefusal` messages (`SETTLED_SENTENCE`, `EVERY_TURN_KEPT_SENTENCE`) | S / O | no | none | P |
| 8 | host.ts:4607 | commit `{halt}` | `SeatNameRefusal` (seatName.ts 125, 128/246, 152, 154, 161, 204, 206, 243) | S / O | no (but seatName.ts:85 wraps any `Error`) | none | P (not the :85 wrap) |
| 9 | host.ts:4691 | commit `{halt}` | `setSeatBench` refusals (sessions/seats.ts 1816, 1820, 1825) | O | no | writer-level | P |
| 10 | host.ts:310, 559, 6862 | thrown, prefixed | `UNDATED_LORE_WRITE_SENTENCE` (state/storyTime.ts:444) | O | no | none | P |
| 11 | host.ts:493 | thrown, prefixed | "'${title}' was written on another line of the book … change it in the lorebook." | O | no | none | P |
| 12 | host.loreWrites.ts:151 | thrown, prefixed | "“${name}” is the name of more than one entry … Rename one of them…" | O | no | none | P |
| 13 | host.loreWrites.ts:780, 783 | thrown, prefixed | `LINKED_THAT_WAY` + `LINKED_IN_PART` / `linkNotStanding` | O | no | none | P |
| 14 | loreMatch.ts:111, 144 | thrown, prefixed | "${name} is not in this book's cast … add them to the cast, or leave bind off." | O | **"leave bind off"** | none | W |
| 15 | host.ts:5343 | thrown | `UNDATED_MOVE_SENTENCE` (same class also raises "There is no session ${id}.") | O | no | none | P (that sentence only) |
| 16 | host.ts:6040 | commit `{halt}` | "Only the session's owner can change its rules." | S | no | sessions.actions.modelCallWording:114; runReply.modelCallWording:119; haltExplanation.test:215 | P |
| 17 | host.ts:6054 | commit `{halt}` | `StateRefusal` from convertRuleset.ts 102, 105, 111, 112, 115 | O | no | writer-level | P |
| 18 | SDK executor.ts:1798 | executor halt | "rejected at review" (structural: `receipt.reviews` `{action:'reject'}`; **dropped on compacted receipts**, receipts.ts 466–492) | S | no | sessions.actions.modelCallWording:112; runReply.modelCallWording:117; replyRoad.int:1229; reviewGate.int:284 | P |
| 19 | capPause.ts:342 | cancelled receipt | "stopped at the cycle cap by the session owner — ${run.cap}" | O | **cap text** | — | W |
| 20 | lineage.ts:156, 166 (host.ts:6245, sessionEvents.ts:984) | `halted(cap)` | "cycle guard: … under root ${rootRunId} … (01 §8, R65)…" | O | **run id, spec section** | — | W |
| 21 | sessionEvents.ts:917 | refusal receipt | "the pipeline answering ${event} changed while this waited at the cycle cap (now ${spec})…" | O | **event id, spec** | — | W |
| 22 | routines/queue.ts:82 | routine line | "Skipped: already waiting" | M | no | queue.test:88; receiptView.test:1309 | P |
| 23 | interaction.ts:151 (run.ts:346) | routine line | "Paused: no one has played for ${span}" | M | no | runtime.test:33; sessionSettingsForm.dom.test:288 | P |
| 24 | interaction.ts:153 | routine line | "Paused after N run(s) in a row" | O / M | no | routines.int:311; runtime.test:35 | P |
| 25 | run.ts:317 | routine line | `SESSION_ARCHIVED_SENTENCE` | O | no | none | P |
| 26 | run.ts:328 | routine line | "Skipped: the routine is no longer registered in this session" | O | no | none | P |
| 27 | evaluate.ts:266 | routine line | "Skipped: its \`when\` condition does not hold now" | nobody | **\`when\`** | none | W |
| 28 | evaluate.ts:277 ← SDK cadences.ts 1336, 1353 | routine line | "Skipped: the clock jumped more than ${span}" + " from … to …" | O | no | none | P |
| 29 | run.ts:357 | routine line | "Skipped: '${reg.pipeline}' is not published on this pub" | an administrator | **spec slug** | none | D |
| 30 | host.ts:5535 | thrown, "refused — " prefix | `OfferMediaRefusal` (characters/portrait.ts) | S | no | none | P (the ownership sentences) |
| 31 | host.ts:5601 | thrown | `AttachSpriteRefusal` (sprites/attach.ts) | S | no | none | P (the ownership sentences) |
| 32 | host.ts:5467 | thrown | `BackdropRefusal` "That picture belongs to neither this session nor you…" | S | no | none | P (that sentence) |
| 33 | bindings.summarize.ts:1064 | binding `halt()` | "nothing to answer — this action was fired with no form; it answers a question a message put to you" | S | no | none | P |
| 34 | host.ts:6166 | `halted()` | "the form '${blockId}' was already answered by ${by}" | S | **block id, participant ref** | — | W |
| 35 | host.ts:6161 | `halted()` | "the form '${blockId}' is addressed to ${x}, not ${y}" | S | **yes** | host.seatMembers.s3:422 (`.halt` only) | W |
| 36 | host.ts:1360 | commit `{halt}`, prefixed | `LibraryWriteRefusal`: only `may.reason` (library/writes.ts 350, 406) | S | no | none | P (`may.reason` only) |

Also ruled **P** (explains the cause, names the genre by its shown name; nobody in the session can change it): the genre-shape guards `loreWriteRefusal` (host.ts 1150, 6499, 7087, 7344, 7484), `seatWriteRefusal` (4666), `libraryWriteRefusal` (1303). Ruled **D**: `NOBODY_ACTING_SENTENCE` (1312), `PLUGIN_LIBRARY_REFUSAL` (1300), host.ts:4551, `setStatConfig` `StateRefusal` (4809), seatName.ts:85 wrap, host.loreWrites.ts:968, host.ts:691, 671, `CastMemberRefusal` (2881, 7315; loreWrites:1136), `SceneBoundaryRefusal` (4526), host.ts:6184, `LaneRefusal` (bindings.ts:938), resolve.ts:1079 / functionRun.ts:817, pluginBindings.ts:406, describeImage.ts:105, the fifth road `runTurn.ts` 1470, 1505 (a fire's refusal copied into a child receipt: follows the child's own mark), `ConnectionChoiceRefused` (not a halt).

## Part B — wiring (detail): counts

host.ts: thrown `HostScopeError` 158, `{halt}` 24 + 8 `halted()`, `refuse()` 9 calls · host.helpers.ts 5 + 5 · host.loreWrites.ts / loreMatch.ts / loreSources.ts 14 / 8 / 5 · host.call.ts 2 + 2 · bindings*.ts `halt()` 58 · dispatch family `ComposedError` subclasses 34 · connections/capabilityTarget.ts 7 · capabilityGuard.ts 1 · runTurn.ts / cardAction.ts 2 + 1 + 4 · rulesets/resolve.ts 4 · sessionEvents.ts 3 · fireAction.ts 45 `refused()` before the run (not a halt).

## Part C — structure

1. People sentence as its own value at prefixed sites: 14 (1488, 1492, 1504, 1513 via the helper's `why`; 1578; `e.message` at 5153, 5467, 5535, 5601; `refusal` at 310, 559, 6862; `LINKED_*` at 780, 783). Only inside a template string: 7 (493, 5777, 5848, 5995, loreWrites:151, loreMatch:111, 144).
2. Helpers: `personLineOf`'s `refuse` (host.ts:1463) raises 4 candidates and 5 wiring sentences (needs a for-people variant); `assertMayAct` (1565) raises only #4; `halted()` (6134) only W rows; `routineLine()` (run.ts:256) already writes `meta.routine`. About 2 helpers plus ~20 inline sites.
3. Review rejection: structural on the receipt, missing on compacted receipts (`answerStanding`, reviewGate.ts 563–579, falls back to the text `REVIEW_REJECTED_REASON` there).
4. Routine lines: `meta.routine = { skipped | paused: true, registrationKey }` only on `routineLine` receipts (run.ts:294).

Totals: 36 candidate rows; 8 need rewording first (W: 14, 19, 20, 21, 27, 34, 35 and 29 is D); ~24 raise sites plus one helper variant to mark the P rows.
