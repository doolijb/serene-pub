# BRIEF perf-R — home page: modal bodies off the first page (round 5, R5-3)

**Supervisor:** read `.claude/guides/multi-agent.md`, then `plans/PLAN-performance-2026-11-13.md` **Part 6** (row (d),
proposal R5-3 with the challenger notes [C22][C23]). One or two workers. **Owner go 2026-11-14 for R5-1, R5-2, R5-3
only.** ★R5-4/5/6 are unruled; nothing outside this brief.

**Coordination:** another session (`serene-pub-c4`) runs a full vitest; the lead launches this lane only after it says
"free". Lane perf-Q owns `Layout.svelte`, the pipelines modals and `shared/utils/docs*`; do not touch them.

## Goal
`routes/+page.svelte` (the home page and the setup wizard) statically imports four modals whose bodies the first screen
never shows: `CharacterCreatorModal` (43 KB rendered + `AvatarCropEditor` 22 KB + zod), `CharacterSelectModal` 19 KB,
`PersonaSelectModal` 13 KB, `BindingLinkerModal` 3 KB. Load each body on first open with **no visible change** and **no
change to when any component's script runs** (listeners and interests stay as they are).

## What to change — and what not
1. **`CharacterCreatorModal.svelte`** (mounted twice with no outer gate, `+page.svelte:3736`, `:3750`; its script holds a
   bare `characters:create` listener at `:376`): keep the component, its script, props and `<Dialog>` frame exactly as
   they are. Inside its own `{#if open}` (`:397`), move the **body** — the step content from the backdrop's content inward,
   including the `AvatarCropEditor` use (`:640`) — into a new sibling file `CharacterCreatorBody.svelte` (name per §24;
   grep first; §25 row) that receives the state it needs as props/bindables, and render it with
   `{#await import("./CharacterCreatorBody.svelte")}` → `<LoadingState />` → `{:then { default: CharacterCreatorBody }}`.
   Read the whole component before deciding the prop surface; if the body's bindings into the parent's state are too many
   to pass cleanly (more than ~12), **stop and report** with the count instead of forcing it — leaving the creator eager
   is acceptable, the other three still pay. zod leaves the first page only if this body split lands (and ★R5-5 later).
2. **`PersonaSelectModal`** (`+page.svelte:3779`, already inside `{#if dataReady && !setupComplete && currentWizardStep === "persona"}`)
   and **`BindingLinkerModal`** (`:3792`, inside `{#if bindingLinkerData}`): wrap the component in
   `{#await import(...)}` → `{:then { default: X }}` **inside the existing gate**, so the script mounts at exactly the same
   moment as today (the persona picker's standing `characters:list` interest included). Drop the two static imports
   (`+page.svelte:40–51`). `{#await}` with no pending branch is fine here: the gate already governs mounting and the
   dialogs open on a later click, so nothing shows in the gap; if the picker can be *open* at gate time, keep a
   `<LoadingState />` pending branch.
3. **`CharacterSelectModal`** (`:3766`, mounted with no gate, `open={showCharacterPicker}`, no listeners or interests of
   its own — verify with grep): same pattern as the creator — the component stays mounted, its body
   (`:227–` the `<Dialog>` content) moves into `CharacterSelectBody.svelte` loaded inside the Dialog's content when `open`;
   or, if the component has no state worth keeping outside the body, gate the whole component on
   `{#if showCharacterPicker}` **only if** the lane confirms the close transition still plays (Skeleton `Dialog` with
   `open` false unmounts the content anyway — check `characterSelectModal.dom.test.svelte.ts` expectations). Say which
   you did and why in the report.
4. **Leave eager:** `LanguagePicker` (first control of the measured screen, `:2292`, `:2331`), `FileDropzone` (`:3385`,
   `:3562`), `connectionTypeIcon`, `managers`, `ConnectionTypes` (reach the first page through the connections context
   anyway — [C22]), everything else in `+page.svelte`.

## Files owned
`src/lib/client/components/modals/CharacterCreatorModal.svelte`, new `CharacterCreatorBody.svelte`,
`src/lib/client/components/modals/CharacterSelectModal.svelte`, new `CharacterSelectBody.svelte` (if used),
`src/routes/+page.svelte` (only the import lines `:40–51` and the mount sites `:3736–3800`), their tests:
`CharacterCreatorModal.ssr.test.ts`, `characterSelectModal.dom.test.svelte.ts`, `CharacterSelectModal.castMembers.dom.test.ts`,
`personaSelectModal.dom.test.svelte.ts`, `NOMENCLATURE.md` §25 (one row per new file).

## Files readable
`src/lib/client/components/modals/PersonaSelectModal.svelte`, `BindingLinkerModal.svelte` (read only — their scripts
do not change), `AvatarCropEditor.svelte`, `LoadingState.svelte`, `charactersSidebar.dom.test.svelte.ts` (it mounts the
select modal), the plan.

## Out of scope — written down, never built
`Layout.svelte`, `+layout.svelte`, pipelines modals, `hostElements/**`, auth screens, icons (lane perf-Q / ★s); a
generic lazy-mount helper; `connectionTypeIcon.ts` / `connectionServiceItems.ts`; `LanguagePicker`; any setting, event,
migration, SDK edit, `vite.config.ts` or build.

## Rules (quoted for workers)
- P1: the lazy import sits where the body renders; no module-scope prefetch, no cache.
- Sockets ruling: "one domain context per event family is the only listener" — no `socket.on`, `requestWithInterest` or
  store subscription changes its mount timing. If a change would, stop and report.
- Members never see model plumbing — not in play here; the wizard is the admin's. Nothing user-visible changes.
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
- Green: the four tests above plus `charactersSidebar.dom.test.svelte.ts`, `sceneRunSaidOnce.dom.test.ts`.
- `npx tsc --noEmit -p .` clean for the touched files.
- `grep -n "^\s*import .*modals/" src/routes/+page.svelte` shows only `CharacterCreatorModal` and `CharacterSelectModal`
  (whose bodies are lazy) — or, if the creator split was refused, says so with the prop count.

## Report path
`plans/REPORT-perf-R-2026-11-14.md` — changed files, which pattern each modal got and why, tests with results, open ★,
Noticed, not done.
