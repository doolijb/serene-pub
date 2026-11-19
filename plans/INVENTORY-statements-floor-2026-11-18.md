# Statements per reply: the fixed floor — measured 2026-11-18

Measured with the baselines' `client.query` counter (stack and timing per statement), the baselines' mock model, one character, an empty lorebook, a first world then a measured second world; Story and Chat through `runReply`, the Lair through `sessionsFireTurnHandler`. A temporary test, deleted afterwards. PGlite in-process, test database on local disk, one connection: times are not portable.

| Case | During the reply | After it returns | Model calls | DB time, ms (mean per statement) |
|---|---|---|---|---|
| Chat, default preset | 780 | 406 | 1 | 1749 (1.5) |
| Story, Minimal | 782 | 406 | 1 | 1628 (1.4) |
| Story, Living (the genre's default) | 780 | 406 | 1 | 1595 (1.3) |
| The Lair, default | 1793 | 114 | 1 | 2386 (1.25) |

- The baselines reproduce (Story 806 → 782 during the reply; the Lair 1918 → 1907 in total). The "after" column (turn-order and round-tick runs after the reply returns) is not counted by the baselines: Story's true total is about 1190.
- **The floor is fixed.** Chat, Story Minimal and Story Living cost the same: Chat runs the same specs as Story (`story-respond`, `story-turn-order`, `round-tick`), and Living's routines did not fire on a one-reply fixture (their cost when they fire is not in these numbers). Enabled features added almost nothing; nothing a preset or owner switches off lowers the count. Routines are switched off only by choosing the Minimal preset; owners toggle only action registrations per session (`sessionGenres.ts` 1664–1680).
- **Where it goes** (Story; the Lair in brackets): registrations, settings and world build ~450 [693]; cast and seats ~238 [248]; state and rules reads ~220 [411]; other ~165 [346]; messages 39; lore and retrieval 37 [76]; routines and events 29 [11]; push after the reply 7 [77]; turn order 0 [4].
- **The three dominant sources are the same reads repeated within one reply:** resolving the session's genre and building the world (`sessionGenres.ts` 148, 172, 252, each 23 times [30]; tables `pipeline_specs` 94, `lorebooks` 162); session and lorebook clock reads (`state/reading.ts` 332, 416, 45 times each [56]); cast and seat reads (`cast/seatedCast.ts` 76, 26 times [`character_versions` 73]).
- **Time:** reply wall time with an instant model ~0.55–0.63 s (Story, Chat), ~1.3 s (the Lair); ~1.25–1.5 ms per statement.
- **Several replies at once:** one connection behind a mutex (`db/transactionGuard.ts` 4–9), so statements run one at a time; five concurrent Lair replies queue about 5 × 1.9k statements, roughly 5 × 2.4 s of database time before the last finishes. A page load's reads interleave between statements, not behind a whole reply, except while a transaction holds the mutex.

## Pinned by lane p6-0 (2026-11-18, later) — these supersede the first table where they differ

The baselines now assert ceilings (`pipelines/runtime/unknownEntries.reply.int.test.ts`, `sockets/sessions.lairUnknownEntries.int.test.ts`, new `pipelines/runtime/statementFloor.chat.int.test.ts`, `statementFloor.leanGenre.int.test.ts`; helpers `utils/statementProfile.ts`, `utils/leanGenreFixture.ts`). Second, warm world; a change that raises a ceiling must say why.

| Case | During the reply | After it returns |
|---|---|---|
| Story, Minimal | 798 | 423 |
| The Lair | 1806 | 112 |
| Chat, Basic preset (its own reply spec `assistant-respond`) | 559 | 392 |
| Lean genre (one create spec, one reply spec, no turn order; built through the public SDK calls) | 406 | 10 |

**Corrections to the first measurement:** Chat is NOT the same as Story (the first pass measured Chat running Story's specs): its own preset costs 559 + 392. A lean genre already costs about half of Story during the reply and almost nothing after it. And enabled features DO cost, heavily, once routines fire (the first fixture never let them):

**Story, Living preset, registrations cache on, routines on, 8 replies** (during ≈ 781 every reply): after a reply with only `story-reckoning`: 1031; with `scene-boundaries` and `scene-summaries` firing (every second reply): 1550–1691 (one firing pair ≈ 520–660); with `story-sweep`: 1400 (≈ 370). `story-reckoning` runs after every Living reply and adds about 600 over Minimal. So a Living reply costs about 1,800 to 2,500 statements in all. Turning the registrations cache on saved only about 17 during the reply (the plan guessed ~63).

Top call sites, during: Story `state/reading.ts` 88, `cast/memberAsRead.ts` 75, `boot/store.ts` 58, `sessionGenres.ts` 47, `registrations/resolve.ts` 41; the Lair `boot/store.ts` 250, `reading.ts` 182, `sessionGenres.ts` 149, `memberAsRead.ts` 135, `state/resolve.ts` 96; Chat `boot/store.ts` 72, `sessionGenres.ts` 44, `config/world.ts` 42, `resolve.ts` 41, `messages/store.ts` 39; lean `boot/store.ts` 65, `sessionGenres.ts` 50, `config/world.ts` 42, `resolve.ts` 34, `messages/store.ts` 27. Prompt fingerprints unchanged (Story `7be63a35…`, the Lair `cb880fdd…`).
