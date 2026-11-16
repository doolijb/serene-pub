# BRIEF — build lane `perf-D` — the turn path stops recomputing what it already knows

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then: `plans/PLAN-performance-2026-11-13.md`
Part 1 and W4 (as amended by [C3]); `plans/REVIEW-performance-2026-11-13.md` rows C2–C9, C11; CLAUDE.md Principles,
Hard rules and Standing rulings; `docs/pipelines.md` and `docs/sessions.md` where a step touches them. Line numbers are
from 2026-11-13; re-read before editing. Rows marked **S** are sweep findings: re-verify at their lines first.

## Rulings that bind

- Owner 2026-11-13: change how often, never what. A cache here is keyed so a stale answer is impossible; each one
  names its key and what invalidates it in your report and has one test that a write invalidates it.
- Owner 2026-11-04 P1: same inputs, same result. No cache may make a turn depend on what ran before it.
- **Not your files:** `src/lib/server/pipelines/runtime/host.ts` and `runtime/bindings.ts` belong to the peer session
  `serene-pub-c4`. If a step needs a line there, write the exact change in your report under "Queued for the
  runtime owner" and build everything else.

## Build

1. **Send handler** (C2). `sockets/sessions.ts:8817` loads the whole main-channel transcript through
   `getPromptSessionFromDb` to test the session exists; `fireNarratorResponseHandler` (`:11483`) uses it for
   `some(m => m.isGenerating)`. Replace with an existence check (the access check at ~`:8787` already proves the
   session; do not repeat it) and an `EXISTS(... is_generating)` query. Nothing else in the handler reads the result
   — confirm by reading `:8836–9006` before you change it.
2. **Compiled templates cached** (C4). `pipelines/prompt/renderers.ts:122–159` creates a Handlebars engine, registers
   helpers and compiles per render; Liquid likewise. Cache compiled templates keyed on `(engine id, template source,
   prompt-format identity + updatedAt or hash)`; helpers that close over `promptFormat` close over the cached key's
   own format. Bounded LRU (say the size). One test: two formats with the same template source render differently.
3. **Local tokenizer counts memoised** (C5). `pipelines/runtime/tokenizers.ts:114–145`: wrap the llama / llama3 /
   mistral / gpt counters in the same content-keyed LRU `connections/backendTokenCount.ts:167–268` uses (reuse its
   `keyOf` and limit; do not write a second cache shape).
4. **Turn number kept, not recounted** (C6, **S** — verify). `pipelines/routines/moments.ts:109–133` counts every
   earlier turn per landed message; `readTurnTally` (~`:403`) already persists a tally. Keep the turn number on the
   tally and increment it, with a reconcile path that recounts when the tally is absent. Same answer in every case
   the existing tests cover.
5. **Narrator labels per session** (C7, **S** — verify): `pipelines/runtime/dispatch.ts:579–588` scans
   `metadata->>'narratorName'` per dispatch. Cache per session, invalidated when a narration lands (find the write
   site; if it is in `host.ts`, queue the invalidation call for the runtime owner and do not ship the cache without it).
6. **Ruleset N+1** (C8, **S** — verify): `rulesets/resolve.ts:204–205` (`writtenAgoOf`) and `:676–679`
   (`sessionAsleep`). Batch `valueRows` across owners; memoise the per-owner book reading for the moment.
7. **One expression engine** (C9). `state/expressions.ts:293–330`: one shared Liquid; filters read scope and seed
   from the render context rather than a closure. The two-concurrent-turns concern the comment names is the test:
   two evaluations with different scopes interleaved give each its own answer.
8. **Session reload paths** (C11, **S** — verify): `sockets/sessions.ts:7542`, `:8724` pass `"none"` or a limit as
   `buildSessionRefresh` does; `:6204–6205` sends the rows once. Check the client reads `messages` or
   `session.sessionMessages` from the refresh payload and keep the one it reads.

## Files owned

`src/lib/server/sockets/sessions.ts` (the handlers named in steps 1 and 8 only) · `src/lib/server/pipelines/prompt/renderers.ts` ·
`src/lib/server/pipelines/runtime/tokenizers.ts` · `src/lib/server/pipelines/routines/moments.ts` ·
`src/lib/server/pipelines/runtime/dispatch.ts` (`nonCastLabelsFor` only) · `src/lib/server/rulesets/resolve.ts`
(`writtenAgoOf`, `sessionAsleep`) · `src/lib/server/state/expressions.ts` · tests beside them.

## Files readable

Everything.

## Out of scope

`runtime/host.ts`, `runtime/bindings.ts` (peer's). The keyword-scan cache (W4-b: its home `ranking/keywordQuery.ts`
is free, but its call site is in `bindings.ts`; build the gazetteer/DF cache in `keywordQuery.ts` only if it needs
no change at the call site, else queue it). The write gate (W9). Any new setting.

## Stop and ask when

A cache cannot be keyed so staleness is impossible; a name is new; a step needs a migration; a handler in
`sessions.ts` outside the named ones must change.

## Done means

Existing tests for every touched file green (list them); the invalidation test per cache; the renderer two-format
test; the expression interleave test. `npx prettier --check` on changed files. Report measured before/after for
steps 2, 3 and 7 with a 50-iteration micro-benchmark in a test (p50 ms).

## Report path

`plans/REPORT-perf-D-2026-11-13.md`: changed files, verified/not-verified per S row, tests with results, numbers,
"Queued for the runtime owner", open ★, **Noticed, not done**.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- At most 2 workers at once. Workers get these rules inline.
