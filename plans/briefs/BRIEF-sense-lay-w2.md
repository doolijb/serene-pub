# BRIEF — worker `sense-lay-w2` (client half + docs) — variable layout truth fixes

You are a `lane-worker` under supervisor `sense-lay`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.
Another worker (`sense-lay-w1`) is editing the server files and `src/lib/shared/sockets/types.ts` at the same time; never touch them. Until w1 lands, `Sockets.Pipelines.VariableLayouts.Variable` has no `differs` field — code against the contract below and, for typing, declare a local type alias in your words module that matches it exactly (see Task A3); do not edit `types.ts`.

## Verbatim rules (from the lane guide)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no SDK build.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash`. `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- No reference to any other project or product in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Do not start a dev server.
- Run only the targeted tests below, capped: `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`. Never pipe vitest into `head`.

## Design rules this work depends on

- STYLE-GUIDE §6.11 (Variable layouts change view): the page is a read-only **change view**: header, a closed **Example value** `AdminFieldset`, the layouts as an `AdminInline`. Relations the object does not own "stay read-and-link: rows link to their own change forms, nothing is edited there." A refusal is in words where it applies, never a toast. Every admin card is `panel-card` (AdminFieldset already is).
- STYLE-GUIDE §6.17: the step's leftover-pick line is a 12px muted line with a tonal button; buttons keep `pointer-coarse:min-h-11`.
- Every new or changed sentence below is provisional 🚧 copy, given verbatim. Use exactly these words; add no other user-facing words, names, settings or props.

## Files owned (edit only these)

- `src/lib/client/admin/sections/variable-layouts/VariablePage.svelte`, `variableLayoutWords.ts`, `variableLayoutWords.test.ts`, `variablePage.dom.test.svelte.ts`
- `src/lib/client/components/pipelines/StepVariableLayouts.svelte`, `src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts`
- `src/lib/client/components/pipelines/inspector/receiptView.ts` (the `REASON_LABEL` table and its doc only), `receiptView.test.ts` (the layout-reason tests only)
- `docs/context-templates.md`, `docs/pipelines.md` (only the sentences listed below)

## Task A4 — the leftover line's button (StepVariableLayouts.svelte ~88–93)

Relabel **Use the pub's** → **Remove this pick**. It still calls `onclear(step, pick)`. Update the component's header comment (`*Use the pub's* (drop the pick)` → `*Remove this pick*`). Update `stepVariableLayouts.dom.test.ts` (lines ~236–243, ~356) so the test finds the button by the new label, and asserts no button reads "Use the pub's" and that clicking it still calls `onclear` with that step and pick.

## Task A5 — the inspector's words (receiptView.ts ~962–968)

```ts
const REASON_LABEL: Record<string, string> = {
	template: "named by the template",
	leftover: "leftover pick",
	preset: "the preset's",
	pub: "the pub's",
	authored: "the pipeline's choice for this step",
	default: "the variable's default",
	automatic: "automatic",
	"no-layout": "no layout for it"
}
```

The server's `LayoutReason` becomes `"leftover" | "preset" | "pub" | "template" | "authored" | "default" | "automatic" | "no-layout"` (w1 does that). Update the test "says why each layout was used, in words" (~1215) to cover all eight plus `null` and an unknown word (both → `null`).

## Task A3 — **Where this differs** on the variable page

The server adds to `Sockets.Pipelines.VariableLayouts.Variable` a field `differs: Difference[]`:

```ts
/** One thing that writes this variable out with another layout than the one in use. */
type Difference =
	| { kind: "template"; id: number; name: string; layout: { id: number; name: string } }
	| { kind: "leftover"; specSlug: string; pipelineLabel: string; stepKey: string; stepHeading?: string; layout: { id: number; name: string } }
	| { kind: "preset"; id: number; name: string; layout: { id: number; name: string } }
	| { kind: "authored"; specSlug: string; pipelineLabel: string; stepKey: string; stepHeading?: string; layout: { id: number; name: string } }
```

Ordered by the server (template, leftover, preset, authored). `stepKey` is an opaque handle: never decode it.

1. In `variableLayoutWords.ts` add one pure function `differenceLine(d)` returning `{ lead: string; link: { text: string; href: string }; rest: string }`:
   - `template`: lead `The context template `, link `name` → `/admin/context-templates/${id}`, rest ` names ${layout.name}.`
   - `leftover`: lead `${stepHeading} in ` (or `A step in ` with no heading), link `pipelineLabel` → `/admin/pipelines/${encodeURIComponent(specSlug)}`, rest ` keeps ${layout.name}, picked before layouts moved.`
   - `preset`: lead `The `, link `name` → `/admin/session-presets/${id}`, rest ` preset chooses ${layout.name}.`
   - `authored`: lead as leftover, same link, rest ` uses ${layout.name}, the pipeline's choice for that step.`
   Declare the `Difference` type locally in this module, matching the contract exactly (with a comment that it mirrors `Sockets.Pipelines.VariableLayouts.Difference`); the supervisor will switch it to the socket type once w1 lands. Unit-test every kind (and the no-heading fallback) in `variableLayoutWords.test.ts`.
2. In `VariablePage.svelte`, after the layouts `AdminInline` (inside the `{#if v.rows.length}` branch, below it), render only when `(v.differs ?? []).length > 0`:
   an `AdminFieldset` titled **Where this differs** with description _These write this variable out with another layout than the one in use._, holding a `<ul>` of one `<li class="text-sm">` per difference: `{lead}<a class="anchor" href={link.href}>{link.text}</a>{rest}`, keyed by `kind` + (`id` or `specSlug`+`stepKey`) + `layout.id`. Read `AdminFieldset`'s props first (`src/lib/client/components/admin/AdminFieldset.svelte`) and use its existing `title`/`description` API. No heading or fieldset when the list is empty.
3. `variablePage.dom.test.svelte.ts`: a variable with three differences (template, leftover, preset) shows the heading and the three lines with their links; one with `differs: []` shows no "Where this differs" text. Follow the file's existing mounting/socket-faking pattern.

## Docs (exact edits)

`docs/context-templates.md`:
1. In "#### One choice for the whole pub", after the paragraph that starts "Open a variable to see its layouts…", add a new paragraph:
   "**In use** is the pub's choice. Where something writes the variable out with another layout, the page lists it under **Where this differs**: each preset that chooses another, each context template that names another, each step that keeps a pick from before layouts moved, and, while the pub has no choice of its own, each step whose pipeline chose another. Each names its layout and links to where it is changed. When nothing differs, the list isn't shown."
2. In "## Upgrading from 0.5", the sentence "…is kept and shown on its step as _Characters uses JSON here (set before layouts moved)._ with **Use the pub's** to remove it." → "…is kept and shown on its step as _Characters uses JSON here (set before layouts moved)._ with **Remove this pick**. What applies then is the next in the order above, which may be the session's preset's layout rather than the pub's."

`docs/pipelines.md`:
3. Line ~391, replace "and why that layout: _the preset's_, _the pub's_, _the default_, _named by the template_ or _leftover pick_." with "and why that layout: _named by the template_, _leftover pick_, _the preset's_, _the pub's_, _the pipeline's choice for this step_, _the variable's default_, _automatic_, or _no layout for it_."
4. Line ~422, replace "Which layout is in use is on the variable's page in **Admin › Variable layouts**." with "Which layout is in use, and what writes the variable out with another, is on the variable's page in **Admin › Variable layouts**."

Do not change the numbered resolution-order list in `context-templates.md` (it matches the code).

## Tests (Done means)

Capped run of: `src/lib/client/admin/sections/variable-layouts/variableLayoutWords.test.ts`, `src/lib/client/admin/sections/variable-layouts/variablePage.dom.test.svelte.ts`, `src/lib/client/components/pipelines/stepVariableLayouts.dom.test.ts`, `src/lib/client/components/pipelines/inspector/receiptView.test.ts`. The new assertions must fail on the old code (the button label, the reason words, the block). `npx prettier --check` each changed `.ts`/`.svelte` file (docs: skip).

## Report (return as your final message)

Changed files with one line each; tests with pass/fail counts; every user-facing sentence you added or changed, verbatim; decisions you made; **Noticed, not done**.
