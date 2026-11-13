# BRIEF — worker `sense-rin-w2` — the owner's Read in line gets the stored reason (server half)

You are a `lane-worker` under supervisor `sense-rin`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

The entry editor's Read in line, for a book owner reading without a run explanation, is fed by
`entries:recentDecisions` (`entryRecentDecisionsHandler`, `src/lib/server/sockets/entries.ts` ~2053–2230). For
each entry the newest ranking judged it hands `facts` (rank, of, tokens, matched, budget) off the ranking store —
but not **why** an entry was left out, though `ranking_decisions` stores it (`reason`: select's code such as
`excluded_budget` / `excluded_ineligible`; `why`: the decision's own sentence, e.g. "A secret the speaker does
not hold."). So the line says "weighed and left out".

Extend that read's payload — no new event, no new stored fact — so each fact for an entry the turn **left out**
carries the stored `reason` and `why`. A parallel worker turns them into the sentence on the client.

## Files owned (the only files you may edit)

- `/home/jody/github/serene-pub/src/lib/server/sockets/entries.ts` — **only** `entryRecentDecisionsHandler`.
- `/home/jody/github/serene-pub/src/lib/shared/sockets/types.ts` — **only** the `facts` entry type inside
  `namespace RecentDecisions` (~9234–9256). Nothing else in this shared file.
- `/home/jody/github/serene-pub/src/lib/server/sockets/entries.workspaceVerbs.int.test.ts` — the
  `describe("entries:recentDecisions")` block and the `receiptWith` helper (~95–124), extended backwards-compatibly.

## The contract (exact)

1. Types: add to each `facts` entry, with a short doc comment each in the file's voice:
   - `reason?: string` — select's code for a decision that left the entry out (`ranking_decisions.reason`).
     Present only when the turn left it out.
   - `why?: string` — that decision's own sentence (`ranking_decisions.why`). Present only when the turn left it
     out and the store has one.
   Update the `facts` doc comment's list ("rank among the entries judged, tokens, the key that matched, the
   budget") to mention why it was left out.
2. Handler: select `reason` and `why` from `schema.rankingDecisions` beside the existing columns. In the facts
   loop, add `reason` and `why` only when `!r.included` (and `why` only when non-null/non-empty). Keep the
   existing rule that an inclusion's figures win over another ranking's rejection (`if (fired && !r.included)
   continue`), and make sure an entry included by one ranking and left out by an earlier-iterated one does not
   keep a stale `reason`/`why` (when a later row includes it, its fact must not carry them). Read the loop and
   reason about row order before writing.
3. No other behaviour changes; no new query beyond the two extra columns.

## Done means

In the int test file:
- `receiptWith` accepts optional `reason` and `why` per decision (default reason stays as today; `why` omitted
  when not given). Check how `recordRankings` (`src/lib/server/pipelines/runtime/rankingStore.ts`) reads a
  decision's `reason` and `why` and shape the receipt so it stores them.
- New test: a left-out decision with `reason: "excluded_ineligible"`, `why: "A secret the speaker does not hold."`
  → `res.facts[id]` has exactly that `reason` and `why`.
- New test: an entry left out by one branch and included by another → its fact carries no `reason`/`why`.
- New test (or assertion in the first existing test): the included entry's fact carries no `reason`/`why`.
Each `test(...)` that opens a DB gets the 60 s timeout like its neighbours (`}, 60_000)`).

Run, capped:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 src/lib/server/sockets/entries.workspaceVerbs.int.test.ts"`
Afterwards list `/tmp/serene-pub-vitest-*` dirs created by your run and delete only those, by name.
Then `npx prettier --check` on each changed file. (types.ts and entries.ts are large; if prettier --check
already failed on them before your change, say so rather than reformatting the file.)

## Out of scope

Every other handler in `entries.ts`; `pipelines.ts`; `runtime/host.ts`; `sockets/sessions.ts`; the ranker and
the ranking store writer; migrations; client files. If you think you need any of them, stop and say so.

## Rules that apply

- Inside `db.transaction(async (tx) => …)` use only `tx` (you should need no transaction).
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- It is a **session**, never a *chat*. No reference to any other project or product in code, comments or tests.
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `prettier --write` on a directory or on these large shared files. Never `git checkout` / `restore` / `stash`. Never pipe vitest into `head`. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.

## Report

Return as your final message: the diff summary per file, the test command's pass/fail counts, prettier results,
the temp dirs you deleted, Noticed-not-done.
