# PLAN — Speech: the first connections, and who tunes a voice (2026-10-28)

**Status: PROPOSED; partly RULED 2026-10-28** (one global default pair now, voicebank spine underneath; §11 universality rule; §12 storage). Nothing built. Surveyed against HEAD `6ffa72f6` and the SDK sibling on
2026-10-28, plus a same-day survey of the runtimes (KoboldCPP 1.123.1, audio.cpp v0.9.3,
Ollama 0.40.12, OpenAI and ElevenLabs public docs). Owner words quoted where they rule. Every ★
is open until the owner rules it ("planning is not go"). Words marked 🚧 are proposed names and
enter NOMENCLATURE §25 only with the build.

## 0. What is being asked

1. The initial list of speech connections: KoboldCPP, audio.cpp, and the most popular online
   provider(s). For each: what it is, its models, its voices, what it can tune.
2. What a loadout decides, and what is tuneable per **character**, per **envoy** ("agent"), and
   per **session**.
3. What tuning *looks like*: the options a person sees must follow from the connections and models
   this pub has, never from a fixed form.

## 1. What already exists (do not rebuild)

- The action seam: `synthesizeSpeech(req, signal)` on an adapter is the statement "this service
  speaks" (`server/adapters/actions.ts:329-411`, `shared/connectionAdapters/actions.ts`). Its
  `SpeechRequest { text, voice?, format?, speed? }` and `SpeechResult { media, applied, ignored }`
  already carry the applied/ignored discipline images use. **No adapter implements it today**
  (`koboldcpp/probeCapabilities.ts:93`, `shared/connectionAdapters/manifest.ts:679,751`).
- The capability: transform `text->audio`, graded per connection; KoboldCPP's probe already reads
  its `tts` flag into it (`probeCapabilities.ts:131`), recorded but unresolved.
- The modality: `tts` on `connections`, `connection_models` and `local_models` (0172), and the
  model's **What it's for → Speaks** tick (docs/connections.md:608).
- The loadouts: **Narration** (`text->audio`, default), **Spoken reply** (`text->text+audio`),
  **Transcription** (`audio->text`) — `core-catalog/src/loadouts.ts:105-131`, all unfilled on a
  fresh pub.
- The sampling shape `core:shape/tts@1` with `ttsSamplingSchema`: `voice`, `speed` (0.25–4),
  `pitch` (−20..20), `volume` (0..2) (`sdk/src/sampling.ts:662-698`). The **speech sampling** slot
  on `generate-text@1` (O7) and the declared-but-unbound oracle `core:oracle/speak@1`
  (`contracts/src/oracles.ts:886-922`; `provisional: true`, `review: { fields: ['text'] }`,
  param `skipCodeBlocks`).
- Per-line emotion precedent: the sprite picker writes `{ set, label, source }` into message
  metadata per swipe; labels are free-form with `STANDARD_SPRITE_LABELS` (go_emotions' 28) as the
  starter (`shared/sprites/index.ts:73`). "Emotions are never cast state" (DESIGN-sprites).
- Card-side storage precedent: `characters.extensions.serenepub.likeness` (`shared/characters/
  likeness.ts`), exported and re-imported with the card.
- Rulings that bind this plan: members never see connections, models, sampling or loadouts
  (2026-10-12); pickers say what the choice decides and why (2026-10-15); formats and presentation
  belong to widgets and templates, not SDK decl fields (2026-10-15); genres expect, never lock
  (2026-10-23); no magic in core for pipeline data (2026-09-30); one source for the cancel signal.

## 2. The connections — initial set

Every local server below speaks OpenAI's `POST /v1/audio/speech` body (`model`, `input`, `voice`,
`response_format`, `speed`, `stream`); only the voice list and the expression controls differ. So
there is **one speech dialect** 🚧 (OpenAI-speech, like the OpenAI-images dialect of §10) with
per-type *voice discovery* and *controls*, plus **one native dialect** for ElevenLabs. Ordered by
what ships first.

| # | Connection | Type today | Speech route | Models (engines) | Voices come from | What it can tune | Phase |
|---|---|---|---|---|---|---|---|
| 1 | **KoboldCPP** managed + external | `koboldcpp_managed`, `koboldcpp` | `/v1/audio/speech` (+ `/api/extra/tts`) | **Kokoro** 82M (198 MB GGUF, 54 voices, CPU-fine) · **Qwen3-TTS** 0.6B / 1.7B Base · CustomVoice · VoiceDesign (q8 1.3–2.4 GB, Vulkan `--ttsgpu` advised) · OuteTTS, Parler, Dia ("not recommended" by KoboldCPP) | `/v1/audio/voices` returns KoboldCPP's **five placeholder names** only (`kobo cheery sleepy shouty chatty`); real names come from a **shipped catalogue per engine** (Kokoro's 28 permitted ids `af_heart am_echo bf_isabella …`; Qwen3's 9 presets `aiden serena ryan vivian …`); `--ttsdir` WAVs for Qwen3 clones | `voice`, `speed`; **`instruction`** (prose, Qwen3 CustomVoice/VoiceDesign only — also parsed from a leading `[…]` in the text); `language`; clone by WAV name | **1** |
| 2 | **audio.cpp** external | new `audiocpp` | `/v1/audio/speech` (streaming PCM deltas), `/v1/models`, `/v1/models/load`, `--max-loaded-models` | 130+ families: Kokoro (voice blending), Qwen3-TTS (all four), **KittenTTS 2** (native GGML port, ~7 GB VRAM Q8, no streaming), Supertonic 3, Pocket TTS, Phonon, VoxCPM2 (voice design), Chatterbox, OmniVoice, VibeVoice… | `/v1/audio/voices` = configured presets + reference-WAV library, **not** a model's embedded voices (Kokoro/Kitten) → catalogue per family again; `/v1/models` names the configured ids | `voice`, `speed`, `options.instruct` (instruction-conditioned families), `voice_ref` + `reference_text` (cloning), family-specific options | **1** (external) · managed later ★5 |
| 3 | **ElevenLabs** | new `elevenlabs` | native `POST /v1/text-to-speech/{voice_id}` (+ `/stream`), `xi-api-key` | `eleven_v4`, `eleven_v4_turbo` (audio tags), `eleven_v3`, `eleven_v3_conversational` (audio tags), `eleven_multilingual_v2`, `eleven_flash_v2_5` (cheap, 75 ms); `GET /v1/models` | `GET /v2/voices`: `voice_id`, `name`, `category`, **labels** (`gender`, `accent`, `age`, `use_case`), **`preview_url`**, stored `settings`; community library not on free tier | `voice_settings`: `stability`, `similarity_boost`, `style`, `use_speaker_boost`, `speed`; inline **audio tags** `[whispers] [laughs] [sighs]` on tag-capable models; `seed`; `previous_text/next_text` continuity; `output_format` by tier | **1** |
| 4 | **OpenAI (Official)** | `openai` preset `openai-official` | `/v1/audio/speech`, chunked streaming | `gpt-4o-mini-tts` (takes `instructions`), `tts-1`, `tts-1-hd` — **all three deprecated, shut down 2027-01-06**; the successor is the Realtime API, which `/v1/audio/speech` does not serve | fixed list of 13 (`alloy ash ballad coral echo fable nova onyx sage shimmer verse marin cedar`); custom voices need a consent recording | `voice`, `speed`, `response_format` (mp3 opus aac flac wav pcm), **`instructions`** (accent, emotion, intonation, pace, whisper) | **1**, flagged ⏳ by the shutdown date ★1 |
| 5 | **Ollama** | `ollama` | `/v1/audio/speech` (0.40.11+; macOS/MLX today, GGUF path via llama-server merged 10-28) | `phonon` 31M English (Apache), 40M fr/de/es/pt (non-commercial); `lfm3-audio` 2B (18 languages) | `/api/show` → `capabilities: [speech]` + voices; **not** `/v1/audio/voices` | `voice`, `response_format` (`wav`/`pcm`) **only** — any other field, incl. `speed` and `instructions`, is HTTP 400 | **1b** (cheap once 1 exists) |
| 6 | **OpenAI-compatible speech server** (Kokoro-FastAPI, Kitten-TTS-Server, openedai-speech, KittenTTS 2's Docker image, Soprano's endpoint) | `openai` with a custom base URL | `/v1/audio/speech` | whatever it serves; `/v1/models` where present | probe `/v1/audio/voices` (Kokoro-FastAPI, KoboldCPP), then `/v1/voices` (Kitten Docker), else a typed voice field | `voice`, `speed`, `response_format`; `instructions` passed through when the model is known to take it | **1b** |
| 7 | **llama.cpp server** | `llamacpp` | own `POST /tts` (`input`, `lang`, `voice`, `speaker_ref_b64`, `stream`, `wav`/`pcm`) | LFM3-Audio and the OuteTTS example | none; `voice` is `female`/`male` for LFM3 | `voice`, `lang`, clone by reference | **2** ★6 |
| — | LM Studio | `lmstudio` | none | — | — | — | never (no TTS) |
| — | Gemini TTS · Azure · MiniMax · NovelAI (SillyTavern's other cloud providers) | — | native each | — | — | — | **later**, by demand |

**Why ElevenLabs is "the" online provider.** No usage-share data exists, but every roleplay-facing
client (SillyTavern's 16-provider list included) treats ElevenLabs as the paid default, its voice
library carries labels and previews a picker can show, and its tag-capable models are the only
cloud service with an inline expression vocabulary. OpenAI stays in the first phase because the
adapter already exists and `instructions` is the best prose-steering API, but its speech models
have a published shutdown date (★1).

**Not in the list.** KittenTTS 2 as a first-party dependency (no torch-free runtime; weights not
open source — see memory `reference_kittentts_0_9_discord_only`); it arrives through audio.cpp
(row 2) or its own Docker image (row 6). In-process ONNX speech (`kokoro-js`, `kitten-tts-js`):
Node runtime on `onnxruntime-node` exists in the app for embeddings and entities, but pins
Transformers v4 against those packages' v3; a `local-onnx-tts` type is **phase 3** at the earliest ★7.

## 3. The model layer — what a speaking model declares

A `connection_models` row with modality `tts` (or `text-gen` with **Speaks** for a spoken-reply
model). Its `facts` column (0156) gains a **speech facts** 🚧 record the probe or the catalogue
fills, because the editor in §6 is drawn from it:

```
speechFacts {
  voices: { id, name, labels?: { gender?, accent?, age?, language?, useCase? }, previewUrl?, kind: 'preset' | 'clone' | 'designed' }[]
  voicesFrom: 'discovered' | 'catalogue' | 'typed'     // how the list was obtained, said in the UI
  controls: {
    speed?: { min, max }                               // honoured range, or absent
    instruction?: 'prose'                              // free prose steering (Qwen3 CustomVoice/VoiceDesign, gpt-4o-mini-tts, audio.cpp instruct families)
    tags?: { syntax: 'bracket', vocabulary: string[] | 'open' }   // inline tags (ElevenLabs v3/v4-turbo, KittenTTS 2's ten)
    settings?: ('stability' | 'similarity' | 'style' | 'speakerBoost')[]   // ElevenLabs-style dials
    clone?: 'reference-audio'                          // Qwen3 via --ttsdir, audio.cpp voice_ref, ElevenLabs IVC
    design?: 'prose'                                   // make a new voice from a description (Qwen3 VoiceDesign, VoxCPM2, ElevenLabs ttv)
    language?: string[]
  }
  streams: boolean
  formats: string[]
  deprecatedOn?: string                                // OpenAI's 2027-01-06
}
```

Rules: a fact is **probed** when the service can say it (`/v1/audio/voices`, `/v2/voices`,
`/api/show`, `/v1/models`), **catalogued** when the engine is known and the service cannot
(KoboldCPP's Kokoro, audio.cpp's embedded presets), and **typed** by the admin otherwise — and the
UI always says which (the Pickers-explain-why ruling). `pitch` and `volume` in today's sampling
schema are honoured by **none** of the surveyed services; ★2 asks whether they go, or become
client-side playback gain.

## 4. Levels — who decides what

| Level | Who | Decides | Where it lives |
|---|---|---|---|
| **Pub** | admin | which connections speak; which models are **Speaks**; the **Narration** loadout (pair + a `tts` sampling config = the house voice and pace); **Spoken reply** loadout; cost lines | Connections · Models · Loadouts (exists) |
| **Loadout / sampling config** | admin | `voice` (default), `speed`, and — new — the **inflection vocabulary** 🚧 allowed on this loadout: `none` · `labels` (the closed set) · `prose` (free instruction) | `sampling_configs` shape `tts` (exists); one new enum field |
| **Genre** | genre author | *expects*: whether its lines carry an inflection label (the sprite tail already picks one), a recommended inflection vocabulary; **never** a voice id | `GenreDecl` fit/recommend only — no new decl field for a voice (formats-belong-to-widgets ruling) ★3 |
| **Envoy** ("agent") | admin via the genre's session preset; session owner may override | a **timbre** 🚧 per envoy slug (the Castellan's voice) | `session_genre_settings` / preset defaults keyed `envoy:<slug>` ★3 |
| **Character (card)** | the card's owner — a member | the card's **timbre** 🚧 | `characters.extensions.serenepub.timbre` (travels with the card, like likeness) ★4 |
| **Cast member** (lorebook) | lorebook owner | *later*: a timbre override by name, as `spriteSet` is | `lorebook_bindings` amendable field — **not phase 1** |
| **Session** | session owner (reach `owner`) | **Read aloud** on/off · autoplay new lines · quotes only · the narrator's timbre (no card) · which speakers are read (all / AI only) | session settings (exists: `reach: 'owner'`) |
| **Line** | the run | the **inflection** 🚧 actually used, the voice id, the applied/ignored list, the audio artifact | message metadata per swipe + `pipeline_run_artifacts` |

**Members never touch plumbing — and this stays inside it.** A member picks a *voice* for *their*
character from the list the admin's connections offer, exactly as they pick a session preset: a
choice among things the admin made available, with the plumbing invisible. They never see which
connection or model serves it, never a sampling config, never a loadout. ★4 asks the owner to
confirm that reading of the 2026-10-12 ruling; if refused, timbre becomes admin-only on the card
and the member sees only the prose line.

### 4.1 Timbre 🚧 — the record

Portable first, pinned second:

```
timbre {
  description?: string           // "a warm low alto, slight Irish lilt, unhurried" — portable prose
  pins?: { [voiceKey: string]: string }   // voiceKey = `<connectionType>:<engine-or-model>` → voice id on THIS pub
  settings?: { speed?: number, stability?: number, similarity?: number, style?: number }  // only keys the pinned voice honours are kept
}
```

The prose **description** is the only part guaranteed to travel between pubs. At run time it is
also the **design prompt** where a service designs voices (Qwen3 VoiceDesign, VoxCPM2, ElevenLabs
text-to-voice) and the standing **instruction** where a service takes prose (`instructions`,
`instruct`). A pin is dropped silently when its connection is gone, and the editor says so. ⚠ Not
**portrayal** (who plays the part), not the user **voicing** a character (schema comments'
sense), not the adventure **voice** (one character's turn inside a reply, §9), not **ruleset
voice**. "Timbre" is clean in both repos and the canon (grep 2026-10-28).

### 4.2 Inflection 🚧 — the per-line expression

One closed label per line, the same label the sprite picker already produces (go_emotions' 28 +
`neutral`), written to message metadata per swipe as `{ inflection: { label, source } }`. Where
the line's model emitted its own tag (KittenTTS 2's `[joyful]`, ElevenLabs' `[whispers]`) the
tag is kept verbatim and the label is derived from it. The adapter **translates** the label into
the service's dialect at the seam (R5), per the model's `controls`:

| Model takes | The label becomes |
|---|---|
| `instruction: 'prose'` | one sentence from a shipped table: *sadness* → "Speak quietly, with restrained sadness." appended after the timbre description |
| `tags` with a vocabulary | the nearest tag by a shipped crosswalk (28 → KittenTTS 2's ten; 28 → ElevenLabs' tag list), leading the text |
| neither | nothing; `ignored: ['inflection']` on the result, and the line's audio menu says *This voice reads evenly* |

The label never changes cast state (sprites ruling). A lasting mood stays an attribute slot and
only biases the picker. **Word check (2026-10-28):** "inflection" is not in the canon and names no
type, but the retrieval code uses it in its *linguistic* sense in comments and one test fixture
(`ranking/signals.ts:311`, `rankingCorpus.test.ts:729` — word inflection, `rider`/`riders`). R1
says one word, one meaning, so ★10 asks whether to keep it (qualified: *line inflection*) or take
**intonation** (clean in src, SDK and canon). **delivery** was considered and is a retired word
(§23, R56) — never reintroduced. **mood** is taken (the common vocabulary's cast mood).

## 5. Resolution at a run — one order, printed on the receipt

For a line spoken by participant P on step S, on loadout L (Narration unless S picks another):

1. **Service and model** — L's pair. (A member's choice never reaches here.)
2. **Voice** — S's `speechSampling.voice` if set → P's timbre pin for this pair's `voiceKey` →
   L's sampling `voice` → the service's default. Each step logged as *voice from: step / character /
   loadout / service*.
3. **Standing instruction** — P's timbre `description`, only if the model's `controls.instruction`
   is `prose`.
4. **Inflection** — the line's label, translated per §4.2, only if L's inflection vocabulary allows
   it.
5. **Dials** — `speed` from S → P's settings → L; ElevenLabs settings from P → the voice's stored
   settings. Keys the model does not honour are reported `ignored`, never sent (Ollama 400s on
   extras).
6. **Text** — the line, with `skipCodeBlocks` and the session's *quotes only* applied before the
   call, then the service's chunking where it has none.

The receipt's **Spoken as** line reads: *Bruno (character) · Qwen3-TTS 1.7B CustomVoice ·
KoboldCPP · said with sadness · speed from loadout*.

## 6. What tuning looks like — drawn from the pub's facts, never a fixed form

### 6.1 On a character card — **Voice** section (beside Likeness)

Lede: *Who speaks for ‹name› when a line is read aloud.* Then, in order:

1. **How they sound** — one text field, the timbre description, always present even on a pub with
   no speech connection (it is portable content). Helper copy says what it does *here*: *Used as
   the voice's direction on Qwen3-TTS and OpenAI; shown only, on Kokoro.*
2. **Voice** — one row per **voice key the pub offers** (each enabled speaking pair), each a
   picker: the chosen voice above the list (§6.6 pattern), the find row with filters from the
   voices' **labels** where the service gives them (gender · accent · age · language · use case),
   a **▶ preview** where `previewUrl` exists, and **Try with this line** which synthesises the
   card's first message once through that pair. A row whose list was *catalogued* or *typed* says
   so under the lede. With one speaking pair there is one row; with none, the section shows only
   *How they sound* and *No voice set up on this pub yet* (admins get the link to Loadouts).
3. **How this voice can be directed** — read-only chips derived from `controls`: *Takes direction
   in words* · *Takes [tags]: whispers, laughs, …* · *Reads evenly* — and the dials the voice
   honours, nothing else: *Speed* always where supported; *Stability · Similarity · Style* only for
   an ElevenLabs voice (defaults from the voice's stored settings). No pitch, no volume, unless ★2
   keeps them as playback gain.
4. **Suggest a voice** (admin-grade services only: Qwen3 VoiceDesign, VoxCPM2, ElevenLabs
   text-to-voice) — proposes a designed voice from the description into the draft with a stated
   reason; saved only on Save (auto-pick proposes, never writes).

### 6.2 On an envoy — the same section, under the genre's session settings

Envoys have no card. The **Envoys** group of a genre's preset settings (admin) and the session's
settings (owner) shows one **Voice** block per seated envoy, identical to §6.1 minus *Suggest*.
The narrator, when it is not an envoy, gets the same block under **Narration** in session
settings.

### 6.3 On the Narration loadout — the house voice

The existing loadout editor's step 3 (sampling config, shape `tts`) shows `voice` with the same
picker (facts-driven), `speed`, and the new **Inflection** choice: *None* · *Labels* · *Prose*, with
one consequence line each (*Lines are read evenly* / *Each line carries one of 29 moods, translated
for the voice* / *Each line may carry free direction; costs tokens on OpenAI*). Pitch and volume
per ★2.

### 6.4 In the session — a line's audio

Under a spoken line: play · the **Spoken as** line from §5 · **Say it again** (re-synthesise, e.g.
after an edit) · **Say it as…** (one-off inflection override, written to the swipe's metadata).
Whether lines are spoken at all is the session's **Read aloud** setting; the widget shows the
control, the setting owns the behaviour (formats-belong-to-widgets).

### 6.5 Admin — one new thing only

**Models → a speaking model's page** gains the **Voices** table from its speech facts (name ·
labels · preview · origin *discovered / catalogue / typed*) with **Refresh** (re-probe) and, for a
*typed* list, an editor. Managed KoboldCPP gains **Speech model** in its load plan (`ttsmodel`,
plus `ttswavtokenizer` for Qwen3), beside **Image model**, so narration needs no second server.

## 7. Build shape (for sizing only — not a go)

- **A. Adapter seam (server).** `OpenAISpeechDialect` used by `openai`, `koboldcpp*`, `ollama`,
  `audiocpp`; `ElevenLabsAdapter` native. Each implements `synthesizeSpeech`; voice discovery per
  type into `speechFacts`; `applied/ignored` honest per type. Bind `core:oracle/speak@1`; the
  Narration path from a **Read aloud** request = `speak@1` on the Narration loadout with the
  message's text. Cancel through the one signal.
- **B. Facts and catalogue.** `speechFacts` on `connection_models.facts`; shipped voice catalogues
  for Kokoro and Qwen3 (KoboldCPP and audio.cpp); the 28→tags crosswalks; the label→sentence table.
- **C. Timbre + inflection.** `extensions.serenepub.timbre` read/write + card export/import;
  per-swipe `inflection` metadata written by the sprite tail (same label) and by *Say it as…*.
- **D. Surfaces.** §6.1 card section; §6.2 envoy/narrator blocks; §6.3 loadout fields; §6.4 line
  controls + session settings; §6.5 admin voices table + managed KCPP speech model.
- **E. Docs + canon.** docs/connections.md (Speech section), docs/sessions.md (Read aloud),
  NOMENCLATURE §10 (speech facts, speech dialect), §9 (timbre, inflection), §25 ledger.
- **Migrations:** none expected — json on existing columns; one enum field on the `tts` sampling
  schema (SDK, evolve @1 in place per the 10-16 ruling).

## 8. Open ★ — owner rulings needed

- **★1 OpenAI in phase 1 despite the 2027-01-06 shutdown?** Cheapest adapter (exists) and the best
  `instructions` API; but it will stop. Proposal: ship it, mark the models ⏳ with the date in the
  picker's consequence line, and let ElevenLabs be the documented online default.
- **★2 Pitch and volume.** No surveyed service honours them. Retire from `ttsSamplingSchema`, or
  keep as client-side playback gain only (never sent)? Proposal: retire; playback gain is a widget
  setting if ever wanted.
- **★3 Where an envoy's timbre lives.** Proposal: *not* on `EnvoyDecl` (a genre expects, never
  locks; formats and voices are presentation), but in the genre's preset settings keyed by envoy
  slug, overridable per session by its owner. Alternative: genre may declare a *recommended*
  description string only (prose, portable, no ids).
- **★4 A member picks a voice for their own character.** The reading above: a choice among what
  the admin offers, plumbing invisible — allowed. The strict reading of 2026-10-12: anything
  touching models is admin-only — then only the prose description is member-editable and pins are
  admin's. Which?
- **★5 audio.cpp as a managed service** (download its portable binary, own its config, hot-load
  via `/v1/models/load`) like KoboldCPP, or external-only for now? Proposal: external in phase 1,
  managed as its own plan once the adapter has run against real installs; it is Apache-2.0,
  single-binary on every platform, and would also give Transcription without OpenAI.
- **★6 llama.cpp `/tts`.** Own shape, two models. Phase 2 unless the owner uses LFM3-Audio.
- **★7 In-process ONNX speech** (`local-onnx-tts` on the existing runtime: Kokoro, Kitten 0.8).
  Phase 3; blocked today by the Transformers v3/v4 pin mismatch. Keep possible, do not build.
- **★8 The inflection label set.** Reuse the sprite starter set (29 incl. neutral) so one picker
  feeds both faces and voices, or a smaller speech-specific set (KittenTTS 2's ten is the smallest
  real vocabulary)? Proposal: reuse; the crosswalks absorb the difference.
- **★10 The word for the per-line expression.** *inflection* (second, linguistic sense in
  retrieval comments) or *intonation* (clean)? Proposal: intonation, unless the owner prefers the
  shorter word qualified as *line inflection*.
- **★11 WAV from local servers in phase 1, or in-process Opus encoding** (§12).
- **★12 Chunked audio delivery to the browser**: growing file + range requests, or socket + MediaSource (§13).
- **★9 Who may hear.** Guests/members hear what the owner's session speaks; speech costs the
  admin's money on cloud services. Should *Read aloud* be an owner-only toggle with a per-session
  cap like images, or free? Proposal: owner-only toggle; cloud loadouts show the cost line.

## 10. Pipelines: how speech runs, and the four triggers (2026-10-28)

**One rule.** Speech is two nodes — `core:oracle/speak@1` (text in, audio out) and
`core:outlet/attach-audio@1` (audio onto a message, raising `message-updated@1`) — and every
trigger is a different place to put them. Nothing in core speaks on its own (no-magic ruling);
the sprite tail is the precedent (an oracle and an outlet after `save`, exposed as a session
setting, writing nothing when off).

**Binding `speak@1`** (contracts `oracles.ts:886`, provisional today): ports gain `cues` (§11) in
place of bare `text`, plus `speaker`; out gains `cueMap` and `spokenAs` (voice, model, applied,
ignored) beside `audio`. `skipCodeBlocks` leaves its params for the cue task. Slots: `loadout`
(default **Narration** — the one global pair, ruled 2026-10-28), `prompts { direction }` (§11.3),
`template` (the line template, §11.3), `params { streaming }` (§13). The oracle never picks a
connection.

| Trigger | Where the nodes sit | Who controls it |
|---|---|---|
| **Automatic, per reply** | A tail on each reply spec after `save` and after `spritePick`, so the sprite label is the line's inflection. Session setting **Read replies aloud**, off by default, behind a junction so off writes nothing. After the line settles, never delaying text. | Session owner switches it; the genre decides which specs carry the tail. |
| **Manual, per line** | Core message-venue verb **Read aloud** beside Hide/Swipe → one core spec: `user-message` inlet (messageId) → `sessionHistory` → cue task → speak → attach. **Say it as…** collects an inflection label first. | Whoever the message belongs to (item rule). |
| **Per pipeline / genre** | Authors place the nodes where they want (Castellan plan lines only, room descriptions only, never whispers); a plugin uses a maintenance spec on the `session-event` inlet locked to `message-completed@1`. | Genre and plugin authors; admins on the canvas. |
| **Spoken reply** | No speak node: `generate-text@1` with audio in `outputs` and `speechSampling`. Preflight refuses a spec that both asks for audio output and tails `speak`. | Built for OpenAI audio models. |

Generation writes an audio part; **playback** is the Messages widget's (session setting
**Read aloud**: off · make audio · make and play; autoplay only for the newest line). `attach-audio`
gains `replace: true` so re-speaking swaps the part; `spokenAs` and `cueMap` land in the line's
metadata per swipe beside the sprite record (the inspector prints *Spoken as*). Cancel: the run's
one signal. Cost cap: ★9.

## 11. The speech script: universal and deterministic (ruled 2026-10-28)

**Owner's rule, for TTS specifically (not a rule for context templates in general):** whatever shapes speech must be *universal*, or at least *deterministic* where a
model supports this kind of templating. So: **one intermediate every service renders from, with
no model in the loop between the line and the request.** The only non-deterministic input is the
sprite label, and it is already on the row before speech runs; re-speaking a line reproduces the
same script and the same request, byte for byte, given the same templates.

### 11.1 Cues — the script

`core:task/cue-lines@1` 🚧, a pure task. In: the line's text, `speaker`, the recorded inflection
label, the cast's names. Out: `cues[]`:

```
cue { text, kind: 'dialogue' | 'narration' | 'action' | 'aside',
      voice: 'speaker' | 'narrator' | 'silent', inflection?: label,
      markers?: string[]   // expression the model wrote inline, lifted off the text
      emphasis?: '!' | '?' | '…' }
```

Rules are regex and locale tables, unit-tested, same text → same cues:
- quotes open **dialogue**: `"…"` `“…”` `‘…’` `«…»` `「…」` `『…』` (a `quoteStyles` param lists them);
- `*…*` / `_…_` are **action** (param `asterisks: action | emphasis | ignore`); `(…)` is an **aside**;
- `Name:` at the start of a run switches `speaker` — multi-voice lines (Lair, dialogue models);
- inline expression markers the model wrote — `[angry]`, `<laugh>`, `*sighs*`, `(((word)))` — are
  lifted off the text into `markers` and never spoken as words;
- `voices` param maps kind → voice: default `dialogue: speaker`, `narration: narrator`,
  `action: narrator`, `aside: silent`; code blocks are dropped.

### 11.2 Inflection per cue — resolved, never guessed

Per cue, first: a marker on the cue (`<sigh>` → `sadness`, by the shipped marker table); else the
line's recorded label; else none. **No second model call.** A lexicon hint from punctuation or
word lists is a later param, off by default, and still deterministic.

### 11.3 Templates render cues per capability

- **Line template** (`speak@1`'s `template` slot, `pipeline_context_templates`, Jinja): sees
  `cues`, `speaker`, `voice`, `controls`. Shipped rows: *Whole line*, *Dialogue only*,
  *Narration only*. The session's **Read aloud** picks one by name; quotes-only is a template, not
  a flag in core.

```jinja
{% for cue in cues if cue.voice != 'silent' %}
{% if controls.tags and cue.inflection %}{{ cue.inflection | tag }} {% endif %}{{ cue.text }}
{% endfor %}
```

- **Direction** (`prompts { direction }`): rendered only when `controls.instruction` is set —
  the timbre description, the inflection sentence, the genre's tone line. A model without prose
  gets nothing and reports `ignored: ['direction']`.
- **Variable templates** `core:var/inflection-sentence@1` (label → "Speak quietly, with restrained
  sadness.") and `core:var/inflection-tag@1` per tag vocabulary (label → `[sad]`, or Kitten 2's
  `[sad]`, or ElevenLabs' `[sad]`): the wording is editable, versioned text; the mapping is a table.
- Shipped filters: `tag` (through the vocabulary of the resolved model), `dialogue`, `narration`,
  `strip_code`, `spell_numbers` (deterministic normalisation where the service has none).

### 11.4 Grouping, the call, the cue map

`speak@1` groups consecutive cues with the same `(voice, inflection)`, makes one call per group
(the `voice` resolves through the voicebank spine: `speaker` → the speaker's timbre → the
loadout's voice; `narrator` → the session's narrator timbre → the loadout's voice), concatenates
PCM with a fixed gap (param, default 200 ms), and returns one audio plus a **cue map** of time
offsets per cue. Falls out for free: a line whose dialogue and prose are two voices; the Messages
widget highlighting words as they play; a tag model gets markers re-inserted in its own syntax; a
plain model gets clean text and an honest `ignored`; a future SSML service is one more template.

**Universality claim, stated so it can be tested:** prose, tags, plain and multi-voice are all
projections of one script; `cue-lines@1` is pure; the templates are pure given `controls`; the
crosswalks are tables. A conformance test feeds one line through every shipped service profile and
asserts the request bodies are stable across runs.

## 12. Storage: where spoken audio lives and how it is reclaimed (ruled 2026-10-28)

Owner: the plan is fine "as long as it's convenient to clean up, and won't automatically clutter
when a user goes to view/manage their media."

- **Where:** `storeGeneratedMedia` → `createMedia` → one `files` row (provenance: user, session,
  message, run + step in meta; `kind: audio`, `durationMs`), bytes under
  `data/users/<uid>/sessions/<sid>/`; the line's text is written to the file's **`transcript`**
  column, so transcribe-audio never runs on it and search sees the words.
- **Class:** spoken audio is a **derived form** (it is reproducible from script + voice + seed),
  marked `spoken` in provenance — never an original. The derived-forms sweep (`media/cull.ts`)
  reclaims it with no confirmation and nothing irreplaceable is at risk.
- **No clutter:** excluded from every default media listing at the query (`spoken` provenance), and
  shown as ONE folded row — *Spoken lines · N files · X MB · Clear* — pub-wide in the admin Media
  panel (0182) and per session in that session's media. No member-facing media manager exists
  today; the exclusion lives in the listing query both surfaces will read.
- **Convenient cleanup:** re-speaking replaces the part (`replace: true`), the old file is
  unreferenced at once; **Clear** per session and pub-wide; pub setting **Keep spoken audio**:
  forever · until the session is archived · N days (the sweep runs on the schedule tick when set).
- **Size:** local servers return 24 kHz 16-bit WAV (~3 MB/min); cloud services can return Opus/MP3.
  ★11 whether phase 1 keeps WAV from local servers (no encoder is bundled) or requests `pcm` and
  encodes to Opus in-process (needs a dependency).

## 13. Streaming as a capability (2026-10-28)

`streaming` is a known SDK feature graded none/native, recorded per connection and overridable per
connection model; its own doc says a feature qualifies a call "whose in and out kinds are already
settled". KoboldCPP streams text but returns speech whole; audio.cpp streams speech for most
families but not its KittenTTS 2 port; ElevenLabs, OpenAI and Ollama stream speech.

- Add **`audio_streaming`** 🚧 to `FEATURES` (LS4: a feature may arrive without breaking SDK 1;
  evolve @1 in place). Bands **none · emulated · native** — emulated = the host splits by cue
  group and calls per group, which is what KittenTTS does inside itself; the first band outside
  JSON/tools that honestly has an `emulated` entry.
- Graded on the connection, overridden per connection model, mirrored in `speechFacts.streams`
  (the loadout tile says *starts playing after the first sentence*).
- `speak@1` param `streaming`: native streams bytes as they arrive; emulated chunks by cue group;
  off waits for the file.
- **Delivery to the browser** is the open piece: a growing file over range requests (simple,
  playback starts late) or chunks over the socket into a MediaSource buffer (plays after the first
  sentence; new client code). Phase 1 records the capability and ships whole-file playback; chunked
  delivery is the first phase 2 item. ★12.

## 9. Sources checked 2026-10-28

KoboldCPP `koboldcpp.py` (routes `/v1/audio/speech`, `/v1/audio/voices`, `tts_generate`,
`tts_extract_instruction`), `otherarch/tts_adapter.cpp` (Kokoro `vpermitted`, Qwen3
`speaker_instruction`), wiki TTS section; audio.cpp `README.md`, `app/server/README.md`,
`docs/models/kitten_tts2.md`, release v0.9.3 assets; Ollama docs `capabilities/speech`, releases
0.40.11–0.40.13-rc0, PR #19344; OpenAI text-to-speech guide (deprecation notice); ElevenLabs
`models`, `text-to-speech/convert`, `voices/search`; SillyTavern TTS extension docs; Hugging Face
text-to-speech task rankings. Memory: `reference_lightweight_tts_landscape_2026_10`,
`reference_audio_cpp_runtime`, `reference_ollama_speech_2026_10`,
`reference_kittentts_0_9_discord_only`.
