# BRIEF — lane `sense-mod` (wave 1) — model set-up truth fixes

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then what this lane triggers: CLAUDE.md
Hard rules and Standing rulings ("Members never see or touch model plumbing"), `docs/connect-a-model.md`, the managed
KoboldCpp sections of `docs/connections.md` (grep headings; it is 140 KB), STYLE-GUIDE (the sections for a status
card and for settings forms, before you add or change any UI), NOMENCLATURE §1 and §24.

Plan: `plans/PLAN-sensible-engine-2026-11-11.md` (Part 5 is what the owner's go covers). Evidence:
`plans/REVIEW-sensibility-2026-11-11.md`, rows A6, C5, C4. **Re-read the cited lines before changing anything.**

## Goal

1. **The server fills Reply when the first model arrives (review A6).** Today the first downloaded model becomes
   the Reply model from a client effect in `src/lib/client/components/connections/SetupChatFlow.svelte` (about
   193–200, `firstModelToRegister` in `setupChatFlow.ts`) that returns early when the dialog is closed. Close the
   dialog or the tab during a download and the model arrives with Reply empty.
   - Move the write to the server: when a text model's download completes and the text transform has **no** default
     pair, the server sets it (`setCapabilityDefault` in `src/lib/server/connections/capabilityDefaults.ts`; the
     image default at `src/lib/server/sockets/koboldcpp.ts` about 733 and `pairProjectorOntoModel` are the patterns
     to follow). Never overwrite a pair somebody chose.
   - One writer (P2): the client effect stops writing. The dialog shows its done sentence from server state.
   - Cover every path the client effect covered (read `firstModelToRegister` and its facts: managed KoboldCpp
     download at least; say in the report which other providers it handled and what you did for each).
   - P1: the automatic fill is visible where the model lands (the existing done sentence, or the Loadouts row);
     list any new sentence as provisional 🚧 copy.
2. **Managed KoboldCpp: the address follows the port (review C5).** In Managed mode the process listens on
   `koboldcpp_managed_port` while health checks and generation use `koboldcpp_base_url`; both are editable and the
   UI carries a warning for when they disagree (`src/lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte`
   about 132–150 and 745–830; `src/lib/server/sockets/koboldcpp.ts` about 100–120 and 1935–1955;
   `src/lib/server/koboldcpp/managedPreflight.ts` about 229). In **Managed** mode: the Server URL is not an
   editable fact; it is computed from the port, shown read-only, and the mismatch warning goes. **External mode is
   untouched** (owner, 2026-11-11: "5. keep"): its URL field stays as it is.
   - Decide the mechanism yourself (derive on read through one accessor, or keep writing the column from the port)
     and name the choice in your report. No schema change.
3. **Say why a model was unloaded (review C4, narrowed).** `decideCoLoad` (`src/lib/server/koboldcpp/coLoad.ts`)
   returns a reason sentence that today goes to `console.log` only (`src/lib/server/koboldcpp/modelManager.ts`
   about 1031). Show the last decision's sentence on the managed status card, through the existing status push.
   The **Keep both models loaded** checkbox stays exactly as built (owner, 2026-11-11: "manageable via the admin");
   where the machine gives no free-memory reading, one line under it says so, since the switch cannot take effect.

## Files owned (the only files this lane may edit)

- `src/lib/client/components/connections/SetupChatFlow.svelte`, `setupChatFlow.ts` and their tests.
- `src/lib/client/components/koboldcppManager/` (settings tab, status card) and their tests.
- `src/lib/server/sockets/koboldcpp.ts`, `src/lib/server/koboldcpp/` (`managedPreflight.ts`, `modelManager.ts`,
  `coLoad.ts`, settings readers) and their tests.
- `src/lib/server/connections/capabilityDefaults.ts` only if a small helper is needed for "fill if empty"; its tests.
- The socket type entries these changes need in `src/lib/shared/sockets/types.ts` and
  `src/lib/client/sockets/typedSocket.ts`, limited to the `koboldcpp:*` family.
- `docs/connect-a-model.md`, `docs/connections.md`, `docs/getting-started.md` — only the sentences made untrue.

## Out of scope — written down, never built

`db/schema.ts` and any migration; the loadouts module and the default star (plan lane M-defaults); External mode's
behaviour; the co-load decision itself; the wizard's steps; `sockets/sessions.ts`, `runtime/host.ts`; the SDK repo.

## Stop and ask (through your report) when

CLAUDE.md §Decisions applies: a new name, setting, flag, event, table or migration; a file outside **Files owned**;
a review claim that turns out false. A new socket event is a new name: prefer extending an existing `koboldcpp:*`
payload. Sockets rule: one domain context per event family is the only listener and the only place that toasts;
views never call `toaster`.

## Done means

Tests that fail before and pass after: a completed text-model download with no text default sets the default, and
with a default already set leaves it; in Managed mode the address used by the health check follows a changed port;
the status payload carries the co-load reason. Run only those targeted test files, in a capped scope:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Heavy DOM tests run
in the same capped scope. `npx prettier --check <file>` on each file you changed. Do not start a dev server or a
managed KoboldCpp process.

## Report

`plans/REPORT-sense-mod-2026-11-11.md`: changed files, tests run with results, the mechanism you chose for item 2,
which first-model paths item 1 covers, open ★, provisional copy, **Noticed, not done**.

**Return the full report as your final message** (the harness refuses a supervisor's write of a report file; the
lead saves it at the path above).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` in either repo. Never `kill -9` a dev
  server. `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`.
  Browser code runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
