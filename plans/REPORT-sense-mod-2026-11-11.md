# REPORT — lane `sense-mod` — 2026-11-11

Written by the lead from the supervisor's final message.

## Built

**1. The server fills Reply when the first model arrives (A6).**
- NEW `src/lib/server/koboldcpp/fillReplyOnArrival.ts` (`fillReplyIfEmpty(db, filename)`): serialised on a promise
  chain; does nothing when Reply already has a model; otherwise finds the managed endpoint's row for the file, runs
  `starRefusal` for `text->text` (the Use buttons' own check), then `setCapabilityDefault`, sampling untouched.
- `src/lib/server/sockets/koboldcpp.ts`: on download success, after the model sync, the fill runs in its own
  try/catch when the download was not a speech request, not a queued projector, and the file's final kind is text.
  When it fills it pushes `systemSettings:get` before `connections:list`.
- `src/lib/client/components/connections/setupChatFlow.ts`, `SetupChatFlow.svelte`: `firstModelToRegister` and the
  auto-register effect are gone; `replyFilled`, `doneHeading`, `doneSentence(facts)` read server state only.
  `onChooseJobModel` stays in Props, marked ⏳ unused.
- Paths covered: a managed download finishing with the dialog open, closed or the tab gone; a managed download
  started from the Models finder (never covered before unless the dialog was open). **No longer automatic:** a model
  already present when the dialog opens with Reply empty (a hand-copied file, External mode's served models, Reply
  cleared on purpose) — the Done step says Reply is empty and points at **Use in Reply**. The old client effect
  handled the managed KoboldCpp text connection only.

**2. Managed KoboldCpp: the address follows the port (C5).** Mechanism chosen: **the column stays the only store and
every writer keeps it in step with the port**, because eight readers outside the lane read the column directly.
- `src/lib/server/koboldcpp/managedEndpoint.ts`: `managedBaseUrl(port)`.
- `sockets/koboldcpp.ts`: `koboldcpp:setBaseUrl` refuses in Managed mode; `setManagedMode("managed")`, set-port and
  binary install write the address from the port.
- `koboldcpp/subprocessManager.ts`: `prepare()` repairs a stale address before every spawn (so no boot pass).
- `koboldcpp/managedPreflight.ts`: re-reads `baseUrl` after a start (a start that changed the address used to load
  against the old one).
- `KoboldCppSettingsTab.svelte`: Managed card shows Server URL read-only; the mismatch warning is gone. External
  card untouched. No schema change.

**3. Why a model was unloaded (C4, narrowed).**
- `subprocessManager.ts` holds `coLoadReason`, exposes it through `getStatus()`, and every supervisor push carries
  it; cleared when the process goes. `modelManager.ts` notes the reason where it logs it.
- `src/lib/shared/sockets/types.ts`: `coLoadReason?: string | null` on the subprocess status response. No new event.
- `KoboldCppPerfTab.svelte`: the status card shows the sentence under "Loaded model".
- NEW `koboldcppManager/coLoadReading.ts` (`coLoadUnmeasured`): a line under the co-load checkbox when the machine
  gives no reading.

Docs: `docs/connections.md` (Set up chat step 3; the ways a loadout gets filled; the Server URL / Port bullet; the
co-load paragraph).

## Tests

Capped scope, `--maxWorkers=3`. Lane files: 13 files, 150 tests, all pass. Neighbouring files: 11 files, 158 tests,
all pass. svelte-check: 0 errors (needs `NODE_OPTIONS=--max-old-space-size=8192`). The download call-site gating
(speech, projector, kind) has no automated test. Fail-before was not run against the old code. `prettier --check`:
new files pass; older files still fail on lines that predate the lane, left alone.

## Open ★

1. Set up chat's Done step, with Reply empty and a model already present: add a **Use ‹model› in Reply** button that
   calls the existing `chooseJobModel`? Recommended: yes, one press, nothing automatic.

## Provisional copy 🚧

- Done step, Reply empty: "The Reply loadout is still empty. Open KoboldCPP and press Use in Reply on a model."
- Done heading, Reply empty: "KoboldCPP is ready" (stays "Chat is set up" when filled).
- `setBaseUrl` refused in Managed mode: "In Managed mode the address follows the port. Change the port instead."
- Managed Server URL hint: "Follows the port below."
- Under the co-load checkbox, no reading: "This machine gives no free graphics-memory reading, so the two models always swap."
- Server log: `[koboldcpp] Reply was empty; "<name>" now fills it`

## Queued for other owners

- **`src/routes/document-view/koboldcpp/+page.svelte`**: its "KoboldCPP Server URL" field shows in every mode; in
  Managed mode the server now refuses it. Hide or make read-only there. (Lane `sense-mod2`.)
- `src/lib/client/components/sidebars/ModelsSidebar.svelte`: stop passing `onChooseJobModel` to `SetupChatFlow`,
  then drop the ⏳ prop. (Lane `sense-mod2`.)
- NOMENCLATURE §25: `fillReplyIfEmpty`, `managedBaseUrl`, `noteCoLoadReason`, `coLoadReason`, `coLoadUnmeasured`.

## Noticed, not done

- The no-reading line uses `gpu.vendor === "nvidia"` as a stand-in for "nvidia-smi gives a reading", detected once per boot.
- The Managed Server URL is spelled `http://localhost:…` by hand in the settings tab: a second copy of `managedBaseUrl`.
- The managed process binds `127.0.0.1` while the stored address says `localhost` (predates the lane; matters where `localhost` resolves to `::1` first).
- The co-load reason is a module-level variable; a dev SSR reload resets it until the next decision.
