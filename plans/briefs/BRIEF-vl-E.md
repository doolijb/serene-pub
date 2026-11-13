# BRIEF vl-E — Variable layouts: the pipeline panel, the template editor, the run inspector

You are a **lane supervisor**. Read `.claude/guides/multi-agent.md` first, then the plan `plans/PLAN-variable-layouts-2026-11-10.md` in full (§ W4 and W5 are yours), then `plans/REPORT-vl-D-2026-11-10.md` (§ Sockets, § Removed, § Queued › vl-E) and `plans/REPORT-vl-S-2026-11-10.md` (§ Signatures, § Queued › vl-E). Do not change server or SDK files. Every ★ is ruled. Delegate typing to at most 2 `lane-worker`s with briefs at `plans/briefs/BRIEF-vl-E-w<n>.md`; quote into each the rules below that its work depends on.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

1. **Remove the per-step pickers (client):** the `variable-template-ref` branch and its layout clone/edit/delete flow in `PipelineConfigOptions.svelte` (~618–702, ~945–1001, ~1847–1900), the reader in `src/lib/client/components/Layout.svelte` 288–290, the loose ⏳ entries in `src/lib/client/sockets/typedSocket.ts`, and the stale `variableTemplate` doc in `src/lib/shared/sockets/types.ts` ~10268 (that doc comment only).
2. **W4 in the pipeline panel**: under the context template picker, one row: *Each variable is written out by its variable layout, shared by every pipeline.* **Change layouts** links to `/admin/variable-layouts` filtered to the variables this step renders (`?step=<specSlug>:<nodeKey>`; `vl-A`'s W1 reads it). Leftover picks from `pipelines:leftoverPicks` (its own request, not the panel payload: ruled), one read-only line per pick: *‹Variable› uses ‹layout› here (set before layouts moved).* with **Use the pub's** (`pipelines:clearLeftoverPick`) and, when `canMoveIntoTemplate`, **Move into the template** (`pipelines:moveLeftoversIntoTemplate`; asks inline for an owner slug when the server refuses for lack of one; shows `kept` reasons in words). Check it reads well on a builder key (vl-D Q6). STYLE-GUIDE §6.17's shape.
3. **W5 in the template editor** (`TemplateEditor.svelte`, `ScopeTree.svelte`, `codeField/templateAssistBridge.ts`, `shared/utils/templateDiagnostics.ts`, the template assist module), fed by `pipelines:templateVariableLayouts` (`{ specSlug, nodeKey }` from a step, `{ nodeType }` in the library) and checked with `laidOutScope` + `variableLayoutOffers` exactly as the server checks (vl-S signatures):
   - **ScopeTree**: a laid-out root's meta line adds *Written as ‹name›*.
   - **The caret line** (`TemplateEditor.svelte:367-388`): with the caret on a laid-out key, *Written as ‹name› (‹reason in words›)*, then one real button per other offer: **Write as ‹label› here**, which rewrites that occurrence to `{{{layout key "ref"}}}` (Liquid: `{{ key | layout: "ref" }}`). New plumbing; not the lint-fix mechanism.
   - **Layouts in this template**: a button beside the field opening a short list, one row per laid-out key the template reads: a select (*The pub's layout* · each offer by label) plus **All bare** and **All titled** shortcuts (bare = the offer whose slug is `json` or `as-written`; titled = `titled-json` / `titled`; hide a shortcut no key can take). Apply rewrites every occurrence in one go.
   - **Completion** inside `layout key "` lists that key's offers with labels. **Lint** shows the SDK's `layout-argument` / `unknown-layout` findings; `quickFix` for `unknown-layout` replaces the whole `[start, end)` span with `suggestion` (the `.`-segment logic breaks `acme.dice/prose@1`). Add `layout`'s doc entry to the template assist helper list and put it back in `templateCheckOptions.test.ts`'s comparison (vl-D excluded it pending this).
   - A read-only (shipped) template shows the caret line's *Written as* but no buttons and no **Layouts in this template**.
4. **Run inspector** (`components/pipelines/inspector/receiptView.ts` `layoutsView`, `RunInspector.svelte`): show each layout's reason in words (*the preset's* / *the pub's* / *the default* / *named by the template* / *leftover pick*) and `missingReference` as *named ‹ref›, which wasn't found; used ‹name›*.

## Files owned

`src/lib/client/components/pipelines/PipelineConfigOptions.svelte` (the layout branch and the W4 row only), `src/lib/client/components/Layout.svelte` (lines 288–290 only), `src/lib/client/sockets/typedSocket.ts` (the three entries only), `src/lib/shared/sockets/types.ts` (the one doc comment only), `src/lib/client/components/templates/{TemplateEditor,ScopeTree}.svelte` + tests, `src/lib/client/components/codeField/templateAssistBridge.ts` + test, `src/lib/shared/utils/templateDiagnostics.ts` + tests, the template assist module (find it) + tests, `src/lib/shared/utils/templateCheckOptions.test.ts`, `src/lib/client/components/pipelines/inspector/{receiptView.ts,receiptView.test.ts,RunInspector.svelte}`, new small components + dom tests beside these.

## Files readable

Everything. Read before building: STYLE-GUIDE §6.12 (code fields: the caret line, the tree, the issue list; a11y), §6.17 (pipeline settings), §6.21 (notices), §9, §10; `docs/context-templates.md` § The editor and § Finding the variables; `AI-TEMP/skeleton-llms-svelte.txt` by section only for any Skeleton component you use.

## Rules your work depends on (quote into worker briefs)

- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and **never call `toaster`**. `socket.off(event)` without a handler removes every listener app-wide: always pass the handler.
- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`. Untrack reads of state an effect-called method writes.
- Browser code runs on plain-http LAN addresses and phones: **no `crypto.randomUUID`, no `navigator.clipboard`**. Buttons, never a keyboard-only shortcut, for anything W5 offers.
- A refusal is shown in words where it applies. A read-only value is words, never a disabled control.
- The editor and the save must never disagree: use the SDK check with the same scope and offers the server uses.
- **NOMENCLATURE §24**: list new UI labels and names in your report for `vl-N`. **Do not edit NOMENCLATURE.md, STYLE-GUIDE.md or docs/.**
- Heavy DOM tests: never pipe vitest into `head`; keep CodeMirror DOM tests small (a failing happy-dom assert has OOM-killed VS Code).

## Out of scope

Server and SDK files (requests go in your report). The admin pages and the preset form (`vl-A`). Docs (`vl-N`). The panel's other rows.

## Stop and ask when

CLAUDE.md § Decisions applies (anything a user sees beyond the plan's drawing goes in the report as a ★); a socket doesn't give a drawn element what it needs.

## Never

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Additionally: do not run `npm run sdk:build`, and do not start any dev server or `vite dev`.** The lead walks the screens later.

## Done means

- Tests: the panel has no per-step picker and shows the W4 row and leftover lines with both actions; the caret line's buttons rewrite one occurrence (Handlebars and Liquid); **Layouts in this template** rewrites all (All bare); completion offers references; `quickFix` on a dotted owner; read-only template shows no buttons; inspector reasons and missing reference.
- `npx tsc --noEmit -p .` clean, including with the loose `typedSocket.ts` entries gone. `npm run check` may OOM here; say so if it does.
- A `scope-reviewer` run on your diff, findings answered.

## Report

Return it as your final message (subagents can't write report files; the lead saves it to `plans/REPORT-vl-E-2026-11-10.md`): changed files, tests run with results, the W1 filter parameter you used, new UI labels for `vl-N`, server/SDK requests, ★ proposals, **Noticed, not done**.
