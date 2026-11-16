# BRIEF — lane `time-t7-measure` — measurement 2: what the "Recently referenced" lift does for lore recall today

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §7 (measurement 2 and "Measured 2026-11-15") and §8 ★8,
`plans/briefs/BRIEF-time-t7.md` (only its LAST section: the rest is withdrawn),
`src/lib/server/pipelines/ranking/weights.ts` (~130–310, the signal weights and `lastRefRecency`),
`ranking/signals.ts` (~1040–1130, `lastRefRecencySignal`, `buildLastRefMap`), `ranking/keywordQuery.ts` (~420–450,
~1170–1200), `ranking/select.ts` (~350–370, ~730–800), and how the shipped Story pipelines call the ranker
(`src/lib/server/pipelines/runtime/bindings.ts` around `rankHybrid` / `rank-hybrid`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no build, no dev instance, no migration, no change to any shipped behaviour. **This lane builds a
measurement and reports numbers; it changes no ranking.**

## The question (owner ruling it serves)

Owner, 2026-11-13: "Maybe we can update recency to use the new decay rate and switch." Ruled 2026-11-14: "Moving
recency onto Decay although existing entries (all facts) lose today's lift, pending measurement 2" — and the
plan: "what a real lorebook recalls over a recorded session, before and after; facts lose today's lift, so if
recall of facts drops, facts keep the lift."

Today every shipped genre ranks lore with `rank-hybrid`, where the signal `lastRefRecency` ("Recently
referenced", weight 0.1 for world lore, character lore and history) lifts an entry the conversation touched
recently. If recency moves onto Decay, an entry that is a **Fact** (Decay 0: every entry that exists today)
would no longer get that lift. **How much does recall change when that lift is taken away from facts?**

## Build: one replay harness, run on a copy of real data

- A test file that is **skipped unless an environment variable names a data directory** (follow the existing
  pattern of live tests gated by an env var, e.g. `LIVE_MODEL` in
  `src/lib/server/pipelines/parity/liveWireFormats.live.int.test.ts`): `REPLAY_DATA_DIR=<dir>`. It opens the
  PGlite database in that directory **read-only in effect** (it must write nothing: no migrations run by the
  harness beyond what opening requires; if opening would migrate or write, copy the directory first inside the
  test's own temp dir and open the copy).
- The lead has put a copy of the owner's real data (already on migration 0164) at
  `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/replay-copy`
  (its `data/meta.json` holds a secret key: never print that file's values). Sessions 4 (Story, reads lorebook 4:
  57 entries, 11 history entries, about 60 messages) and 5, 3, 1 (Story, notes-only) are the useful ones. Work
  out the session ids from the database, do not hardcode them in the harness: take every session of a
  story-time genre that has at least 20 live messages and at least 10 lore entries on its reading.
- For each such session, and for each message position N from the 10th live message to the last: build the
  ranking input **as the session's shipped pipeline would have at that point** (the conversation up to N, the
  lorebook as the session reads it, the session's ranking parameters and budgets as its preset declares them),
  and run the lore selection **twice**: once as shipped, once with `lastRefRecency`'s weight set to 0 for every
  entry type (everything else identical: same budgets, same other weights, same inputs). Use the real
  functions (`keywordQuery` + `select`, or whatever `rank-hybrid` calls); do not reimplement scoring.
  - If meaning search (embeddings) is part of the shipped path and cannot run in the test without a model
    server, run with the keyword half only and **say so plainly** in the report; do not start a model server.
  - Determinism: the same input must give the same output on a second run (assert it).
- Report, per session and in total:
  1. how many turns were replayed, how many lore entries were candidates on average, how many were selected on
     average (as shipped);
  2. **on how many turns the selected set differs** between the two runs, and by how many entries (in / out);
  3. for the entries that dropped out without the lift: how many times each, their entry type, and how recently
     they had been referenced (messages ago) at that turn; the same for the entries that came in instead;
  4. the rank shift of selected entries that stayed (mean and worst);
  5. three concrete examples in words: turn N, what dropped out, what replaced it (entry names only, no entry
     text; the data is the owner's private story).
- Write the numbers to `plans/measurements/recall-recency-<date>.md` (the harness prints them; you paste the
  table), and the raw per-turn diff as JSON beside it. Entry names may appear; entry text and message text may
  not.

## Files owned

One new test file under `src/lib/server/pipelines/ranking/` (name it `*.replay.int.test.ts`), one small helper
beside it if needed, `plans/measurements/recall-recency-*.md` and `.json`. Nothing else. No change to any
ranking source file: if the harness cannot set the weight to 0 through the functions' existing parameters,
**stop and report** which parameter is missing.

## Stop and ask when

The shipped ranking input cannot be rebuilt for a past message position without changing source files; opening
the copy would write to it; the lift is not reachable as a parameter.

## Done means

- The harness runs green and skipped without `REPLAY_DATA_DIR`, and produces the report with it, twice with the
  same numbers. Run as
  `REPLAY_DATA_DIR=<the path above> systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=1 <file> > plans/time-t7-measure.log 2>&1"`
  (the variable must reach the scope: pass it with `systemd-run`'s `--setenv` or inside the `bash -c`), after
  checking `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t7-measure-<date>.md`): how the
ranking input was rebuilt (file:line), whether meaning search took part, the table, the three examples, what the
numbers suggest (in two sentences, no recommendation beyond the data), **Noticed, not done**. Under 600 words.
