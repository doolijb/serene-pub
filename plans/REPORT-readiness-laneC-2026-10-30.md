# REPORT — readiness lane C (Connections: B2(a), B3) — 2026-10-30

Saved by the lead from the supervisor's hand-back (the harness refused the subagent's own write).

## B2(a) — a free first reply without a graphics card (OpenRouter free models)
**Facts checked 2026-10-30:** documented endpoint `GET https://openrouter.ai/api/v1/key` (`/auth/key` tried
only on a 404); reply carries `data.is_free_tier` and `data.free_model_daily_requests.{used,limit,remaining}`;
free models end in `:free` and are priced "0" (`openrouter/free` is priced 0 without the suffix); 20 req/min;
50/day under 10 credits purchased, 1,000/day at 10 or more; live list 16 free of 456.

**Built**
- NEW `src/lib/server/connections/openRouterKey.ts`: stores `connections.extra_json.openrouter = { freeTier,
  freeRequestsPerDay?, checkedAt }` (server-owned like `extra_json.comfy`; no migration). Key sent only to the
  fixed openrouter.ai addresses, 5 s timeout, never throws; a failed read keeps the stored answer; a missing key
  removes it. Exports `isOpenRouterConnection`, `isFreeModel`, `freeModelsFirst` (stable split).
- Read on a passing Test of a saved connection (`sockets/connections.ts`) and in `modelSync.ts`
  `syncConnectionModelsById` after a clean listing (save forces a sync).
- `sockets/connections.ts`: create strips a client-sent `openrouter`; update keeps it and drops it when the key
  changed; `modelsSyncView` adds `freeTier: true`; `buildConnectionsList` and `connectionModelsView` order free
  first on a free-tier key (`chatDefaultFirst` still wins). Type `Sockets.Connections.ModelsSync.freeTier?`.
- Status card (`connectionViewChrome.ts` `nextStep` step 4): *This key has no credit yet, so paid models would be
  refused: pick a free one under **Models**, listed first, and press **Use in Reply**.*
- Wizard `serviceRoadChecklist.ts` Key saved line: OpenRouter, no key yet: *Paste your API key, then press Save; a
  key with no credit still gets free models, about 50 replies a day.*; saved and free-tier: *No credit yet: free
  models only, about 50 replies a day*. Other services unchanged.

## B3 — answer the hardware questions
- NEW `src/lib/shared/connections/machineHardware.ts`: `MachineHardware { gpu.{vendor: nvidia|amd|apple|null,
  name, memoryGb}, systemMemoryGb, platform, arch, detectedAt }`.
- NEW `src/lib/server/connections/hardware.ts`: `parseNvidiaSmi` (largest card wins), `parseRocmSmi` (skips
  WARNING lines), `parseAmdSysfs` (Linux `/sys/class/drm`, ignores <2 GiB). Probe order: Apple silicon
  (`os.totalmem`) → `nvidia-smi` → Linux `rocm-smi` → sysfs → nothing. `execFile`, 5 s timeout, never throws;
  `machineHardware()` caches the promise (once per process, on first request). AMD on Windows without a tool: not found.
- Event `models:machineHardware` (admin-only, gated) in `sockets/modelPresence.ts`; replies `{hardware|null,
  error?}` on the same event. Wired in `types.ts`, `typedSocket.ts`, `interest.ts`, `gatedEvents.test.ts`.
- NEW `client/components/connections/hardwarePicks.ts` (pure): usable memory = card memory; Apple two-thirds of
  system; no card half. NVIDIA → full build; AMD → ROCm if offered else `-nocuda`; Apple → `mac-arm64`; no card →
  `-nocuda`; wrong-arch builds dropped; `-oldpc` never proposed.
- NEW `useMachineHardware.svelte.ts` (the one asker). `memoryTier.ts` gains `readStoredMemoryTier()`.
- Finder: with no stored tier the detected tier is proposed with its reason under the tier line and in the popover;
  a pick is stored and wins; detection never writes storage. Build picker
  (`koboldcppManager/KoboldCppBinaryVariantPicker.svelte`): preselects when nothing is selected; reason in the
  Selected box while the selection is still the suggestion. Nothing detected → today's views exactly.
- `server/koboldcpp/binaryManager.ts` `makeDescription` fixed (+`binaryManager.description.test.ts`): full build
  *NVIDIA graphics cards (CUDA 12); also works with other cards or none*; `-nocuda` *Other graphics cards (Vulkan)
  or no graphics card; smaller download*; `-oldpc` *Older computers and older NVIDIA cards (CUDA 11)*.
- Copy: tier *Picked because this computer has an NVIDIA card with 12 GB.* / *…an AMD card with 16 GB.* /
  *Picked because this Mac has 32 GB of memory, and models get about two-thirds.* / *Picked because no graphics
  card was found; this computer has 16 GB, and models get about half.*; build *Picked because this computer has an
  NVIDIA card.* / *…an AMD card.* / *Picked because this is a Mac with Apple silicon.* / *Picked because no graphics
  card was found; this build works on any computer.* Sizes snap to common sizes within 8%.

## Files outside the listed paths
`KoboldCppBinaryVariantPicker.svelte`; `server/koboldcpp/binaryManager.ts` (`makeDescription`) + new test;
one entry each in `typedSocket.ts`, `interest.ts`, `gatedEvents.test.ts`.

## Verified
9 touched test files, 134 tests pass (`openRouterKey`, `openRouterKey.int`, `connectionViewChrome`,
`serviceRoadChecklist`, `hardware`, `modelPresence.machineHardware`, `gatedEvents`, `hardwarePicks`, `memoryTier`);
`binaryManager.description` + `allowedHost` 8 pass; workers' neighbouring int/render tests pass (45 + 5 files).
tsc filtered to lane files clean (unfiltered: 10 errors, none in lane C). svelte-check needed for
`ModelFinderView`, `KoboldCppBinaryVariantPicker`, `useMachineHardware`. Prettier clean on new files.

## New terms (§10 rows, §25 ledger)
🚧 **machine hardware** (`MachineHardware`, `models:machineHardware`; the pub's machine, not the viewing device;
not the memory tier) · 🚧 **detected memory tier / detected build** (a proposal with a reason; the memory tier
row should say detection proposes, the person's answer wins) · 🚧 **free tier** of an OpenRouter key
(`ModelsSync.freeTier`, `OpenRouterKeyFacts`, `extra_json.openrouter`; not a gate, not a quota meter) ·
**free model** (`isFreeModel`: `:free` id or priced 0 both ways).

## Docs hand-off (`docs/connect-a-model.md`, `docs/connections.md`)
Hosted row + step 1: credit optional; a key with no credit gets free models, ~50 replies/day (1,000 after a
one-time 10 credits). Step 5: free models listed first on Models; the status card sentence above; the wizard's
Key saved line. Local step 2: build preselected (NVIDIA → full; AMD or none → `-nocuda`; Apple silicon →
`mac-arm64`), Selected box says why, click another to change. Local step 3: if never answered, the tier is
proposed with the reason under "‹tier› tier · Change"; Mac counts ~two-thirds, no card ~half; own pick kept;
nothing detected → question as before.

## Open
"This computer" means the pub's machine (a phone viewer may misread). "About 50 replies a day" assumes one
request per reply. A paid model already set as Reply is not flagged on a free-tier key (402 at reply time).
Test passes with a wrong OpenRouter key because `/models` is public. AMD on Windows not detected.
