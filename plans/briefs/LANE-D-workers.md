# Lane D — worker sheet (supervisor-maintained; every D worker reads this after the lane brief)

Lane brief: `plans/briefs/LANE-D-runtime.md`. Cross-lane notes: `plans/briefs/CROSS-LANE-NOTES.md`.
Reporting: do NOT write report files (the harness refuses them for subagents). Put your report in
your final message to the supervisor: files touched, exported names/signatures, deviations, asks,
loose ends, ★ questions, spec hash moves (for core-catalog edits), and "what to test" for lane V.

## Rules (verbatim from the brief, plus hazards) — every worker
- Write ONLY the files your area lists below (the worker sheet itself is the supervisor's). Another worker owns every other file; if you need a
  change there, write it under "Asks" in your report section and keep going.
- Never `git stash` in any form (incl. `--keep-index`), never `git checkout`/`restore`/`clean`, in
  EITHER repo. Never commit.
- Never `npm test` or `npm run build` at `/home/jody/github/serene-pub-sdk` root. Never
  `npm run sdk:build` — the supervisor runs it. Your core-catalog/SDK edits reach the app only after
  that build; until then typecheck the package from source:
  `cd /home/jody/github/serene-pub-sdk && npx tsc --noEmit -p core-catalog/tsconfig.build.json`
  (or `sdk/tsconfig.build.json`; look for the right tsconfig first).
- App typecheck: `cd /home/jody/github/serene-pub && npx tsc --noEmit -p .` — grep the output for
  YOUR files; known noise: lane B `connectionAdapters/speech/**`, `NARROW_SIDE_PX` dom test.
- No test suites. No new test files (lane V owns `*.test.ts`). A scratch `npx tsx` script in
  `/tmp/claude-1000/-home-jody-github-serene-pub/564efcec-663a-419e-8efc-7e445249445f/scratchpad/`
  is fine for checking a pure function.
- Never start or stop a dev server (the supervisor does the end-to-end run). Never `kill -9`.
- Mundi coordination: before editing ANY existing file run `git status --short -- <file>` and
  `stat -c %y <file>` in its repo; if it changed in the last hour and you did not change it, re-read
  it; if it has hunks that are not lane D's, edit additively around them and say so in your report.
  Files Mundi names: SDK `contracts/src/outlets.ts`, `sdk/src/extension.ts`, `sdk/src/widgets.ts`,
  `sdk/src/descriptors.ts`, `sdk/src/annexFields.ts`, `sdk/src/rulesetSections.ts`,
  `core-catalog/src/functions/time.ts`; app `src/lib/server/db/schema.ts`. Do not edit those.
- `core-catalog/src/index.ts` is shared by D3/D4/D5: APPEND export lines only, re-read right before.
- Quote heredoc delimiters (`<<'EOF'`). Read large files by range (`sed -n`), never whole.
- Nomenclature: speech cue (never bare "cue" in prose for people; ⚠ not scene cue), inflection,
  cue map, spoken as, spoken metadata, line template, voicebank, timbre — all 🚧. Never "chat"
  for a session. Import template ids from `SPOKEN_LINE_TEMPLATE_IDS`; never type them.
- Lane B (adapters) may still be editing `src/lib/server/adapters/actions.ts` and
  `src/lib/server/connectionAdapters/speech/**`: read, never write. Re-read before each use.

## Decisions the supervisor fixed (code to these; ask before deviating)

### S7 storage — session speech settings are GENRE FIELDS (D5 writes; D1/D3/E read)
Stored in `sessions.genre_fields` like every genre field, resolved by the session settings cascade
into the settings document's `fields` (`$.input.session.fields.<key>` in a spec), drawn by the
settings form from the declaration, owner reach. Declared by every core genre whose reply carries
the speech tail: **story, guide, lair** (not chat, not dungeon-crawler — no sprite tail there).

| S7 name | field key (storage) | FieldDecl | default |
|---|---|---|---|
| `speech.readAloud` | `speechReadAloud` | enum `off` · `make` · `play` | `off` |
| `speech.template` | `speechTemplate` | enum over `SPOKEN_LINE_TEMPLATE_IDS` values (labels Whole line / Dialogue only / Narration only) | `SPOKEN_LINE_TEMPLATE_IDS.whole` |
| `speech.narratorVoice` | `speechNarratorVoice` | string (voicebank slug; `''` = none) | `''` |
| `speech.narrateUser` | `speechNarrateUser` | boolean | `false` |
| `session.language` | `sessionLanguage` | string (ISO 639-1; `''` = none) | `''` |

- core-catalog (D5): NEW `core-catalog/src/shared/speechFields.ts` exporting
  `SPEECH_FIELD_KEYS = { readAloud: 'speechReadAloud', template: 'speechTemplate',
  narratorVoice: 'speechNarratorVoice', narrateUser: 'speechNarrateUser', language: 'sessionLanguage' } as const`,
  `READ_ALOUD_MODES = ['off','make','play'] as const`, one `FieldDecl` per key
  (`SPEECH_READ_ALOUD_FIELD`, `SPEECH_TEMPLATE_FIELD`, `SPEECH_NARRATOR_VOICE_FIELD`,
  `SPEECH_NARRATE_USER_FIELD`, `SESSION_LANGUAGE_FIELD`, all `reach: 'owner'`) and
  `SPEECH_FIELDS` (the five by key, for spreading into a genre's `fields`). Export from the
  package index. Then spread `...SPEECH_FIELDS` into story, guide and lair `fields` in
  `core-catalog/src/registry/genres.ts` (three additive edits).
- app (D5): NEW `src/lib/shared/sessions/speechSettings.ts` — the S7 seam for lane E: the same key
  table (literal strings; lane V pins equality with core-catalog's), `READ_ALOUD_MODES`,
  `type ReadAloudMode`, `interface SpeechSessionSettings { readAloud; template; narratorVoice: string|null;
  narrateUser: boolean; language: string|null }`, and
  `readSpeechSessionSettings(fields: unknown): SpeechSessionSettings` (defaults applied, blank → null,
  language lower-cased). Client-safe: no server imports, no core-catalog import.
- server (D5): NEW `src/lib/server/pipelines/speech/sessionSpeech.ts` —
  `sessionSpeechSettings(db, sessionId): Promise<SpeechSessionSettings>` through the cascade
  (`resolveSessionSettings` in `server/sessions/settings.ts`, read its signature) — the ONE server
  read; and fix lane C's `sessionSpeechSetting()` in `src/lib/server/speech/resolveVoice.ts` (that
  one function only; the cross-lane notes authorise it) to read through it.

### The reply tail (D3 writes, in core-catalog genres)
After `spriteShow`, LAST in the spec (after the clock tick where there is one):
```
.task('cue', ($) => C.cueLines.v1({ text: <the reply's text>, speaker: $.input.speaker,
      inflection: $.spritePick.main, cast: $.input.session, params: slot.params() }),
      { expose: { session: true, label: … } })
.junction('readAloud', { on: ($) => $.input.session }, (j) => j
  .when('make', { path: 'fields.speechReadAloud', equals: 'make' }, (b) => <speak + attach>)
  .when('play', { path: 'fields.speechReadAloud', equals: 'play' }, (b) => <speak + attach>))
```
(the junction grammar has no "in"/"not equals"; two branches with the same two nodes, built by
ONE helper so they cannot differ; `off`/absent fires neither, so off writes nothing.)
speak: `C.speak.v1({ cues: <cue>.cues, speaker: $.input.speaker, template: slot.template(),
prompts: slot.prompts(), variables: slot.variables(), params: slot.params() })` (no connection, no
language — the resolver's chain supplies language). attach: `C.attachAudio.v1({ target:
$.save.messageId, audio: <speak>.audio, meta: <speak>.meta, params: { replace: true } })`.
The helper lives in NEW `core-catalog/src/shared/speechTail.ts`. Adjust to what the builder
actually accepts (slot.variables may not exist; a literal params object may need `slot.params()`
plus a preset) and REPORT the final shape.

### Host (D1 writes) — module layout
- `src/lib/server/pipelines/speech/cueLines.ts` (pure parser), `speech/markers.ts` (marker word →
  inflection label table, design §11.2), `speech/audio.ts` (WAV parse/concat/gap, spans).
- `src/lib/server/pipelines/runtime/dispatchSpeech.ts` (the speak effect: group → render via D2 →
  resolveVoice → `getSpeechAdapter(type)` → `new Adapter(connection).synthesizeSpeech(req,{signal})`
  per group → concat → `storeGeneratedMedia` with `meta.spoken = true`, userId = SESSION OWNER →
  set `files.transcript` → `SpokenMeta`).
- `runtime/host.ts`: speak case + attach-audio `replace` + `meta`. `runtime/bindings.ts`: cue-lines,
  speak, attach-audio (`meta` port, `replace` param). Boot bind guard. `services/register.ts`
  spokenRetention (cross-lane note).

### Rendering (D2 writes) — the seam D1 calls
NEW `src/lib/server/pipelines/speech/lineTemplate.ts`:
```ts
renderSpokenGroup(i: { template: unknown /* p.template as the host gets it, null → shipped Whole line */;
  sessionTemplateId?: string | null /* the session's speechTemplate, wins when it names a line template */;
  cues: readonly Cue[]; speaker: { ref: string; name?: string }; voice: 'speaker' | 'narrator';
  controls: SpeechControls | null; variables?: unknown /* p.variables raw */ }): Promise<string>
renderDirection(i: { prompts: unknown /* p.prompts raw */; inflection: string | null;
  timbreDescription?: string | null; controls: SpeechControls | null; variables?: unknown }): Promise<string | undefined>
```
`renderSpokenGroup` returns the call's text (trimmed, runs of spaces collapsed, tags inline);
`renderDirection` returns undefined unless `controls.instruction === 'prose'`. Plus
`speech/jinja.ts` (the five filters + `core:template/jinja2@1` renderer registered in
`prompt/renderers.ts`), `speech/tagCrosswalk.ts` (label → service tag through the
inflection-tag layout and the model's vocabulary), and seeding of the line templates + variable
layouts (`boot/seedContextTemplates.ts` and the variable-layout seeder) with
`engine: SPEECH_TEMPLATE_ENGINE`.

### Speak-message + verbs (D4 writes)
NEW `core-catalog/src/shared/speakMessage.ts` (`core:spec/speak-message@1`) and its registration;
CORE verbs **Read aloud** / **Say it as…** (message venue, item rule, `replace: true`; the second
collects an inflection label as text); app dispatch in `src/lib/server/messages/**` /
`src/lib/server/pipelines/entities/sessionActions.ts` as the existing core verbs do.
