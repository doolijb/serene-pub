# BRIEF perf-Q-w2 — shell modal bodies load on first open (performance plan round 5, R5-2)

Supervisor: lane perf-Q (`plans/briefs/BRIEF-perf-Q.md`). Owner go 2026-11-14 for R5-2. Repo: /home/jody/github/serene-pub.
Use absolute paths. Another worker (perf-Q-w1) edits `Layout.svelte`, `NOMENCLATURE.md` and a new `docsPages.ts` at the
same time — do not touch those. Another lane (perf-R) edits `src/routes/+page.svelte` and `components/modals/*` — do not
touch those either.

## Goal
`Layout.svelte` mounts `RunInspectorModal` and `PipelineReviewModal` unconditionally, and each statically imports a heavy
body that is only drawn when a run is inspected / a review card is up: `RunInspector.svelte` (71 KB + `receiptView` 18 KB)
and `SchemaForm.svelte` (33 KB). Load only those bodies on first open. The opener components stay eager and in place,
with every listener, store read and `$effect` exactly where it is. **No visible change** apart from the shell's standard
`LoadingState` spinner for the instant the chunk takes.

## Files owned (edit only these)
- `src/lib/client/components/pipelines/inspector/RunInspectorModal.svelte`
- `src/lib/client/components/pipelines/PipelineReviewModal.svelte` (only line 25 and line ~252)
- `src/lib/client/components/pipelines/PipelineReviewModal.dom.test.svelte.ts` (only if it needs to await the import)

## Files readable
`src/lib/client/components/LoadingState.svelte`, `pipelines/inspector/RunInspector.svelte`, `pipelines/SchemaForm.svelte`,
`src/lib/client/components/Layout.svelte:3700–3712` (the reference pattern, read only).

## What to do
1. **`RunInspectorModal.svelte`**: remove `import RunInspector from "./RunInspector.svelte"`; add
   `import LoadingState from "$lib/client/components/LoadingState.svelte"`. The `{#if runId}` frame, header, close button,
   `svelte:window` Escape handler and `runInspector` store read stay unchanged. Replace `<RunInspector {runId} />` with
   ```svelte
   {#await import("./RunInspector.svelte")}
       <LoadingState />
   {:then { default: RunInspector }}
       <RunInspector {runId} />
   {/await}
   ```
2. **`PipelineReviewModal.svelte:25`**: remove `import SchemaForm from "./SchemaForm.svelte"`; add the `LoadingState`
   import. At `:252`, inside the existing `{#if current}` (same place), replace
   `<SchemaForm schema={current.schema as any} bind:values />` with
   ```svelte
   {#await import("./SchemaForm.svelte")}
       <LoadingState />
   {:then { default: SchemaForm }}
       <SchemaForm schema={current.schema as any} bind:values />
   {/await}
   ```
   The `useInterest(...)` calls, the `$effect(() => requestWithInterest("pipelines:reviews", {}, onList))` at `:191`, and
   every other `$effect` stay exactly where they are, untouched. Confirm `bind:values` through the `{:then}` binding
   compiles and still binds (svelte allows `bind:` on a component from an await destructure; the supervisor's svelte-check confirms).
   The doc comment at the top mentions `SchemaForm` by name — it stays true; leave it.
3. No `{:catch}` branch: the brief for these two specifies none (the shell's `viewLoadFailed` snippet lives in
   `Layout.svelte` and is not reachable here). Do not invent new copy. If you think a catch is needed, say so under
   Noticed, not done.
4. **Test**: `PipelineReviewModal.dom.test.svelte.ts` mounts the modal with `schema: {}` and asserts the pipeline name.
   Run it first. If any assertion now depends on content inside the `{:then}` (or on the import having resolved), make
   the test await it (`await tick()` / `await vi.waitFor(...)`, or poll for the element) — **adjust the test, not the
   flow**. If it passes untouched, leave it untouched.

## Rules (quoted from the lane's brief and CLAUDE.md)
- P1: nothing hidden — the lazy import sits where the component renders; no module-scope prefetch, no cache.
- Sockets ruling: "one domain context per event family is the only listener" — no `requestWithInterest`, `socket.on`,
  `useInterest` or store subscription moves or changes its mount timing. If a change would, stop and report.
- STYLE-GUIDE §6.7: "Loading is `LoadingState` … a centred 20px spinner at `py-8`, `role="status"` … never bare
  _Loading…_ text and never a blank pane".
- Comment ratchet: say what the code does now; avoid "no longer", "used to", "previously".
- Out of scope, never built: a generic lazy-mount component or helper; `CapPauseDialog`, `ConnectionsDialogs`,
  `ConnectionTimeoutModal`; the other static importers of `SchemaForm` / `RunInspector` elsewhere (they are not on the
  first page); any setting, event, migration, SDK edit or build-config change.
- Stop and ask (write it in your report, don't decide) when: CLAUDE.md §Decisions applies, a new name is needed, or
  anything outside the files above would need to change.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Do not run `prettier --write` at all** (not on a directory, not on a file). `npx prettier --check <file>`, then fix
  only your own hunks by hand; pre-existing failures from other hunks are not yours.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No sdk:build is needed. No `npm run build`.)
- Never `git checkout` / `restore` anything.

## Tests (Done means)
Run only these, each time after `pgrep -af vitest` shows no other run (wait if one is up), inside a capped scope, never
piped into `head`:
```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run \
  src/lib/client/components/pipelines/PipelineReviewModal.dom.test.svelte.ts \
  src/lib/client/components/pipelines/inspector/receiptView.test.ts
```
All green. **Do not run svelte-check or tsc** — the supervisor runs them once for both workers.
Proof: `grep -rn "from \"./RunInspector.svelte\"\|SchemaForm.svelte\"" src/lib/client/components/pipelines` shows only
the two `import("…")` sites (or nothing for the `from` form).

## Report
Reply (your final message) with: changed files, the exact `old → new` hunks, tests run with pass/fail counts, the grep proof, anything you stopped on, and **Noticed, not done**. Do not write a
report file.
