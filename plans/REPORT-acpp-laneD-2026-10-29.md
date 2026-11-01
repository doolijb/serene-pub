# REPORT — audio.cpp managed, Lane D (S7–S9) — DONE 2026-10-29 (saved by the lead from the hand-back)

Built, mounted, walked in private headless Chromium on an isolated instance (:5231) against lane B's real handlers (real binary download, real package list; varied package states injected). 19 files / 325 tests green; svelte-check 0 errors; tsc clean for D; docs build OK (155 pages). Instance + Chromium stopped with SIGTERM.

## Files
New `client/components/audiocppManager/{AudioCppBinaryVariantPicker,AudioCppSetupScreen,AudioCppProcessTab,AudioCppSettingsTab,AudioCppModelsTab}.svelte`, `audioCppSettingsFields.ts`, `audiocppPackages.ts` (+tests, 2 dom tests); `client/connectionForms/AudioCppManagedForm.svelte`; `shared/constants/modalityLabel.test.ts`. Edited: `managedConnectionView.ts` (third kind, stage `acpp-binary`, tabs Models · Process · Arriving · Settings), `ManagedConnectionView.svelte` (`!isKcpp` → `isOllama`), `downloads.svelte.ts` (fifth feed) + `DownloadsView.svelte`, `managers.ts`, `modelManagement.ts`, `finder.ts`, `addMenuItems.ts`, `AddMenu.svelte`, `ConnectionTypeForm.svelte`, `connectionTypeIcon.ts` (Cpu), `connectionRowStatus.ts`, `connectionIndexFilter.ts`, `ConnectionIndexView.svelte` (row Start/Stop generic), `liveStatus.svelte.ts`, `contexts/connections.svelte.ts`, both sidebars, `Layout.svelte` (`audioCppSettingsCtx`, toasts say "audio.cpp"), admin `IdPage.svelte` ("audio.cpp runtime" block), `connectionsAdmin.ts` (tts→Speech, asr→Transcription), `shared/utils/connectionDefaults.ts`, `ConnectionTypes.ts` `modalityLabel`, `server/connections/discoverLocal.ts` (+test) + `sockets/connections.ts` exclusion, `routes/+page.svelte` (wizard never offers audio.cpp as chat). Docs: `connections.md`, `environment-variables.md`, `sessions.md`. Canon: NOMENCLATURE §10 rows **audio.cpp, run by Serene Pub** · **audio.cpp package** · **audio family** · **audio list** · **audio families list**; updated downloads tray (five feeds), managed connection view, local discovery, run-by row, service chip, modality (+ `asr`); §25 row. STYLE-GUIDE :985.

## B/C notes applied
One click: binary success → `updateSettings {enabled:true}` → re-ask settings/install/status. *Restarting to apply* when `configApplied` false and status running/starting/stopping. Reconnect re-lists. Unknown family → **Confirm family**. `AUDIOCPP_BINARY_DIR` documented. `asr` labels. Cold state needs no client change (pinned).

## Screenshots
`/tmp/claude-1000/-home-jody-github-serene-pub/564efcec-663a-419e-8efc-7e445249445f/scratchpad/ld/shots/` 02-add-menu, 03-setup-screen, 05-after-binary, 06-index-row, 10/11-process, 12/13-settings, 15-models-real-v2, 16/17-models-fake, 18-admin-runtime.

## Items for V (D1–D5)
1. Start with zero enabled models always Crashed (audio.cpp refuses an empty `models` array) — **fixed by the lead 10-29**: the supervisor gate refuses with "audio.cpp has no model to serve yet. Enable a speech or transcription package on its Models tab first." V: confirm no auto-start fires with zero models.
2. Not walked: real package download → enable → Process running with loaded models/devices; Arriving tray with real pushes; picker remount mid-download.
3. `audio->text` reads as text-gen in `modalityOfTransform` (maps by output side): `+page.svelte modelKnownFor` doesn't auto-register an `asr` row; `jobPicker.modalityRulesOut` miscounts. Proposed fix: set-based checks in those two readers (not an `audio->text`→`asr` special case).
4. Discovery exclusion compares the managed row's port, not `sameHost`; untested (needs DB); the row's `baseUrl` must stay on the settings port.
5. Remaining two-kind assumptions: `useReadiness` / `JobPickerDialog` start verbs KoboldCPP-only; `clearFinished` has no audio.cpp event; first-run doors' copy names only KoboldCPP and Ollama.

## ★ owner
- ★D1 glyph: `Cpu` per §22's managed-runtime rule (alternative `AudioLines`, the tts glyph) — rule and record in §22.
- ★D2 no Get tab: the model finder has no speech scope; packages come only from the Models tab. Add a speech scope later?
- ★D3 start with nothing enabled: lead chose refuse-with-reason (not `ui_management` on). Confirm.
- ★D4 add-menu blurb "Install and manage a local speech runtime" (mirrors KoboldCPP's); "manage" in the blurb only.
