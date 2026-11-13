# BRIEF vl-G-w1 — Server: step-addressed variable-layout events take the opaque step handle

Lane vl-G (supervisor brief `plans/briefs/BRIEF-vl-G.md`). You are a `lane-worker`. Server half; a second worker does the client at the same time against the shapes below, so build exactly these shapes.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## The bug

The pipeline panel never sees node keys. A step is named by its opaque handle `stepKeyFor(secret, nodeKey)` (`src/lib/server/pipelines/config/panel/ids.ts`, exported also from `$lib/server/pipelines/config/panel`), sent as `ConfigOption.step.key` (`panel/read.ts` ~505). The server resolves a handle by **search**: mint the handle for every address and compare (`locate` in `panel/write.ts` ~55). The four variable-layout step events were built on raw node keys, so the client sends a handle under the name `nodeKey` and the server answers *"The pipeline 'core:spec/story-respond' has no step '694ff0a079d37191'."*

## Rules (quoted; your work depends on them)

- **No topology in a panel payload** (`panel/ids.ts` header, 05 §0a): "the payload carries **no topology** — not the node key, not the count, not the order." No node key reaches the browser; resolve handles by search over the published version's nodes. "Resolving an id is therefore a *search* — mint every address's id and look for a match … The alternative, a reversible encoding, is the same leak this rule exists to prevent."
- A slot name (`slot: "variables"`) is a definition's declared slot name, not topology (the scripts payload already sends slot-derived `at`); **keep `slot`** on leftover steps/picks and in the clear/move params. `key` (the template variable name) stays.
- Sockets: one domain context per event family is the only listener and toaster; these admin events are not scoped. Refusals answer `<event>:error` in words.
- Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently). Pass `db` explicitly in tests. Int tests opening a DB inside an `it` need 60 s. **Never pipe vitest into `head`.**
- **Never run `npx prettier --write` on a directory or glob.** Only on a file you changed, by name, or not at all (`npx prettier --check <file>` to inspect). A previous worker reformatted 151 files of other people's work this way.
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — Additionally: **do not run `npm run sdk:build` at all, and do not start any dev server.**
- Do what is asked, at the size asked. Anything else you notice goes under **Noticed, not done** in your report, never fixed in passing.

## Goal — exact shapes

### Types, `src/lib/shared/sockets/types.ts` (these namespaces only)

- `Sockets.Pipelines.VariableLayouts.ForTemplate.Params` = `{ nodeType: string } | { specSlug: string; stepKey: string }` (doc: "a step by pipeline and the panel's opaque step handle").
- `ForTemplate.Echo` = `{ nodeType?: string; specSlug?: string; stepKey?: string }`.
- `ForTemplate.Response extends Echo` adds `stepHeading?: string` beside `keys?`/`error?`: for a step target only, the step's heading as the panel shows it (`ConfigOption.step.heading`: the declaration's `stepHeading ?? typeLabel` for that node); omitted when no declaration names the node. (W1's page needs a name for the step and can no longer match the library's `scriptSeams[].nodeKey`.)
- `LeftoverPicks.Pick` and `LeftoverPicks.Step`: `nodeKey: string` → `stepKey: string` (doc: "the step's opaque handle, `ConfigOption.step.key`").
- `ClearLeftoverPick.Params` and `MoveLeftoversIntoTemplate.Params`: `nodeKey` → `stepKey`.

`src/lib/client/sockets/typedSocket.ts` refers to these by namespace; touch it only if tsc says so (these entries only).

### `src/lib/server/pipelines/config/variableLayoutsView.ts`

- Export one helper `locateStep(db, secret, specVersionId, stepKey): Promise<string | null>` returning the node key whose `stepKeyFor(secret, nodeKey) === stepKey` among `pipelineNodes` of that spec version (the search; never decode). Used by both modules.
- `TemplateVariableLayoutsTarget` step form becomes `{ specSlug: string; stepKey: string }`; `templateVariableLayouts(db, target, secret)` (secret needed only for the step form) resolves via `locateStep` over the active version, then proceeds exactly as today with the resolved node key. Unknown handle → `UnknownTemplateTargetError` with: `That step is not part of the pipeline '${specSlug}'. A newer version may have removed it, or the link was made on a different install.` Return `{ keys, stepHeading? }` or similar so the socket can add `stepHeading` (your structure choice; keep the export names `templateVariableLayouts`, `TemplateVariableLayoutKey`).

### `src/lib/server/pipelines/config/leftoverPicks.ts`

Node keys stay internal; translate only at the module's boundary.
- `leftoverPicksFor(db, slug, viewer, secret, opts)`: each step and pick carries `stepKey: stepKeyFor(secret, nodeKey)` instead of `nodeKey`. Exported `LeftoverStep`/`LeftoverPick` follow.
- `clearLeftoverPick(db, slug, secret, scope, { stepKey, slot, key })`: resolve with `locateStep` over the published version (`published(db, slug)` from `panel/declarations`), unknown → `LeftoverPickRefusal("That step is not part of this pipeline. A newer version may have removed it, or the link was made on a different install.")`, then the existing removal. The internal call inside `moveLeftoversIntoTemplate` (which holds node keys) goes to a non-exported node-key form of the same removal (e.g. `clearPickAt`), with `tx`.
- `moveLeftoversIntoTemplate(db, slug, viewer, secret, { stepKey, slot }, opts)`: inside the transaction find the plan step whose `stepKeyFor(secret, s.nodeKey) === step.stepKey && s.slot === step.slot`; the existing "no variable layout left over" refusal covers a miss. `refuseOtherPresetsDiffering` keeps node keys internally.
- Update the module header line that names `nodeKey` only if it describes the payload.

### Sockets

- `src/lib/server/sockets/pipelinesVariableLayouts.ts` (`pipelinesTemplateVariableLayouts` only): accept and echo `{ specSlug, stepKey }` (echo only strings, as today); pass the instance secret. Get it like `pubSecret()` in `sockets/pipelines.ts` ~94–107 (lazy `getCryptoSecretKey` from `$lib/server/db`, cached) — a local copy is fine; do not export from `pipelines.ts`. Add `stepHeading` to the answer when present. Bad-params words unchanged.
- `src/lib/server/sockets/pipelines.ts` (`leftoverView`, `pipelinesClearLeftoverPick`, `pipelinesMoveLeftoversIntoTemplate` only, ~1886–2020): pass `await pubSecret()` and `params.stepKey`.

### Tests (owned; run them)

- `src/lib/server/sockets/pipelinesVariableLayouts.int.test.ts`: its `vi.mock("$lib/server/db")` gains `getCryptoSecretKey: () => "<a test secret>"`; every step-form call switches from raw `nodeKey` to `stepKeyFor(SECRET, nodeKey)`; the unknown-step case sends a handle that matches nothing and expects the new words; echoes assert `stepKey`.
- **New test A (the missing one):** read a real published spec's panel the way the browser does (`namespaceView` from `$lib/server/pipelines/config/panel` with the same secret — see `panel/index.int.test.ts` for how it is called — or the `pipelines:get` handler), take a `context-template-ref` option's `step.key`, send `pipelines:templateVariableLayouts { specSlug, stepKey: option.step.key }`, and expect a non-error answer whose `keys` include `key: "characters"`, the echo `{ specSlug, stepKey }`, and a non-empty `stepHeading` equal to `option.step.heading`.
- `src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts` and `pipelines.leftoverBytes.int.test.ts`: storage helpers keep writing by node key (that is storage, not payload); every socket param switches to `stepKey` minted with the file's mocked secret; assertions on returned steps/picks use `stepKey` and assert **no `nodeKey` property** on steps and picks.
- **New test B:** on a published spec with **more than one** `context-template-ref` option (find one among the shipped specs by reading the panel; if none ships two, say so and use the smallest real way to get one — e.g. a spec the existing tests already publish — and name it in the report), store a leftover pick on a node that owns a template option that is not the first, read `pipelines:leftoverPicks`, and assert the step's `stepKey` equals exactly that option's `step.key` and differs from the other template options' `step.key`.
- Run: `npx vitest run src/lib/server/sockets/pipelinesVariableLayouts.int.test.ts src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts src/lib/server/sockets/pipelines.leftoverBytes.int.test.ts` (no `| head`; redirect to a file under the scratchpad if long). Then `npx tsc --noEmit -p .` and report only errors in your files (the client worker is changing the client at the same time; client errors about these fields are expected until it finishes — list them, don't fix them).

## Files owned

`src/lib/server/pipelines/config/variableLayoutsView.ts`, `src/lib/server/pipelines/config/leftoverPicks.ts`, `src/lib/server/sockets/pipelinesVariableLayouts.ts` (the W5 handler), `src/lib/server/sockets/pipelines.ts` (the three leftover handlers and `leftoverView` only), `src/lib/shared/sockets/types.ts` (the namespaces above only), `src/lib/client/sockets/typedSocket.ts` (these entries only, if needed), the three int test files above.

## Files readable

Everything; especially `config/panel/{ids,write,read,declarations,index}.ts`, `config/panel/index.int.test.ts`.

## Out of scope

Client files (the other worker), docs, NOMENCLATURE (the supervisor), the library payload's `scriptSeams`, any other event.

## Stop and ask when

A name beyond those listed here is needed; resolving a handle needs a file not listed; the shapes above can't be built as written. Stop and say so in your report instead of deciding.

## Report

Return as your final message: changed files, test commands with pass/fail counts, the final payload shapes, the spec used for test B, any `/tmp/serene-pub-vitest-*` dirs your tests left (and that you deleted them by name), **Noticed, not done**.
