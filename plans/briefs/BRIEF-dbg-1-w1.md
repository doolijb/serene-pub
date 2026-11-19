# BRIEF — lane `dbg-1`, worker 1 — SDK: the run option that turns step time limits off, the dossier field, the Turn line marker

Supervisor: lane `dbg-1`. SDK repo `/home/jody/github/serene-pub-sdk` (edit it there). App repo `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You do not build and do not run tests.** The supervisor runs `sdk:build` and the SDK tests after you. Never `git checkout / restore / stash` in the SDK repo (most of it is uncommitted). Never `prettier --write`. Do not touch `contracts/src/queries.ts`, `core-catalog/src/genres/story/respond.ts`, `lair/reply.ts`, `sdk/src/validate.ts` (another lane's uncommitted edits).

## Goal

The owner (2026-11-15): "a global debug off switch in the admin for pipeline step await time so we have a safety fallback." Core will pass a run option when an admin has turned the switch on. Your part is the SDK side.

## Files owned (only these)

1. `sdk/src/executor.ts`
2. `sdk-tests/idle-timeouts.test.ts`
3. `sdk/src/sessionDossier.ts`
4. `core-catalog/components/shared/messages/TurnLine.svelte`
5. `sdk-tests/coreTurnLineRuns.test.ts`
6. `INTEGRATING.md` (the canonical one in the SDK repo)

## Work

### A. `RunOptions.stepTimeLimitsOff` (executor.ts)

The executor computes each node invocation's limit at ~1884:
`const timeoutMs = Math.min(d.timeoutMs ?? Infinity, opts.timeoutCeilingMs ?? Infinity)` and passes
`ceilingMs: opts.timeoutCeilingMs ?? Infinity` to `nodeClock`. Add one field to `RunOptions` beside
`timeoutCeilingMs` (~640):

```ts
/**
 * 🚧 Apply no step time limit for this run: neither a definition's `timeoutMs`
 * nor `timeoutCeilingMs`. A pub's diagnostic switch (an administrator finding
 * out whether a time limit is what stops a step); a stuck step then waits until
 * the run is cancelled (`cancelSignal`). Limits a host enforces inside its own
 * calls (a sandbox's deadline, a connection's idle watchdog) are the host's and
 * are not touched. Read once, at the run's start.
 * @experimental
 */
stepTimeLimitsOff?: boolean
```

Behaviour: when `opts.stepTimeLimitsOff === true`, every node's `timeoutMs` is `Infinity` and its `ceilingMs` is
`Infinity` (so `nodeClock.race` returns the promise untouched, and `nr.timeoutMsApplied` stays `undefined`).
Read it once at the run's start into a local (e.g. `const limitsOff = opts.stepTimeLimitsOff === true`) and use the
local at the per-node site; do not read `opts` per node for it. Nothing else changes: cancellation
(`cancelSignal`) must still end the node exactly as today. Check whether the per-node block is reached for every
node kind and for `each` / `loop` bodies and sub-runs (grep `timeoutCeilingMs` and `opts` forwarding to child runs:
if the executor forwards `timeoutCeilingMs` to a nested run anywhere, forward `stepTimeLimitsOff` the same way). If
`RunOptions` is mirrored elsewhere (a validator of option keys, a docs list, a public type re-export), keep it in step.

### B. Tests (`sdk-tests/idle-timeouts.test.ts`, append; node:test, real timers with small numbers, as the file does)

The file's `go(which, hook, opts)` helper takes `{ host?, timeoutCeilingMs? }`: widen it to pass `stepTimeLimitsOff`
(and `cancelSignal` if you need it). Add:
1. off (option absent) still fires: already covered by the existing tests; leave them.
2. `stepTimeLimitsOff: true`: a `wall` node sleeping 200 ms past its 60 ms limit ends `ok`, `gen(r).timedOut`
   undefined, `gen(r).timeoutMsApplied` undefined.
3. `stepTimeLimitsOff: true` with `timeoutCeilingMs: 80`: an `idle` node that pulses for 240 ms ends `ok` (the
   ceiling is off too).
4. `stepTimeLimitsOff: true`: a node that would wait forever (or 2 s) is ended by aborting `cancelSignal` after
   ~50 ms; the receipt's outcome is the one a cancelled run gets today (look at how existing tests assert
   cancellation: grep `cancelSignal` in `sdk-tests/`), and the handler's `ctx.signal` aborted.

### C. The dossier field (`sdk/src/sessionDossier.ts`, `SessionDossierV1`)

Beside `rerunWaitsFor` (~325) add:

```ts
/**
 * 🚧 The pub's step time limits are off (Admin › Diagnostics): a step may wait until someone stops it.
 * Told to administrators only; the turn line shows a short marker while it is set. Absent reads as on.
 * @experimental
 */
stepTimeLimitsOff?: true
```

### D. The marker (`TurnLine.svelte`)

There is a reserved place already: the `notice?: Snippet` prop and
`{#if notice}<div data-widget-part="turn-line.notice">{@render notice()}</div>{/if}` (~374). Keep the prop as it is
(removing a published prop is the owner's call). Draw the marker there from the dossier:

- When a `notice` snippet is given, render it exactly as today.
- Else when `dossier?.stepTimeLimitsOff === true`, render inside the same `turn-line.notice` div a
  `<span data-widget-part="turn-line.limits-off" title="Step time limits are off in Admin › Diagnostics. A stuck step waits until someone stops it.">`
  with a small `<sp-icon name="timer-off" size="12" aria-hidden="true"></sp-icon>` (check that `timer-off` is an icon the
  `sp-icon` set knows: grep the icon registry in the SDK / app (`sp-icon` names, `ICON_NAMES` or similar); if it is not
  there, use no icon rather than adding one) and the words `Time limits off`. Text only, no link, no button (members
  never see admin links; the host already tells only administrators).
- Update the prop's JSDoc ("reserved … later") and the file's header comment to one line saying the place now shows
  *Time limits off* while the dossier's `stepTimeLimitsOff` is set, unless a snippet fills it.
- Svelte 5 runes, as the file already is. Don't restyle anything else.

### E. Tests (`sdk-tests/coreTurnLineRuns.test.ts`, append)

Using the file's `dossier()` / `mountTurn()` helpers: with `stepTimeLimitsOff: true` the
`[data-widget-part~="turn-line.limits-off"]` part is present and its text contains `Time limits off`; without the field
it is absent. Assertions on strings and booleans only (a failing `assert` on a happy-dom element has OOM-killed VS
Code: never `assert.equal(element, …)`, never pass elements to assert).

### F. `INTEGRATING.md`

1. In **### Node clocks — `wall` and `idle` (F36)** (~274), after the sentence about `timeoutCeilingMs`, add two
   sentences: `RunOptions.stepTimeLimitsOff` makes the run apply neither (🚧, a pub's diagnostic switch); cancellation
   still ends a node, and limits the host enforces inside its own calls are the host's.
2. In the table row **Scoped sections and grants** (~1755), after the `rerunWaitsFor` clause, add:
   `🚧 \`stepTimeLimitsOff\` (\`true\` or absent) is told to administrators only, while the pub's step time limits are off; the turn line shows *Time limits off* in \`turn-line.notice\`;`

## Rules (quoted by the supervisor)

- CLAUDE.md: "Removing or renaming a published SDK name is the owner's call." — add only; remove nothing.
- STYLE-GUIDE §10: "Sentence case everywhere." "Help is one sentence." "A hint becomes the field's placeholder (what to type) or its `title` (what it is for)."
- STYLE-GUIDE §6.21: "A notice says only what the viewer can act on."
- NOMENCLATURE R6: mark provisional vocabulary 🚧 (done above in the JSDoc).
- Do the asked thing at the asked size; anything else you notice goes in your report under **Noticed, not done**.

## Done means

All six files edited as above; `npx prettier --check` on each edited file (report the result; do not `--write`; if a
file was already failing before your edit, say so). Report to the supervisor (final message): files changed, what you
did per section A–F, anything you could not do, Noticed-not-done.
