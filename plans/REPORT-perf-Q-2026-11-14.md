# REPORT perf-Q — 2026-11-14 (round 5: R5-1 docs manifest lazy, R5-2 shell modal bodies lazy)

Brief: `plans/briefs/BRIEF-perf-Q.md`. Workers: `plans/briefs/BRIEF-perf-Q-w1.md` (R5-1), `BRIEF-perf-Q-w2.md` (R5-2).
Both reports checked against their briefs and the diffs read by the supervisor. Relayed status question: none.

## Changed files (all inside Files owned)
- NEW `src/lib/shared/utils/docsPages.ts` — `hasDocPage(slug)`: a leaf with **no imports**; its own lazy
  `import.meta.glob("/src/lib/generated/docs/pages/**/*.html", { query: "?raw", import: "default" })`, keys only,
  `Object.hasOwn(pageModules, \`${DIST_DIR}/pages/${slug}.html\`)`.
- NEW `src/lib/shared/utils/docsPages.test.ts` — unknown slug false; `constructor` / `__proto__` false; with a compiled
  docs-dist (skips otherwise, same pattern as `docsIndex.test.ts`): first nav slug true, and parity
  `hasDocPage(slug) === (getDocMeta(slug) !== undefined)` for every nav slug.
- `src/lib/client/components/Layout.svelte` — `:28` imports `hasDocPage` from `docsPages` (was `getDocMeta` from
  `docsIndex`); the help-link guard (`:547`) reads `!hasDocPage(link.slug)`, still synchronous; static `JumpOverlay`
  import (`:84`) removed; inside the existing `{#if jumpCtx.isOpen}` (`:3531`) it is
  `{#await import("$lib/client/components/shell/JumpOverlay.svelte")}` → `<LoadingState />` → `{:then}` →
  `{:catch}{@render viewLoadFailed()}` — the Help sidebar's pattern.
- `src/lib/client/components/pipelines/inspector/RunInspectorModal.svelte` — `RunInspector` loads by
  `{#await import("./RunInspector.svelte")}` → `<LoadingState />` inside the `{#if runId}` frame; header, close button,
  Escape handler and `runInspector` store read unchanged.
- `src/lib/client/components/pipelines/PipelineReviewModal.svelte` — `SchemaForm` loads by
  `{#await import("./SchemaForm.svelte")}` → `<LoadingState />` → `<SchemaForm … bind:values />` inside the existing
  `{#if current}`; `useInterest` calls, `requestWithInterest("pipelines:reviews")` `$effect` and every other `$effect`
  untouched.
- `NOMENCLATURE.md` §25 — one bullet appended (perf-Q, *new* `docsPages.ts` / `hasDocPage(slug)`, the brief's wording).
  perf-R's bullet now follows it.

Untouched: `docsIndex.ts`, `docsJump.ts`, `JumpOverlay.svelte` (its working-tree diff is a peer's, mtime 2026-11-13),
`PipelineReviewModal.dom.test.svelte.ts` (passed unchanged), `layoutHandledErrors.test.ts`, `+layout.svelte`,
`CapPauseDialog`, `ConnectionsDialogs`, `ConnectionTimeoutModal`, `JumpPill`.

## Tests
- Supervisor's combined run (capped scope, 6G): `docsPages.test.ts`, `docsIndex.test.ts`, `docsJump.test.ts`,
  `jump.test.ts`, `openJumpHit.test.ts`, `layoutHandledErrors.test.ts`, `PipelineReviewModal.dom.test.svelte.ts`,
  `receiptView.test.ts`, `shellLoading.dom.test.ts` → **9 files, 206 tests passed**. (Workers' own runs: 7 files /
  122 passed; 2 files / 84 passed.) A peer session's small lorebooks vitest run started during mine.
- `npx tsc --noEmit -p .` → **0 errors** (the `lorebooks/redlines.ts` peer error is gone).
- `svelte-check --threshold error` (capped, `--max-old-space-size=5500`; the default heap OOMs) → **0 errors**,
  9 warnings, none in a touched file. Confirms `bind:values` through the `{:then { default: SchemaForm }}` destructure and
  `viewLoadFailed` scope at the Jump overlay.
- `npx prettier --check`: `docsPages.ts` passes; the three edited components warn only on pre-existing hunks (workers
  compared; nothing of ours).

## Grep proofs
- `grep -rn "docsIndex" src/lib/client/components/Layout.svelte` → nothing.
- `grep -rn "RunInspector.svelte\"\|SchemaForm.svelte\"" src/lib/client/components/pipelines --include=*.svelte` →
  `PipelineReviewModal.svelte:252` and `RunInspectorModal.svelte:51` (both `{#await import(…)}`) plus
  `workspace/RunsPanel.svelte:16` — a static `$lib/…/RunInspector.svelte` import in the pipelines workspace (not the
  `./` form, not on the first page; out of scope). Three `schemaForm*.dom.test.ts` files import `SchemaForm` statically
  (tests).
- `docsJump` is imported only by `JumpOverlay.svelte` and `HelpSidebar.svelte` (plus its test), both lazy now.

## Decisions taken (inside scope)
- `JumpOverlay` carries a `useInterest("jump:search")` listener. Its trigger is unchanged (mounts only while
  `jumpCtx.isOpen`); it registers after the chunk resolves rather than synchronously. Its only emitter
  (`socket.emit("jump:search")`, `:198`) is inside the same component, so no reply can arrive before the listener — no
  listener moved in the sense of the sockets ruling.
- No `{:catch}` on the two modal bodies, as the brief specified (the shell's `viewLoadFailed` snippet is not reachable
  there). See ★ below.

## Open ★
- ★ **Q-1 (proposal):** a failed chunk load (stale deploy) in `RunInspectorModal` / `PipelineReviewModal` leaves the
  spinner up with no words. Recommend a `{:catch}` with the shell's existing sentence ("This page did not load. If Serene
  Pub was just updated, reload to get the new version." + **Reload**), duplicated inline or lifted into a tiny shared
  component; trade-off: new copy site / a new component vs a silent spinner in a rare case. Not built.
- ★R5-4 / ★R5-5 / ★R5-6 untouched (unruled).

## Noticed, not done
- Worker w1 reported that its own `pgrep -f vitest` wait loop matched itself, and it then ran
  `pkill -f "while pgrep"` to clear it. That pattern would also match any other session's `while pgrep …` wait loop on
  this machine; it reported only its own shell died. Worth a line in future briefs: never `pkill -f` a generic pattern.
- `npm run check` OOMs at the default Node heap on this tree; it needs `NODE_OPTIONS=--max-old-space-size≈5500`.
- `workspace/RunsPanel.svelte:16` imports `RunInspector` statically (admin pipelines workspace; fine unless that view
  turns out to be on a hot path).
- vitest output is noisy with `csrf.checkOrigin` deprecation warnings.
- The lead's re-measure (bundle/first paint) is owed; no `npm run build` was run here.

## Scope review + lead fixes (2026-11-14)
Scope review: no objection on scope; two low correctness notes and one nit, all taken by the lead:
- A failed `JumpOverlay` chunk load left `jumpCtx.isOpen` true with nothing visible (only the overlay can close it).
  Now the await block draws nothing while loading and, on failure, shows the shell's existing `viewLoadFailed` notice
  (its Reload button is the way out) inside a fixed, centred frame over the page. Folded into ★Q-1's scope: whether
  the two modal bodies (`RunInspector`, `SchemaForm`) should get the same catch.
- `RunInspector`'s `useInterest("pipelines:run:error")` and `requestWithInterest("pipelines:run")` now register when
  its chunk resolves rather than when `runId` is set. Self-contained: the server emits `pipelines:run:error` only in
  reply to that request, which `RunInspector` itself sends. No listener moved.
- `docsPages.test.ts` now also checks every manifest page key, not only nav slugs.
`docsPages.test.ts` + `layoutHandledErrors.test.ts`: 12/12 after the fixes.
