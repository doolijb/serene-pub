# REPORT — Lane V (verification) — 2026-10-28 · DONE

Supervisor (Opus) + Sonnet workers V1 (unit), V2 (adapters + determinism), V3a (int: voicebank/resolver/timbre/F1/migration), V3b (int: media/pipelines/seeders), V4 (browser walk). V5 (pins + grouped run) done by the supervisor.

## Pin fixes
- ★A2 applied (SDK `sdk/src/capabilities.ts`, 17:14): `EMULATABLE_VIA.audio_streaming = []`, plus the two comments that described it as "no entry"/"first three" corrected. `sdk:build` ran 17:15 with :5173 free and no dev instance (exit 0).
- Second `sdk:build` 17:52 (:5173 free, no dev instance) after the three SDK source edits lane V made, all additive/mechanical: `sdk/src/component.ts` re-exports the speech types; `core-catalog/components/shared/messages/{SpokenLine.svelte,spokenLine.ts}` import through `@serene-pub/sdk/component`; `HOST_ELEMENTS_VERSION` 1.5 → 1.6 (+ `sdk/host-elements.d.ts` regenerated). The V4 walk ran on that build.
- `$S` = `/tmp/claude-1000/-home-jody-github-serene-pub/564efcec-663a-419e-8efc-7e445249445f/scratchpad`; logs `$S/laneV/G-*.log`, worker logs `$S/laneV/V*/`.

## Pins moved (and why)
App (each speech-only move PROVEN by stripping the speech additions from the built document and hashing back to the recorded pin — script `$S/laneV/pins/prove.mjs`):
- `pipelines/boot/specHashes.test.ts`: story-respond, guide-respond, story-side-character, story-narrate (speech tail appended: 5 nodes + their edges + the `readAloud` clause); lair-reply (same tail nested in the delver branch — proof also shifts later node/clause `position`s back); story-create, guide-create, lair-create (genre decl gains the 4 speech fields; Guide's whole `fields` map). NEW `core:spec/speak-message@1.0.0` = 3f96a96de2af8.
- `pipelines/boot/registryHashes.test.ts`: `core:outlet/attach-audio@1` 1f92305dec26b9 → 1b89057ef5ad36 (`meta` in-port + `params.replace`); `core:oracle/speak@1` d72aee8a96401 → 115012f3717eba (S3 contract; bound, flag gone); NEW `core:task/cue-lines@1` 34df3bdd9d588, `core:query/message-line@1` 1affa775a4525c; the "three flagged definitions, bound" assertion now covers mcp-tool/mcp-resource and asserts speak has no flag.
- `pipelines/boot/bindingCompat.test.ts`: "the three provisional ones" → two (mcp-tool, mcp-resource); speak, cue-lines, message-line asserted bound.
- `pipelines/boot/registrySync.int.test.ts`: the three R-2 status tests used speak as the flagged control; now mcp-tool, and speak asserted `live`.
- `connectionAdapters/manifest.conformance.test.ts`: NOT a hash — its `beforeAll` never walked the new `speech` registry slot, so all six `text->audio` types read as unimplemented. Added the slot walk (`actionsOf(Adapter, BaseSpeechAdapter)`).


SDK (`sdk-tests/`, all re-run green except the golden below):
- `contract.test.ts` (V6 policy tests) and `rulings.test.ts` (R-2 flagged list): speak no longer provisional → the flagged control is mcp-tool/mcp-resource; speak asserted unflagged.
- `coreGenreDefaults.test.ts` parity: every genre's actions + `core:spec/speak-message#read-aloud` / `#say-it-as` (`SPEAK_VERBS`).
- `dungeonCrawler.test.ts`, `lair.test.ts` (spine + Words only): the same two verbs in the registration lists.
- `lair.test.ts`: levers test separates the 4 speech fields from the GM's levers (reach check widened to all); `lair-create` d927ed6661005 → 3b5ac8f6f9ab1, `lair-reply` c4fe814f1e089 → 73fa4f3b363fb (both proven as above); live-row list + `readAloud.make.attach` / `readAloud.play.attach`.
- `lair.test.ts` character-turn tests ×2 went `err`: the speech tail's `cue` step runs on every reply and the fixture host had no `core:task/cue-lines@1` stand-in. Added one to the shared `helpers.ts` (beside the sprite stand-ins, same precedent).
- `writes.test.ts`: Story create 37a22c038f516 → fd12c6ff3be21, Guide create c06cc623f9142 → 135f054ab8ea7f (proven).
- `coreCatalog.test.ts`: Story's action registrations 14 → 16 (11 a person presses).
- `componentBuiltAgainst.test.ts`: host-element vocabulary grew (`audio` takes `autoplay`, lane E) → `HOST_ELEMENTS_VERSION` '1.5' → **'1.6'** (SDK `sdk/src/hostElements.ts`, minor = grew only) and the shape pinned under 1.6 (6e32a5b3…). `sdk/host-elements.d.ts` regenerated (`npm run host-elements -w sdk`) — `hostElements.test.ts` green.
- `coreComponentSources.test.ts`: core's `SpokenLine.svelte` / `spokenLine.ts` imported speech types from `@serene-pub/sdk` (forbidden for components). Fixed: `sdk/src/component.ts` re-exports `CueMap, Inflection, SpokenAs, SpokenMeta` (additive), both files import from `@serene-pub/sdk/component`.
- `capabilities.test.ts:268` green after ★A2.

## Pins that moved for a NON-speech reason (not re-pinned — reported)
App (Mundi agent's work, left red on purpose):
- `registryHashes`: `core:outlet/advance-story-clock@1` recorded 7918829884527 → code 118e5d7be719d3; `core:query/cast-presences@1` 68689a20c23d4 → b8400a3942873; unpinned new types `core:query/lorebook-annex@1` f7b0c5dddbcc, `core:outlet/set-lorebook-annex@1` 14aaff8ed20d3a, `core:outlet/set-lorebook-annex-field@1` 44910c1fc9bad, `core:outlet/convert-ruleset@1` 13e84ee0942730.
- `specHashes`: unpinned new `core:spec/weather@1.0.0` (1123a7599ac1bc).

SDK:
- `coreCatalog.test.ts` golden ("the canonical document is unchanged"): 0542b047614b9f33 → a0340e2c66a0f72a. **MIXED** — the announcement now carries speech AND the Mundi agent's `core:spec/weather` (+ advance-story-clock references), so it cannot be proven speech-only. Left red; whoever lands Mundi re-pins it once.
- Mundi-only (untouched): `attributes.test.ts:421` (day-period/season/time-of-day derivations), `channels.test.ts:346` (audience wording), `fit.test.ts:277` (`lorebook-annex-changed` states no carries), `forms.test.ts:431` (`convert-ruleset` lacks review.fields), `framePort.test.ts:191` (state cap 16384 → 262144), `guideSnippets.test.ts` (`guides/genres-presets-and-routines.md:211/219` fences), `rulesetSections.test.ts:355` (7 ruleset template hashes), `surface.test.ts:447` (`@serene-pub/cli ./bin writePackageZip` untagged), `turnOrder.test.ts:82` (event registry 46 → 48: `ruleset-converted`, `lorebook-annex-changed`).


## Targeted tests written (all new files, beside the code; list in `$S/laneV/targeted.txt`)
- **V1 unit** (14 app files, 210 tests; 2 SDK files, 59 tests): `pipelines/speech/{cueLines,audio,lineTemplate,messageLine}.test.ts`, `pipelines/runtime/dispatchSpeech.groupCues.test.ts`, `pipelines/prompt/renderers.jinja2.test.ts`, `pipelines/entities/speechTemplateIds.test.ts`, `speech/resolveVoiceCore.test.ts` (every fixture + service fallback + language chain), `characters/timbre.test.ts`, `shared/sessions/speechSettings.test.ts`, `shared/speech/inflectionLabels.test.ts`, `client/components/{speech/voicePicker,characterForms/voiceTab,sessionForms/speechSettingsBlock}.test.ts`; SDK `sdk-tests/speechTemplateFilters.test.ts`, `sdk-tests/speechCatalog.test.ts` (28 labels, layouts, line templates, speak-direction row, speak-message validates + 2 actions in 5 genres, tails identical, sprite-pick→cue-lines→speak→attach validates, speak timeout 180000, ★A2).
- **V2 adapters** (9 files, 241 tests): `connectionAdapters/speech/{speechAdapters.fixtures,speechDiscovery,speechListings,speechListings.managed,determinism.conformance}.test.ts`, `speech/speechFactsStore.int.test.ts`, `connectionAdapters/speech.conformance.test.ts`, `koboldcpp/modelManager.speech.test.ts`, `connections/modelSync.speech.int.test.ts`. Lane B fixtures 1, 2, 3, 4, 6, 7 match the code byte-for-byte incl. key order and applied/ignored; fixture 5 omits `jinja:true`, which the code always writes (fixture abbreviated, code right). **Determinism conformance**: one line × 9 profiles (openai cloud gpt-4o-mini-tts, openai-compatible kokoro, ollama, KCPP Kokoro, KCPP managed Kokoro, KCPP Qwen3 CV, audio.cpp Qwen3 CV, audio.cpp Kitten 2, ElevenLabs v3) through cueLines → groupCues → renderSpokenGroup/renderDirection → splitForLimit → synthesizeSpeech: two runs on one adapter and one on a fresh adapter record byte-identical url/method/body. Composed from the pieces (driving `dispatchSpeech` needs the resolver, voicebank and media store).
- **V3a int** (6 files, 65 pass + 4 `it.fails`): `speech/voicebank.int.test.ts`, `speech/voicebank.fresh.int.test.ts` (real fresh boot), `speech/voicebank.migration.int.test.ts` (0129 over 0128 data: 15 cols, FK SET NULL, 3 indexes, `keep_spoken_audio` default 'forever', earlier rows survive; 0130 applies after), `sockets/voicebank.int.test.ts` (incl. the interest gate through the real `connectSockets`), `sockets/characters.timbre.int.test.ts`, `sessions/narratorVoice.int.test.ts`. **F1 fresh-DB check: PASSES at the voicebank/resolver level** (Narration only filled, Defaults untouched → `speakingLoadout` = Narration, `voicebank:list.pairModelId` non-null, Narrator seeded, `resolveVoice` ok) — but see defect V-1: the speak step itself does not use that fallback.
- **V3b int** (7 files, 47 tests): `sockets/mediaSpoken.int.test.ts`, `services/spokenRetentionService.test.ts`, `pipelines/runtime/{attachAudio,dispatchSpeech.store,speechTail}.int.test.ts`, `pipelines/speech/messageLine.int.test.ts`, `pipelines/boot/seedSpeech.int.test.ts`.

## Defects found (not patched — larger than a typo)
- **V-1 (HIGH) F1 is only half fixed: on a fresh pub with only Narration filled, replies are never spoken.** `src/lib/server/pipelines/runtime/dispatchSpeech.ts:398-408` resolves the pair through `resolveCapabilityTarget(db, { capability: "text->audio" })` (`src/lib/server/connections/capabilityTarget.ts:438`), which has no seed-key fallback; only `speakingLoadout()` (`src/lib/server/speech/voicebank.ts:40`) has it. So the voicebank UI shows a pair and `resolveVoice` works, while every speak throws `SpeechDispatchError` and the host binding (`runtime/host.ts` speak case, ~l.6553) turns it into "nothing spoken" — no log line, no toast. Seen in the walk (V4 step 6): no `/audio/speech` call until Narration was made the `text->audio` default (`loadouts:setDefault`). Fix direction: one reader for "which loadout speaks" (give `resolveCapabilityTarget` the same seed fallback for `text->audio`, or have dispatch use `speakingLoadout`) and surface the refusal instead of swallowing it silently.
- **V-2 `characters:create` does not guard `timbre.voice`** (lead decision 1): a member's voice is stored as sent, and an admin's create runs no timbre validation (length/language/slug). `src/lib/server/sockets/characters.ts` `charactersCreate` (~l.484–575); the hook exists only in `charactersUpdate` (~l.691). Fix: route `extensions` through `applyTimbreUpdate(carded.extensions, {}, { db, user: socket.user })`. Pinned as `it.fails` in `sockets/characters.timbre.int.test.ts`.
- **V-3 narrator-voice validation bypassed by create and update**: `sessions:create` stores `genreFields.speechNarratorVoice` as sent (unknown or disabled slug) — `src/lib/server/sockets/sessions.ts` ~l.997 filters by declared key only; `sessions:update`'s `genreFieldsPatch` likewise (~l.5728). Only `sessions:updateSetting` runs `narratorVoiceRefusal`. Presets do not copy a pinned voice into `genre_fields` (test passes). Impact low (resolution skips an unknown slug with a reason) but the store holds garbage. Three `it.fails` in `sessions/narratorVoice.int.test.ts`.
- **V-4 SDK derive-don't-spell violations** (`sdk-tests/deriveDontSpell.test.ts:198,245`, red): `core-catalog/src/shared/speakMessage.ts` 3 × `($: any)`, 2 × builder callback typed `any`; `core-catalog/src/shared/speechTail.ts` 7 × `($: any)`, 2 × junction path strings (`'fields.' + SPEECH_FIELD_KEYS.readAloud`) → "path into published state: 23 (ruled 21)". Lane D owes typed accessors (or `// derive-don't-spell: <why>` allowances, which need the owner's say for the +2 ruled strings). Output:
  ```
  + 'shared/speakMessage.ts: 3 × ($: any) (allowed 0)', 'shared/speakMessage.ts: 2 × builder callback typed any (allowed 0)',
  + 'shared/speechTail.ts: 7 × ($: any) (allowed 0)', "shared/speechTail.ts: 2 × junction path: '…' (allowed 0)"
  + "path into published state: 23 (ruled 21) — …"
  ```
- **V-5 the next reply queues behind the speech tail** (walk step 11, slow TTS 15 s/call): the composer is NOT blocked (typing and sending work), but the second reply's chat call started only after the first reply's three speech calls finished (~37 s), because the speak binding runs under `line.hold` (`runtime/host.ts` speak case). No "speaking" indicator on the reply meanwhile, and Stop is not offered during the tail. Owner/lead call: release the line before speaking, or show the state.

- **V-6 (tsc + svelte-check RED) the speech resident's wire shape disagrees three ways.** The lead's F3 edit typed `GetLoadedConfig.Response.config.resident.audio?: Resident` (`src/lib/shared/sockets/types.ts` ~l.12168, `Resident` requires `file`), but the server passes the model manager's `Residency` straight through (`src/lib/server/sockets/koboldcpp.ts:923`), whose `audio` is `AudioModelSlot {ttsFile?, ttsModelPath, ttsWavTokenizerPath?, ttsGpu?}` (`src/lib/server/koboldcpp/modelManager.ts:119-129`), and the Perf tab casts it to `{file, wavTokenizerFile?}` (`src/lib/client/components/koboldcppManager/KoboldCppPerfTab.svelte:55-66`). Result: `TS2322` at koboldcpp.ts:923, and the Perf tab's **Speech model / Speech tokenizer** rows read fields the server never sends (they stay empty). Fix: map the slot in the handler to `{ file: ttsFile ?? basename(ttsModelPath), wavTokenizerFile: basename(ttsWavTokenizerPath) }`, type `audio?:` as that, and drop the client cast. Not patched (a seam choice between B, E and the lead's F3).

## Findings (behaviour worth a look; tests pin current behaviour)
- Deleting the last voicebank row re-seeds a Narrator in the very `voicebank:list` push the delete triggers — an admin can never empty the voicebank while Narration has a model (UX hazard; `ensureVoicebankDefault` runs inside `buildList`).
- A configured quote style `<<…>>` can never work: marker lifting (`<word>` regex, `liftMarkers` in `pipelines/speech/cueLines.ts`) runs before the quote scan and eats `<yes>`.
- The default direction template `{{ timbreDescription }} {{ inflectionSentence }}` (SDK `core-catalog/src/seed/speechTemplates.ts:256`) joins with no punctuation: "a warm contralto Speak brightly, with open joy." — sent to the model verbatim.
- ElevenLabs drops an out-of-range speed (reports `ignored`); the OpenAI dialect and audio.cpp clamp it (report both). Inconsistent across adapters.
- OpenAI's tts regex marks `tts-1-1106` as tts, but the deprecation list has no dated tts-1 snapshots.
- The Lair's speech tail is nested in the delver branch (the plan-posted steps follow it), so "the tail is the last step" holds for the other four reply specs only — by design (speaks only a delver's line).
- `cue` runs on every reply, Read aloud on or off — pure, no I/O, negligible cost; but it is why every fixture host needs a cue-lines stand-in.
- Walk: the session Read aloud card's language field showed "en" while the stored `sessionLanguage` was "" (placeholder?); each load of a session whose spoken files were cleared logs a console 404 per missing file (harmless, noisy). *Say it as…* on a fake `tts-1` host sends no direction (not honoured there) — expected.
- `sessionSpeechSettings` reads stored speech fields only for keys the session's genre declares; a session whose (plugin) genre is gone reads all four as defaults.
- ★B5 doc checks (V2): Kitten TTS 2 — **contradicted**: upstream README says 115 built-in voices; `catalogues/kitten2.ts` ships 47. KCPP Qwen3 0.6B — confirmed (KoboldCpp wiki). ElevenLabs `language_code` ignored on multilingual_v2 and seed 0..2³²−1 — confirmed (API convert docs); speed 0.7–1.2 — only the agents-platform docs state it, the core TTS reference states no range. Ollama `/api/show` voices location, audio.cpp `language` per family, KCPP's 28 Kokoro ids — not found in public docs.
- Not speech, seen in passing: `src/lib/server/connections/reasoningDisabledWire.int.test.ts` "the shipped Default config resolves without either reasoning key" fails (`resolved.contextTokens` undefined) — likely the vi.mock-of-`$lib/server/db` trap (a mocked db whose factory imports `db/defaults` loads the REAL db module, so `sync()` writes elsewhere).

## Browser walk (V4) — isolated vite :5261 (scratch PGlite `$S/laneV/V4/dev-data`), fake OpenAI-compatible host :5262, private headless Chromium (playwright library); never the shared MCP browser. Shots in `/tmp/claude-1000/-home-jody-github-serene-pub/564efcec-663a-419e-8efc-7e445249445f/scratchpad/laneV/V4/shots/`.
1. Narration only filled → Loadouts › Voices shows ★ Narrator (`narrator:alloy`), `pairModelId` 2 — OK (`01a-loadouts-view.png`, `01-voices-panel.png`).
2. New voice "Old Bruno" (onyx) via picker; model page Voices table (alloy/nova/onyx) + Refresh — OK (`02a…02f`).
3. Card Speech tab: description + `en` + Old Bruno saved and kept on reopen — OK (`03a…03c`).
4. Read aloud card: Off · Make audio · Make and play; *As the pipeline says* selected when unset; narrator picker; language; Spoken lines row — OK (`04-read-aloud-card.png`).
5. Off → no spoken line, 0 `/audio/speech` calls — OK (`05-off-reply.png`).
6. Make audio → **broken on a fresh pub (V-1)**; after `setDefault` on Narration: player + "Spoken as onyx · tts-1"; 3 calls — dialogue in onyx (Old Bruno), narration in alloy (narrator), dialogue in onyx; `metadata.spoken` has spokenAs {voice, voices, model, applied [voice, format], ignored [language]}, 4 cue-map spans (`06a`, `06b`).
7. Make and play → newest line autoplays once; older line stays paused; reload replays nothing — OK (`07a…07c`).
8. Say it again → take replaced, old file gone, one audio element per line (identical bytes dedupe into one shared row first — expected) — OK (`08-say-it-again.png`).
9. Say it as… → "How should it sound?" → "angrily" → record inflection `{label:"anger"}` — OK (`09a…09c`).
10. Clear spoken lines → every line "Not spoken yet · Read aloud · Say it as…"; Read aloud speaks again — OK (`10a`, `10c`, `10d`).
11. Slow TTS (15 s/call): composer free; next reply queued ~37 s behind the tail (V-5) (`11a…11d`).
12. Admin › General Keep spoken audio = 30 days round-trips; Admin › Data shows Spoken audio + Clear — OK (`12a`, `12b`).
13. Member's view of the card (A1) — NOT walked (enabling accounts is one-way on that data dir, needs a second login flow); A1 is covered by `sockets/characters.timbre.int.test.ts` server-side only.
No `pageerror` in any step; vite and the fake server stopped with SIGTERM.

## Grouped run (V5, once, capped scopes, after every worker finished; no dev instance up)
| Step | Result |
|---|---|
| `npx tsc --noEmit -p .` | **RED, 2 errors**: pre-existing `arrangeCanvas.dom.test.svelte.ts` `NARROW_SIDE_PX` (not ours) and **V-6** `src/lib/server/sockets/koboldcpp.ts:923` TS2322. (The first pass also showed 12 type errors in lane V's own test files — `speech.conformance.test.ts` imported `ActionName` from the wrong module, `speechAdapters.fixtures.test.ts` Uint8Array/Error-union typings, `spokenRetentionService.test.ts` passed an argument to `shutdown()`. Fixed; the three files re-run green, 113/113.) |
| `npm run check` | **RED, 13 errors** = the 12 lane-V test typings since fixed + V-6. 7 warnings (pre-existing). |
| `npm run sdk:test` | SDK `tsc` clean. **4021 tests, 4010 pass, 11 fail**: 2 speech (V-4 derive-don't-spell ×2), 1 mixed (core golden), 8 Mundi (listed above). |
| docs compile (`npm run docs:build`) | **GREEN**: 152 pages, 1 asset; one warning `time` (sdk-guides) missing from `order` — Mundi's new guide. |
| `npm run test:budgets` | **RED, 1/5**: `docsDist.budgets.test.ts` page budget — 4.01 MB rendered vs 3.00 MB. Not speech-caused: `sdk/pipelines` alone is 1.97 MB (DC respond 210 KB, lair-reply 185 KB); speech adds the speak-message page (7 KB) and the tail in five reply pages (tens of KB). No older manifest on disk to prove the before-state; the owner should re-budget or slim the pipeline pages. |
| Targeted suites (44 files: the 36 new + 8 pin files) | **42/44 files, 779 pass + 4 expected-fail, 3 fail** — the 3 fails are the Mundi-only pins above (advance-story-clock, cast-presences, lorebook-annex ×3, convert-ruleset, weather). `seedPrompts.int.test.ts`, which hung twice (20 min, 10 min) while other agents' suites ran concurrently, passed here and alone (14 s) — watch it. |

## Could not verify
- A member's view of the card's Speech tab in the browser (A1) — covered server-side only.
- Real Socket.IO client gating (V3a drove the real `connectSockets` with a fake io).
- Multi-voice join through the real runtime, real TTS servers, streaming (A5: recorded, never played).
- Leftover `/tmp/serene-pub-vitest-*` dirs (≈11 since 17:10) may include two from my early pin runs that hit `timeout` (exit 124); they are not provably mine, so they are left to the 6 h sweep.
- Live TTS: no KoboldCPP/audio.cpp server running and no TTS model on disk (only Ollama 0.30.7 on :11434, which has no speech). Walk uses the fake OpenAI-compatible server path from lanes D/E.

## Lead follow-up (2026-10-28, after hand-back)

Fixed by the lead, re-verified (app tsc: only the pre-existing `NARROW_SIDE_PX` error; svelte-check 0 errors; `narratorVoice.int`, `characters.timbre.int`, `dispatchSpeech*` green):

- **V-1** `dispatchSpeech.ts`: with no slot connection, the target now comes from `speakingLoadout()` (text→audio default, else Narration by seed key) before `resolveCapabilityTarget`. A fresh pub with only Narration filled speaks.
- **V-2** `sockets/characters.ts` create: `applyTimbreUpdate(extensions, null, …)` runs as on update — member voice dropped, unknown voice refused. Pin flipped from `it.fails` to `it`.
- **V-3** `sockets/sessions.ts` create and update: `narratorVoiceRefusal` runs on `speechNarratorVoice`; an unknown or disabled voice **refuses the write** (same discipline as the settings form). The two create pins now expect the refusal; the update pin passes.
- **V-6** wire type `ResidentAudio { ttsFile?, ttsModelPath, ttsWavTokenizerPath?, ttsGpu? }` mirrors the loader's `AudioModelSlot`; Perf tab reads it directly.

Still open: V-4 (SDK derive-don't-spell, lane D owes typed accessors or owner rules on the 2 strings), V-5 (speak step under `line.hold`, no "speaking" indicator / Stop), the mixed speech+Mundi golden hash, Mundi's own pins, the docs-size budget, the seedPrompts hang watch, and the "other findings" list.
