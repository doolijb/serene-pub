# BRIEF — lane `sense-sdk` (wave 2) — SDK truth fixes

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then what this lane triggers (named
below). Plan: `plans/PLAN-sensible-engine-2026-11-11.md` (Part 5 is what the owner's go covers). Evidence for each
item: `plans/REVIEW-sensibility-2026-11-11.md`, by row id.

Read down: `../serene-pub-sdk/INTEGRATING.md` (the steps on slots, script seams and the executor; read by section),
CLAUDE.md "Stack and layout" (the SDK resolves by `file:` link to `../serene-pub-sdk/`; its `main` is
`./dist/index.js`; after any SDK change run `npm run sdk:build` from the app before app tests, never under a live
`vite dev`), NOMENCLATURE §1 and §24, `../serene-pub-sdk/guides/your-first-plugin.md`.
**Removing or renaming a published SDK name is the owner's call.** This lane adds defaults and aligns behaviour; it
removes nothing.

## Goal — review rows C1, C7, C8 (pick-sprite only)

1. **C1 — a prompt step wires itself.** The validator knows the fix for an unwired prompt step and only warns
   (`../serene-pub-sdk/sdk/src/validate.ts` about 1274–1318): an `assemble@2` with no `template` wired, or no
   connection of the model call it feeds, publishes and then halts or sends a prompt with no messages. Make the
   builder supply both when the author leaves them out: `template` defaults to the node's own template slot, and
   the connection to that of the model call the assemble feeds (what `slot.template()` and
   `slot.connectionOf('<that node>')` write today). A model-call oracle with no connection or sampling slot wired
   defaults to its own. **A spec that already wires them compiles to the same document, byte for byte**: prove it
   with the catalogue's existing hash pins, which must not move. The warning stays for a document nobody built
   through the builder. Fix the guide's two sentences that contradict each other (about lines 79 and 101).
2. **C7 — a script failure costs nobody their reply, at either kind of seam.** At a port seam an applier throw is
   absorbed and recorded as an `(engine)` error row (`sdk/src/executor.ts` about 1628–1656). At an interior point
   it rethrows ("No try/catch", about 1962–1968). Make the point path absorb and record the same way; only
   `ScriptSeamHalt` propagates. The type's own contract (about 564–566) already promises this.
3. **C8, narrowed — pick-sprite declares that it may fail.** `core:oracle/pick-sprite@1`
   (`contracts/src/oracles.ts` about 1454) catches everything by hand in the app binding and returns ok with null
   ports, so the receipt shows success. The SDK has a declared policy for this, `optional: true`
   (`sdk/src/descriptors.ts` about 1775–1792; used at `oracles.ts` 226 and 784). Declare it and let the binding
   throw, so the tolerated failure is recorded. This changes a hashed descriptor: re-pin the affected goldens with a
   dated note, as the repo's pins do. **Leave `core:oracle/speak@1` alone** — the speech work is unfinished and
   unassigned.

4. **The turn pool's `all` option says what it now does.** Lane `sense-eng` made the pool honour the bench for
   every value of `characters`, so `all` now reads the same as `active`. The option's description in
   `contracts/src/tasks.ts` (about 2966–2985) still says "'All' admits ones switched off". Change the **description
   text only** to say it is the same as Active and that a benched character never takes a turn. Do not remove or
   rename the option (a published name; dropping it is the owner's call). Re-pin any golden the text moves.

## Files owned

- In `../serene-pub-sdk/`: `sdk/src/builder.ts` and the files the defaults live in, `sdk/src/validate.ts`,
  `sdk/src/executor.ts` (the point-seam path), `contracts/src/oracles.ts` (the pick-sprite descriptor only), `contracts/src/tasks.ts` (that one description),
  `guides/your-first-plugin.md`, the tests and golden pins these changes move, `INTEGRATING.md` sentences made untrue.
- In the app: the `core:oracle/pick-sprite@1` binding in `src/lib/server/pipelines/runtime/bindings.ts` only, its
  tests, and any app golden pin the descriptor change moves.

## Out of scope

`core:oracle/speak@1` and everything on the speech red list; removing the "Stream speech" parameter (a published
name); `shape.writes` defaults (plan lane K-writes); id forms (K-ids); `runtime/host.ts`, `sockets/sessions.ts`.

## Stop and ask when

Any published name would be removed or renamed; a hash pin moves that item 1 says must not; a new public option.

## Done means

Tests that fail before and pass after: a spec built without `template` or `connection` on its prompt step compiles
to the same document as one that wires them; an interior-point applier throw is recorded and the value passes
through; a failing pick-sprite leaves a tolerated-failure record and the reply still lands. SDK tests run from the
app as `npm run sdk:test` scoped to the files you touched if the script allows, otherwise the targeted vitest files
in the capped scope. `npm run sdk:build` once at the end (after the `pgrep` check) so the app sees the change.

## Report

`plans/REPORT-sense-sdk-2026-11-11.md`: changed files in each repo, tests and results, every pin that moved and why,
open ★, **Noticed, not done**.

**Return the full report as your final message** (the harness refuses a supervisor's write of a report file; the
lead saves it at the path above).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
