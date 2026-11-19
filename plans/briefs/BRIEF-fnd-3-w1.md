# BRIEF — worker `fnd-3-w1` — stale server test expectations + temp dirs (lane `fnd-3`)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-3`. Triage source:
`plans/INVENTORY-standing-failures-2026-11-16.md` (rows quoted below). **Re-verify every file:line and every
cause before editing: a row may be wrong.** Line numbers inside `src/lib/server/sockets/sessions.ts` are moving
(another lane is splitting that file into `sessions.*.ts` right now): find code by searching, not by line.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Make each test file below pass by updating the **test** only. No product code changes at all.

## Rows

| File | Cause (inventory) | Fix (inventory) |
|---|---|---|
| `src/lib/server/net/hfDownload.v.test.ts` | `SCRATCH` (line 9) is a dead hardcoded scratch path; `mkdtempSync` ENOENT | `fs.mkdtempSync(path.join(os.tmpdir(), "hfv-"))`; guard `afterAll` for an undefined server |
| `src/lib/server/audiocpp/packages.v.int.test.ts` | same hardcoded `SCRATCH` (24–25) | same; remove the made dir in `afterAll` if the test does not already |
| `src/lib/server/pipelines/boot/placedNodeReconcile.int.test.ts` | uses `C.speak.v1` as the provisional definition; speak is bound now; provisional ones left are `mcpTool` / `mcpResource` (`../serene-pub-sdk/contracts/src/oracles.ts` ~318, ~391) | place `C.mcpTool.v1({ args: … })`; expect `mcp-tool@1` (verify which oracles are still provisional; read the SDK, never edit it) |
| `src/lib/server/plugins/coreRow.int.test.ts` "offers no widget" | widget src is built as `frameSrc(…, e.version)` (search `frameSrc(` under `src/lib/server/sockets/`) | expect `…/widget.mjs?v=1.0.0` (whatever version the fixture carries) |
| `coreRow` "never served as frame" | the route `src/routes/plugin-ui/[...rest]/+server.ts` reads `event.url.host`; the fake event has no `url` | add `url: new URL(...)` to the fake event |
| `src/lib/server/sessions/genreFieldDefaults.int.test.ts` (3 tests) | new declared fields `speechReadAloud` "off", `speechNarratorVoice` "", `sessionLanguage` "", `ownerSheetLatitude` "all-any" | add the four keys |
| `src/lib/server/pipelines/entities/publishedValues.int.test.ts` | same four | same |
| `src/lib/server/pipelines/entities/sessionGenres.int.test.ts` | same four | same |
| `src/lib/server/sockets/presetFallback.int.test.ts` | Story offers speech actions: a second notice "needs a model that can speak" | regex `/(draw pictures\|speak)/` (or whatever states both notices exactly; keep the test's "one notice per cause" meaning) |
| `src/lib/server/sockets/sessionAdmin.presetActions.int.test.ts` | the Lair preset carries `read-aloud`, `say-it-as` | add both keys |
| `src/lib/server/sockets/sessions.forms.int.test.ts` | the ack echoes `askedRunId` | add `askedRunId: "parked-press-run"` |
| `src/lib/server/db/dataUpgrades/0108_layering_registrations.int.test.ts` | new speak-message action registrations are dropped like every action an old include list never named | add the two expected rows |
| `src/lib/server/pipelines/runtime/allPipelines.int.test.ts` | `core:oracle/speak` has its own dispatch case (`pipelines/runtime/host.call.ts` ~576) | add to `dispatchable` with a one-line reason stated as a rule |

## The rule for every row (lane rule, from the owner's programme 0.3 brief)

> "Class A rows: update the test's expectation to what the code does today, only after confirming the code's
> present behaviour is intended (find the change that moved it; if it looks like an accident, stop on that row
> and report it as a possible defect instead of pinning it). Excuse lists (`UNCONSUMED_OUT_SHAPES`,
> `UNFILLED_IN_PORTS`, `CONSUMERS`, `dispatchable`) get one reason per entry, stated as a rule."
>
> "No product behaviour changes in this lane. A row whose honest fix is a product change: stop on that row, report."

**Evidence of intent** for each class A row = one of: the product line that does it plus a `docs/*.md`,
`NOMENCLATURE.md` or `plans/*.md` line that describes that behaviour (grep for the key/field name), or a
`git log -S'<token>' --oneline` commit whose subject matches. Record it per row in your report (file:line, ≤1 line).
Specific checks: for the four field defaults, find where each field is declared and confirm its default value;
for 0108, confirm the migration's drop rule really is "an old include list never named this action" and that it
is not seeding or carrying something it should not; for `askedRunId`, find where the ack sets it.

Comments you add in tests: present tense, state the rule, not the story (CONTRIBUTING §Comments: "A comment is
for the reader of the code as it is now… Leave out how it got here"). Do not write "used to", "no longer",
"previously", "deliberately not": a ratchet test counts those.

## Files owned

Only the 12 test files above.

## Files readable

Anything. `src/lib/server/sockets/sessions.ts` and `sessions.*.ts`: read only, never edit.

## Out of scope

Product code; the SDK (`../serene-pub-sdk`, read only); any other failing test; `paramsSlotWiring`,
`panel/groups` (owner rows).

## Stop and report (do not decide) when

A cause differs from the row; the present behaviour looks accidental; the fix needs a product change; a fix
would need a new name, setting or migration.

## Running tests

Strictly one vitest at a time across the machine (another worker, the supervisor and another lane share it).
Before **every** run, wait until none is up:

```
until ! ps -eo pid,args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 5; done
```

Then, only this form (pass the files you touched; `<n>` = 1, 2, 3…):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-3-w1-<n>.log 2>&1"
```

Read the log with `grep`/`sed -n`; never pipe vitest into `head`. Prefer batching several files per run.
Formatting: `npx prettier --check <file>` only.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane runs no `sdk:build` at all.)

Never `git checkout` / `restore` in either repo. No `npm test`, no full run, no `npm run build`.

## Done means

Each of the 12 files passes in a capped run (they may share one run); `npx prettier --check` clean on each.

## Report

Your final message: per row, the change (one line) and the evidence of intent (file:line); rows stopped and
why; logs with pass counts; anything noticed but not done.
