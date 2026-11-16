# BRIEF — worker `time-t6b-w3`: wire the firsthand filter into the two node bindings, with the receipt line

Supervisor: lane `time-t6b` (report to it). Repo: `/home/jody/github/serene-pub` (the app). The SDK half is built
(`sdk:build` ran 2026-11-15 13:48): `core:query/session-history@1` and `core:query/earlier-scenes@1` now declare two
optional in-ports, 🚧 `firsthandFor` (`S.rowIds`, wired `$.input.characterId`) and 🚧 `firsthandBy` (`S.text`, a
cast-level stat by full id or local name, a literal in the node's config). The decision lives in
`src/lib/server/sessions/firsthandFilter.ts` (worker w2, done; read it whole first).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. **Never `prettier --write`.**

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (**You do not run `sdk:build`**: the supervisor does.)

Never `kill -9`. Never `git checkout`/`restore`/`stash` in either repo. Another session shares this checkout and is
editing `src/lib/server/pipelines/prompt/` and `pipelines/entities/`; another worker (w4) is editing
`pipelines/scripts/` and the SDK guides at the same time: touch only the files under Files owned. It is a
**session**, never a *chat*. Never write the phrase "no lorebook".

## The rule (owner rulings — the module implements it; your binding only calls it)

Owner 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not
know." ★6: "where one model voices everyone, nothing can be left out" (a narrator or envoy reads everything).
Owner 2026-11-15: "a mixture of per scene, per location (when available)"; Bench plays no part; "a per character
filter on what gets put into their context"; "all features are opt in on invoke"; opt-in per "pipeline/node".
P1 (CLAUDE.md): "A new automatic behaviour is off in core until a genre opts in, and every automatic action shows its
cause." So: **unwired → the node behaves byte-for-byte as today, with no extra statement and no receipt line.**

## Build — `src/lib/server/pipelines/runtime/bindings.ts`, two bindings only

1. `"core:query/session-history@1"` (~2473–2613). After `messages` is read:
   - The option is invoked when the `firsthandFor` **key is present** in `input` (a wired port arrives as a key
     even when its value is `undefined`/`null`: the executor's `resolveInput` sets every referenced path,
     `../serene-pub-sdk/sdk/src/executor.ts` ~1241–1246; verify this in a test, and if it is not true say so and
     stop).
   - Not invoked → return exactly what the code returns today.
   - A one-row read (`messageId` wired: a person's press on one row) is never filtered; say so in the comment.
   - Invoked: `loadFirsthandView(db, { sessionId, characterId: input.firsthandFor, slotId: <input.firsthandBy if
     a non-blank string, trimmed, else null>, lineIds: <ids of the rows read> })`, `db` taken the way the
     earlier-scenes binding takes it (`(await import("$lib/server/db")).db`, ~8690). `reads-all` →
     `ctx.log("info", readsAllReceipt())`, rows unchanged. `viewpoint` → keep the rows whose ids `keptLineIds`
     keeps (order preserved; `main` and `messages` stay the same value), `ctx.log("info", linesReceipt(view,
     leftOut))`. The `band` port is unchanged.
   - Add `"firsthandFor", "firsthandBy"` to the binding's `ports` declaration.
2. `"core:query/earlier-scenes@1"` (~8676–8696). Take `ctx` as the hook's second argument (look at how other
   bindings type it). Invoked (same key rule): `loadFirsthandView(db, { sessionId, characterId, slotId, sceneIds:
   <the scene ids read> })`; `reads-all` → note, scenes unchanged; `viewpoint` → keep the scenes `keptSceneIds`
   keeps, `ctx.log("info", scenesReceipt(view, leftOut))`. `maxTokens` unchanged. Add the two ports to its `ports`.
3. Import the module lazily (`await import(...)`) as the neighbouring bindings do. Comments state the rule in one
   or two lines and point at the module; not the story.

The receipt line is the node's receipt note (`ctx.log` → `NodeReceipt.notes`, `sdk/src/executor.ts` ~1927). Find
whether the prompt preview shows a node's notes (grep the preview/inspect UI for `notes`) and report what you find;
do not change the UI.

## Tests

- A new `src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts` (copy the set-up of an existing binding
  int test that calls `"core:query/session-history@1"` or `"core:query/earlier-scenes@1"` through the bindings map;
  find one with `grep -rln "earlier-scenes@1\|session-history@1" src/lib/server --include=*.int.test.ts`;
  `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Cases:
  - not invoked → the output is deep-equal to today's and `ctx.log` was never called;
  - wired with `firsthandFor: undefined` / `null` (a narrator turn) → every row, one note `Reads everything: not one
    cast member's turn`;
  - a member that never spoke in a closed scene → that scene's lines left out, the note
    `‹n› messages left out: ‹name› was not there`; one that spoke in it, even only before the history window
    (`params.limit` small) → kept;
  - composes with a channel read (`params.channel` a side channel, or `channelLane`): the filtered rows are a subset
    of the unfiltered read, never more;
  - earlier scenes: a summary left out for a member that never spoke, kept for one that spoke; the note;
  - with `firsthandBy` naming a tracked cast-level stat: a line spoken after the member's value changed away is
    left out (reuse w2's fixture approach in `sessions/firsthandFilter.int.test.ts`).
- Run, each as its own capped run (below): your new test; `src/lib/server/pipelines/boot/declaredReads.test.ts`;
  `src/lib/server/pipelines/boot/paramsSlotWiring.test.ts` (find its path); `src/lib/server/pipelines/boot/registryHashes.test.ts`
  (if a pinned hash of `core:query/session-history@1` or `core:query/earlier-scenes@1` moved because of the new
  ports, re-pin it with the comment `// 2026-11-15 time-t6b: firsthandFor/firsthandBy in-ports added`; any other
  moved hash: stop and report it); and any existing int test of the two bindings you found above (they must still
  pass unchanged).
- Report the statements the two bindings add per reply when invoked (w2 measured the loader: 13 without a stat; about
  70 with a stat and 3 members; confirm or correct at the binding level) and 0 when not invoked.

Run tests only in this capped form, from the app root, **strictly one vitest run at a time across everyone**: first
check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if any line shows (the lead or worker w4 may be
running one), wait (`timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 20; done'`)
and check again.

    systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t6b-w3.log 2>&1"

Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report the
total; errors in files you do not own: list them, do not fix).

## Files owned

- `src/lib/server/pipelines/runtime/bindings.ts` (the two bindings only)
- `src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts` (new)
- `src/lib/server/sessions/firsthandFilter.ts` (only if the binding needs a small addition there; say what)
- `src/lib/server/pipelines/boot/registryHashes.test.ts` (a re-pin line only, as above)

## Out of scope

Any shipped pipeline or genre (none invokes the option); `host.ts`; the SDK; docs; NOMENCLATURE; the per-message
`firsthand_cast_member_ids` column; a setting; a migration; the UI.

## Stop and ask (stop, and write it in your report; do not choose) when

- a wired port does not arrive as a key when its value is undefined (then "narrator turn → receipt says so" cannot
  be told apart from "not invoked");
- a hash other than the two nodes' moved;
- the filter would need `host.ts` or a file you do not own.

## Report

Your final message: the diff summary with line ranges, test results per file, statements per reply, what the
preview shows of node notes, assumptions, anything noticed and not done.
