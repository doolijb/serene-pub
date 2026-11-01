# REPORT — Lane B (adapters, speech facts, catalogues) — DONE 2026-10-28 (saved by the lead from the agent's hand-back)

tsc clean for lane-B files. Not run against a live speech server (local Ollama 0.30.7 has no speech). No commits, no suites.

## Files / exports
- S1 `src/lib/shared/connectionAdapters/speechFacts.ts`: `SpeechVoice`, `SpeechControls`, `SpeechFacts`, `readSpeechFacts(facts)`, `withSpeechFacts(facts, speech|null)`, `SPEECH_FACTS_KEY="speech"`.
- S2 `src/lib/server/adapters/actions.ts`: `SpeechRequest` + `direction? tags? language? seed? model?` (+ `pitch? volume?` — never sent, always `ignored`); `SpeechResult.spokenAs {voice, model, connection}` required.
- S9 `src/lib/server/connectionAdapters/speech/`: `BaseSpeechAdapter.ts` (`BaseSpeechAdapter`, `SpeechAdapterExports {Adapter, discoverSpeechFacts?(conn, model, {name}?), listModels?, testConnection?}`, `SPEECH_REQUEST_KEYS`, `NEVER_SENT`, `partitionSpeechKeys`), `speechProfile.ts`, `openAiSpeechDialect.ts` (`createOpenAiSpeechModule`, `mimeForFormat`, `wavDurationMs`), **`getSpeechAdapter.ts` → lane D loads speech with `getSpeechAdapter(type)` then `new Adapter(conn).synthesizeSpeech(req, {signal})`**, `speechFactsStore.ts` (`refreshSpeechFacts(db, connectionId, {model?, clearOnNull?})`), `profiles/{openai,ollama,koboldcpp,audiocpp}.ts`, `ElevenLabsSpeechAdapter.ts`.
- Catalogues `src/lib/shared/speech/catalogues/`: `kokoro.ts` (54 ids; 28 KCPP-permitted), `qwen3.ts` (9 presets lowercase, 10 languages, variant matcher skips tokenizer files), `kitten2.ts` (47 documented voices, 10 emotion tags, `KITTEN2_NOTICE`), `index.ts` (`SPEECH_CATALOGUES`, `catalogueFor`, `speechEngineKey(model, name?)`).
- S10 `koboldcpp/`: `modelManager.ts` (`ManagedModelRequest` kind `"audio"`, `Residency.audio`, `buildConfigContent` emits `ttsmodel/ttswavtokenizer/ttsgpu`, `planResidency` carries speech across loads, waits on `tts` flag, `SpeechModelMissingError` after 15 s), `kcppHttp.ts` `fetchSpeechModelStatus`, `ttsTokenizer.ts` (`pickWavTokenizer` by file-name rule), `managedPreflight.ts`.
- Types: `CONNECTION_TYPE.AUDIOCPP` (local, tts, `http://127.0.0.1:8080`), `CONNECTION_TYPE.ELEVENLABS` (cloud, tts, default `eleven_flash_v2_5`, key required). Manifest `text->audio` unproven-until-none on openai/ollama/koboldcpp(+managed); native on audiocpp/elevenlabs. Registry `speech` slot + 6 thunks. Listings mark tts models (OpenAI `gpt-4o-mini-tts*`/`tts-1*`; Ollama `capabilities: speech`; external KCPP `koboldcpp-speech` row when `flags.tts`; managed KCPP via `catalogueFor`).
- Socket `models:refreshSpeech` `{connectionId, model?}` → `{connectionId, results:[{model, connectionModelId, speech, error?}], error?}`; admin, rate-limited, re-emits `connections:models`.
- Outside-table additive edits: `adapters/registry.ts`, `connections/modelSync.ts` (`adapterIO` case "tts"; **facts replace now carries `facts.speech`**), `shared/utils/connectionDefaults.ts`, `shared/connections/credentials.ts`, `shared/sockets/types.ts`.

## Honoured keys per type (pitch/volume never sent; unhonoured keys never sent, reported `ignored`)
| key | openai | ollama | koboldcpp (+managed) | audiocpp | elevenlabs |
|---|---|---|---|---|---|
| model | `model` | `model` | `model` (unread) | `model` | `model_id` |
| voice | `voice` | `voice` | `voice` | `voice` (dropped on Qwen3 VoiceDesign) | URL path; required |
| format | mp3/opus/aac/flac/wav/pcm; mp3 on api.openai.com, wav elsewhere | wav/pcm; wav | wav/mp3; wav | wav only; `response_format` not sent | `output_format` `mp3_44100_128` or `opus_48000_64` |
| speed | clamp 0.25–4 | ignored | **ignored** | clamp 0.5–2 when catalogue gives a range | `voice_settings.speed` 0.7–1.2 else ignored |
| direction | `instructions` (gpt-4o-mini-tts only) | ignored | `instruction` (Qwen3 CustomVoice/VoiceDesign) | `instructions` (Qwen3 CV/VD, voxcpm, omnivoice) | ignored |
| tags | ignored | ignored | folded into `instruction` | inline (Kitten 2) | inline (v3, v3_conversational, v4_turbo) |
| language | ignored | ignored | `language` (Qwen3) | `language` (Qwen3) | `language_code` ISO 639-1; not on multilingual_v2 / English v2 |
| seed | ignored | ignored | `seed` | `seed` | `seed` 0..2³²−1 |
Clamped speed appears in both `applied` and `ignored`. **Ollama refuses >4096 chars; lane D must split groups.**

## Deviations
1. Speech is its own adapter family (registry slot), like image/embedding/NER — the conformance test pins manifest keys to registry modules.
2. KCPP ignores `speed`; reads only the first `[…]`, so tags fold into `instruction`. audio.cpp takes top-level `instructions`, not `options.instruct`. audio.cpp voices route returns flat strings → all `preset` except Qwen3 Base (`clone`, read-only).
3. `discoverSpeechFacts(conn, model, {name})` hint; `honouredFor(model, connection)`.

## ★ and lead decisions
- ★B1 `models:refreshSpeech` not in GATED_EVENTS / typedSocket → **lead added the GATED_EVENTS entry; lane E adds typedSocket + `:error`.**
- ★B2 client never sees stored speech facts (`modelRowView` uses `readStoredFacts`) → **lead adds `speech?` to `ModelRow` + one line in `modelRowView`.**
- ★B3 no "tts" model kind in `modelKind.ts`; speech GGUFs recognised by file name; OuteTTS/Parler/Dia list as text-gen → **owner ★ (phase 2: typed kind).**
- ★B4 external KCPP: row named after the engine ("Kokoro") gets real voices, else five placeholders + notice → **acceptable phase 1; owner ★ for a typed engine field.**
- ★B5 unverified facts (Ollama `/api/show` voices location; audio.cpp `language` per family; ElevenLabs speed 0.7–1.2; KCPP's 28 Kokoro ids; KCPP 0.6B variant; Kitten 2 47/115 voices) → **lane V checks docs; live checks where a server exists.**
- ★B6 `eleven_v4` not on the tag list (docs list only Turbo/v3-conv) → keep.
- ★B7 Kitten 2 NOTICE file when distributing weights → **owner ★ (packaging).**
- ★B8 "Speech models" section name only in an error string → **lane E names the real section.**
- ★B9 openai-compatible host with no voices route → null facts → **lane E shows a typed voice field.**

## Fixtures for lane V (stubbed fetch)
1. OpenAI gpt-4o-mini-tts: req `{text:"Hello", voice:"coral", speed:9, direction:"hushed", pitch:1.2, volume:0.5, format:"mp3"}` → body `{"model":"gpt-4o-mini-tts","input":"Hello","voice":"coral","response_format":"mp3","speed":4,"instructions":"hushed"}`; applied `[voice,format,speed,direction]`, ignored `[pitch,volume,speed]`; 200 `audio/mpeg`. Local host `http://x:8880/v1` model kokoro direction "x" → `{"model":"kokoro","input":"hi","response_format":"wav"}`.
2. Ollama phonon: body `{"model":"phonon","input":"Hello","voice":"coral","response_format":"wav"}`; applied `[voice,format]`, ignored `[speed,direction,pitch,volume]`; WAV header 0xffffffff → `durationMs` 2000; 5000-char input throws.
3. KCPP Kokoro (`http://h:5001/v1/`): POST `…/v1/audio/speech` `{"model":"Kokoro_no_espeak_Q4.gguf","input":"Hi","voice":"af_bella","response_format":"wav"}`; applied `[voice,format]`, ignored `[speed,direction,pitch]`.
4. KCPP Qwen3 CustomVoice: req `{voice:"aiden", direction:"hushed", language:"en", tags:["[whispers]"], pitch:2, seed:3}` → `{"model":"qwen3_tts_1_7b_customvoice_q8_0.gguf","input":"Hello","voice":"aiden","response_format":"wav","instruction":"whispers. hushed","language":"en","seed":3}`; applied `[voice,direction,language,seed,tags]`, ignored `[pitch]`.
5. Managed reload_config: audio while text resident `{model:[textPath], gpulayers, contextsize, flashattention, batchsize, jinja:true, ttsmodel, ttswavtokenizer, ttsgpu:true}`; text while audio resident carries `tts*`; audio alone `{nomodel:true, ttsmodel, ttswavtokenizer}`.
6. audio.cpp: `/v1/models` `{"object":"list","data":[{"id":"qwen3_tts_1_7b_customvoice_q8_0","configured":true,"device":0},{"id":"kitten_tts2_q8"}]}` → rows `{id, modality:"tts", family:"qwen3-tts"|"kitten-tts-2"}`; `/health` `{"status":"ok","backend":"cuda","models":2}`; `/v1/audio/voices?model=…` `{"voices":["Vivian","Ryan","my_ref"]}` → `voicesFrom:"discovered"`, 10 voices after catalogue merge (case-insensitive dedupe), controls `{instruction:"prose", language:[10], speed:{0.5,2}}`, formats `["wav"]`, 24000; Kitten 2 facts `streams:false` + notice. Speech req `{voice:"Vivian", direction:"warm, slow", speed:1.2, pitch:3, language:"en"}` → `{"model":"qwen3_tts_1_7b_customvoice_q8_0","input":"Hello.","voice":"Vivian","speed":1.2,"instructions":"warm, slow","language":"en"}` (no response_format); applied `[voice,speed,direction,language]`, ignored `[pitch]`.
7. ElevenLabs: `/v1/models` keeps `can_do_text_to_speech` → `{id:"eleven_v3", modality:"tts", languages:[en,ja]}`; `/v2/voices` premade→preset (labels gender/accent/age/useCase, previewUrl), cloned→clone, generated→designed; controls speed 0.7–1.2, four settings, open bracket tags, model languages. Req `{text:"Hello.", voice:"v1", model:"eleven_v3", tags:["[whispers]"], speed:1.1, direction:"hushed", pitch:2, language:"en-US", format:"opus"}` → POST `https://api.elevenlabs.io/v1/text-to-speech/v1?output_format=opus_48000_64`, header `xi-api-key`, body `{"model_id":"eleven_v3","text":"[whispers] Hello.","voice_settings":{"speed":1.1},"language_code":"en"}`; applied `[model,voice,format,speed,tags,language]`, ignored `[direction,pitch]`; response `audio/ogg`.
8. Kokoro catalogue facts: 28 voices (`af_heart` "Heart" en-US female … `bm_*` en-GB male), `voicesFrom:"catalogue"`, speed 0.5–2, wav, 24 kHz, `streams:false`; for KCPP speed removed, formats wav+mp3.

## What to test (lane V)
Conformance (registry `speech` ↔ manifest `text->audio`, six types); `partitionSpeechKeys` presence rules + no ignored key in any body; all fixtures; errors/abort (Ollama 400 voice list, ElevenLabs `detail`, 422 array, 401; abort → `isAborted`); `wavDurationMs` (normal, 0xffffffff, non-WAV); facts helpers round-trip; `modelSync` keeps `facts.speech` and routes tts types; `refreshSpeechFacts` (modality/model filter, null keeps unless `clearOnNull`, thrown → `error`, name hint); socket (non-admin refused, admin results + re-emit, rate limit); `catalogueFor`/`speechEngineKey` (Kitten 0.8, Qwen3 tokenizer, `""` → null; three Qwen3 variants); KCPP external (tts row only with `flags.tts`; `externalRoot` trailing `/v1`, slash, empty; tag folding; Base not steerable); KCPP managed (`planResidency` matrix, `buildConfigContent`, `pickWavTokenizer` on real HF names, listModels modality, empty-model/missing-tokenizer errors; live speak→chat→speak with one reload); OpenAI (tts regex, cloud vs local format, `deprecatedOn`, `/v1/voices` fallback); Ollama speech models list as tts; ElevenLabs (pagination, category→kind, language dropped on multilingual_v2, tags dropped where unsupported, seed bounds).
