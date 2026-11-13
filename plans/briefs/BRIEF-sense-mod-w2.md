# BRIEF — worker `sense-mod-w2` — Managed KoboldCPP: the address follows the port; say why a model was unloaded

Supervisor: lane `sense-mod`. Repo: `/home/jody/github/serene-pub` (always absolute paths).
This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

**A. The address follows the port (review C5).** In Managed mode the process listens on `koboldcpp_managed_port`, while
the preflight health check, generation and every adapter use the column `koboldcpp_manager_base_url`. Both are editable
today and the settings tab warns when they disagree. In **Managed** mode the Server URL stops being an editable fact: it
is made from the port, shown read-only, and the mismatch warning goes. **External mode is untouched** (owner,
2026-11-11: "5. keep") — its URL field and behaviour stay exactly as they are.

**B. Say why a model was unloaded (review C4, narrowed).** `decideCoLoad` (`src/lib/server/koboldcpp/coLoad.ts`) returns a
reason sentence that today only reaches `console.log` (`modelManager.ts`, `if (coLoad) console.log(...)` about line 1031).
Show the last decision's sentence on the managed status card (`KoboldCppPerfTab.svelte`, the subprocess status card)
through the existing `koboldcpp:subprocessStatus` push. The **Keep the text and the image model loaded together**
checkbox stays exactly as built; where the machine gives no free-memory reading, one line under it says so.

## Files owned (edit only these)

- `src/lib/server/sockets/koboldcpp.ts` — **only**: `koboldCppSetBaseUrl` (~line 95), `koboldCppSetManagedMode`
  (~1895), `koboldCppSetManagedPort` (~1935), the base-URL write after a binary install (~2190–2203),
  `koboldCppGetSubprocessStatus` (~2329) if needed, and the admin emitter registration at the end of the file. Another
  worker edits the model-download handler (~1700–1760) at the same time: use Edit (never Write), never reformat the
  file, and if an Edit fails because the file changed, re-read that region and retry.
- `src/lib/server/koboldcpp/managedEndpoint.ts`, `subprocessManager.ts`, `managedPreflight.ts`, `modelManager.ts`
  (only the co-load log site and, if needed, the place residency is forgotten).
- Tests of those: `src/lib/server/connectionAdapters/managedPreflight.test.ts`, `src/lib/server/koboldcpp/subprocessManager.test.ts`,
  `src/lib/server/koboldcpp/subprocessManager.emitterFanout.test.ts`, `src/lib/server/koboldcpp/modelManager.test.ts`,
  and either an added case in `src/lib/server/sockets/koboldcpp.settingsScoping.int.test.ts` or a NEW
  `src/lib/server/sockets/koboldcpp.managedAddress.int.test.ts`.
- `src/lib/client/components/koboldcppManager/KoboldCppSettingsTab.svelte`, `KoboldCppPerfTab.svelte`, NEW
  `src/lib/client/components/koboldcppManager/coLoadReading.ts` and NEW `coLoadReading.test.ts`.
- `src/lib/shared/sockets/types.ts` — only `Sockets.KoboldCPP.SubprocessStatus.Response`. `src/lib/client/sockets/typedSocket.ts`
  — only the `koboldcpp:subprocessStatus` / `koboldcpp:getSubprocessStatus` entries, and only if they need it.
- `docs/connections.md` — **only** the managed KoboldCPP settings sentences at about lines 560–590 (Server URL / Port
  bullet ~563, the co-load paragraph ~586; line ~582 only if made untrue). Another worker edits the §Set up chat section
  (~61–73) at the same time: Edit only, re-read on failure.

Everything else is read-only. Never edit `src/lib/server/managed/supervisor.ts`, `managed/emitters.ts`, any adapter,
`pipelines/runtime/*`, `ManagedConnectionView.svelte`, `routes/document-view/**`, `db/schema.ts`.

## Design (prescribed — ask in your report if a piece cannot work; do not change the shape)

### A. Mechanism: keep writing the column from the port (no schema change, no boot pass)

Eight readers outside this lane (adapters, `dispatchImage`, `embedding/target`, `runTokenCounter`, `strokeTokens`) read
the column, so the column stays the one store and is kept in step with the port by every writer:

1. `managedEndpoint.ts`: export `managedBaseUrl(port: number | null | undefined): string` → `http://localhost:${port ?? 5001}`,
   with a comment saying it is the one spelling of the Managed address. Replace the two existing hand-written
   `` `http://localhost:${port}` `` writes in `sockets/koboldcpp.ts` (set-port handler, binary install) with it.
2. `koboldCppSetManagedMode`: when `params.mode === "managed"`, also write `koboldCppManagerBaseUrl: managedBaseUrl(port)`
   in the same update. External and null modes write nothing new.
3. `koboldCppSetBaseUrl`: when the stored mode is `"managed"`, refuse exactly like the existing bad-protocol branch
   (emit `koboldcpp:setBaseUrl:error` with the error, then throw) with 🚧
   `"In Managed mode the address follows the port. Change the port instead."` External mode unchanged.
4. `subprocessManager.ts` `prepare()` (runs before every spawn): if the stored column differs from `managedBaseUrl(port)`,
   write it. This repairs a row edited before this change at the moment the process gets its port. Comment why.
5. `managedPreflight.ts` `attemptLoad`: `baseUrl` is read once before a start and never refreshed, so a start that
   realigned the column still loads against the old address. Make it `let` and re-read it from the settings read after
   the start (`settings = await readSettings()` is already there).

### A. UI: `KoboldCppSettingsTab.svelte`, the Managed card only

- Server URL: replace the input + Save with a read-only line: the `Server URL` label (keep it a noun label; use a plain
  element, not a form control, and keep `aria-describedby` meaningful or drop it) and the value
  `http://localhost:{saved port ?? 5001}` (the saved port from settings, not the unsaved draft). Hint 🚧 `"Follows the port below."`
- Delete `portMismatch`, its comment block, and the warning box under Port.
- Leave `baseUrlField`/`saveBaseUrl` alone if the External card still uses them; delete only what becomes dead.
- Do not touch the External card.

### B. The co-load reason through the status push

1. `types.ts`: add `coLoadReason?: string | null` to `Sockets.KoboldCPP.SubprocessStatus.Response`, documented as "the last
   co-load decision's sentence (`decideCoLoad`), null until one is made or after the process goes". Optional, so the
   audio.cpp status and existing mocks still type-check.
2. `subprocessManager.ts` holds the sentence and pushes it (the supervisor is shared with audio.cpp and is not ours):
   - module state `let coLoadReason: string | null = null`;
   - `export function getStatus()` → `{ ...supervisor.getStatus(), coLoadReason }` (replacing the bare re-export);
   - `registerEmitter(userId, fn)` registers `fn` with the supervisor wrapped so every supervisor push carries
     `coLoadReason`, AND registers `fn` in a lane-local `createUserEmitters` registry (from `$lib/server/managed/emitters`,
     backed by a map on `globalThis` under a new key so it survives Vite SSR HMR like the supervisor's);
     `unregisterEmitter` unregisters from both;
   - `export function noteCoLoadReason(reason: string)` sets the state and emits `getStatus()` through the local registry;
   - clear it (`null`) in `onProcessGone` beside `forgetResidency()`.
3. `modelManager.ts`: where it logs the co-load reason, keep the log and also call `noteCoLoadReason(coLoad.reason)` via a
   **dynamic** `await import("./subprocessManager")` (subprocessManager imports modelManager statically; a static import
   back would be a module-init cycle). Best-effort: a failure to push never fails a load.
4. `KoboldCppPerfTab.svelte`: in the subprocess status card, under the Loaded model block, when `subStatus?.coLoadReason`
   is set, one muted line `text-surface-600-400 text-xs` with the sentence. No label, no toast, no new listener (the card
   already listens to `koboldcpp:subprocessStatus` and `koboldcpp:getSubprocessStatus`; check both handlers keep the field).

### B. The no-reading line under the checkbox

- `coLoadReading.ts`: export `coLoadUnmeasured(hw: MachineHardware | null | undefined): boolean` → `hw !== undefined && hw?.gpu.vendor !== "nvidia"`
  (`MachineHardware` from `$lib/shared/connections/machineHardware`). Comment: free graphics memory is read with
  `nvidia-smi` only (`freeGpuMemoryGib`, `connections/hardware.ts`); `gpu.vendor === "nvidia"` means nvidia-smi answered
  at boot; undefined = not answered yet, so say nothing.
- `KoboldCppSettingsTab.svelte`: call `useMachineHardware()` (from `$lib/client/components/connections/useMachineHardware.svelte`)
  during component init; under the checkbox's purpose text, when `coLoadUnmeasured(hardware.current)`, one muted line
  (`text-surface-700-300 block text-xs`, matching the purpose text) with 🚧
  `"This machine gives no free graphics-memory reading, so the two models always swap."`
  The checkbox itself, its label and its purpose sentence do not change.

### Docs: `docs/connections.md` (managed settings only)

- The Server URL / Port bullet (~563): Port is where KoboldCPP listens (changing it needs a restart); Server URL shows the
  address Serene Pub reaches it at, made from the port, and cannot be edited in Managed mode. Drop the "if the two
  disagree" warning sentence.
- The co-load paragraph (~586): the decision and its figures are shown on the status card under **Details** (as well as
  in the server log); on a machine with no reading a line under the checkbox says so. Keep the rest.
- Line ~582 only if untrue. User-facing words: "pub", never "instance/server" (the "Server URL" label is the UI's name).

## Rules you work under (quoted from CLAUDE.md and the lane brief)

- "P1 Deterministic, never hidden. … every automatic action shows its cause and how to undo or switch it off."
- "P3 Few settings … A setting must answer who changes this, why, and what breaks without it." — no new setting.
- "External mode is untouched (owner, 2026-11-11: '5. keep')." "The Keep both models loaded checkbox stays exactly as built
  (owner, 2026-11-11: 'manageable via the admin')." "The co-load decision itself" is out of scope: do not change `decideCoLoad`.
- "A new socket event is a new name: prefer extending an existing `koboldcpp:*` payload." — no new event.
- "Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register
  listeners for local state and never call `toaster`." — add no toast, no new listener.
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Inside `db.transaction(async (tx) => …)` use only `tx`." "Never add a top-level `await` to `src/lib/server/db/index.ts`."
- "Browser code runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE §10: "Labels are nouns, hints are sentences … Help is one sentence." Sentence case everywhere.
- No `db/schema.ts` change, no migration, no boot pass, no new setting or flag.
- "Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need `sdk:build`.)
- Never `prettier --write` on a directory or on a file that already failed `--check` before you touched it (at baseline
  `sockets/koboldcpp.ts`, `subprocessManager.ts`, `modelManager.ts`, `managedPreflight.ts`, `KoboldCppSettingsTab.svelte`,
  `KoboldCppPerfTab.svelte`, `types.ts`, `typedSocket.ts` already fail — leave their formatting alone). New files must pass
  `npx prettier --check`; `managedEndpoint.ts` passes today and must still pass.
- Never `git checkout` / `restore`. Never `kill -9` anything. Do not start a dev server or a KoboldCPP process.

## Tests (must fail before your change and pass after, where the behaviour is new)

- **Address follows the port:** in `managedPreflight.test.ts`, Managed mode with the process not running, where the mocked
  `start()` changes the stored base URL (as `prepare()` now does after a port change): `ensureModelLoaded` receives the NEW
  address. Plus `subprocessManager.test.ts`: `prepare()` with a stale column and port 5002 writes `http://localhost:5002`.
  Plus a handler int test (real PGlite, pattern in `koboldcpp.settingsScoping.int.test.ts`): `setManagedPort(5002)` then
  the stored address is `http://localhost:5002`; `setBaseUrl` in Managed mode is refused and the column is unchanged;
  `setBaseUrl` in External mode still writes; `setManagedMode("managed")` writes the address from the port.
- **The status payload carries the co-load reason:** `subprocessManager` test (see `subprocessManager.emitterFanout.test.ts`):
  after `noteCoLoadReason("…")`, `getStatus().coLoadReason` is the sentence and a registered emitter receives a payload
  carrying it; a supervisor push also carries it; after the process goes it is null. If cheap, a `modelManager.test.ts`
  case that a co-load decision calls `noteCoLoadReason`.
- `coLoadReading.test.ts`: nvidia → false; amd / apple / vendor null / `null` hardware → true; `undefined` → false.

Any `it` that opens a DB needs a 60 s timeout. Run only these, in a capped scope (never pipe vitest into `head`):

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <files>"`

Also run `npx prettier --check` on each file you created or changed and report the result per file.

## Report

Reply with: files changed (absolute paths), tests run with pass/fail counts, the exact new copy strings, anything you
could not do or changed from the design and why, and **Noticed, not done**.
