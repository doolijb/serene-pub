# BRIEF vl-G-w2 — Client: send and match variable-layout steps by the opaque step handle

Lane vl-G (supervisor brief `plans/briefs/BRIEF-vl-G.md`). You are a `lane-worker`. Client half; another worker is changing the server and `src/lib/shared/sockets/types.ts` to the shapes below **at the same time** — code against these shapes, don't edit `types.ts`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## The bug

The pipeline panel never sees node keys. A step is named by its opaque handle, `ConfigOption.step.key` (an HMAC; hex). The variable-layout step events were built on raw node keys, so the panel sends `option.step.key` under the name `nodeKey` and the server can't find it; and leftover steps came back with raw `nodeKey`, compared against `option.step.key`, never matching. After the change every step-addressed field is called `stepKey` and holds the handle.

## Rules (quoted; your work depends on them)

- **No topology in a panel payload** (`src/lib/server/pipelines/config/panel/ids.ts`, 05 §0a): "the payload carries **no topology** — not the node key, not the count, not the order." The browser holds only the handle; it never derives or shows a node key.
- Sockets: one domain context per event family is the only listener and the only place that toasts; **views never call `toaster`**; `socket.off(event)` with no handler removes every listener app-wide — always pass the handler. These admin events are not scoped.
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`.
- Browser code runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`.
- Never pipe vitest into `head`. Heavy DOM tests: a failing assert on a happy-dom element has OOM-killed VS Code — run only the listed files.
- **Never run `npx prettier --write` on a directory or glob.** Only on a file you changed, by name, or not at all (`npx prettier --check <file>` to inspect). A previous worker reformatted 151 files of other people's work this way.
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — Additionally: **do not run `npm run sdk:build` at all, and do not start any dev server.**
- Do what is asked, at the size asked; user-visible copy stays exactly as it is unless named below. Anything else goes under **Noticed, not done**.

## The shapes after the change (server worker builds these in `types.ts`)

- `Sockets.Pipelines.VariableLayouts.ForTemplate.Params` = `{ nodeType: string } | { specSlug: string; stepKey: string }`.
- `ForTemplate.Echo` = `{ nodeType?: string; specSlug?: string; stepKey?: string }`; `ForTemplate.Response extends Echo` = `{ keys?, error?, stepHeading?: string }` — `stepHeading` is sent for a step target: the step's heading as the panel shows it.
- `LeftoverPicks.Step` and `LeftoverPicks.Pick`: `stepKey: string` replaces `nodeKey` (`slot`, `key`, the rest unchanged).
- `ClearLeftoverPick.Params` `{ slug, scope, stepKey, slot, key, sessionId?, presetId? }`; `MoveLeftoversIntoTemplate.Params` `{ slug, stepKey, slot, ownerSlug?, sessionId?, presetId? }`.

## Goal

- `src/lib/client/components/pipelines/templateVariableLayouts.svelte.ts`: target and echo keyed by `specSlug` + `stepKey`. Rename the local helper now called `stepKey(...)` (e.g. `stepTargetKey`) so it doesn't shadow the field; header comment follows.
- `src/lib/client/components/pipelines/leftoverPicks.svelte.ts`: `leftoverStepKey` built from `step.stepKey` + `slot`; `clear` emits `stepKey: pick.stepKey`; `move` emits `stepKey: step.stepKey`.
- `src/lib/client/components/pipelines/StepVariableLayouts.svelte`: `idOf` from `step.stepKey`.
- `src/lib/client/components/pipelines/PipelineConfigOptions.svelte` (these parts only): `leftoverStepsFor` (~190–205) matches `st.stepKey` against `o.step.key`, and its doc comment says `stepKey`; the `layoutTargetKeys` effect (~208–225) sends `{ specSlug: slug, stepKey }`; the template editor's `variableLayouts` and the error line (~1748–1762) read `templateVariableLayoutsOf({ specSlug: slug, stepKey: option.step.key })`. Don't rename the component's existing `stepKey` prop. The `?step=` link (~1685) already sends `option.step.key`; leave it.
- `src/lib/client/admin/sections/variable-layouts/Page.svelte` (the `?step=` reader only) and `parseStepParam` in `variableLayoutWords.ts` (it *is* that reader): `parseStepParam` returns `{ specSlug, stepKey }` (doc: `?step=<specSlug>:<stepKey>`, the panel's opaque handle; split at the last colon — a hex handle holds none). The page sends `{ specSlug, stepKey }`. `stepWords` names the step by the answer's `stepHeading` (`stepAnswer?.stepHeading`), falling back to the matching `scriptSeams` row no longer (it has only `nodeKey`; remove that lookup). When there is no heading yet, use the pipeline label alone where today's code would show the node key: the sentence then reads *Showing the variables Reply · Chat writes out.* — keep that the only copy change, and report it. Keep the `pipelines:library` request for the pipeline label.

### Tests (owned; update and run)

- `src/lib/client/components/pipelines/templateVariableLayouts.test.ts`, `src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts`, `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.test.ts`, `src/lib/client/admin/sections/variable-layouts/variableLayoutsPage.dom.test.svelte.ts`: switch every `nodeKey` fixture/assertion on these events to `stepKey` with hex-looking handles (e.g. `"694ff0a079d37191"`), never a readable word. The page test feeds `stepHeading: "Build the prompt"` on the answer and still expects *Showing the variables Build the prompt in Reply · Chat writes out.*; its library fixture no longer needs a matching seam.
- Add to `stepVariableLayouts.dom.test.ts` (or the closest existing client test that renders leftover steps): **Use the pub's** emits `pipelines:clearLeftoverPick` with `stepKey` and no `nodeKey`; **Move into the template** emits `pipelines:moveLeftoversIntoTemplate` with `stepKey` and no `nodeKey`.
- Run: `npx vitest run src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts src/lib/client/components/pipelines/templateVariableLayouts.test.ts src/lib/client/admin/sections/variable-layouts/ src/lib/client/components/templates/` (no `| head`; redirect to a file in the scratchpad if long). Then `npx tsc --noEmit -p .`: list errors in your files; if the only remaining ones are because `types.ts` still says `nodeKey` (the server worker hasn't landed yet), say so — don't edit `types.ts`.

## Files owned

`src/lib/client/components/pipelines/{templateVariableLayouts.svelte.ts,leftoverPicks.svelte.ts,StepVariableLayouts.svelte}`, `src/lib/client/components/pipelines/PipelineConfigOptions.svelte` (the parts named only), `src/lib/client/admin/sections/variable-layouts/Page.svelte` (the `?step=` reader and `stepWords` only), `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.ts` (`parseStepParam` only), and the four test files above.

## Files readable

Everything.

## Out of scope

Server files, `types.ts`, `typedSocket.ts`, docs, NOMENCLATURE, the library pages (they use the `{ nodeType }` form, unchanged), any copy not named here.

## Stop and ask when

A new name beyond the above is needed, copy beyond the one fallback sentence would change, or a file not listed must change. Say so in your report instead of deciding.

## Report

Return as your final message: changed files, test commands with pass/fail counts, the one copy change, **Noticed, not done**.
