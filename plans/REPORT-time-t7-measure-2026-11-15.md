# REPORT — lane `time-t7-measure` — measurement 2 (2026-11-15)

Brief: `plans/briefs/BRIEF-time-t7-measure.md`. Saved by the lead from the supervisor's final message. No shipped
behaviour changed.

**The harness works; on the owner's data the question has no answer, because the lift is zero there.** Taking the
"Recently referenced" lift away changed nothing on any of 108 replayed turns, and no score moved.

- Files: `src/lib/server/pipelines/ranking/recallRecency.replay.int.test.ts` (skipped without
  `REPLAY_DATA_DIR`), `recallRecency.replay.ts`, `plans/measurements/recall-recency-2026-11-15.md` and `.json`.
- How a past turn was rebuilt: the shipped pipeline itself runs in preview on a copy of the database, with every
  row after the N-th live message hidden; the second run overrides the rank node's `signalLastRefRecency` to 0.
  Differences from a live run: no meaning search (embeddings mocked; the owner's live turns used a local
  embedding model); the lorebook, cast, scenes and settings are as they are today, not as at turn N (the table
  repeats for the 61 turns whose lore all existed then).

| Metric | All turns | Turns whose lore existed then |
|---|---|---|
| Turns replayed (one qualifying session) | 108 | 61 |
| Mean lore candidates = mean selected | 6.15 | 5.23 |
| Turns where the selected set differs | 0 | 0 |
| Entries out / in | 0 / 0 | 0 / 0 |
| Rank shift of kept entries, mean / worst | 0 / 0 | 0 / 0 |

Why: the lift is computed only for entries with keys (`buildLastRefMap`, `ranking/signals.ts` ~1100). The one
qualifying lorebook has 51 entries, all keyless, 50 written by the pipeline: 0 of 664 lore candidates carried the
signal. Also, the budget never left a lore candidate out on any turn, so even a non-zero lift could only have
reordered entries.

Open: ★8 cannot be measured on this data. A lorebook with keys (an imported one) read by a session of 20 or more
messages would be needed. Tests: with the variable 1 passed in 601 s (determinism and the lever check pass);
without it 1 skipped; `tsc` 0 errors.

Noticed: `lorebook_entries.created_at` is a timestamp without time zone while `session_messages.created_at` has
one (raw reads show them 8 hours apart; drizzle and SQL compare them correctly).
