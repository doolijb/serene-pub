# Measurement 2: what the "Recently referenced" lift does for lore recall (2026-11-15)

Harness: `src/lib/server/pipelines/ranking/recallRecency.replay.int.test.ts` (run with
`REPLAY_DATA_DIR=<app data root>`; skipped without it). Raw per-turn data:
`recall-recency-2026-11-15.json` (entry ids, names, bands, scores, signal values; no text).

Data: a copy of the owner's install at migration 0164. Sessions were picked by rule (a dated genre, at least 20 live
main-channel messages, at least 10 lore entries considered); only session 4 (Story, lorebook 4) qualifies.

## How each turn was rebuilt

- The real reply pipeline, `runTurn(..., { preview: true, skipReceipt: true })`, on a copy of the database in the
  test's temp dir. The selection is read off the `core:task/rank-hybrid@1` node's `decisions`.
- Position N (10 to 117): every row after the N-th live message is set hidden in the copy. The lore lanes and the
  history window then read exactly the first N messages.
- Speaker: the next assistant row's character. Trigger text: the N-th message. Seed: fixed per position.
- Variant: an override of the rank node's `signalLastRefRecency` to 0 on every band. Nothing else changes.

**What differs from a live run:**

- No embedding model, so the meaning-search half added nothing. The owner's install has a local bge-m3 embedding
  connection, so live turns had it.
- The lorebook, cast, scenes, story clock and stored config are as they are today, not as they were at turn N.
  61 of 108 turns had every candidate entry already written by then, and the table repeats for those turns.
- Entry edits after turn N are not undone.

## Results (session 4 = all sessions)

| metric | all turns | turns whose lore existed then |
|---|---|---|
| turns replayed | 108 | 61 |
| mean lore candidates | 6.15 | 5.23 |
| mean selected (shipped) | 6.15 | 5.23 |
| turns where the selected set differs | 0 | 0 |
| entries out / in | 0 / 0 | 0 / 0 |
| rank shift of entries kept: mean / worst | 0 / 0 | 0 / 0 |

- Lore candidates with `lastRefRecency` > 0: **0 of 664**.
- Distinct candidate entries with keys: **0 of 32**. Lorebook 4 has 51 entries, all keyless, and 50 of them were
  written by the pipeline.
- Turns where the shipped run left any lore candidate out: **0 of 108**.
- Scores were bit-identical between the two variants on every turn. Two full passes gave identical results, and
  the run repeated with the same numbers.
- Dropped-out entries, came-in entries and examples: none.

## Why

`lastRefRecency` is produced only for entries with keys (`buildLastRefMap`, `ranking/signals.ts` ~1100: it filters
to `splitKeys(e.keys).length > 0`). The lift therefore has nothing to act on in this lorebook. Also, no turn's
budget left a candidate out, so a lift could only have reordered entries, never changed which ones were read.
