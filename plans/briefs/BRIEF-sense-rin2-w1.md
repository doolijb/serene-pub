# BRIEF — lane `sense-rin2`, worker 1 — the skipped row carries its raw reason

You are a `lane-worker`. Do only this. Supervisor: lane `sense-rin2`.

## Goal

`explainRetrieval` (`src/lib/server/sockets/pipelines.ts`, the "Never reached the ranker" block, about lines
4631–4690) builds one `RetrievalRow` per entry a mechanism declined before the ranker. Today the mechanism's raw
reason (`s.reason`, e.g. `"entry is archived"`, `"entry is disabled"`, `"not visible to the current speaker"`, a
miss sentence) survives only inside the prose `verdict` (`` `Never reached the ranker — ${reason}.` ``), and the client
recovers it by stripping that prefix. Hand it over as data instead.

1. In `src/lib/shared/sockets/types.ts`, interface `RetrievalRow` (about line 10854), add one optional field
   **`skipReason?: string`**, placed right after `reason?: string` (about line 10966). Doc comment, in the file's
   style, saying: the mechanism's own reason for declining the entry before the ranker (the skip's `reason`,
   e.g. `"entry is archived"`), present only on a `skipped` row that had one and never on a judged row; **not**
   `reason`, which is select's code (`excluded_budget`…) and absent on a skipped row; the prose `verdict` quotes
   it and is for reading, this is for code.
2. In `explainRetrieval`'s skipped-row `rows.push({...})`, add `...(reason ? { skipReason: reason } : {})`. Change
   nothing else: the `verdict` sentence stays exactly as it is.
3. Test, in `src/lib/server/sockets/pipelines.retrievalExplain.test.ts`, inside
   `describe("explainRetrieval — what never reached the ranker", …)` (about line 702): a skipped row carries
   `skipReason` equal to the skip's own reason (the existing receipt's `skip:worldLore:2` row:
   `"no key matched in the last 10 messages"`), and a skip with no reason carries no `skipReason` (build a small
   receipt the way the neighbouring tests do; read how `receipt()` / `explain()` are built first). Also assert a
   judged (included or excluded) row has no `skipReason`.

## Files owned

`src/lib/server/sockets/pipelines.ts` — **only** the skipped-row block inside `explainRetrieval`.
`src/lib/shared/sockets/types.ts` — **only** the `RetrievalRow` interface.
`src/lib/server/sockets/pipelines.retrievalExplain.test.ts`.

## Files readable

Anything. Another worker is editing `src/lib/client/lorebooks/editor/readIn.ts` and `signals.ts` at the same time
to read `row.skipReason`; do not touch them.

## Out of scope

Renaming `RetrievalRow.verdict` (it stays); any other handler in `pipelines.ts`; any other type in `types.ts`.

## Stop and ask when

You would need any other name, field or file. Write the question in your report instead of deciding.

## Done means

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/pipelines.retrievalExplain.test.ts"`
passes, and `npx prettier --check` on each file you changed (if a file already failed prettier before your change,
say so and do not reformat it: check with `git diff` that your hunks alone are formatted like their neighbours).

## Report

Return in your final message: changed files with the exact lines added, test command and result, anything noticed
and not done.

## Rules (verbatim from the guide and the lane brief)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `prettier --write` on a directory or on these large files. Never `git checkout` / `restore` / `stash`.
  Do not start a dev server. Never pipe vitest into `head`.
- **No reference to any other project or product** in code, comments or tests.
- It is a **session**, never a *chat*.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
