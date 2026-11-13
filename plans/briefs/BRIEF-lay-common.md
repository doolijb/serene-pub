# BRIEF lay common — session layouts simplified (owner GO 2026-11-05)

Every `lay-*` lane supervisor reads this first, then its lane brief.

## Read first
1. `.claude/guides/multi-agent.md` (your contract).
2. `plans/PLAN-session-layout-simplify-2026-11-05.md` — §1 owner rulings (quoted), §2 ★ decisions, **§3 lead decisions D1–D15 (these win over anything in the recon reports)**, §4 lanes.
3. The recon report(s) for your domain: `plans/briefs/RECON-layout-{sdk,runtime,widgets,storage}.md` — file:line maps already gathered; re-verify before editing (lines drift).
4. The design canvas exists (https://claude.ai/artifact/LEUyfXZcTWuxDrYnkkoveY) — you cannot open it; the plan describes every board.

## Rules (quote into every worker brief)
- CLAUDE.md Principles / Decisions / Hard rules apply. Notably: no top-level `await` in `src/lib/server/db/index.ts`; inside `db.transaction(async (tx) => …)` use only `tx`; `socket.off(event)` always with the handler; `$state(new Set/Map)` is not reactive — `SvelteSet`/`SvelteMap`; browser code: no `crypto.randomUUID`, no `navigator.clipboard`; "session", never "chat".
- **0.6 is in users' hands**: stored data changes ship with a boot pass + a test that a second boot changes nothing. **No schema migration** in this build (JSON/rows only); if you think you need one, stop and report.
- **Published SDK names are never removed or renamed** in this build: mark ⏳ deprecated instead (owner's call, PLAN D4).
- **New names**: every new user-visible word or exported name follows NOMENCLATURE §1 + §24 and is listed in your report for lay-F to record in §25 (lay-F owns NOMENCLATURE.md; nobody else edits it). Retired words in §23 are never reintroduced (exceptions decided in PLAN §3: `composer` id un-retired).
- **Shared files** (`sockets/sessions.ts`, `startup/index.ts`, `src/lib/shared/sockets/types.ts`): another programme (`cv-*`) has queued edits there. Only the lane that owns one may edit it; re-read immediately before each edit; minimal hunks; never rewrite whole files.
- **Every test or typecheck run goes inside a memory-capped scope** (VS Code has been OOM-killed by bare runs, last on 2026-11-06), never bare, one group at a time, logging to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd <dir> && timeout 900 npx tsx --test <a few files> > <scratch>/<lane>-t.log 2>&1; echo test-exit=$? >> <scratch>/<lane>-t.log'` then grep the log. `tsc` / `npm run check` in their own scope with MemoryMax=12G and `--max-old-space-size=8192`. Never hand a DOM node to an assertion (compare `x === null` to `true`).
- Tests: run only your targeted files. **Never pipe vitest into `head`** (SIGPIPE leaks PGlite temp dirs). DB-in-`it` int tests need a 60 s timeout. Heavy happy-dom tests in a capped scope.
- Every implementation brief adds, verbatim:
  - *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
  - *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
  - *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
  - *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
  - *"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."*

## Done means
Your targeted tests green; `tsc` clean on your files (app: `npx tsc --noEmit -p .` filtered to your files; SDK: the package's tsc). Subagents cannot write report files in this harness: END with the full report as your final message (the lead saves it to `plans/REPORT-lay-<letter>-2026-11-05.md`), starting `# REPORT lay-<letter> (2026-11-05)`: exported names + signatures first, changed files, tests run with results, names for §25, open ★, Noticed-not-done.
