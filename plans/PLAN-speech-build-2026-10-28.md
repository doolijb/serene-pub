# PLAN — Speech build: seams, lanes and hand-off (2026-10-28)

**Status: BUILDING since 2026-10-28 (owner "Implement now"); lanes A/B/C launched, D/E/V to follow; briefs in plans/briefs/.** Companion to `PLAN-speech-connections-and-timbre-2026-10-28.md`
(the design; §1–§13). This file is the build order: the **seams** every lane codes against, the
**lanes** (one Opus supervisor each, up to five Sonnet workers), what each lane owns and reads,
and the single verification lane that runs last. Owner rulings 2026-10-28 that bind it: one
global default speaking pair now, voicebank spine underneath · no in-app cloning (no blockers,
not built) · TTS shaping universal/deterministic · spoken audio easy to clear, never cluttering
media · tests and verification last.

## 0. Assumptions taken so the build can start (each reversible, each flagged)

| # | Assumption | Flip cost |
|---|---|---|
| A1 | **Members do not pick voices in phase 1** (★4 unruled). The card's Voice section shows the timbre *description* to everyone; the voice picker is behind `canPickVoice(user)` = admin-only. | one predicate |
| A2 | **Language takes the simple chain** (★13/★14): cue → timbre.language → session language → pub default; **no Latin-script detection**, script-based detection only. A session language setting is added here as an ordinary owner-reach setting. | add a detector later |
| A3 | `pitch` and `volume` stay in the tts sampling schema but are **never sent** (★2); every adapter reports them `ignored`. | delete two fields |
| A4 | Local servers' **WAV is kept** as-is (★11); cloud services are asked for `opus`/`mp3`. | add an encoder |
| A5 | **Whole-file playback** (★12); `audio_streaming` is recorded, `speak@1`'s `streaming` param is accepted and treated as off in the host. | client work |
| A6 | OpenAI is in phase 1 with its models marked ⏳ *shuts down 2027-01-06* in the picker (★1). | remove a row |
| A7 | Phase 1 has **one speaking pair**, so every voicebank entry points at the Narration loadout's model; `resolveVoice` validates that and refuses an entry on another model with a reason. Hence **no cross-service lines and no resampling**. | lift the check |
| A8 | Inflection stored as a record `{ label, intensity?, events? }` from day one; only `label` is written in phase 1. | none |

## 1. Seams — the contracts lanes code against

Each seam names ONE owner lane that writes it and the lanes that read it. A seam file is written
in the first hour of the owning lane, before anything else, and its shape never changes without
the lead. Readers code against the seam, not the implementation.

### S1 — `SpeechFacts` (owner **B**, readers C D E)
`src/lib/shared/connectionAdapters/speechFacts.ts`
```ts
export interface SpeechVoice { id: string; name: string; language?: string;
  labels?: { gender?: string; accent?: string; age?: string; useCase?: string };
  previewUrl?: string; kind: 'preset' | 'clone' | 'designed' }   // 'clone' is read-only: never created by the app
export interface SpeechControls { speed?: { min: number; max: number }; instruction?: 'prose';
  tags?: { syntax: 'bracket'; vocabulary: readonly string[] | 'open' };
  settings?: readonly ('stability' | 'similarity' | 'style' | 'speakerBoost')[];
  language?: readonly string[]; multiSpeaker?: boolean }
export interface SpeechFacts { voices: SpeechVoice[]; voicesFrom: 'discovered' | 'catalogue' | 'typed';
  controls: SpeechControls; streams: boolean; formats: readonly string[]; sampleRate?: number;
  deprecatedOn?: string; notice?: string }
export const readSpeechFacts = (facts: unknown): SpeechFacts | null   // off connection_models.facts.speech
```
Stored under `connection_models.facts.speech` (json; no migration).

### S2 — the adapter action (owner **B**, reader D)
`src/lib/server/adapters/actions.ts` — `SpeechRequest` gains `direction?: string` (prose),
`tags?: string[]` (already in the service's syntax), `language?: string`, `seed?: number`,
`model?: string`; `SpeechResult` gains `spokenAs: { voice: string; model: string; connection: number }`.
`text` is ONE rendered group; the host loops groups. `applied`/`ignored` stay exact per type.
Keys never honoured are not sent (Ollama 400s).

### S3 — SDK contracts (owner **A**, readers D E)
Sibling repo `../serene-pub-sdk`. Evolve @1 in place (10-16 ruling).
- `contracts/src/tasks.ts`: **`core:task/cue-lines@1`** — in `{ text, speaker: participantRef,
  inflection?: Inflection, cast: names[] }`; params `{ quoteStyles, asterisks: 'action'|'emphasis'|'ignore',
  voices: { dialogue, narration, action, aside } ∈ 'speaker'|'narrator'|'silent', language? }`;
  out `{ cues: Cue[] }`. Pure; `effects: 'none'`.
- `contracts/src/oracles.ts`: **`speak@1`** ports in `{ cues: Cue[], speaker, language? }`
  (`text` kept as an alias input for one release); out `{ audio, cueMap: CueMap, spokenAs }`;
  slots `loadout` (default Narration), `prompts { direction: text }`, `template` (line), `sampling`,
  `params { streaming: boolean, gapMs: number (200) }`. Drop `skipCodeBlocks`. Unmark `provisional`.
- `contracts/src/outlets.ts`: **`attach-audio@1`** params `{ replace: boolean }`, in `{ meta?: SpokenMeta }`.
- `sdk/src/capabilities.ts`: **`audio_streaming`** in `FEATURES`; `BANDS.audio_streaming = [none, emulated, native]`.
- `sdk/src/speech.ts` (new): `Cue`, `Inflection { label; intensity?; events?: {marker; at}[] }`,
  `CueMap { source: 'concatenated'|'service'|'none'; spans: {cue; startMs; endMs}[] }`, `SpokenMeta`,
  `INFLECTION_LABELS` (= sprite standard set + `neutral`).
- `core-catalog`: variable templates `core:var/inflection-sentence@1`, `core:var/inflection-tag@1`;
  context templates `core:template/spoken-line-whole@1`, `-dialogue@1`, `-narration@1`; Jinja
  filters `tag`, `dialogue`, `narration`, `strip_code`, `spell_numbers` registered by the app (D2).
- After A lands: `npm run sdk:build` **only if :5173 is not the owner's dev server**.

### S4 — voicebank (owner **C**, readers D E)
Table `voicebank_voices` (migration **0129** via `db:generate`; verify the journal max is still 128
at build time): `id, slug (unique per owner), name, description, owner ('pub'|plugin id), seed_key,
connection_model_id (set null), voice_id, language, settings json, labels json, enabled, is_default,
created_at, updated_at`. Sockets (admin-gated): `voicebank:list|create|update|delete|setDefault`,
member-readable `voicebank:pickable` (name, slug, language, labels, previewUrl only).
Helper `resolveVoice({ speakerRef, sessionId, loadoutId }) → { connectionModelId, voiceId, settings,
language, from: 'timbre'|'session'|'voicebank-default'|'loadout'|'service' }` in
`src/lib/server/speech/resolveVoice.ts` — the ONE resolver (§5 of the design).

### S5 — timbre on the card (owner **C**, reader E)
`src/lib/shared/characters/timbre.ts`: `{ description?: string; voice?: string /* voicebank slug */;
  language?: string; settings?: { speed?: number; stability?: number; similarity?: number; style?: number } }`
at `characters.extensions.serenepub.timbre`; `timbreOfExtensions()` like `likenessOfExtensions`.
Export keeps `description` + `language` + `settings`, **drops `voice`** (pub-local). No clip slot.

### S6 — spoken metadata on the line (owner **D**, reader E)
Message metadata per swipe: `spoken: { spokenAs, cueMap, inflection, template, at }`; the audio is a
`core:audio` part from `attach-audio`. `files.meta.spoken = true`, `files.transcript` = the line.

### S7 — session settings (owner **D**, reader E)
Keys (reach `owner`): `speech.readAloud: 'off'|'make'|'play'` (default off), `speech.template`
(context template id, default whole), `speech.narratorVoice` (voicebank slug | null),
`speech.narrateUser: boolean` (false), `session.language` (ISO 639-1 | null).

### S8 — media (owner **C**, reader E)
`listMedia` excludes `meta.spoken` rows by default; new socket `media:spokenSummary { count, bytes }`
and `media:clearSpoken { sessionId? }`; pub setting `speech.keepSpokenAudio: 'forever'|'archived'|days`;
spoken rows are **derived class** for `cull.ts`.

### S9 — connection types and the dialect (owner **B**)
`src/lib/server/connectionAdapters/speech/openAiSpeechDialect.ts` (one module; `synthesizeSpeech`
+ `discoverVoices` per type via a small per-type profile: route, voices route, honoured keys);
used by `openai`, `koboldcpp`, `koboldcpp_managed`, `ollama`, new **`audiocpp`**; new
**`elevenlabs`** adapter (native). Catalogues `src/lib/shared/speech/catalogues/{kokoro,qwen3,kitten2}.ts`
(voices + controls + notice). Manifest rows, presets, capability rows.

### S10 — managed KoboldCPP (owner **B**)
Load plan gains `audio?: { ttsModelPath; ttsWavTokenizerPath? }` → `ttsmodel` / `ttswavtokenizer`
in the hot-load body beside `sdmodel`; probe already grades `text->audio`.

## 2. Lanes

Every lane: reads **only** its listed files plus the seams it consumes; writes **only** its owned
paths; never runs a full suite (targeted tests are written by lane V); never `sdk:build` while
:5173 is up; never commits; reports to `plans/REPORT-speech-lane<X>-2026-10-28.md` with
deviations, loose ends and ★s. Supervisors keep their context; a worker takes the next item in its
own area rather than the next item on the list.

### Lane A — SDK contracts (Opus + 2 Sonnet) · **first, short**
Owns S3. Reads: `contracts/src/{oracles,outlets,tasks}.ts` (speak, attach-audio, assemble as the
template-slot precedent), `sdk/src/capabilities.ts`, `core-catalog/src/seed/*` for template rows.
- A1: `speech.ts` types, `cue-lines@1`, `speak@1` ports/slots, `attach-audio@1` replace,
  `audio_streaming`; `sdk:build` when allowed.
- A2: variable + context template rows and their seeds; `specHashes`/registry hash pins are
  **left failing for V** (note the hashes in the report).
Done when: `tsc` on the SDK passes and the app's `tsc` sees the new types.

### Lane B — adapters, facts, catalogues (Opus + 5 Sonnet)
Owns S1, S2, S9, S10. Reads: `server/adapters/actions.ts:329-411`, `BaseConnectionAdapter.ts`,
`OpenAIChatAdapter.ts` (images dialect as the pattern), `koboldcpp/probeCapabilities.ts`,
`koboldcpp/modelManager.ts:690-740`, `shared/connectionAdapters/manifest.ts` (one type's row),
`shared/constants/ConnectionTypes.ts`, memory notes `reference_audio_cpp_runtime`,
`reference_ollama_speech_2026_10`, `reference_lightweight_tts_landscape_2026_10`.
- B1: `speechFacts.ts` (S1) + `actions.ts` (S2) **first**; then the dialect module + `openai`
  (+ generic base-URL profile) + `ollama` (`/api/show` voices, strict keys).
- B2: `koboldcpp` external + managed: voices = catalogue (Kokoro 28 ids, Qwen3 9 presets),
  `instruction`/`language`, load plan `audio` (S10), probe → facts.
- B3: `audiocpp` type: manifest row, preset `http://127.0.0.1:8080`, `/v1/models` → connection
  models (family from the id), `/v1/audio/voices` + catalogue for embedded presets, `options.instruct`.
- B4: `elevenlabs` type: `xi-api-key`, `/v1/models`, `/v2/voices` → facts with labels/preview,
  `voice_settings`, audio tags on tag-capable models, `opus`/`mp3`.
- B5: catalogues (Kokoro, Qwen3 incl. speakers+languages, Kitten 2 incl. Stellon notice), facts
  probe/store on `connection_models.facts.speech`, `Refresh` socket `models:refreshSpeech`.
Done when: each type's `synthesizeSpeech` returns audio against a recorded fixture and
`applied/ignored` match the profile table.

### Lane C — voicebank, timbre, resolution, media (Opus + 4 Sonnet)
Owns S4, S5, S8 + migration 0129. Reads: `db/schema.ts` loadouts block (`:1071-1135`) as the
table pattern, `sockets/connections.ts` (admin gate pattern), `shared/characters/likeness.ts`,
`server/characters/likeness.ts` + `cardIO.ts:300-320`, `sockets/characters.ts:460-480`,
`media/cull.ts` header, `sockets/media.ts` listing, `media/generatedMedia.ts`.
- C1: schema + `db:generate` + sockets + seed of a `pub` default entry when Narration is filled.
- C2: timbre shared/server + card export/import + `characters:update` validation.
- C3: `resolveVoice` + language chain + A7 validation + session narrator voice read (S7 keys are
  D5's; C3 reads them by name).
- C4: media: `spoken` class, listing exclusion, summary/clear sockets, retention setting + the
  schedule-tick sweep hook.
Done when: resolver unit fixtures cover every `from` value; migration applies on a scratch DB.

### Lane D — runtime and pipelines (Opus + 5 Sonnet)
Owns S6, S7, host bindings, core-catalog spec edits (sibling repo). Reads: `runtime/host.ts`
attach-audio case (`:9146-9290`) and one oracle case as the pattern, `runtime/bindings.ts`
generate-image entry, `config/panel/flows.ts` labels, `media/generatedMedia.ts`, core-catalog
`genres/story/respond.ts:1418-1455` (sprite tail), `genres/story/generateImage.ts` (action spec
pattern), `genres/lair/fileRoom.ts:84-135` (message-venue action), `sdk/src/actions.ts:1150-1200`
(core verbs), `shared/sessions/*` for settings reach.
- D1: host handlers: `cue-lines@1` (pure, with the quote/asterisk/`Name:`/marker tables),
  `speak@1` (group by voice+inflection+language → render line template → `direction` prompt →
  `resolveVoice` → adapter per group → concat PCM with `gapMs` → store via `storeGeneratedMedia`
  with `spoken` meta + transcript → `cueMap: concatenated`), `attach-audio` `replace` + S6 meta.
- D2: Jinja filters (`tag` via the resolved model's vocabulary, `dialogue`, `narration`,
  `strip_code`, `spell_numbers` en-only) + rendering of the `template` and `prompts.direction`
  slots on `speak@1`; crosswalk table marker→label.
- D3: spec tails (core-catalog): story `respond`, `narrate`, `narrateCharacter`; guide `respond`;
  lair `reply` — after `spritePick`, behind the `speech.readAloud` junction, `expose: { session: true }`.
- D4: core spec `core:spec/speak-message@1` + core verbs **Read aloud** / **Say it as…**
  (message venue, item rule, collects inflection label for the second).
- D5: S7 settings declarations + door reach + `session.language` plumbed to the cue task.
Done when: a reply on an isolated instance with Read aloud = make produces an audio part with
S6 metadata, and Read aloud twice on one line replaces the part.

### Lane E — surfaces and docs (Opus + 5 Sonnet) · starts on seams, finishes after B C D
Owns UI + docs + canon. Reads: STYLE-GUIDE §6.3/§6.6 (pickers), `components/loadouts/
LoadoutSheet.svelte` + `loadoutsGrid.ts`, `components/characterForms/LikenessTab.svelte` (section
pattern), `admin/sections/connections/IdPage.svelte` (model page), `sessionForms/
SessionSettingsForm.svelte`, the Messages widget under `components/sessionPage/` (audio part
render), `docs/connections.md` §Loadouts/§Sound, `docs/sessions.md`, NOMENCLATURE §10 §9 §25.
- E1: shared `VoicePicker.svelte` (facts-driven: filters from labels, preview, *Try with this
  line*, origin line) + card **Voice** section (description always; picker behind `canPickVoice`).
- E2: admin **Loadouts → Voices** panel (voicebank CRUD, default star) + Models page **Voices**
  table with Refresh + managed KoboldCPP **Speech model** field + ⏳ deprecation chip.
- E3: session settings block (S7) + narrator voice + line controls (play, *Spoken as*, Say it
  again, Say it as…) + Messages widget autoplay for the newest line + cue highlighting from `cueMap`.
- E4: Media **Spoken lines · N · MB · Clear** folded row (admin panel + session media) + retention
  setting in Admin → General.
- E5: docs (`connections.md` new **Speech** section: types, voices, voicebank; `sessions.md` **Read
  aloud**; `session-layout.md` line controls), NOMENCLATURE rows (**speech facts**, **speech
  dialect**, **voicebank**, **timbre**, **inflection** 🚧) + §25 ledger, `coming-from-sillytavern.md`
  voice-map paragraph.
Done when: every surface renders against lane B/C/D data on an isolated instance.

### Lane V — verification (Opus + 5 Sonnet) · **last**
Reads the five lane reports first. Owns all tests.
- V1: unit — `cue-lines` fixtures (quote styles, asterisks, `Name:`, markers, CJK), filters,
  crosswalks, **determinism conformance**: one line × every shipped profile → stable request bodies
  across two runs.
- V2: adapters — dialect per type with recorded fixtures (`applied/ignored`, Ollama 400 on extras,
  KCPP instruction extraction, ElevenLabs settings), facts probe.
- V3: int — voicebank sockets + gate, resolver, timbre export/import, media exclusion/clear/sweep,
  migration 0129 on scratch (`feedback_int_test_timeouts_under_load`: 60 s).
- V4: browser walk on an isolated instance (`reference_isolated_dev_instance_recipe`) against
  KoboldCPP + Kokoro and, if installed, audio.cpp + Qwen3 CustomVoice: Read aloud on/off, Say it
  as…, replace, Clear; screenshots to the report.
- V5: `tsc`, `svelte-check`, `sdk:test` (re-pin spec/registry hashes A2 left), docs compile,
  budgets. ONE grouped run at the end (`feedback_batch_large_verification_runs`), capped scope.
Done when: all green and `REPORT-speech-laneV` lists every pin that moved and why.

## 3. Order and parallelism

```
A (hours) ──► D (needs A's types)
B ──────────┐
C ──────────┼──► E (seams first; real data as B/C/D land) ──► V
D ──────────┘
```
B and C start at once from the seams; D starts when A's build is visible; E starts on seam stubs
and swaps to real sockets as they land. V starts only when A–E have reported.

## 4. File ownership (no two lanes write one file)

| Path | Lane |
|---|---|
| `../serene-pub-sdk/{contracts,sdk}/src/**` | A |
| `../serene-pub-sdk/core-catalog/src/seed/**` (templates) | A |
| `../serene-pub-sdk/core-catalog/src/genres/**`, `core-catalog/src/shared/speakMessage.ts` | D |
| `src/lib/server/adapters/actions.ts`, `src/lib/server/connectionAdapters/**`, `src/lib/shared/connectionAdapters/**`, `src/lib/shared/speech/catalogues/**`, `src/lib/server/koboldcpp/**`, `src/lib/shared/constants/ConnectionTypes.ts` | B |
| `src/lib/server/db/schema.ts` (voicebank block only), `drizzle/0129*`, `src/lib/server/sockets/voicebank.ts`, `src/lib/server/speech/resolveVoice.ts`, `src/lib/shared/characters/timbre.ts`, `src/lib/server/characters/timbre.ts`, `src/lib/server/media/**`, `src/lib/server/sockets/media.ts` | C |
| `src/lib/server/pipelines/**`, `src/lib/server/messages/**`, `src/lib/shared/sessions/speechSettings.ts` | D |
| `src/lib/client/**`, `docs/**`, `NOMENCLATURE.md`, `STYLE-GUIDE.md` | E |
| `**/*.test.ts`, `**/*.int.test.ts`, `**/*.dom.test.svelte.ts` | V |

Shared files with two readers and one writer: `sockets/characters.ts` (C writes the timbre
validation hook only, in one function), `sockets/connections.ts` (B adds `models:refreshSpeech`
only), `schema.ts` (C appends one block).

## 5. Hand-off brief (what a supervisor receives, verbatim)

1. This file's §0, §1, its own lane in §2, §4. Nothing else of this plan.
2. The design plan's sections its seams cite (named per lane above), read by section with `sed -n`.
3. CLAUDE.md hard rules, with three repeated: no `sdk:build` while :5173 is the owner's server;
   never `git checkout`/`stash` in the SDK repo; migrations are generated and must exceed the
   applied max.
4. The memory notes named in its lane (three at most).
5. "Write your seam file first. Code to seams, not to other lanes' implementations. Do not read
   beyond your list; ask the lead for a path instead. Targeted tests belong to lane V: leave a
   note of what to test, not the test. Report deviations as they happen, in your report file."

## 6. Open ★ carried into the build

★1 OpenAI shutdown (A6) · ★2 pitch/volume (A3) · ★4 member picking (A1) · ★9 who may switch Read
aloud on paid services (phase 1: owner only, no cap) · ★11 WAV (A4) · ★12 chunked delivery (A5) ·
★13/★14 language (A2) · ★15 **voicebank naming**: the owner said "Roster"; canon already has the
cast roster and the member roster, so the code word is `voicebank` unless the owner objects.
