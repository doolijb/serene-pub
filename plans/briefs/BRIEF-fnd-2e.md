# BRIEF — build lane `fnd-2e` — split `EditSessionForm.svelte` into parts (programme 0.2, fifth file)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-file-splits-2026-11-15.md` §5 (the map; **re-derive every line range**), `STYLE-GUIDE.md`
(component patterns), `CLAUDE.md` hard rules for Svelte (`SvelteSet` / `SvelteMap`, sockets: one listener, every
`socket.off` with its handler, views never call `toaster`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. Tests
only as `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-2e-<n>.log 2>&1"`,
one run at a time; other lanes run tests: wait with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
Type checks: `NODE_OPTIONS=--max-old-space-size=10240 npm run check` (svelte-check; the one that reads `.svelte`).
The SDK is not touched. No full run, no `npm run build`.

## The rule of this lane

**No behaviour change and no visible change**: the rendered markup (elements, classes, attributes, order, text,
ids, `data-*`, aria) is the same before and after, for every state of the form. Unlike the server splits this is
not a byte-identical move: markup moves into child components and state arrives as props and callbacks. So:

- **State, effects and socket listeners stay in the parent** (`EditSessionForm.svelte`). A child receives values
  as props and reports through callback props; a child holds only purely local UI state it already owned (an
  open / closed fold, a text draft that never leaves it): list each such piece in the report.
- A two-way binding the parent had (`bind:value` on its own state) becomes a value prop plus a callback, or a
  `$bindable` prop where that is the existing pattern in this codebase (find one precedent and follow it; name
  it in the report).
- Moved markup is copied verbatim (indentation aside); expressions change only where a name becomes a prop.
- `noCharacterVisibility.test.ts` (~20–25) reads this file's source for `sessions:setCastSeatEnabled`: **those
  lines stay in the parent**. Grep for any other test that reads a `.svelte` source as text or imports this
  component; list them.
- Before step 1, capture a baseline: for each existing DOM test of this form, and for a new throwaway render
  script if the tests do not cover a part you move, save the rendered HTML of the part; after each step the HTML
  is identical (whitespace-normalised, Svelte's hydration comments aside). Say how each part was compared; a
  part with no way to render it in a test is moved last or not at all.

## Steps (one at a time, sequential workers; each ends green before the next)

1. `SessionVisibilityPanel.svelte`. 2. The actions part. 3. Tags. 4. Benched seats. 5. Characters and personas
(with the two snippets). 6. `sessionSchema` and pure helpers to a `.ts` file beside the form.

New files live beside the form in `src/lib/client/components/sessionForms/`; names follow the existing files
there (PascalCase, the noun the part shows). A partial split is acceptable and reported as such; stop a step
that needs the parent's state restructured.

Per step: `npm run check` 0 errors in this lane's files; the form's tests (all 14: find them) plus
`noCharacterVisibility.test.ts`, green or failing only as in `plans/lead-full12.log`; the HTML comparison.

## Files owned

`src/lib/client/components/sessionForms/EditSessionForm.svelte`, the new files beside it, a path string in a
test that reads the source as text (only if a moved line forces it; prefer keeping the line in the parent).
Not `SessionsSidebar.svelte` beyond nothing at all (the form's props and events are unchanged). Lane `ss-2a`
may touch `PipelineConfigOptions` session mode: do not touch it; if its edit lands inside a block you are
moving, re-derive from the file as it is.

## Stop and ask when

A move needs the parent's state reshaped, a new store, or a context; the HTML differs and you cannot make it
identical; a listener would have to move.

## Report

Final message = the report (lead saves `plans/REPORT-fnd-2e-<date>.md`): per step, new file, lines, parent size
after, props / callbacks, how the HTML was compared; local state left in children; what stays and why;
**Noticed, not done**. Under about 500 words.
