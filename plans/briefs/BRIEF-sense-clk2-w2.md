# BRIEF — `sense-clk2-w2` — App: the round worth read's host binding, and the reply tick's boot pass

You are a `lane-worker` for lane `sense-clk2`. App repo: `/home/jody/github/serene-pub`. SDK (read only for you):
`/home/jody/github/serene-pub-sdk`. Use absolute paths. Another worker (`w1`) is changing the SDK in parallel and
will run `npm run sdk:build`; do **not** build yourself. Another session is editing this repo (visual-novel layout:
dialogue-box widget, `show-line` request, portraits `speaking`): do not touch its files.

## Context (the owner's rulings, 2026-11-11, verbatim)

- "In core genres we should have one default owner that moves the clock." … "Maybe they can share the same session
  setting, sdk provides an API to grab the setting, if opted in and pipelines can act on it/choose to respect the
  interval"
- On Story's per-reply tick (*Each reply advances the clock by…*, published at pr-7): "Remove it. The setting
  mentioned allows pipelines to handle time arbitrarily"
- CLAUDE.md, "0.6 is in users' hands": "A change to stored data or ids ships with a forward migration or boot pass
  and a test that a second boot changes nothing." This lane uses **a boot pass, never a migration**.

What `w1` is adding in the SDK (you code against it):

- `core:query/round-worth@1` (contracts export `roundWorth`): in-port `scope` (`S.sessionScope`); out-ports `main`
  (`{ minutes, step }`), `minutes` (whole number ≥ 0), `step` (`{ by: minutes, unit: 'minutes' }`). It reads the
  session's `roundWorth` genre field from the settings document; 0 when the genre places no such field or the
  session sets 0.
- core-catalog exports `ROUND_WORTH_KEY` (`'roundWorth'`) and `ROUND_WORTH_FIELD`.
- `core:spec/story-respond` loses its reply tick: the step `tick` and the junction `clock` with its outlet, node key
  `clock.moves.advance`.

## Task 1 — the host binding of `core:query/round-worth@1`

- NEW `src/lib/server/pipelines/runtime/roundWorth.ts`, shaped like `runtime/clockStep.ts` (read it first):
  - `roundWorthOf(doc: unknown): { minutes: number; step: { by: number; unit: "minutes" } }` — reads
    `doc.fields[ROUND_WORTH_KEY]` (import the key from `@serene-pub/core-catalog`); a whole number > 0 is the
    minutes, anything else (absent, 0, negative, fractional, not a number) is 0. Check how
    `src/lib/server/sessions/settings.ts` (`resolveSessionSettings`) leaves a cascaded value in `fields` (a plain
    value, or a `{ value, lock }` decision?) and read it accordingly.
  - `roundWorthBindings(): Bindings` — `"core:query/round-worth@1": reads<typeof C.roundWorth>(async (input, ctx:
    CoreQueryCtx) => …, { ports: ["scope"] })`: read the settings document the way the `core:query/session-settings@1`
    binding does (`ctx.read("session_settings", { sessionId: input?.scope?.sessionId })`, `runtime/bindings.ts` about
    4410); no document → `halt("there is no session to read the round worth for — the run is scoped to a session that
    no longer exists")`; else `ok({ main: w, minutes: w.minutes, step: w.step })`.
  - Header docblock: 🚧 what it reads and why (one value, one writer: the session settings form writes the field,
    this only reads it); ⚠ not the clock.
- `src/lib/server/pipelines/runtime/bindings.ts`: import `roundWorthBindings` and spread it beside
  `...clockStepBindings(),` (about line 4138). **Only those two lines** in that file.
- NEW `src/lib/server/pipelines/runtime/roundWorth.test.ts` (unit, no DB): `roundWorthOf` for 5, 0, absent field,
  negative, 2.5, a string, a null document's fields; the binding with a fake `ctx.read` (5 → `{ minutes: 5, step:
  { by: 5, unit: "minutes" } }`; no document → a halt).
- The key import only resolves once `w1`'s build lands (`grep -c ROUND_WORTH_KEY
  /home/jody/github/serene-pub-sdk/core-catalog/dist/index.js` > 0). Do Task 2 first; run this test when the build is
  in. If it never lands while you work, report the test as "not run: waiting on the SDK build".

## Task 2 — the boot pass that drops the reply tick's stored settings

NEW `src/lib/server/pipelines/boot/replyTickDrop.ts`, modelled on `boot/embedTextConnectionDrop.ts` and
`boot/spritePickerMove.ts` (read both): ⏳ header docblock (why: owner ruling R1 above; what goes; why before the
catalog seed; idempotent; delete at the RC1 squash). Export `REPLY_TICK_NODE_KEYS = ["tick", "clock.moves.advance"]`
and `dropReplyTickSettings(db: Db): Promise<ReplyTickDropReport>` with counts `{ registrations, instanceValues,
overrides, configValues }`. On `core:spec/story-respond` only (`STORY_RESPOND_SPEC_ID`, dynamic import from
`@serene-pub/core-catalog` as the precedents do):

1. **`registrations.values`** (every scope: genre, preset, session; every origin) — a row is the reply's when its
   `spec_slug` is story-respond **or** its base key (`baseKeyOf`, `pipelines/registrations/rows.ts`: a genre-scope
   admin change row's key carries a prefix) names story-respond as its pipeline (a change row has no `spec_slug`; the
   key is `registrationKeyOf(trigger, pipeline)`, SDK `sdk/src/registrations.ts` about 285: `<trigger
   key><REGISTRATION_KEY_JOIN><keySegment(pipeline id)>` — use the SDK's own exports to build or parse it; never a
   hand-typed join). From such a row's `values` delete the two node keys; when nothing is left, store `null`.
   Count rows changed. Leave every other column and every other node's values alone. (Why it matters: the
   registration door refuses values on a step the pipeline no longer has — SDK `registrations.ts` about 770 — and
   the boot's refit would then leave the session's whole reply registration out as stale.)
2. **`pipeline_specs.instance_values`** of story-respond: the same two keys removed; `null` when empty.
3. **`pipeline_node_overrides`** (any scope) on story-respond's spec row with `node_key` in the two keys: delete.
4. **`pipeline_config_values`** of story-respond's configs with `node_key` in the two keys: delete (quietly, so the
   configs reconcile never culls them with a notice — the `embedTextConnectionDrop` precedent).

Log one line when anything changed (as the precedents do). Call it from `boot/bootstrap.ts` right after
`dropEmbedTextConnectionValues` (about line 428), before `seedCoreSpecs` and the registrations projection and refit,
with a short ⏳ comment; add `replyTickDropped?: ReplyTickDropReport` to the boot report type beside
`embedTextConnectionDropped` (about line 163). Only those edits in `bootstrap.ts`.

NEW `src/lib/server/pipelines/boot/replyTickDrop.int.test.ts` (copy the DB-mock and data-dir set-up of
`routines/roundTick.int.test.ts` or another boot int test; temp dir prefix `serene-pub-vitest-reply-tick-drop-`; 60 s
timeouts): after `bootstrapPipelines`, seed — a Story session's own registration row for the reply (key from the
SDK, `values: { tick: { params: { by: 3 } }, <another real node key of story-respond>: { params: {…} } }`), a
preset-scope change row, a genre-scope admin change row (prefixed key), story-respond's `instance_values` with `tick`,
a `pipeline_node_overrides` row at `tick`, and one row of a different spec that also has a `tick` key (it must be
left alone). Run `dropReplyTickSettings`: the two keys are gone everywhere, the other node's values and the other
spec's row are untouched, the counts are right. **Run it a second time: every count is 0 and the rows read back
identical.** Also assert `bootstrapPipelines` a second time leaves those rows as the first pass left them.

## Files owned

`src/lib/server/pipelines/runtime/roundWorth.ts` and `.test.ts` (new), two lines in `runtime/bindings.ts`,
`src/lib/server/pipelines/boot/replyTickDrop.ts` and `.int.test.ts` (new), the call and report field in
`boot/bootstrap.ts`.

## Files readable

Anything in both repos.

## Out of scope

The SDK repo; `runtime/host.ts`; `sockets/sessions.ts`; `db/schema.ts`; migrations; docs; any other test file; any
UI.

## Stop and ask when

The binding needs a new host read (`ctx.read` kind) or an edit to `host.ts`; the boot pass would need a migration or
to reshape data beyond removing those two keys; a name beyond those this brief gives seems needed.

## Tests

Run only your two test files, in a capped scope, from `/home/jody/github/serene-pub`:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
Never pipe vitest into `head`. `npx prettier --check <file>` on each file you changed. Do not start a dev server.
Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and report only errors in your files (others'
errors: list them under Noticed). If the type check runs before `w1`'s build, `C.roundWorth` will not exist yet: say
so rather than working around it.

## Done means

Both test files pass (the boot pass test twice in one run, as above); prettier clean; a report with changed files,
tests and results, every decision you made, and **Noticed, not done**. Return the report as your final message.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx` —
  the outer `db` deadlocks PGlite silently. Never seed a row at a hardcoded id. It is a **session**, never a *chat*.
- **No reference to any other project or product** in code, comments, tests or docs.
- An int test that opens a DB inside an `it` needs a 60 s timeout.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** Line numbers are approximate.
