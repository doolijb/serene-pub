# REPORT — Lane D (runtime, templates, specs, verbs) — DONE 2026-10-28 (saved by the lead from the agent's hand-back)

**Verified end to end** on an isolated Vite (:5231, scratch data dir) against a fake OpenAI-compatible speech server (:5298) driven through the app socket from a private headless Chromium: reply with `make` spoke 3 groups (dialogue in the speaker's voice, narration+action in the narrator's, dialogue), joined WAV as ONE `core:audio` part, S6 record at `metadata.spoken` {spokenAs, cueMap{concatenated, 4 spans, 200 ms gaps}, inflection:null, template, at}; **Read aloud twice replaced** the part and deleted the older spoken files; files carry `user_id`=session owner, `meta.spoken=true`, `transcript`; dedupe-safe. `off` → no call; `play` → spoken. Seeding: 3 line templates + 2 variable layouts, engine jinja2. Boot clean; `spokenRetention` registered. `sdk:build` ran at ~16:25 with :5173 free (includes the speak timeout bump). Not tested: real TTS server, sprite-driven inflection, multi-voice `Name:` lines, swipes.

## Files
App new: `pipelines/speech/{cueLines,markers,audio,jinja,tagCrosswalk,lineTemplate,sessionSpeech}.ts`, `pipelines/runtime/dispatchSpeech.ts`, `shared/sessions/speechSettings.ts` (`readSpeechSessionSettings`, `SPEECH_FIELD_KEYS`, `READ_ALOUD_MODES`, `SPEECH_TEMPLATE_IDS`). Edited: `runtime/host.ts` (speak case; attach-audio `replace` + S6 + `written:false` on no audio), `runtime/bindings.ts`, `prompt/renderers.ts` (jinja2 registered, owner core), `boot/seedContextTemplates.ts` + `seedVariableTemplates.ts` (engine-aware), `services/register.ts` (`spokenRetention`), `speech/resolveVoice.ts` (`sessionSpeechSetting()` body). SDK core-catalog new: `shared/speechFields.ts`, `shared/speechTail.ts`, `shared/speakMessage.ts`; edited additively: `registry/genres.ts` (speech fields story/lair/guide), `genres/defaults.ts` (`readAloud` in all 5), five reply specs, `index.ts` (exports + `CORE_SPECS` entry).

## Bound
`core:task/cue-lines@1`, `core:oracle/speak@1`, `core:outlet/attach-audio@1` (meta port, replace param).

## S7 settings = genre fields in `sessions.genre_fields`, owner reach (story, guide, lair)
| S7 | key | values | default |
|---|---|---|---|
| speech.readAloud | `speechReadAloud` | off/make/play | off |
| speech.template | `speechTemplate` | SPOKEN_LINE_TEMPLATE_IDS | whole |
| speech.narratorVoice | `speechNarratorVoice` | voicebank slug | '' |
| speech.narrateUser | `speechNarrateUser` | boolean | false (**declared, NOT implemented**) |
| session.language | `sessionLanguage` | ISO 639-1 | '' |
Server read `sessionSpeechSettings(db, sessionId)`; resolver reads through it.

## Tail and verb
`speechTail()` last in each spec: `cue` step → junction `readAloud` on `$.input.session` → branches `make`/`play` (path `fields.speechReadAloud`) each `speak` → `attach {replace:true}`. Lair speaks delver lines only; story narrate uses the narrator voice. Verb `read-aloud` ("Read aloud") = `core:spec/speak-message#read-aloud`, message venue, audience {see:[participant], act:[item]}, greyed hidden/generating, registered in all 5 genres, works whatever readAloud says. **Today it speaks every cue in the narrator/default voice with no inflection** (see ★1).

## Hashes that move (lane V)
Specs story-respond, story-narrate, story-side-character, guide-respond, lair-reply; new spec `core:spec/speak-message` (+1 count); genre decls story/guide/lair; default registrations ×5; contracts (speak timeout); 3 context + 2 variable seeded rows; SDK suite pins.

## Deviations
1. S7 keys are flat camelCase genre fields (junction paths cannot read dotted keys). 2. Additive edits outside §4 (listed above). 3. Tail `attach` literal `{replace:true}`. 4. Ollama input split at 4096. 5. S6 per swipe at `metadata.swipes.spokenHistory[idx]`, mirroring sprite history.

## ★ questions → lead decisions (2026-10-28)
1. **Manual verb cannot pass speaker/inflection** (history rows opaque; `json@1` refused into those ports) → **APPROVED:** add pure `core:query/message-line@1` {scope, messageId, say?} → {text, speaker: participantRef, inflection}; bind; rewire speak-message; build **Say it as…** (`collects.text` "How should it sound?"). → lane D-follow-up.
2. No voice sent when nothing is set → **both:** resolver's `service` step falls back to `facts.voices[0]` (`from:'service'`, spokenAs.voice non-empty) AND seed the voicebank default at boot. → D-follow-up.
3. `speechTemplate` always beats the node's template slot → **session value wins only when explicitly set**; blank = node slot. → D-follow-up.
4. Direction text is a code default → **seed a prompt row** (`core:prompt/speak-direction@1` on speak's `prompts.direction`) with the same text; code default stays only as the row's seed. → D-follow-up.
5. `speechNarratorVoice` owner-reach free text → keep owner reach; **E draws a picker over `voicebank:pickable`**; server validates the slug (D-follow-up). A1 (members don't pick voices) concerns the CARD; a session owner choosing the narrator voice from the admin's list is the preset-pick posture.
6. cue-lines `language` param → **leave as is** (blank = script detection; chain reaches session language).
7. jinja2 not in `CORE_TEMPLATE_ENGINES` → **add it** (`shared/pipelines/templateEngines.ts`). → D-follow-up.
Loose: `speechNarrateUser` → **unregister the field until implemented** (D-follow-up). Tail runs inside the reply run → V watches composer blocking. Incident: shared Playwright MCP browser was closed by lane D; **every lane uses a private Chromium from now on.**

## What to test (lane V)
cueLines (every quote style incl. apostrophe inside ‘…’, unclosed quote at blank line, 3 asterisk modes, nested asides, `Name:` script+bold, marker table + stemming, code dropped, emphasis, determinism); `groupCues`, `castNamesOf`; `joinAudio` (gaps, mismatched formats, all-MP3), `splitForLimit`; rendering goldens 3 templates × tags open/closed/missing, `{{x}}` escape hazard, unknown filter, `spell_numbers`, `strip_code`, crosswalk; seeder idempotence + exactly one inflection-sentence content row; `coreTemplateIdFor` ×5; attach-audio (replace with missing earlier file, beside a voice note, deduped bytes; no audio → `written:false`, no event; spokenHistory padding); tail off/absent/make/play, 5 specs validate, branches identical; verb (item rule, greyed, works while off, 5 genres); S7 defaults/cascade/visibility/key-table equality/resolver reads; pins. E2E scripts: `/tmp/claude-1000/-home-jody-github-serene-pub/564efcec-663a-419e-8efc-7e445249445f/scratchpad/e2e/` (`fake-openai.mjs`, `vite.e2e.mts`, `drive.mjs`, steps s0, s2–s11; `dev-data` folder).
