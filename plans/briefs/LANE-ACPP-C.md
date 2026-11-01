# Lane C — audio.cpp managed: adapters + model sync (S5, S6)

Read `ACPP-COMMON.md`, the plan §2 D8–D9, §3 S5–S6, `ACPP-SEAM-MAP.md` §5, lane A's hand-back, and
(when it exists) lane B's `ensureAudioCppReady` signature in `src/lib/server/audiocpp/process.ts`
(until then code against `ensureAudioCppReady({signal}) → Promise<{baseUrl: string}>` and leave a
`// ⏳ lane B` note). Own: `server/connectionAdapters/speech/profiles/audiocpp.ts` (additive),
`server/transcriptionAdapters/AudioCppTranscriptionAdapter.ts` (+ test), `server/adapters/registry.ts`
entries (additive), `server/connectionAdapters/AudioCppManagedAdapter.ts` (new; testConnection,
listing models from packages), model sync for the managed row, `shared/speech/catalogues/*` matchers
(with lane B's families data).

## S5 Adapters
- `audiocppManagedSpeech = withManagedReady(audiocppProfile)` exactly as `profiles/koboldcpp.ts:204-257`: before each listing/synthesis call `ensureAudioCppReady`, swap the base URL for the settings one, cache per connection in a WeakMap. `ADAPTER_REGISTRY[AUDIOCPP_MANAGED] = { speech: audiocppManagedSpeech, transcription: audioCppManagedTranscription, adapter: AudioCppManagedAdapter }` (match the registry's existing shape — read :182-207 and :310-314 first).
- `AudioCppTranscriptionAdapter` on `BaseTranscriptionAdapter`: multipart `file` + `model` (+ `language` when given) to `POST {base}/v1/audio/transcriptions`; map `{text, timing}`; errors as sentences; honours the signal; 25 MB input guard like OpenAI's. Register for `AUDIOCPP` (external, base URL from the row) and `AUDIOCPP_MANAGED` (through `ensureAudioCppReady`). Read `attachments/transcribe.ts` to confirm nothing else is needed for the Transcription loadout to use it.
- `AudioCppManagedAdapter`: `testConnection` (binary installed? process reachable? else the honest unfinished state: *Download audio.cpp* / *No package enabled*), `listModels` from enabled packages (no HTTP needed) — each becomes a model row (below).

## S6 Model sync
- For the managed row, `connection_models` rows = enabled packages: id = package id, modality `tts` (task tts/vdes) or `asr`, `facts.speech` = catalogue facts for the family (voices from the catalogue for kokoro/kitten/qwen3 customvoice; `voicesFrom: "catalogue"`) merged with `/v1/audio/voices?model=` when the process is up (`voicesFrom: "discovered"` for those names). `models:refreshSpeech` must work on it. Find the existing sync entry point lane B of the SPEECH build used for KoboldCPP managed speech rows (grep `facts.speech` in `server/connections/modelSync*.ts` / `sockets/connections.ts`) and add the audio.cpp branch beside it, not a second mechanism.
- ★A11: replace the three `matches()` in `shared/speech/catalogues/{kokoro,qwen3,kitten2}.ts` with lookups into the families data (shared snapshot module from lane B); keep `factsFor` as is.

## Tests (only these files)
`AudioCppTranscriptionAdapter.test.ts` (fake server: multipart parsed, language passed, error sentence), `audiocppManagedSpeech.test.ts` (ready wrapper swaps base URL, called once per listing), `audiocppModelSync.int.test.ts` (rows appear/disappear with enabled packages; facts.speech shape), catalogue matcher tests still green.

Hand back: paths, how the Transcription loadout now reaches audio.cpp end to end, test results, ★.
