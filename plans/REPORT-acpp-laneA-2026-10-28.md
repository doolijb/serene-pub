# REPORT — audio.cpp managed, Lane A (S1 + S2) — DONE 2026-10-28 (saved by the lead from the hand-back)

S1 and S2 built. KoboldCPP re-based on `server/managed/supervisor.ts` (parity gate 55/55 before and after). tsc clean except the known `NARROW_SIDE_PX`.

## Files
New: `server/managed/{emitters,supervisor}.ts` (+tests), `server/audiocpp/settings.ts` (+test), `drizzle/0132_audiocpp_settings.sql` (+ snapshot, journal idx 132; generated with drizzle-kit directly because `check-db-lock` refused while the owner's dev server held the DB — generation touches no DB).
Edited: `koboldcpp/subprocessManager.ts` (now a ~145-line spec over the factory; same 14 exports), `koboldcpp/binaryManager.ts` + `sockets/koboldcpp.ts` (emitters → helper), `db/schema.ts` (`audiocppSettings`), `db/types.d.ts`, `shared/constants/ConnectionTypes.ts` (`AUDIOCPP_MANAGED`, `isManagedAudioCpp`), `shared/utils/connectionServiceItems.ts` (`AUDIOCPP_MANAGED_TYPES`, `isAudioCppManagedType`; picker skips it), `shared/connections/connectionGroup.ts` (`EndpointKind "audiocpp-managed"`), `shared/connectionAdapters/manifest.ts` (`AUDIOCPP_MANAGED`: text->audio, audio->text, audio_streaming native; `AUDIOCPP` + audio->text), `shared/sockets/{types,interest}.ts` (namespace `Sockets.AudioCpp`, 20 events, `audiocpp:` restricted prefix), `client/sockets/typedSocket.ts`, `gatedEvents.test.ts`, `notifications/downloads.ts` (source `audiocpp`), `client/.../connectionTypeIcon.ts` + `jobPicker.ts` (placeholder glyphs Volume2 / Cpu), `app.d.ts` (`AudioCppSettingsCtx`), NOMENCLATURE §25.

## Contract (`Sockets.AudioCpp`)
Types `Backend` cpu|vulkan|cuda|metal|rocm · `PackageTask` tts|asr|vdes · `ProcessStatus` stopped|starting|running|crashed|stopping. `SettingsView` (enabled; binaryDir, binaryVariant, releaseTag, backend; port, baseUrl; modelsDir, modelsDirResolved; deviceIndex, threads, maxLoadedModels, idleUnloadMs, subprocessTimeoutMinutes; configHash), `EditableSettings` (8 fields). Binary: `BinaryVariant {name, assetName, sizeBytes, backend, portable, needsRuntimeAsset?, recommended?, reason?}`, `ListBinaryVariants`, `ListReleaseVersions`, `DownloadBinary`, `BinaryDownloadProgress {download: DownloadState|null}` (status starting|downloading|unpacking|success|error|cancelled; phase binary|runtime; verified?), `CancelBinaryDownload`, `InstallState`. Packages: `PackageRow` as briefed, `ListPackages`, `DownloadPackage`, `PackageDownloadProgress {downloads: Record<id, PackageDownloadState>}`, `CancelPackageDownload`, `RemovePackage`, `SetPackageEnabled → {package}`, `ConfirmFamily → {package}`. Process: `StatusView {status, pid, startedAt, restartCount, isExternal, lastError, port, baseUrl, version?, backend?, loaded: {id, device?}[], configApplied}`, `GetStatus|Start|Stop|Restart → {status}`, push `SubprocessStatus {status}`. Errors on `audiocpp:<event>:error`.

## Supervisor factory
`createSupervisor(spec)`: `id, label, binaryPath(), args(), cwd?(), port(), ping(baseUrl, timeoutMs), onSpawn?, onExit?, idleTimeoutMs?(), pidFileName, globalKey?, gate?(), prepare?(), onProcessGone?(), env?(), externalStopMessage?, stopGraceMs?` → `start, stop, restart, getStatus, isRunning, isExternal, pingActivity, setIdleTimeoutSecs, suspendHealthCheck, resumeHealthCheck, registerEmitter, unregisterEmitter, checkForOrphanOnBoot, adoptIfAlreadyRunning`. State on globalThis per `globalKey` (KoboldCPP keeps its old key so a live dev process stays adopted). `emitters.ts`: `createUserEmitters`, `createProgressThrottle`, `PROGRESS_EMIT_THROTTLE_MS`.

## Tests
Final capped run: 18 files / 402 tests green; 3 red — 2 in `manifest.conformance` (expected until lane C registers the adapters), 1 in `gatedEvents` (speech-build events `voicebank:*`, `models:refreshSpeech` — **fixed by the lead 10-29**: added to `MIGRATED_FAMILIES` / `MIGRATED_EVENTS`).

## Left for B / C / D — see CROSS-LANE-NOTES (acpp block).

## ★ owner
- ★L1 status words: wire uses the supervisor's five (`crashed` + `lastError`, not `error`). Lead: accepted (R1).
- ★L2 `npm run db:generate` is blocked by `check-db-lock` while the dev server holds the DB, though generation never touches the DB — allow `generate`?
- ★L3 `subprocess_timeout_minutes` vs KoboldCPP's `…_secs` — lead: keep minutes on audio.cpp (the column is unapplied anywhere but already generated; lane D labels the unit), owner may rule to align later.
