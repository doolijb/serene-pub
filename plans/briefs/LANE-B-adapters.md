# Lane B — adapters, speech facts, catalogues (supervisor: Opus; workers: 5 Sonnet)
Owns seams **S1, S2, S9, S10**. Write S1 and S2 in the first hour.
## Rules (every lane)
- Read ONLY the files this brief lists plus the seam files it names. For anything else, write the question in your report and continue.
- Write ONLY your owned paths (§4 of the build plan). Never touch another lane's files.
- Never `git checkout`, `git restore`, `git stash` in `../serene-pub-sdk` (mostly uncommitted work). Never commit anywhere.
- Never run `npm run sdk:build` if something listens on :5173 (`ss -ltnp | grep 5173`); check each time.
- Never run full test suites. Lane V owns tests. Leave "what to test" notes in your report.
- Migrations are GENERATED (`npm run db:generate`); the index must exceed the journal max.
- Quote heredoc delimiters (`<<'EOF'`). Never `kill -9` a dev server. Never edit server files while a dev instance is booting.
- Another agent is porting a "Mundi" plugin concurrently and will touch SDK and core files. Before editing any file, run `git status --short -- <file>` in that repo and `stat -c %y <file>`; if it changed in the last hour and is not in your ownership table, STOP and report. Keep SDK edits additive (new files, new exports) wherever possible.
- Workers: up to 5 Sonnet (`model: "sonnet"`), long-lived; give each one AREA and let it take the next item in that area. Tell workers the same rules.
- Report to `plans/REPORT-speech-lane<X>-2026-10-28.md`: what was built, deviations from the seams, loose ends, ★ questions, and "what to test" for lane V. Update it as you go; it is how the lead reads you.
- Plan files: `plans/PLAN-speech-build-2026-10-28.md` (seams §1, your lane §2, ownership §4, assumptions §0) and the design `plans/PLAN-speech-connections-and-timbre-2026-10-28.md` (read only the sections your lane cites, with `sed -n`).
- Project rules: `CLAUDE.md` (read once). Nomenclature: before naming anything new, `NOMENCLATURE.md` §1 and §24 (`sed -n 29,64p`, `sed -n 1511,1530p`); proposed words for this build: speech facts, speech dialect, voicebank, timbre, inflection, cue (all 🚧).
## Read
- Build plan §1 S1 S2 S9 S10, §2 Lane B, §4. Design plan §2 (connections table) and §3 (speech facts): sed -n '/^## 2\./,/^## 4\./p'.
- `src/lib/server/adapters/actions.ts` 325-411; `src/lib/server/connectionAdapters/BaseConnectionAdapter.ts` (grep synthesizeSpeech, generateImage); `OpenAIChatAdapter.ts` image-dialect usage as the pattern (grep -n dialect); `src/lib/server/koboldcpp/probeCapabilities.ts`; `src/lib/server/koboldcpp/modelManager.ts` 690-740; `src/lib/shared/connectionAdapters/manifest.ts` — ONE type's row (grep -n '"openai-official"'); `src/lib/shared/constants/ConnectionTypes.ts` 55-120; `src/lib/shared/imageGen/types.ts` 130-150 (GeneratedMediaItem).
- Memory notes (cat): `~/.claude/projects/-home-jody-github-serene-pub/memory/reference_audio_cpp_runtime.md`, `reference_ollama_speech_2026_10.md`, `reference_lightweight_tts_landscape_2026_10.md`.
## Work areas
- B1 seams + dialect: `speechFacts.ts` (S1), `actions.ts` (S2), `connectionAdapters/speech/openAiSpeechDialect.ts` with per-type profiles (route, voices route, honoured keys, formats); wire `openai` (+ generic base-URL) and `ollama` (voices via /api/show; send ONLY model,input,voice,response_format).
- B2 KoboldCPP external + managed: voices from catalogue (Kokoro 28 permitted ids; Qwen3 9 presets), `instruction` + `language` fields, load plan `audio { ttsModelPath, ttsWavTokenizerPath? }` → `ttsmodel`/`ttswavtokenizer` beside sdmodel; probe → facts.
- B3 `audiocpp` type: ConnectionTypes entry, manifest row, preset http://127.0.0.1:8080, /v1/models → connection models (family from id), /v1/audio/voices + catalogue for embedded presets, `options.instruct` / `instructions`, streaming fact.
- B4 `elevenlabs` type: xi-api-key, /v1/models (can_do_text_to_speech), /v2/voices → facts (labels, previewUrl, settings), voice_settings, audio tags on v3-conversational/v4-turbo, request opus/mp3.
- B5 catalogues `src/lib/shared/speech/catalogues/{kokoro,qwen3,kitten2}.ts` (voices+languages+controls+notice; Kitten 2 carries the Stellon "Powered by KittenML" notice), facts store on connection_models.facts.speech, socket `models:refreshSpeech` (add in sockets/connections.ts only).
- No cloning: never create `kind: 'clone'` voices; discovered clones are read-only rows. Never send pitch/volume (report ignored). OpenAI models carry deprecatedOn '2027-01-06'.
Done when each type returns audio against a recorded fixture body and applied/ignored match its profile. Fixtures go in the report, not in tests.

## Mundi coordination (another agent, concurrent, planning today, may start editing any time)
Files its plans name, which may change under you: SDK `contracts/src/outlets.ts` (advance-story-clock), `sdk/src/extension.ts`, `sdk/src/widgets.ts`, `sdk/src/descriptors.ts`, `sdk/src/annexFields.ts`, `sdk/src/rulesetSections.ts`, `core-catalog/src/functions/time.ts`; app `src/lib/server/db/schema.ts`, `src/lib/client/sessions/fullscreen.svelte.ts`, plugin package/assets code. Rules: edit these ADDITIVELY in your own region (append a block; never reorder); re-read the file immediately before each edit; if `git diff --stat -- <file>` shows hunks you did not make, do not revert them — work around and report. Migration numbers: if the journal max is no longer 128 when you generate, take the next free index and say so.
