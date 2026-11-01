# REPORT — audio.cpp managed, Lane C (S5, S6) — DONE 2026-10-29 (saved by the lead from the hand-back)

Green: 15 files / 426 tests (capped); tsc clean except the known `NARROW_SIDE_PX`. Nothing ran against a real audio.cpp.

## Files
New: `connectionAdapters/audioCppReady.ts` (`ensureAudioCppReadyUrl`, `listEnabledAudioCppPackages`), `connectionAdapters/AudioCppManagedAdapter.ts`, `transcriptionAdapters/AudioCppTranscriptionAdapter.ts` (+test), `speech/audiocppManagedSpeech.test.ts`, `connections/audioCppManagedModels.ts` (`syncAudioCppManagedModels`), `connections/audiocppModelSync.int.test.ts`, `shared/speech/catalogues/audioFamily.ts`, `catalogueMatch.test.ts`. Edited (additive): `adapters/registry.ts` (AUDIOCPP + AUDIOCPP_MANAGED: speech + transcription), `profiles/audiocpp.ts` (`audiocppManagedSpeech` + its `withManagedReady`; external `listModels` files ASR ids as `asr`), catalogue `matches()` via families data (★A11), `shared/connectionAdapters/actions.ts` (`ACTION_FEATURES.synthesizeSpeech = ["audio_streaming"]` — cleared a third conformance red), `speech.conformance.test.ts` (7 speaking types), NOMENCLATURE §25.

## Transcription chain
rows: `syncAudioCppManagedModels` → `syncManyConnectionModels` → speech module `listModels` → enabled packages → asr rows `{modality:"asr", reads:["audio"], writes:["text"]}`, tts rows `{modality:"tts"}` + `refreshSpeechFacts`. pick: `transcribeFiles` → `resolveCapabilityTarget("audio->text")` → `modelKindsAllow`. hear: `getTranscriptionAdapter` → `audioCppManagedTranscription.transcribeAudio` (model chosen → 25 MB guard → `ensureAudioCppReady` → multipart `file`+`model`+`language` → `{text, raw}`); external `audiocpp` same adapter with the row's URL.

## Behaviour
`testConnection` order: off → not downloaded → no package enabled → `/health` ok → not ok → down = `ok:true, running:false` "starts when first used" (never starts it). Synthesis readies once per call; voices = catalogue always + `/v1/audio/voices` only when `/health` already answers.

## Routed → B (lead applied), D, V: see CROSS-LANE-NOTES (ACPP-C block).

## ★ owner
- ★C1 `asr` as a filing modality on connection models (beside `tts`) vs a null modality with reads/writes only.
- ★C2 Test on a cold managed audio.cpp answers ok + "starts when first used"; KoboldCPP's Test fails when down. Align?
- ★C3 `audio_streaming` native and carriable, but synthesis still plays whole files (phase 1).
- ★C4 catalogue matching widened: `kitten_tts2.gguf` now matches Kitten; `.` is a separator in qwen3/kokoro names.
- ★C5 external audio.cpp ASR ids filed from the shipped families snapshot (the speech profile has no DB handle).
