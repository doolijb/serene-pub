# REPORT — Lane D follow-up (speech ★1–★5, ★7, narrateUser) — DONE 2026-10-28

Supervisor (Opus) did area A; two Sonnet workers did B (resolver fallback, boot voicebank seed, narrator-voice validation) and C (template precedence, speak-direction prompt seed, jinja2 engine, narrateUser). `sdk:build` ran at ~16:58 with :5173 free (exit 0). App `tsc --noEmit -p .` is clean apart from the known `NARROW_SIDE_PX` dom-test error. No tests were run or edited (lane V's job).

Concurrency: Mundi M0 agents were editing `runtime/host.ts` and `runtime/bindings.ts` (16:40–16:41) and `NOMENCLATURE.md` (16:52) while this lane ran. Every edit here is an anchored insert in our own region, re-read just before it was made. No foreign hunks were touched.

## A — ★1 `core:query/message-line@1` + bind + rewire + **Say it as…** (supervisor)
- **Contract** (SDK `contracts/src/queries.ts`, appended at the end):
  - In: `{ scope: session-scope, messageId: row-ids, say: text }`.
  - Out: `{ main: text, text: text, speaker: participant-ref, inflection: inflection }`.
  - It is a read with no writes and no model call.
  - `text` is empty when the row is hidden, still being written, or belongs to another session.
- **Host read** `message_line` (`runtime/host.ts`, right after the `likeness_images` case; `HostTable` in `bindingTypes.ts`):
  - It delegates to the new `src/lib/server/pipelines/speech/messageLine.ts` `messageLineFor(db, sessionId, messageId)`, which applies the history read's filters.
  - Speaker is `metadata.speaker` when it is an `envoy:` ref. Otherwise it is `speakerRefOf(row)` (`character:<personaId|characterId>`), or null for narration.
  - Recorded inflection is `metadata.sprite.label`, the sprite shown on the active swipe.
- **Binding** `messageLineBindings()` (same new file), spread into `bindings.ts` after `describeImageBindings()`.
  - `say` wins over the sprite label. `sayAsInflection(say)` collapses whitespace and caps the text at 120 chars.
  - A label name (`joy`) or a marker word the table knows (`markerInflection`: `angrily`, `sighs`) becomes that label.
  - Any other words are kept as the label, as written.
- **Free words reach the direction** (`lineTemplate.ts`): the inflection-sentence layout only has rows for standard labels, so a free *Say it as…* label used to render to nothing.
  - New `freeDirectionOf(label)` now gives `Speak it this way: <words>.` when the layout is empty and the label is not standard. `neutral` still directs nothing.
  - Tag-only models find no tag for free words and drop them.
- **Spec** `core:spec/speak-message` (core-catalog `shared/speakMessage.ts`):
  - New path: inlet → `line` (message-line; `say: $.input.text`) → junction `spoken` on `$.line.text` → `cue` (text, speaker, inflection from `line`; cast = session) → `speak` (cues + `speaker: $.line.speaker`) → `attach` (replace).
  - The `session-history` + `joinText` pair and the `lineText` wiring are gone.
  - The spec now contributes two actions with the same audience and greying:
    - `read-aloud`
    - **`say-it-as`**: icon `mic-vocal`, `collects.text` required, label *How should it sound?*, placeholder *angrily, with a sigh, whispered*.
  - `genres/defaults.ts` registers every action of the spec, so all 5 genres get **Say it as…** with no edit there.
  - The compiled spec was checked: 5 nodes, edges as above, `validate` returns [].
- Canon: added a §25 row to `NOMENCLATURE.md` for **message line** / `say-it-as`.

## B — ★2 service voice fallback + boot seed; ★5 narrator-voice validation (worker B)
- `speech/resolveVoiceCore.ts`: new optional fact `serviceVoice`. The last step is now `chosen("service", serviceVoice || null, null)`.
- `speech/resolveVoice.ts`: reads the pair model's `facts`, then `readSpeechFacts(...)?.voices[0]?.id`. The doc chain line is updated.
- `speech/resolveVoice.fixtures.ts`: new fixture "service step uses the model's first voice". The null-voice fixture is kept.
- Boot: `db/defaults.ts` `sync()`, right after `moveConnectionDefaultsToLoadouts(db)` (~l.646). It does a dynamic import plus `ensureVoicebankDefault(db)`, in its own try/catch with `console.warn`. It is not in a transaction.
- Validation: new `speech/narratorVoiceCheck.ts` `narratorVoiceRefusal(db, value)`.
  - It is hooked as the `check` on the `speechNarratorVoice` genre-field entry in `sessions/settingsForm.ts`. `updateSetting` already turns a check refusal into `SettingRefusal("… Nothing was saved.")` → `{error}`.
  - Blank or null is accepted.
  - Refusal sentences:
    - `No voice in the voicebank is named "<slug>".`
    - `The voice "<slug>" is turned off — pick another or turn it back on in the voicebank.`

## C — ★3 template precedence; ★4 direction prompt seed; ★7 jinja2; narrateUser (worker C, supervisor fixes)
- ★3:
  - `SPEECH_TEMPLATE_FIELD` has **no `default`** now. This is legal: `default` is optional and reconcile gives `undefined`. Its description says unset uses the pipeline's line template.
  - `readSpeechSessionSettings().template` is `string | null` (null when blank, unset or unknown).
  - `renderSpokenGroup`'s order (session → node slot → shipped Whole line) now does what the ruling says.
  - `dispatchSpeech`'s `templateIdOf` already reports the template actually used.
- ★4:
  - New `SPEAK_DIRECTION_SOURCE` in core-catalog `seed/speechTemplates.ts`.
  - New `CORE_PROMPTS` row: nodeType `core:oracle/speak`, slot `prompts`, seedKey `pipeline-prompt:core:oracle/speak:prompts:speak-direction`, name "Speech direction", `fields.direction` = that text.
  - The row's `defaultForSpecs` are story-respond, story-narrate, story-side-character, guide-respond, lair-reply and speak-message.
  - The supervisor moved the row to the END of the array; the worker had put it first.
  - The app's `DEFAULT_DIRECTION = SPEAK_DIRECTION_SOURCE`. `seedPrompts.ts` needed no change.
- ★7:
  - `CORE_JINJA2_ENGINE = "core:template/jinja2@1"` is in `CORE_TEMPLATE_ENGINES` (`shared/pipelines/templateEngines.ts`).
  - The supervisor switched `prompt/renderers.ts` to register under that constant and dropped its stale "not in CORE_TEMPLATE_ENGINES" comment.
  - Effect: plugins can no longer claim or release jinja2, and the "no renderer" message lists jinja2.
- narrateUser:
  - `SPEECH_NARRATE_USER_FIELD` was removed from `SPEECH_FIELDS` and deleted. Four fields are declared now.
  - The key `narrateUser: "speechNarrateUser"` stays in BOTH key tables as "reserved — not declared until implemented".
  - `narrateUser` was removed from `SpeechSessionSettings`.

## Hashes / pins that move (lane V)
- contracts: +1 query (`message-line@1`); any SDK pin on the count or list of definitions moves.
- `core:spec/speak-message`: a new graph and a second action.
- Genre decls story/guide/lair: `speechNarrateUser` is gone and `speechTemplate` has no default. Any create spec that inlines genre fields also moves, as do the default registrations (the speak-message registrations now hold 2 actions).
- `CORE_PROMPTS` is +1 (the speak pool's first shipped row): `corePrompts.catalog.test.ts`, `seedPrompts.int.test.ts`, sdk-tests pins.
- Generated SDK docs for the story/guide/lair genre pages are stale until regenerated. `sdk:build` regenerated the api docs.

## Deviations
1. The prompt row is keyed by seedKey `pipeline-prompt:core:oracle/speak:prompts:speak-direction`. Prompt rows have no `core:prompt/…@1` id form.
2. Free *Say it as…* words become `Speak it this way: <words>.` from a code string in `lineTemplate.ts`. They could become a variable-layout row later.
3. The narrator-voice check covers `sessions:updateSetting` only. Session create and preset writes were not traced. The speech fields are not `fixedAtStart`, so they are not on the start form.
4. The **recorded** inflection is the shown sprite's label only. An earlier spoken record (`metadata.spoken.inflection`) is NOT reused, so a *Say it as…* does not stick to a later *Read aloud*.
5. A marker inside the line (`*sighs*`) still overrides the line inflection for its cue, as cue-lines does for any line inflection, *Say it as…* included.

## What to test (lane V)
- `messageLineFor`:
  - Returns null for: another session's row, a hidden row, a generating row, a missing row.
  - Speaker by row kind:
    - envoy row (`metadata.speaker: 'envoy:castellan'`) → that ref
    - persona row → `character:<personaId>`
    - character row → `character:<id>`
    - narration / user without persona → null
  - The sprite label comes from `metadata.sprite.label`.
- Binding:
  - Empty or whitespace `text` → `{ main: '', text: '' }`, and the junction fires nothing.
  - `say` beats the sprite. Blank `say` keeps the sprite. No sprite and no `say` → no `inflection` port.
- `sayAsInflection`:
  - `'Joy'` → joy; `'angrily'` → anger; `'sighs'` → sadness.
  - `'with a sigh'` → `{label:'with a sigh'}`.
  - Text over 120 chars is capped; whitespace is collapsed; blank or non-string → null.
- `freeDirectionOf` / `renderDirection` (prose controls):
  - A standard label uses its sentence; `neutral` → nothing.
  - A free label → `Speak it this way: … .` and trailing punctuation is trimmed.
  - A custom layout returning '' for a standard label → nothing.
- Spec: speak-message validates; 2 actions; `say-it-as` collects required text; registered in all 5 genres; the item rule and greying are the same as read-aloud.
- E2E: Read aloud on a character's line speaks dialogue in the character's timbre and passes the sprite label as the inflection. Say it as "angrily" → the S6 record's inflection is `anger`.
- Resolver:
  - `serviceVoice` set → `from: 'service'` with that voice.
  - Absent or whitespace → null.
  - Timbre, session, default and loadout each still win over it.
  - Integration: a pair model whose facts list two voices → the first one.
- Boot: an empty voicebank plus a Narration model seeds "Narrator"; with no model, nothing is seeded; boot survives a throw.
- `narratorVoiceRefusal` / `updateSetting`: blank or null saves; an unknown slug and a disabled slug are refused with the sentences above and nothing is stored; an enabled slug saves.
- Settings: `readSpeechSessionSettings({}).template === null`; an unknown or blank template → null; a known id passes through. The S6 `template` is the slot's id when the session's is unset; an explicit session id beats the slot.
- `isCoreTemplateEngine('core:template/jinja2@1')`; `releaseRenderer` on jinja2 is refused or a no-op.
- The speak-direction row is seeded on a fresh install and is the default for the 6 specs. `DEFAULT_DIRECTION === SPEAK_DIRECTION_SOURCE`.

## For lane E (routed)
- `SpeechSettingsBlock.svelte`'s `narrateUser` branch can never draw now (no field is declared), so it can be deleted.
- The **What is read** radios have no selection when unset. Offer a choice that clears the field to null, worded "As the pipeline says" or similar. Also reword `docs/session-layout.md` / `sessions.md` if they say Whole line is the default.
- **Say it as…** collects free text. Docs say "a mood you pick", which is close; known words map to a mood and other words are passed on as direction.
- NOMENCLATURE l.752 says `speechNarrateUser` "is declared but unregistered". It is now a reserved key with no declaration.

## Open questions
- None blocking. Should *Say it as…* stick, so that a later *Read aloud* reuses the last asked-for inflection? Today it does not (deviation 4).
