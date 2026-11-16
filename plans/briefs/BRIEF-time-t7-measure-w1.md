# BRIEF — worker `time-t7-measure-w1` — the recall replay harness

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t7-measure`. You build one test file (plus at most one
helper beside it). It measures, on a COPY of the owner's real data, how lore selection changes when the ranking
signal `lastRefRecency` ("Recently referenced") is weighted 0. **It changes no shipped behaviour and no source
file.**

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build` at all: no SDK edit, no build, no dev instance, no model server, no GPU.)

## Privacy rules (the data is the owner's private story) — absolute

- The data copy is at `REPLAY=/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/replay-copy`
  (an app data root: `data/serene-pub.db/` is PGlite, `data/meta.json` holds a secret key).
- **Never print `data/meta.json`'s values** (keys only, if ever). Never `cat` it.
- **Entry names may appear in output; entry text (`content`) and message text may not.** Never print, log or write
  a message's `content`, an entry's `content`, a prompt, or a receipt's rendered context. Silence the app's own
  console inside the test (`vi.spyOn(console, "log" | "info" | "debug" | "warn").mockImplementation(() => {})`)
  so nothing the pipeline logs can reach the log file; write the harness's own output with `process.stdout.write`.
- Do not copy the data anywhere outside the test's own temp dir (below). Do not delete or modify `REPLAY`.
- Never open `~/.local/share/SerenePub` (the owner's live database). Use only `REPLAY`.
- Another session shares the checkout and may run tests. Before **each** test run:
  `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` — if anything shows, wait and check again.

## Code rules

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently. (You should
  need no transaction.)
- Comments state the rule, not the story. No history of how you got there.
- An int test that opens a DB inside an `it` needs a 60 s or longer timeout; this one runs many turns, so give
  `beforeAll` and the `it` generous explicit timeouts (e.g. 30 min).
- Never pipe vitest into `head`/`tail` (SIGPIPE leaks PGlite temp dirs). Redirect to a file.
- `socket.off(event)` and Svelte rules do not apply here; `crypto.randomUUID` is fine server-side.

## Files owned

- `src/lib/server/pipelines/ranking/recallRecency.replay.int.test.ts` (new)
- optionally one helper `src/lib/server/pipelines/ranking/recallRecency.replay.ts` (new, pure functions only:
  diffing and table rendering)
- `plans/measurements/recall-recency-2026-11-15.json` (written by the harness when it runs)

Nothing else. **No change to any ranking, runtime or db source file.** If something cannot be done without one,
stop and report exactly what is missing.

## Files readable (the supervisor read these; line numbers approximate)

- `src/lib/server/pipelines/measure/promptDiff.ts` — the model to copy: `runTurn(..., { preview: true,
  skipReceipt: true, overrides, seed })`, and reading the `core:task/rank-hybrid@1` node's `output.decisions`
  off `receipt.nodes` (`standingsOf`, `promptOrder`, ~250–330, ~337–380).
- `src/lib/server/pipelines/measure/promptDiff.int.test.ts` — how an int test mocks `$lib/server/embedding`.
- `scripts/prompt-ab.entry.ts` — why every server import must be dynamic and happen after the data dir is set.
- `vitest.setup.ts` — it sets `SERENE_PUB_DATA_DIR` to a fresh `/tmp/serene-pub-vitest-*` dir per test file and
  removes it (closing PGlite) after the file. That dir is the test's own temp dir.
- `src/lib/server/pipelines/runtime/runTurn.ts` ~125–260 (`TurnRequest`), ~500–560 (`forceOverrides`).
- `src/lib/server/pipelines/runtime/bindings.ts` ~420–470 (`SIGNAL_FIELDS`, `signalsFrom`: param
  `signalLastRefRecency` is a per-band object), ~5263–5360 (the rank-hybrid binding), ~1040–1100 (`loreFor`:
  reads `session_messages` with `limit: 100`).
- `src/lib/server/pipelines/runtime/host.ts` ~3970–4140 (the `session_messages` read: newest rows by id where
  `is_hidden = false and is_generating = false`, the channel, and not a failed reply).
- `src/lib/server/pipelines/ranking/signals.ts` ~1050–1065 (`lastRefRecencySignal = exp(-0.01·(total − lastIndex))`).
- `src/lib/server/messages/failedReply.ts` (`notAFailedReplySql`).

## Design (follow it; name any deviation in your report)

**Gate.** `describe.skipIf(!process.env.REPLAY_DATA_DIR)`. Without the variable the file reports skipped and
imports nothing from `src/lib/server`.

**Open a copy.** Only `vitest`, `node:fs`, `node:path`, `node:os` as static imports. In `beforeAll`: copy
`${REPLAY_DATA_DIR}/data/serene-pub.db` and `${REPLAY_DATA_DIR}/data/meta.json` into
`${process.env.SERENE_PUB_DATA_DIR}/data/` (`fs.cpSync(..., { recursive: true })`); remove a `lock` key from the
COPIED meta.json if present (read, delete key, write back; never print it). Then dynamic-import
`$lib/server/db`, `await dbReady`, and dynamic-import `runTurn`. `vi.mock("$lib/server/embedding", …)` as
`promptDiff.int.test.ts` does (no embedding model: meaning search contributes nothing; the report says so).
Opening runs boot passes and writes — into the copy only, which is the point of copying.

**Sessions, derived, never hardcoded.** Story-time genres are `core:genre/story`, `core:genre/lair`,
`core:genre/dungeon-crawler` (one named constant, with a one-line comment: the dated genres, plan ★14). Live
messages of a session = rows on the main channel (`channel = 'main' or channel like 'main:%'`) with
`is_hidden = false`, `is_generating = false` and `notAFailedReplySql`, ordered by id. Candidate sessions: a
story-time genre, not archived, ≥ 20 live messages. A candidate is kept when a baseline preview at its last
position shows ≥ 10 lore entries considered (sum of `diagnostics.considered` over the receipt nodes whose
output has `diagnostics.considered`, or distinct lore candidates + skipped rows — say which you used).

**Positions.** For each kept session, for N = 10 … L (L = number of live messages): the conversation is the
first N live messages. `cutId` = id of the N-th live message. Rebuild that state in the copy by setting
`is_hidden = true` on every row of the session (any channel) with `id > cutId` that was **not already hidden**
(remember that set; walk N ascending, un-hiding as you go; restore at the end). Plain `db.update` / `db.execute`,
no transaction. Turn inputs:
- `userId` = the session's `user_id`;
- `currentCharacterId` = `character_id` of the first live `assistant` row after `cutId` (`null` when that row
  has none); for the last position, the last live assistant row's `character_id`;
- `text` = the N-th live message's `content` (never printed);
- `seed` = `replay:${sessionId}:${N}`, identical for both variants;
- `preview: true, skipReceipt: true`.

**Two variants per position**, run sequentially:
- `shipped`: no overrides;
- `noRecency`: one override per rank node: `{ nodeKey, path: "signalLastRefRecency", value: { worldLore: 0,
  characterLore: 0, history: 0, messages: 0, relationships: 0 } }`, where the node keys are those of every
  receipt node with `definitionId === "core:task/rank-hybrid@1"` in the shipped run (do not hardcode "rank").

**Read off the receipt**, rank-hybrid node, `output.decisions` (`{ candidate, score, included, reason }`).
Lore candidates = decisions whose `candidate.source` is `worldLore`, `characterLore` or `history`. Per lore
candidate keep: id, name (`payload.name ?? payload.title ?? name`), source, `payload.typeId` if present,
included, score, `candidate.signals.lastRefRecency` (s), and messages-ago = `s > 0 ? Math.round(-Math.log(s) / 0.01) : null`.
Rank = 1-based position by score descending among that turn's lore candidates (ties: by id).

**Assert the lever reached** (fail the test otherwise): at each position, for every lore candidate present in
both runs, `scoreShipped − scoreOff` is 0 (±1e-12) when s = 0, and `(scoreShipped − scoreOff) / s` is the same
number for every candidate of a band (±1e-9) when s > 0; record that inferred weight per band. And at least one
candidate in the whole run has s > 0.

**Determinism.** After the full pass, run both variants again at every position and assert the included id
lists and scores are identical to the first pass.

**Also record per turn** `loreExistedThen`: true when every lore candidate's entry row has
`created_at <= ` the N-th live message's `created_at` (entries are matched by candidate id to
`lorebook_entries.id`; if ids are not entry ids, report that).

**Report (printed with `process.stdout.write`, per session and in total), as a markdown table plus lists:**
1. turns replayed; mean lore candidates; mean selected (shipped);
2. turns where the selected set differs; total entries out / in (and mean per differing turn);
3. dropped-out entries (in shipped, not in noRecency): per entry name — times, source/type, messages-ago at each
   of those turns (min / median / max); the same for came-in entries;
4. rank shift of entries selected in both: mean |shift| and worst;
5. three examples: the first three differing turns (spread across the session if more exist: first, middle,
   last) — "turn N: out [names] / in [names]";
6. the same rows 1–2 restricted to turns with `loreExistedThen`;
7. the inferred shipped `lastRefRecency` weight per band; whether embeddings took part (always "no" here).

**Raw JSON** to `plans/measurements/recall-recency-2026-11-15.json`: per session, per turn: N, cutId,
currentCharacterId, loreExistedThen, and for each variant the lore candidates (fields above, no text); plus the
summary. Pretty-printed. No message or entry content anywhere in it.

## Run (exact)

```
ps -eo pid,args | grep -E "node.*vitest" | grep -v grep   # must print nothing
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "REPLAY_DATA_DIR=/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/replay-copy npx vitest run --maxWorkers=1 src/lib/server/pipelines/ranking/recallRecency.replay.int.test.ts > plans/time-t7-measure.log 2>&1"
```

Then once **without** the variable (must report the file skipped, green), to a separate log
`plans/time-t7-measure-skip.log`. Read logs with the Read tool or `grep`, not by piping vitest. Before you
report, grep the log and the JSON for any long free-text field to make sure no message/entry text leaked.

Also: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` must show 0 errors in your files (other
lanes' errors elsewhere: list them, don't fix them), and `npx prettier --check <your files>`.

## Stop and ask when

- `runTurn` preview cannot run on the copy without changing a source file (missing data, a boot failure you
  cannot work around inside the test);
- the override does not reach the rank node (the lever assertion fails and you cannot see why);
- anything would need a new setting, a migration, or an edit outside the files owned.
Report what you found instead of working around it.

## Done means

The harness is green with `REPLAY_DATA_DIR` set (the table printed, the JSON written) and green-skipped without
it; tsc clean in your files; prettier clean.

## Report

Return as your final message: files changed; the two runs and their results (pass/skip, wall time); the printed
table pasted verbatim from the log (entry names allowed, no text); any deviation from this design and why;
anything you noticed and did not do. Under 600 words.
