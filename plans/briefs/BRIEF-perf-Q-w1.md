# BRIEF perf-Q-w1 — `hasDocPage` leaf + lazy `JumpOverlay` (performance plan round 5, R5-1)

Supervisor: lane perf-Q (`plans/briefs/BRIEF-perf-Q.md`). Owner go 2026-11-14 for R5-1. Repo: /home/jody/github/serene-pub.
Use absolute paths. Another worker (perf-Q-w2) edits `pipelines/RunInspectorModal.svelte` / `PipelineReviewModal.svelte`
at the same time — do not touch those. Another lane (perf-R) edits `src/routes/+page.svelte` and `components/modals/*` —
do not touch those either.

## Goal
The first page loads the whole docs manifest (~370 KB) only because `Layout.svelte` asks "does this help page exist?" in a
click guard and statically imports `JumpOverlay` (which pulls `shell/docsJump.ts` → `docsIndex.ts`). Make both stop
pulling `docsIndex.ts` into the shell's static import graph, with **no visible change** and **no listener moved**.

## Files owned (edit only these)
- NEW `src/lib/shared/utils/docsPages.ts`
- NEW `src/lib/shared/utils/docsPages.test.ts`
- `src/lib/client/components/Layout.svelte` — only line 28 (import), line ~548 (guard), line 84 (JumpOverlay import) and
  lines ~3532–3534 (JumpOverlay render). Nothing else in the file.
- `NOMENCLATURE.md` — append exactly one bullet at the very end of the file (§25 change ledger is the bullet list at the end).

## Files readable
`src/lib/shared/utils/docsIndex.ts` (READ ONLY — never edit; every export stays, another session imports it dynamically),
`src/lib/shared/utils/docsIndex.test.ts` (pattern for the test), `src/lib/client/shell/docsJump.ts`,
`src/lib/client/components/shell/JumpOverlay.svelte`, `src/lib/client/components/sidebars/HelpSidebar.svelte`.

## What to do
1. **`docsPages.ts`** — a leaf module with **no imports at all**. Contents:
   - a `DIST_DIR = "/src/lib/generated/docs"` constant (copied from `docsIndex.ts:88`);
   - its own lazy glob, the same literal as `docsIndex.ts:108–111`:
     `import.meta.glob("/src/lib/generated/docs/pages/**/*.html", { query: "?raw", import: "default" })` — **lazy** (no
     `eager`), typed `Record<string, () => Promise<string>>`; never call the loaders;
   - `export function hasDocPage(slug: string): boolean` returning
     `Object.hasOwn(pageModules, \`${DIST_DIR}/pages/${slug}.html\`)` (same key shape as `loadDocHtml`, `docsIndex.ts:158`).
   - A short module doc comment: what it answers (whether the docs-dist has a page, from the keys of the lazy page glob),
     that it imports nothing so the shell can ask without loading the manifest, and that the manifest stays in
     `docsIndex.ts`. `hasOwn` because the slug comes off a URL (`constructor`). A glob matching nothing is `{}` (fresh
     checkout), so it returns false there.
2. **`docsPages.test.ts`** — vitest, modelled on `docsIndex.test.ts:145–200`:
   - always-run cases: `hasDocPage("no-such-page")` false; `hasDocPage("constructor")` and `hasDocPage("__proto__")` false;
   - a `describe` that skips (`it.skip("needs a compiled docs-dist — run \`npm run docs:build\`", …)`) when
     `src/lib/generated/docs/manifest.json` is not on disk, and otherwise asserts: a known slug (take the first of
     `docsManifest.nav.flatMap(g => g.pages)`) is true, and for **every** nav slug `hasDocPage(slug) === (getDocMeta(slug) !== undefined)`
     (parity with the function it replaces in the guard). The test may import from `docsIndex` — only the module must stay a leaf.
3. **`Layout.svelte:28`** — replace `import { getDocMeta } from "$lib/shared/utils/docsIndex"` with
   `import { hasDocPage } from "$lib/shared/utils/docsPages"`. **`:548`** — the guard reads `!hasDocPage(link.slug)`.
   It stays synchronous; nothing else in the click handler changes. First `grep -n "docsIndex\|getDocMeta" Layout.svelte`
   and confirm there is no other use.
4. **`Layout.svelte:84` + `:3532–3534`** — drop the static `import JumpOverlay …`. Inside the existing
   `{#if jumpCtx.isOpen}` render it exactly like the Help sidebar at `Layout.svelte:3705–3711`:
   ```svelte
   {#if jumpCtx.isOpen}
       {#await import("$lib/client/components/shell/JumpOverlay.svelte")}
           <LoadingState />
       {:then { default: JumpOverlay }}
           <JumpOverlay {jumpCtx} />
       {:catch}
           {@render viewLoadFailed()}
       {/await}
   {/if}
   ```
   `LoadingState` is already imported (`:19`); `viewLoadFailed` is a snippet declared inside the same top-level
   `{#if shouldShowApp}` branch (`:3791`), so it is in scope — svelte-check will confirm. Keep the indentation of the
   surrounding block (tabs).
5. Verify `shell/docsJump.ts` is imported only by `JumpOverlay.svelte` and `HelpSidebar.svelte` (plus its own test):
   `grep -rln "docsJump" src/ --include=*.svelte --include=*.ts`. Do not edit it. Do not edit `JumpOverlay.svelte`.
6. **NOMENCLATURE.md** — append one bullet at the end of the file, matching the style of the other 2026-11-14 bullets there
   (bold date + lane in parentheses, then the term in bold with its file):
   `- **2026-11-14 (lane perf-Q — performance plan round 5, R5-1; owner go 2026-11-14).** 🚧 *new* **`docsPages.ts`** /
   **`hasDocPage(slug)`** (`shared/utils/docsPages.ts`): whether the docs-dist has a page, from the keys of the lazy page
   glob; imports nothing else; the manifest stays in `docsIndex.ts`. The shell's help-link guard (`Layout.svelte`) asks it
   in place of `getDocMeta`, so the docs manifest loads only with the Jump overlay or the Help view.`
   Insert it with a heredoc append (`cat >> … <<'EOF'`) — make sure the file's last line ended with a newline first
   (`tail -c1`). Do not reflow or touch any other line.

## Rules (quoted from the lane's brief and CLAUDE.md)
- P1: nothing hidden — the lazy import sits where the component renders; no module-scope prefetch, no cache.
- Sockets ruling: "one domain context per event family is the only listener" — no `requestWithInterest`, `socket.on` or
  store subscription moves or changes its mount timing. If a change would, stop and report. (`JumpOverlay` mounts only
  while `jumpCtx.isOpen` today; it still does.)
- Comment ratchet: say what the code does now; avoid "no longer", "used to", "previously".
- Out of scope, never built: `docsIndex.ts` edits; a generic lazy-mount component or helper; any other line of
  `Layout.svelte` (`CapPauseDialog`, `ConnectionsDialogs`, `ConnectionTimeoutModal`, `JumpPill` stay eager);
  `+layout.svelte`; `hostElements/**`; the icon set; any setting, event, migration, SDK edit or build-config change.
- Stop and ask (write it in your report, don't decide) when: CLAUDE.md §Decisions applies, a name other than
  `docsPages.ts` / `hasDocPage` would be needed, or anything outside the files above would need to change.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Do not run `prettier --write` at all** (not on a directory, not on a file). `npx prettier --check <file>`, then fix
  only your own hunks by hand. `Layout.svelte` and `NOMENCLATURE.md` may already fail the check from other people's
  hunks — that is not yours to fix; only make sure your own lines match the surrounding style.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No sdk:build is needed. No `npm run build`.)
- Never `git checkout` / `restore` anything.

## Tests (Done means)
Run only these, each time after `pgrep -af vitest` shows no other run (wait if one is up), inside a capped scope, never
piped into `head`:
```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run \
  src/lib/shared/utils/docsPages.test.ts src/lib/shared/utils/docsIndex.test.ts src/lib/client/shell/docsJump.test.ts \
  src/lib/client/shell/jump.test.ts src/lib/client/shell/openJumpHit.test.ts \
  src/lib/client/components/layoutHandledErrors.test.ts src/lib/client/components/shell/shellLoading.dom.test.ts
```
All green. Then typecheck: `npx tsc --noEmit -p . 2>&1 | grep -n "docsPages"` → nothing (a peer error in
`lorebooks/redlines.ts` may exist; report it, don't fix it). **Do not run svelte-check** — the supervisor runs it once
for both workers.
Proofs: `grep -rn "docsIndex" src/lib/client/components/Layout.svelte` → nothing; `grep -n "import" src/lib/shared/utils/docsPages.ts`
→ only the `import.meta.glob` call.

## Report
Reply (your final message) with: changed files, the exact `old → new` of the Layout.svelte hunks, tests run with
pass/fail counts, the grep proofs, anything you stopped on, and **Noticed, not done**. Do not write a report file.
