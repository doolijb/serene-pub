# Cross-lane notes (lead-maintained; every later lane reads this first)

## From lane C (done 2026-10-28) — routed
- **→ D (D1/D5):** `sessionSpeechSetting()` in `src/lib/server/speech/resolveVoice.ts` guesses where `speech.narratorVoice` and `session.language` live (tries `sessions.genreFields[key]`, then `metadata`). D5 declares S7 settings; D5 MUST make that reader match the real storage (edit the one function, it is small).
- **→ D (D1):** `storeGeneratedMedia` must set `files.userId` to the **session owner**, not 0, or the per-user cull misses spoken files.
- **→ D (D1):** wire the retention sweep: `registerService({ id: "spokenRetention", … startSpokenRetention/stopSpokenRetention })` in `src/lib/server/services/register.ts` after the `dailyBackup` block (~line 71). Append-only; re-read before editing.
- **→ D + E:** clearing spoken audio deletes only files. A message part whose file is gone renders as *not spoken yet* (E) and `attach-audio` with `replace` tolerates a missing previous file (D).
- **→ E:** declare interest for gated `voicebank:*` and the new `media:spokenSummary|clearSpoken|setKeepSpokenAudio` events (`shared/sockets/interest.ts` pattern), or replies are dropped silently.
- **→ E:** `media:list` takes `includeSpoken?: boolean`; the folded *Spoken lines* row uses `media:spokenSummary` + `media:clearSpoken`; the retention setter is `media:setKeepSpokenAudio` (admin).
- **→ E:** voicebank wire types are in `src/lib/shared/speech/voicebank.ts`; timbre types + `canPickVoice` in `src/lib/shared/characters/timbre.ts`.
- **→ V:** lane C's "what to test" list is in its report; the default voicebank row seeds lazily on first `voicebank:list`/`pickable` (not at boot) — test that path.

## Lead decisions on lane C's questions
1. `characters:create` should block members from setting `timbre.voice` too — **V or lead** adds the same hook (tiny; lane C has finished).
2. A voicebank entry's own `language` is NOT in the chain in phase 1 (A2 stands).
3. A timbre naming a disabled voice is accepted and skipped at resolution — fine.
4. A disabled `pub` row shadowing a plugin row of the same slug — acceptable; note in docs (E5).
5. Only the session owner and admins see or clear spoken audio (matches A1 posture).
6. ★15 (`voicebank` vs the owner's "Roster") stays open for the owner.

## Known tsc noise while lanes run
- Lane B's in-progress `connectionAdapters/speech/profiles/{koboldcpp,ollama,openai}.ts` (abstract `synthesizeSpeech` via `super`) — B will clear it.
- Pre-existing: the `NARROW_SIDE_PX` dom test. Not ours.

## From lane A (done 2026-10-28) — routed
- **→ D (D2):** the app has NO jinja2 renderer today (`renderers.ts` does Handlebars + Liquid). Register a `core:template/jinja2@1` renderer that calls the SDK `render(src, scope, { filters })` with the five `SPEECH_JINJA_FILTERS`; `tag` renders the selected inflection-tag layout and keeps the result only if `controls.tags` allows it.
- **→ D (D2):** engine hazard — loop output is re-scanned by the outer `{{ }}` pass, so a cue text containing `{{x}}` gets substituted. Escape cue text before rendering.
- **→ D (D2):** the variable-layout seeder has no `engine` field (implies Handlebars); these layouts are Jinja — seed with `engine: SPEECH_TEMPLATE_ENGINE`.
- **→ D (D1):** bind BOTH `cue-lines@1` and `speak@1` (speak is no longer provisional; the bind guard asks). Build the marker table (`<sigh>`→sadness etc., design §11.2) in the cue-lines handler. Speak's out-port `meta` wires straight into `attach-audio.meta`.
- **→ D:** import ids from `SPOKEN_LINE_TEMPLATE_IDS`; never type template id strings.
- **→ E (E5):** NOMENCLATURE §25 rows, all 🚧: speech cue (⚠ not scene cue), inflection, cue map, spoken as, spoken metadata, line template, `audio_streaming` "Streaming speech", inflection sentence, inflection tag.
- **→ V:** the pin list in `plans/REPORT-speech-laneA-2026-10-28.md`; apply the ★A2 one-liner (`EMULATABLE_VIA.audio_streaming = []`) before re-pinning; lead bumps speak's timeout to 180000.
- Lead 10-28: bumped speak@1 timeoutMs 60000→180000 in contracts/src/oracles.ts (needs the next sdk:build; lane D rebuilds).

## From lane B (done 2026-10-28) — routed
- **→ D (D1):** load speech via `getSpeechAdapter(type)` from `src/lib/server/connectionAdapters/speech/getSpeechAdapter.ts`, then `new Adapter(conn).synthesizeSpeech(req, {signal})`. **Ollama refuses input > 4096 chars** (`OLLAMA_SPEECH_INPUT_LIMIT`) — split groups by that limit when the model is Ollama. KoboldCPP ignores `speed`; tags fold into `instruction` there. `SpeechResult.spokenAs` is `{voice, model, connection}` (host-side; the SDK's `SpokenAs` has no connection — map it).
- **→ E (E1/E2):** `ModelRow.speech?: SpeechFacts` is now sent by `modelRowView` (lead edit) — read voices/controls from it; when it is null on an openai-compatible host, show a typed voice field (★B9). Add `models:refreshSpeech` (+ `:error`) to `client/sockets/typedSocket.ts` (★B1 client half). Name the managed KoboldCPP section ("Speech model") — ★B8. Catalogue helpers for labels: `src/lib/shared/speech/catalogues/index.ts`.
- **→ V:** fixtures and the test list are in `plans/REPORT-speech-laneB-2026-10-28.md`; ★B5 facts to verify against docs.
- **Owner ★ carried:** ★B3 typed "tts" model kind; ★B4 typed engine field for external KoboldCPP; ★B7 Kitten 2 NOTICE packaging.

## From lane D (done 2026-10-28) — routed
- **→ E (E3):** S7 keys are genre fields `speechReadAloud` (off/make/play), `speechTemplate`, `speechNarratorVoice`, `sessionLanguage` in `sessions.genre_fields`; client seam `src/lib/shared/sessions/speechSettings.ts` (`readSpeechSessionSettings`, `SPEECH_FIELD_KEYS`, `READ_ALOUD_MODES`). Draw **`speechNarratorVoice` as a picker over `voicebank:pickable`** (not free text). `speechNarrateUser` is being unregistered — do not draw it. The per-swipe S6 record is `metadata.swipes.spokenHistory[idx]` (current at `metadata.spoken`); the verb key is `read-aloud` (spec action `core:spec/speak-message#read-aloud`); **Say it as…** arrives from the D follow-up as `say-it-as`.
- **→ E (all):** use a PRIVATE headless Chromium for walks; never the shared Playwright MCP browser (lane D closed another session's page by mistake).
- **→ D-follow-up (new, small lane):** ★1 `core:query/message-line@1` + bind + rewire + `say-it-as`; ★2 resolver service fallback to `facts.voices[0]` + voicebank default seeded at boot; ★3 session template wins only when explicitly set; ★4 seed `core:prompt/speak-direction@1`; ★5 server-side slug validation for `speechNarratorVoice`; ★7 jinja2 into `CORE_TEMPLATE_ENGINES`; unregister `speechNarrateUser`.
- **→ V:** the test list and the E2E recipe in `plans/REPORT-speech-laneD-2026-10-28.md`; watch composer blocking while the tail runs on a slow local TTS.

## From lane D follow-up (done 2026-10-28) — routed
- **→ E (E3):** the `narrateUser` branch in `SpeechSettingsBlock.svelte` can never draw — remove it. "What is read" (`speechTemplate`, now `string | null`) needs an explicit clearing choice, *As the pipeline says*, which is the default; docs wording follows. Second per-line verb is live: `say-it-as` ("Say it as…", icon `mic-vocal`, collects "How should it sound?") on `core:spec/speak-message`.
- **→ E (E5):** NOMENCLATURE line ~752: `speechNarrateUser` is a reserved key, no longer declared. The follow-up already added a §25 row for **message line** / `say-it-as`.
- **→ V:** `plans/REPORT-speech-laneD2-2026-10-28.md` has the test list; hashes: one more contracts query, speak-message spec, story/guide/lair genre decls (+ create specs inlining fields), `CORE_PROMPTS` +1. Narrator-voice validation covers `sessions:updateSetting` only — test create/preset writes and report if they bypass it.
- **Lead decision:** *Say it as…* does NOT stick to the line for later Read aloud presses (one-off, like a re-roll; emotions are never state — sprites ruling). Recorded inflection = the shown sprite's label.

## From lane E (done 2026-10-28) + lead fixes
- Lead applied F1 (`speakingLoadout` falls back to seed `core:loadout/tts@1`), F2 (KCPP managed wording), F3 (`resident.audio?` type). F4 left (same limiter pattern as refreshModels).
- **→ V:** test lists in `plans/REPORT-speech-laneE-2026-10-28.md`; verify F1 on a fresh scratch DB (fill Narration → voicebank `pairModelId` non-null without touching Defaults). The Perf tab's cast for `resident.audio` can now go.
- Phase 2 (not now): Try with this line socket (★E2), voicebank name in the spoken record (★E6), host media events for cue highlighting (★E7).

## audio.cpp managed build (ACPP) — from lane A (2026-10-28/29)
- **→ B:** build the instance with `createSupervisor({id:"audiocpp", …, ping(baseUrl, timeoutMs)})`; `gate` reads `audiocpp_settings.enabled`; always `ensureAudioCppSettings(db)` (no boot seed, no fixed id); services registry entry; `configHash`/`configApplied`; `createUserEmitters` + `createProgressThrottle` for the two download pushes; status words are the supervisor's five (no translation); `pollUntilReady` lives in `koboldcpp/` — move to `managed/` with a re-export if you touch it.
- **→ C:** registry entries for `audiocpp_managed` (+ transcription for both audio.cpp types) clear the two `manifest.conformance` reds.
- **→ D:** client `downloads.svelte.ts` `DownloadSource` untouched; non-exhaustive `"koboldcpp-managed"` branches that fall to `api`: `connectionRowStatus.ts:450`, `connectionIndexFilter.ts:160`, `ConnectionIndexView.svelte:206 MANAGED_KINDS`, `liveStatus.svelte.ts`, `modelManagement.ts:230`, `connections.svelte.ts:264`, `IdPage.svelte:800`, `ConnectionsSidebar.svelte:1390`; glyphs `Volume2`/`Cpu` are placeholders (check §22); wire `AudioCppSettingsCtx`; NOMENCLATURE §10 display rows; audio.cpp status line (`connectionGroup.ts` comment says six kinds).
- **Lead decisions:** ★L1 accepted (five words); ★L3 keep minutes; gatedEvents speech debt fixed by the lead.

## ACPP — from lane B (2026-10-29)
- **→ C:** catalogue `matches()` → `matchAudioFamily(AUDIO_FAMILIES_SNAPSHOT, {repoId?, files?, pipelineTag?, tags?, ggufFamily?})` from `$lib/shared/audio/audioFamilies` (family id = `result.family.family`; also `variant`, `task`). Always the `baseUrl` from `ensureAudioCppReady`, never the row's.
- **→ D:** the setup flow must send `audiocpp:updateSettings {enabled: true}` after a successful binary download (lead decision on ★B3: one click = download then enable). *Restarting to apply* while status is `stopping`/`starting` or `running` with `configApplied: false`; `setPackageEnabled`/`updateSettings` answer before the restart ends. No "get progress" request: after reconnect call `listPackages` (state `downloading`) and pushes resume. Unknown family rows arrive as family `"unknown"`, confidence `guessed`, cannot be enabled until `confirmFamily`. Document `AUDIOCPP_BINARY_DIR`.
- **→ V (real binary):** confirm audio.cpp accepts `idle_unload_ms`; `/v1/models` "loaded" shape (code accepts `loaded === true` or `status === "loaded"`); `/health` `version`/`backend` field names; untested: `.zip` unpack, Windows cudart second download, checksum path, cancel mid-download, real HF package download, `familyOf` inside the tree walk.

## ACPP — from lane C (2026-10-29)
- **→ B (lead applies):** call `await syncAudioCppManagedModels(db)` (+ emit `connections:list`, try/catch) after `setPackageEnabled`, `removePackage`, `confirmFamily`, a finished package download, and when `ensureManagedAudioCppEndpoint` creates the row. Duplicate `audioCppSettingsBaseUrl` (C) vs `audioCppBaseUrl` (B's process.ts) → move to `settings.ts` (V may do it). Listing walks the tree twice.
- **→ D:** `asr` rows need filing + label in the Models list (`modelsList.ts`; `modalityLabel` prints "asr" raw); connection row status reads `extra.running:false` as the normal cold state; NOMENCLATURE **modality** row mentions `asr`.
- **→ V:** real walk parakeet → WAV → transcript; external audio.cpp listing with an ASR id; run `sockets/pipelineComposites.int.test.ts` + `pipelineDrafts.int.test.ts` (catalogue mentions); lane B's live `listEnabledAudioCppPackages` against a real tree.

## ACPP — from lane D + lead (2026-10-29)
- **Lead applied after B/C/D:** (1) `server/audiocpp/resync.ts` `resyncManagedAudioCpp(db)` — ensures the managed row (`ensureManagedAudioCppEndpoint`, which nobody called before) then `syncAudioCppManagedModels`; called from `setPackageEnabled`, `removePackage`, `confirmFamily` (+ `connections:list` re-emit) and from the package download's success path. (2) Supervisor gate refuses a start with no enabled ids (`NO_PACKAGE_MESSAGE`) and `prepare()` refuses a config with zero models (`NO_PACKAGE_ON_DISK_MESSAGE`); `writeAudioCppConfig` returns `modelCount`. `process.int.test.ts` seeds one fake package.
- **→ V:** D2 real download → enable → Process running with loaded ids/devices; Arriving tray with real pushes; picker remount mid-download. D3 `modalityOfTransform` maps `audio->text` to text-gen: `+page.svelte modelKnownFor` doesn't auto-register `asr`, `jobPicker.modalityRulesOut` miscounts — fix with set-based checks in those two readers, not a special case. D4 discovery exclusion compares the managed row's port (needs a DB test). D5 two-kind leftovers: `useReadiness` / `JobPickerDialog` start verbs, `clearFinished` without an audio.cpp event, first-run doors' copy. Also confirm no auto-start path fires with zero models, and that the managed row appears in the connections list the first time a package is enabled.

## Model consolidation — from lane MA (2026-10-29)
- **→ MB:** presence: declare `models:presence` interest, batch ≤200 queries keyed per row, `Holder.runtime` == `DestinationKind`; Ollama recommended: picker when `quants.length > 1`, pre-select `recommended`, pull `quants[i].tag`, show `quantsNote` when empty; ONNX: `catalog.dtypes` → picker, add-by-id offers `ONNX_DTYPES` with the default pre-selected, ALWAYS send `dtype`; audio.cpp: render `families`, pre-select `recommendedId`; a KoboldCPP family downloads file by file via `koboldcpp:downloadModel {kind:"speech"}` (model, then codec); scope labels must read exactly **Speech** and **Transcription** (the refusal sentences name them); document-view KoboldCPP page already sends `kind:"text"`; check that a thrown socket error toasts like a `:error` emit.
- **→ MC:** §24 checks for **presence** (a model's), **holder** (field), **precision** (audio package / ONNX; user-facing word for dtype), **package family**, `runtime: koboldcpp` rows, `quantsNote`; the four refusal sentences; data formats: onnx-list `dtypes`, audio.yaml `precision`/`runtime` header.
- **→ MV:** real HF/Ollama fetch + directory listing behind presence; gemma `UD-` round-trip against the live repo; int tests not run: `packages.v.int`, `process.gate.int`, `resync.int`, `sockets/audiocpp.resync.int`, neighbouring KoboldCPP download ints; `kind:"speech"` accept path at handler level; `families` over a real socket.

## Model consolidation — from lane MB (2026-10-29) → MV
- Reconcile MC's guessed names (REPORT-model-laneMC §"Names guessed") against MB's build; add/amend canon rows MB introduced (**served packages**, **Get a model…** door, document-view labels, `digest.modelsFinder`, `QuantFieldset`); fix the document-view Ollama heading ("Ollama, managed" → run-by rule) if trivial.
- Server fixes MV may make if trivial (else V-n): quant regex excludes mmproj/auxiliary GGUFs; recommended `pullOptions` carry `sizeBytes` from `hfGgufQuants`; Qwen3-TTS 1.7B Base missing from audio.cpp rows.
- Real install walk with the real cpu-portable audio.cpp binary (scratchpad tarball) + a real precision download + Arriving + presence flipping to "You have this".
