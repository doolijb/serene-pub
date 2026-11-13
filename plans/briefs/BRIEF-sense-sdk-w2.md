# BRIEF — `sense-sdk-w2` — an interior-point script failure costs nobody their reply (C7) + turn pool `all` text

You are a `lane-worker` under lane `sense-sdk`. SDK repo: `/home/jody/github/serene-pub-sdk`. Use absolute paths.

## Task A — C7: the interior-point path absorbs an engine throw, as the port path does

Today, in `/home/jody/github/serene-pub-sdk/sdk/src/executor.ts`:

- **Port seams** (`applyChainsAt`, ~1612–1660): a throw from `applyAtSeam` is caught and recorded as
  `{ scriptId: -1, name: '(engine)', scriptKind: '', phase, appliedBy: 'substrate', result: 'err', reason }` on
  `nr.scripts`; the value passes through unchanged.
- **Interior points** (`base.scripts.apply`, ~1951–1970): "No try/catch: an applier throw reaches the binding
  that asked." The node fails.
- The type's own contract (`ScriptChainApplier` docblock, ~555–568) already promises: "A *thrown* applier is
  treated as engine failure: the value passes through unchanged and the failure is recorded — a broken engine must
  never cost somebody their reply, and must never vanish either."

Change only the interior `apply` function:

- Keep the undeclared-point `throw` exactly as is (a binding naming an undeclared point is a binding bug, not an
  engine failure; `scriptPoints.test.ts` "an undeclared point still throws" pins it).
- Wrap **only** the `applyAtSeam(known, value, 'binding')` call in `try/catch`. On a throw, append to `nr.scripts`
  the same record shape the port path writes, with `phase: 'before'` (what `applyAtSeam` hands a point) and
  `appliedBy: 'binding'`, `reason: (e as Error).message`, and `return value` (unchanged).
- The `outcome.halt` branch stays outside the try: `interiorHalt ??= …; throw new ScriptSeamHalt(…)` still
  propagates — only `ScriptSeamHalt` reaches the binding.
- Replace the "No try/catch" comment with one or two lines saying the throw is absorbed and recorded as at a port
  seam (18 S2; the `ScriptChainApplier` contract), and that only a halt reaches the binding.

Tests, `/home/jody/github/serene-pub-sdk/sdk-tests/scriptPoints.test.ts`:

- The test `'interior path: an applier throw reaches the binding (no absorption)'` (~348) pins the old behaviour.
  Replace it with `'interior path: an applier throw is absorbed into an (engine) err record and the value passes
  through'`: `receipt.outcome === 'ok'`, the `draft` node's `result === 'ok'`, `node.scripts` deep-equals
  `[{ scriptId: -1, name: '(engine)', scriptKind: '', phase: 'before', appliedBy: 'binding', result: 'err', reason: 'point engine down' }]`,
  and `node.output.main === 'hi'`.
- Update the D2 comment above that `describe` (~188–195): the per-origin difference (port absorbs, interior lets it
  reach the binding) is gone as of 2026-11-11 (review row C7): both origins absorb and record; a halt still
  propagates.
- Keep every other test in the file as is.

## Task B — the turn pool's `all` option says what it now does (description text only)

In `/home/jody/github/serene-pub-sdk/contracts/src/tasks.ts`, `core:task/turn-pool@1`, params `characters`
(~2966–2985). The pool now honours the bench for every value of `characters` (the app's binding filters every
character through `inPlay`: a removed or benched seat is never a candidate). So `all` reads the same as `active`.

Change **description text only** — do not remove, rename or reorder the option, its key, label or `of` list (a
published name; dropping it is the owner's call):

- the `all` member's `description` (now `'Ones switched off in the cast too.'`) → say it is the same as Active
  today, kept so presets that name it still load; a benched character never takes a turn. Keep it to one or two
  short sentences.
- the field's `description` (now `"Which of the session's characters may take a turn. 'All' admits ones switched
  off in the cast; a removed character never is."`) → say which characters may take a turn; a benched or removed
  character never does, whichever is picked; 'All' is the same as 'Active'.

Use "benched" (the canon word: a seat on the bench), never "switched off". Plain short sentences. It is a
**session**, never a *chat*. If the `turnPool` docblock above (~2940–2955) says `all` admits switched-off
characters, correct that sentence too; nothing else in it.

Display text (`description`, `i18n`) is stripped from content hashes (`sdk/src/hash.ts` `UNIVERSAL_DISPLAY`), so no
pin should move. If one does, report it and do not re-pin.

## Files owned (edit only these)

- `/home/jody/github/serene-pub-sdk/sdk/src/executor.ts` (the interior `apply` function and its comment only)
- `/home/jody/github/serene-pub-sdk/sdk-tests/scriptPoints.test.ts`
- `/home/jody/github/serene-pub-sdk/contracts/src/tasks.ts` (those description strings / that docblock sentence only)

## Out of scope

`builder.ts`, `validate.ts`, `oracles.ts`, the port-seam path, `ScriptSeamHalt` itself, the app repo, any other
description. If another test fails, do not edit it; report it.

## Stop and ask (in your report, do not decide) when

A published SDK name would be added, removed or renamed; a hash pin moves; anything outside the files above seems
to need a change.

## Done means

From `/home/jody/github/serene-pub-sdk/sdk-tests`, in a capped scope:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test scriptPoints.test.ts scripts.test.ts seams.test.ts turnOrder.test.ts roundRobin.test.ts coreTurnOrder.test.ts seatBench.test.ts"
```

Report each file's pass/fail counts and any failure's test name and assertion. Then
`npx prettier --check <file>` on each file you changed.

## Report

Return in your final message: changed files, the new description strings verbatim, tests run with results,
anything noticed but not done.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not run `sdk:build` at all; the supervisor does.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the SDK
  repo is uncommitted). Never run `npm` at the SDK root.
- **No reference to any other project or product** in code, comments, tests or docs.
- Removing or renaming a published SDK name is the owner's call.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Never pipe test output into `head`.
