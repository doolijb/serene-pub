# REPORT — audio.cpp managed, Lane B (S3a–S3d, S4) — DONE 2026-10-29 (saved by the lead from the hand-back)

Built and integrated; 11 files / 114 tests green in one capped run; tsc clean except the known `NARROW_SIDE_PX`. Real binary never run, GitHub never contacted (lane V).

## Migration
`drizzle/0133_audiocpp_packages.sql` (idx 133): `audiocpp_settings.enabled_package_ids` jsonb `[]`, `audiocpp_settings.binary_verified` bool null, `system_settings.gguf_list_cache` jsonb `{}` (the "last good list copy" — none existed before).

## Files
`server/audiocpp/{binary,packages,config,process,managedEndpoint}.ts` (+ tests, fixtures `release-v0.9.3.json`, `server.golden.json`); `server/audio/{audioList,familyOf}.ts` (+ tests) + `snapshot/{audio,audio-families}.yaml` (byte-identical to the list repo's); `shared/audio/audioFamilies.ts` (`matchAudioFamily`, `AUDIO_FAMILIES_SNAPSHOT`); `server/net/hfDownload.ts` (+ test; `sockets/koboldcpp.ts` re-exports; `downloadFileInParallelChunks` takes `onBytes`); `server/sockets/audiocpp.ts` (+ test of `validateAudioCppSettingsPatch`); additive: `sockets/index.ts`, `services/register.ts` (`audiocpp`: orphan check + `foldAudioCppManagedBaseUrl` on boot, `stopAudioCpp` on shutdown), `db/schema.ts`, `koboldcpp/modelKind.ts` (`readGgufMetadataWindow`), NOMENCLATURE §25. List repo (uncommitted, new files): `audio.yaml` (8 entries), `audio-families.yaml` (5 families), `tools/from-audiocpp-specs.py`.

## Verified against real data
Ids/files/dirs from the real tarball's `model_specs`; sizes from HF blobs (Kokoro q8 = 189,550,976 B); licences from model cards; **GGUF headers read for all 8 files**: `general.architecture` is `audiocpp` everywhere (names the runner, so `gguf_architectures: []`), `general.name` opaque; **every header carries `audiocpp.model_spec.family` == family id** → new match key `gguf_families`, read at byte ~315 inside the existing 64 KiB window, so a hand-copied file is recognised from the file alone. Release JSON (34 assets) parsed; **no checksum assets published** → `binaryVerified: false`.

## `ensureAudioCppReady(opts?: {signal?}) → Promise<{baseUrl}>` (`server/audiocpp/process.ts`)
Throws a sentence when off / not installed; writes `serene-pub.server.json`; restarts only when the spawned hash differs; polls `/health`; concurrent callers share one attempt.

## Decisions
Binary dir `settings.binaryDir || AUDIOCPP_BINARY_DIR || <appdata>/audiocpp`; models root `settings.modelsDir || <appdata>/models/audio`; vdes under `tts/`; hand-copied id `local_<leaf>`; `yaml` lib (already a dep); **downloading the binary does not switch audio.cpp on** (`enabled` via `updateSettings`; lead: the client setup flow enables on a successful download — ★B3); Android refuses enable; switching off saves even if stop fails; no per-model `lazy` (global `lazy_load`); default voices Kokoro `af_heart`, Qwen3 CustomVoice `Vivian`; max loaded 2 GPU / 1 CPU; recommendations per plan; download notification to the asker.

## Routed → C, D, V: see CROSS-LANE-NOTES (ACPP-B block).

## ★ owner
- ★B1 Kitten TTS 2 licence is `stellon-labs-community-license` (card says `other`) — review before offering even unrecommended.
- ★B2 Commit + push the three list-repo files; until then the app runs on the shipped snapshot (source reported `snapshot`).
- ★B3 Turning on is a separate server step from downloading the binary; lead: the client flow enables right after a successful download (one click), server keeps the separation. Confirm.
- ★B4 Workers ran on Sonnet per the owner's 10-28 instruction ("opus supervisors, each handling up to 5 sonnet workers"); the older "Opus for all subagents" memory is superseded for this programme — confirm.
