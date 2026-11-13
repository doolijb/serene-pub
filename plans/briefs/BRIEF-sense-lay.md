# BRIEF — lane `sense-lay` (wave 2) — variable layout truth fixes

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then what this lane triggers (named
below). Plan: `plans/PLAN-sensible-engine-2026-11-11.md` (Part 5 is what the owner's go covers). Evidence for each
item: `plans/REVIEW-sensibility-2026-11-11.md`, by row id.

Read down: `plans/HANDOVER-variable-layouts-2026-11-11.md` ("Rules that bit this build": opaque step handles,
`layoutRowUses` is the ONE rule for who uses a layout, look a row up by `(variable_id, reference)`),
`docs/context-templates.md` (Variable layouts), STYLE-GUIDE §6.11, §6.12, §6.17, NOMENCLATURE §1, §15, §24.
Variable layouts are unshipped (built after the last pre-release), so a type or payload of theirs may change freely.

## Goal — review rows A3, A4, A5 and the stale message in E

1. **A3 — the variable page says where the pub's choice is overridden.** `layoutInUse`
   (`src/lib/server/pipelines/config/variableLayoutsView.ts` about 226–252) is the pub-level answer only; the
   run's order (`config/world.ts` about 1229–1400) also has a name in a template, a leftover pick, a preset's
   choice and an author's per-step pick. Add to the variable's page one block, **Where this differs**, listing each
   thing that writes this variable with another layout than the one **In use**: the presets, the context templates
   that name a layout, the steps holding a leftover pick, and any step with an author's pick. Read through
   `layoutRowUses`; do not add a second rule. Empty when nothing differs (no heading). Correct the module header's
   claim that "the screen and the run cannot disagree".
2. **A4 — the leftover line's button says what it does.** In
   `src/lib/client/components/pipelines/StepVariableLayouts.svelte` (about 88–93) **Use the pub's** clears the
   leftover pick; what then applies may be the preset's choice. Relabel it **Remove this pick**. (This replaces
   wording from `plans/PLAN-variable-layouts-2026-11-10.md`; list it as changed copy.)
3. **A5 — the inspector names the real cause.** `config/world.ts` (about 1372–1397) records `reason: "default"`
   for four outcomes: the author's pick for that step, the package default, the automatic layout, and no layout at
   all. Give each its own reason value, and `REASON_LABEL` in
   `src/lib/client/components/pipelines/inspector/receiptView.ts` (about 962–968) its own words for each.
4. **The stale error.** `src/lib/server/pipelines/entities/variableLayouts.ts` (about 1205–1209) still says "Fix it
   in the pipeline's settings, or switch that setting back"; that setting no longer exists there. Say where the
   choice is made now.

## Files owned

- `src/lib/server/pipelines/config/variableLayoutsView.ts`, `config/world.ts` (the layout-reason code only),
  `src/lib/server/pipelines/entities/variableLayouts.ts` (that message only), `src/lib/server/sockets/pipelinesVariableLayouts.ts`.
- `src/lib/client/admin/sections/variable-layouts/`, `src/lib/client/components/pipelines/StepVariableLayouts.svelte`,
  `src/lib/client/components/pipelines/inspector/receiptView.ts`.
- The `LayoutReason` type where it is declared, and the variable-layout socket types.
- The tests beside those files. `docs/context-templates.md`, `docs/pipelines.md`: the sentences made untrue, and
  the resolution-order list if it disagrees with the code (say which order the code has).

## Out of scope

Removing any tier (plan lanes L-tiers, L-preset); leftover picks' mechanism; `sockets/pipelines.ts`,
`runtime/host.ts`, `sockets/sessions.ts`; migrations; the SDK repo unless `LayoutReason` is declared there, in
which case that one type only (then `npm run sdk:build` under the rule below).

## Stop and ask when

A new name beyond the reason values and the block's heading; a setting; a file outside **Files owned**. Every new
or changed sentence is provisional 🚧 copy: list them all.

## Done means

Tests that fail before and pass after: a variable whose pub layout is overridden by a preset, by a template name
and by a leftover pick lists all three; each of the four former "default" outcomes records its own reason; the
button reads the new label and still clears the pick. A step is addressed by its opaque handle in every socket test.

## Report

`plans/REPORT-sense-lay-2026-11-11.md`: changed files, tests and results, open ★, provisional copy, **Noticed, not done**.

**Return the full report as your final message** (the harness refuses a supervisor's write of a report file; the
lead saves it at the path above).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
