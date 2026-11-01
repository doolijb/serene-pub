# Lane D — audio.cpp managed: client, wizard, docs (S7–S9)

Read `ACPP-COMMON.md`, the plan §2 D10, §3 S7–S9, `ACPP-SEAM-MAP.md` §4, §6, lane A's hand-back
(the `Sockets.AudioCpp` contract is what you code against; lane B's handlers land in parallel — stub
responses in dev with the fake pattern used by `koboldcppManager` tests if you need to). Read
STYLE-GUIDE §2, §6.16 and NOMENCLATURE §1, §24, the §10 Speech table and the rows the seam map names
(:691–:697, :2638) before naming anything. Owner rule: no pixel-perfect styling; screenshots + "looks decent".

## S7 Managed view + everywhere the third kind goes
- `ManagedKind | ManagerKind | ModelManager.panel | DestinationKind | AddMenuItemKey | EndpointKind | DownloadSource` (both) gain `"audiocpp"` / `"audiocpp-binary"`; `managedLabel`, `managerPlan` (→ the `AUDIOCPP_MANAGED` row), `enableManager`, `openManager` in both sidebars, `jobPicker` icon, `finder.ts` destination (*audio.cpp, run by Serene Pub*), `downloads.svelte.ts` fifth feed with interest on `audiocpp:packageDownloadProgress|binaryDownloadProgress`.
- `client/components/audiocppManager/`: `AudioCppBinaryVariantPicker.svelte` (variants with backend, size, portable, the `reason` line, cudart note on Windows CUDA), `AudioCppSetupScreen.svelte` (stage `acpp-binary`), `AudioCppModelsTab.svelte` (groups **Speech** / **Transcription**, then family; rows: name, variant, size, VRAM hint or *CPU-fine*, licence chip, `confidence` chip for matched/guessed with **Confirm family** for guessed, state + action: Get / Arriving / Enable / Disable / Remove; the recommended row first with its `reason`), `AudioCppProcessTab.svelte` (status dot per the one state scale, version · backend from `/health`, loaded ids with device, Restart / Stop, *Restarting to apply* line, unverified-binary line when set), `AudioCppSettingsTab.svelte` (port, models dir, idle unload, max loaded, subprocess timeout; **Runs on** line pointing at Admin › Hardware per ★A9 — plain text for now), `managedConnectionView.ts` third kind with stages `acpp-binary → tabs` and the three helper lines; `ManagedConnectionView.svelte` mounts them. `connectionForms/AudioCppManagedForm.svelte` + `ConnectionTypeForm.svelte` route. `audioCppSettingsCtx` set in `Layout.svelte` beside `koboldCppSettingsCtx`, fed by `audiocpp:getSettings` with interest. Admin `connections/IdPage.svelte`: embed `AudioCppSettingsTab` as the "audio.cpp runtime" block the way :742-750 does for KoboldCPP (additive).
- Add menu item **audio.cpp, run by Serene Pub** under the managed group with KoboldCPP's.
- Members see none of it (admin gates as KoboldCPP's).

## S8 Wizard / discovery
- `server/connections/discoverLocal.ts` `LOCAL_CANDIDATES`: audio.cpp at :8080 and :5002 (probe `GET /health` expecting `status`), excluded when the managed row addresses that host (mirror `sockets/connections.ts:~2395-2425`). Set up chat flow unchanged.

## S9 Docs + canon
- `docs/connections.md`: new "## audio.cpp, run by Serene Pub" mirroring the KoboldCPP section's subsections (what it is, first start, the binary and backends incl. the Windows CUDA runtime, Models tab, enabling and what restarts, Process, Settings, where files live: `models/audio/<task>/<family>/…`, removing); update the Speech section (:196-224) and the choosing table (:267); add menu (:88). `docs/environment-variables.md`: `AUDIOCPP_BINARY_DIR`. `docs/sessions.md` Read aloud: one line that audio.cpp run by Serene Pub is the no-GPU-build route.
- NOMENCLATURE §10 Speech table rows: **audio.cpp, run by Serene Pub**; **package** (audio.cpp) — always qualified *audio.cpp package*; **spec family** → prefer **audio family** (the families file's id); **audio list** (`audio.yaml`) and **audio families list**; check §23 before each. §25 ledger entry. STYLE-GUIDE: the teal managed chip note (:985) gains the second runtime.

## Tests (only these files)
`managedConnectionView.test.ts` additions (stages/lines for audiocpp), `addMenuItems`/`managers` unit tests, `discoverLocal.test.ts` (candidate + exclusion), a `.dom.test.svelte.ts` for `AudioCppModelsTab` (grouping, recommended first, guessed → Confirm family). Docs compile: `npm run docs:build` if that script exists, else the docs test file lane V names.

Hand back: paths, screenshots (private headless Chromium on an isolated instance; the walk is: add menu → setup screen → Models tab with a fake `listPackages` → Process tab), test results, docs/canon rows added, ★.
