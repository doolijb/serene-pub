# REPORT — audio.cpp managed, Lane V — DONE 2026-10-29 (saved by the lead from the hand-back)

**Verdict:** green for everything this build owns; the real v0.9.3 cpu-portable walk passed end to end (13 steps) on an isolated instance. Remaining reds in the grouped run belong to the speech build. 10 defects V-1…V-10; no source touched by V (tests only). Logs: scratchpad `vacpp/`; screenshots `vacpp/walk/shots/`.

## Grouped run
tsc GREEN (known `NARROW_SIDE_PX` only) · svelte-check GREEN (0 errors, 7 pre-existing warnings) · sdk:test 4025/4026 (red = speech build's derive-don't-spell) · docs GREEN 155 pages · budgets RED known (docs 4.07 MB > 3 MB) · targeted 82 files: 80 pass; 4 reds all speech build (`wiring.test.ts` speak@1 ports ×2, `pipelineDrafts.int` spritePick→cue edge ×2) + 1 expected fail (V-3).

## Pins moved (test-only, each proven this build's)
`socketEgress.test.ts` +5 `UNREDACTED_EMITS` (`createUserEmitters.emit` calls, admin-bound) · `wiring.test.ts` §4 accepts `adminHandler` (clears 10 `audiocpp:*:error`) · `registry.test.ts` counts `speech` + `transcription` modules (was red since `elevenlabs`).

## Tests written (10 files / 46 tests)
`audiocpp/resync.int`, `sockets/audiocpp.resync.int`, `audiocpp/process.gate.int`, `sockets/connections.discoverExclusion.int`, `sockets/audiocpp.memberGate` (17 handlers refuse non-admins), `sockets/audiocpp.interestGate`, `audiocpp/packages.v.int` (real header → family; sidecar; twins; remove leaf only; `it.fails` V-3), `net/hfDownload.v`, `speech/audiocppSpeech.v`, `AudioCppTranscriptionAdapter.v`.

## Live walk (all PASS; caveats V-1/V-2/V-4)
Add menu → setup → cpu-portable download (unverified, switched on in one click) → zero models: no auto-start, Start refused → Kokoro download + Enable → Start → Running 0.9.3 · CPU → Narration filled → reply spoken (`af_heart · kokoro_82m_q8_0`, 7.45 s WAV 24 kHz, played) → Say it as… → Parakeet + restart (~50 ms, both listed) → WAV attached → `files.transcript = "The quick brown fox…"` → hand-copied packages matched by header / guessed / Confirm family → Remove leaf only → Stop/Start → adopt on reload → shutdown leaves nothing.
Real-binary answers: `/health` `{status, backend, models(configured count), ui, ui_management, version, git, git_date}`; `/v1/models` entries `{id, family, task, mode, device, loaded, configured, path}` (`loaded===true` path right); no checksum assets; accepts `idle_unload_ms`; honours `threads`; honours `TMPDIR`.

## Defects
- **V-1** (pre-existing loadouts/speech; blocks acceptance): filling Narration/Transcription never claims the `text->audio` / `audio->text` default (only text->text/text->image are seeded in `db/defaults.ts:655-684`); Read aloud shows "Unavailable" until `loadouts:setDefault`.
- **V-2** gate refusal → "Crashed" (`managed/supervisor.ts:642-643` → `failStart`) and the stale message survives Enable.
- **V-3** hand-copied ids numbered in readdir order (`packages.ts:445-447`) → renumbering on twin add/remove drops an enabled one from the config.
- **V-4** `confirmFamily` accepts any well-formed id; sidecar → `matched` (`packages.ts:540-556`, `:424-427`).
- **V-5** `server_busy` (max_loaded_models=1 on CPU: transcription during speech) surfaced, never retried (`AudioCppTranscriptionAdapter.ts:109`, `openAiSpeechDialect.ts:183`).
- **V-6** audio.cpp extracts to `$TMPDIR/audiocpp-gguf/<hash>` (39 MB), outside the data dir, never cleaned; `env()` sets only `LD_LIBRARY_PATH`.
- **V-7** `modalityOfTransform("audio->text")` = text-gen: `+page.svelte:314-321 modelKnownFor` never auto-registers `asr`; `jobPicker.ts:89-94 modalityRulesOut` miscounts.
- **V-8** `useReadiness.svelte.ts:76-77` start only KoboldCPP (no wrong start fires; audio.cpp row never offers Start); `downloads.svelte.ts:607-619 clearFinished` no audio.cpp event; first-run doors' copy unchecked.
- **V-9** minor: too-shallow files ignored silently; Remove leaves empty family/task dirs; discovery exclusion by port only.
- **V-10** `threads` written only when set → audio.cpp runs 1 thread on CPU.

## Not verified
GPU builds, Windows (.zip, cudart), macOS; checksum path (none published); cancel mid-download via UI; picker remount; Kitten/Qwen3 packages; live member socket; Transcription loadout after its model is removed.

## ★ owner
★V1 defaults: seed `text->audio`/`audio->text` at boot vs claim-on-first-fill · ★V2 refused start reads Stopped + reason? · ★V3 Confirm family listed-only vs free text `confirmed` · ★V4 `server_busy` retry vs 2 loaded on CPU (~1.1 GB) · ★V5 default `threads` + `TMPDIR` now vs Admin › Hardware · ★V6 approve set-based D3 readers.

## Lead follow-up (2026-10-29, after hand-back) — fixed, re-verified in their suites
- **V-1** `db/defaults.ts`: boot stars the shipped Narration (`core:loadout/tts@1`) and Transcription (`core:loadout/transcription@1`) loadouts when nothing is flagged for `text->audio` / `audio->text`; the pair is never written (a filled, unstarred Narration on an upgraded pub keeps its model).
- **V-2** `managed/supervisor.ts`: a gate refusal leaves status `stopped` with the reason on `lastError` (KoboldCPP parity suite green; gate test re-pinned).
- **V-3** `audiocpp/packages.ts`: hand-copied ids are `local_<family dir>_<leaf>` (path-derived); the twin `it.fails` now passes; tests renamed.
- **V-4** `confirmAudioCppFamily` accepts only a family the audio families list knows, with a matching task (an empty families list, as in unit tests, cannot judge and is skipped).
- **V-5** new `speech/busyRetry.ts` `withBusyRetry` (5 tries, 750 ms ×2 backoff, max 6 s, abort-aware) around the transcription POST and the speech dialect POST on 503 `server_busy`/429; the two pins now expect the retry.
- **V-6** `process.ts env()`: `TMPDIR`/`TMP`/`TEMP` → `<models>/audio/.cache` on every platform (LD_LIBRARY_PATH on Linux as before).
- **V-7** `+page.svelte modelKnownFor` and `jobPicker.modalityRulesOut` are set-based via `modelKindsAllow` (an `asr` row fits `audio->text`).
- **V-10** `writeAudioCppConfig` defaults `threads` to half the logical cores (≥1) when unset, until Admin › Hardware owns it (★A9).
- **Not fixed:** V-8 (readiness Start verb, `clearFinished`, first-run doors' copy — client follow-up), V-9 (minor). ★V1–★V6 answered by these choices where they overlap; owner may still overrule.
- **Owner report 10-29 "doesn't show downloaded audio models":** the package had downloaded but was never enabled, and only enabled packages become model rows, so the Models view and the Narration picker were empty. Fixed: a finished package download enables it and applies the config (one click), and the services registry re-syncs the managed row's model rows at boot. Needs a dev-server restart to take effect (boot starring of Narration/Transcription too).
