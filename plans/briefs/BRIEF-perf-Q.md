# BRIEF perf-Q — shell: docs manifest and modal bodies off the first page (round 5, R5-1 + R5-2)

**Supervisor:** read `.claude/guides/multi-agent.md`, then `plans/PLAN-performance-2026-11-13.md` **Part 6** (the
measurements, rows (a) and (c), proposals R5-1 and R5-2 with the challenger notes [C25]). One or two workers.
**Owner go 2026-11-14 for R5-1, R5-2, R5-3 only.** ★R5-4 (host elements), ★R5-5 (auth screens) and ★R5-6 (icons) are
unruled: do not touch `hostElements/`, `LoginForm`, `AccessibleLoginForm`, `SetupGate`, `+layout.svelte`'s auth
branches or the icon set.

**Coordination:** another session (`serene-pub-c4`) runs a full vitest; the lead launches this lane only after it says
"free". Its lanes own `src/lib/client/lorebooks/**`, `src/lib/server/sockets/amendments.ts` and `runtime/bindings.ts`
(which imports `docsIndex` dynamically at `bindings.ts:4197` — every current export of `docsIndex.ts` stays).

## Goal
The first page parses 2.1 MB of JS and runs 46 % of it (Part 6 table). Two shell chains load things the first screen
never shows: the docs manifest (374 KB rendered, 161 pages × 2,790 headings, plus the 162-page import map; chunk measured
369 KB minified / 54 KB gz) and the bodies of two shell modals (`RunInspector` 71 KB + `receiptView` 18 KB, `SchemaForm`
33 KB). Move both to load on first use with **no visible change** and **no listener moved**.

## What to change
1. **`hasDocPage` leaf** (R5-1). New module `src/lib/shared/utils/docsPages.ts` (name: §24 — grep it first; record in
   NOMENCLATURE §25 in the same change, one row: *new* `docsPages.ts` / `hasDocPage(slug)` — "whether the docs-dist has a
   page, from the keys of the lazy page glob; imports nothing else; the manifest stays in `docsIndex.ts`"). It owns its own
   `import.meta.glob("/src/lib/generated/docs/pages/**/*.html", { query: "?raw", import: "default" })` (lazy, like
   `docsIndex.ts:108–111`) and exports `hasDocPage(slug: string): boolean` = `Object.hasOwn(pageModules, \`${DIST_DIR}/pages/${slug}.html\`)`
   (same key shape as `loadDocHtml`, `docsIndex.ts:158–161`; copy the `DIST_DIR` constant or import nothing — the module
   must have **no imports** so it is a leaf). A glob that matches nothing is `{}` (fresh checkout, `npm test`), so the
   function returns false there — same as today's `getDocMeta` on the empty manifest.
2. **`Layout.svelte:28` + `:548`**: import `hasDocPage` instead of `getDocMeta`; the guard reads `!hasDocPage(link.slug)`.
   Synchronous, so the click handling is unchanged. Grep `Layout.svelte` for any other `docsIndex` use first.
3. **`JumpOverlay` lazy** (`Layout.svelte:84`, rendered at `:3532–3534`): inside the existing `{#if jumpCtx.isOpen}`,
   `{#await import("$lib/client/components/shell/JumpOverlay.svelte")}` → `<LoadingState />` → `{:then { default: JumpOverlay }}`
   `<JumpOverlay {jumpCtx} />` → `{:catch}` `{@render viewLoadFailed()}` — the exact pattern of the Help sidebar at
   `Layout.svelte:3705–3711`. Drop the static import. `shell/docsJump.ts` imports `docsIndex` (`:20`) and is only imported
   by `JumpOverlay` and `HelpSidebar` (both lazy after this) — verify with grep; nothing to change in it.
4. **`RunInspectorModal.svelte`** (R5-2): the store and the `{#if runId}` frame stay; replace the static
   `import RunInspector from "./RunInspector.svelte"` with `{#await import("./RunInspector.svelte")}` → `<LoadingState />`
   → `{:then { default: RunInspector }}` `<RunInspector {runId} />` inside the frame. Header, close button and Escape
   handling unchanged.
5. **`PipelineReviewModal.svelte:25` + `:252`**: `SchemaForm` becomes `{#await import("./SchemaForm.svelte")}` →
   `<LoadingState />` → `{:then { default: SchemaForm }}` `<SchemaForm schema={current.schema as any} bind:values />` inside
   the existing `{#if current}`. The `requestWithInterest("pipelines:reviews", …)` at `:191` and every `$effect` stay exactly
   where they are. Confirm `bind:values` through the awaited component keeps the Send/Apply flow working (the dom test
   drives it — it will need to await the import: `await tick()` / poll for the first field; adjust the test, not the flow).
6. **Leave eager:** `CapPauseDialog`, `ConnectionsDialogs`, `ConnectionTimeoutModal`, `JumpPill`, everything else in
   `Layout.svelte:3817–3833`.

## Files owned
`src/lib/client/components/Layout.svelte` (only the lines named above), `src/lib/client/components/shell/JumpOverlay.svelte`
(only if its import of `docsIndex` needs no change — expected untouched), new `src/lib/shared/utils/docsPages.ts` + its
test, `src/lib/client/components/pipelines/inspector/RunInspectorModal.svelte`,
`src/lib/client/components/pipelines/PipelineReviewModal.svelte`, `src/lib/client/components/pipelines/PipelineReviewModal.dom.test.svelte.ts`,
`src/lib/client/components/layoutHandledErrors.test.ts` only if it breaks, `NOMENCLATURE.md` §25 (one row).

## Files readable
`src/lib/shared/utils/docsIndex.ts` (read only — do not edit), `src/lib/client/components/sidebars/HelpSidebar.svelte`,
`src/lib/client/shell/docsJump.ts`, `src/routes/+layout.svelte`, `src/lib/client/components/LoadingState.svelte`, the
plan, STYLE-GUIDE (loading states).

## Out of scope — written down, never built
`docsIndex.ts` edits; a generic lazy-mount component or helper; `hostElements/**`; auth screens; `+layout.svelte`;
`routes/+page.svelte` and the modals under `components/modals/` (lane perf-R); `CapPauseDialog`; the icon set; any
setting, event, migration, SDK edit or build-config change; `vite.config.ts`.

## Rules (quoted for workers)
- P1: nothing hidden — the lazy import sits where the component renders; no module-scope prefetch, no cache.
- Sockets ruling: "one domain context per event family is the only listener" — no `requestWithInterest`, `socket.on` or
  store subscription moves or changes its mount timing. If a change would, stop and report.
- Comment ratchet: say what the code does now; avoid "no longer", "used to", "previously".
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Do not run `prettier --write` at all** (not on a directory, not on a file: on 2026-11-14 it reformatted another
  session's uncommitted hunks). `npx prettier --check <file>`, then fix only your own hunks by hand.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No sdk:build needed; **no `npm run build`** — the lead measures.)
- DOM tests inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`; never pipe vitest into `head`.
  Check `pgrep -af vitest` and wait if another session's run is up.

## Done means
- Green: `src/lib/shared/utils/docsPages.test.ts` (new: known slug true, unknown false, `constructor` false),
  `docsIndex.test.ts`, `docsJump.test.ts`, `jump.test.ts`, `openJumpHit.test.ts`, `layoutHandledErrors.test.ts`,
  `PipelineReviewModal.dom.test.svelte.ts`, `receiptView.test.ts`, `shellLoading.dom.test.ts`.
- `npx tsc --noEmit -p .` clean for the touched files (one peer error in `lorebooks/redlines.ts` may exist — report it).
- `grep -rn "docsIndex" src/lib/client/components/Layout.svelte` → nothing; `grep -rln "from \"./RunInspector.svelte\"\|SchemaForm.svelte\"" src/lib/client/components/pipelines` shows only the lazy sites.

## Report path
`plans/REPORT-perf-Q-2026-11-14.md` — changed files, tests with results, the grep proofs above, open ★, Noticed, not done.
