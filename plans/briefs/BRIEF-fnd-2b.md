# BRIEF — build lane `fnd-2b` — split `pipelines/runtime/host.ts` by area (programme 0.2, second file)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-file-splits-2026-11-15.md` §2 (the map; **re-derive every line range**), and
`plans/REPORT-fnd-2a-2026-11-16.md` (how the first split was done and proven: one move script that refuses to
write unless every moved block is byte-identical; copy that method, the script is described there).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. Delete
only your own `/tmp/serene-pub-vitest-*` dirs by name. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-2b-<n>.log 2>&1"`,
strictly one run at a time (check for a running vitest first). Type checks with
`NODE_OPTIONS=--max-old-space-size=10240` (`npx tsc --noEmit -p .` is incremental). The SDK is not touched.

## The rule of this lane

**Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved
code.** Every name importable from `runtime/host` today stays importable from that path (three tests
`vi.mock(".../runtime/host", importOriginal)` and 151 files import it). `createHost` stays the one entry point
and keeps its closure state: `liveChannel`, `liveRowId`, `turnMessageId` and the cases that assign them
(`create-message`, `update-message`) **stay inside `createHost`**. A module-level cache or map ends up in
exactly one module. If a move needs a logic change to compile (a closure variable that would have to become a
parameter counts as a signature change, not a logic change, and is allowed only in the form the inventory
describes: a function taking `{ db, scope, host, node, q }` plus the caches it reads), stop that step and report.

## Steps (one at a time, sequential workers; each ends green before the next)

1. `host.types.ts`: the types (`PendingFire`, `HostScope`, `HostScopeError`, `CoreHostServices`,
   `ChannelShaping`), re-exported from `host.ts`.
2. `host.loreWrites.ts`: the module-level lore-link, notes and history-day writers.
3. `host.helpers.ts`: the remaining module-level helpers and the row mappers; the lazy `embeddingModule` cache
   lives here (one copy).
4. `host.read.*.ts`: the self-contained `read` cases (`lorebook_entries`, `session_cast`, the summarize reads,
   the vector / entity reads), each a function the `read` switch calls.
5. `host.call.ts`: the `call` cases.
6. Only if steps 1–5 are green and the inventory's "riskier" note still holds after reading the code: the
   lore-writer inner helpers as a factory with a getter for `turnMessageId`, then the lore `commit` cases.
   Otherwise report what it would take and stop at 5.

Per step: no new import cycle (new files import shared helpers from `host.helpers.ts` / `host.types.ts`, never
from `host.ts`; the existing cycle with `loreSources.ts` / `loreMatch.ts` is repointed to the new leaf if that
removes it, else left and named); `npx tsc --noEmit -p .` 0 errors; then the tests: every
`pipelines/runtime/host*.test.ts` and `*.int.test.ts` that names host in its path, the three files that mock
it (`nonCastLabels`, `speakerLore.cardless`, `cardlessSeat.e2e`: find them), `pipelines/runtime/allPipelines.int.test.ts`,
`pipelines/runtime/receipts.int.test.ts`, `sockets/sessions.editedLineRerun.int.test.ts`,
`sockets/sessions.retake.int.test.ts`, `pipelines/parity/harness.int.test.ts`; failures allowed only if they
are in `plans/lead-full10.log`'s standing list. A proof per step that moved blocks are byte-identical (the
move script's own check) and that `Object.keys` of the module's exports is unchanged.

## Done means

`host.ts` is `createHost` plus what must stay (report the real size and what remains and why); all checks green
after the last step; `NODE_OPTIONS=--max-old-space-size=10240 npm run check` 0 errors; the contributor note in
`src/lib/server/pipelines/README.md` says where a new host case goes; the comment ratchet
(`src/lib/shared/conformance/commentHistory.ratchet.json`) redistributed for the moved comments with the total
unchanged (report the numbers; the lead applies them if the file is not yours to edit: it is, for this lane).

## Stop and ask when

A step needs a logic change; a cycle cannot be avoided; a test reads `host.ts` as text; an export set differs;
another lane's uncommitted edit sits inside a block you are moving and the move would lose it (verify with
`git diff` before each step).

## Report

Final message = the report (lead saves `plans/REPORT-fnd-2b-<date>.md`): per step, new file, lines, size of
`host.ts` after, checks; what stays and why; **Noticed, not done**. Under about 600 words.
