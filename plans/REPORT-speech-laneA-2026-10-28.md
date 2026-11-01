# REPORT — Lane A (SDK contracts, seam S3) — DONE 2026-10-28 (saved by the lead; the agent could not write files)

SDK tsc clean; `sdk:build` ran with :5173 free; app tsc resolves every export (one unrelated error: `NARROW_SIDE_PX` dom test). No workers used.

## Landed (../serene-pub-sdk)
- `sdk/src/speech.ts` NEW: `INFLECTION_LABELS` (28, = sprite standard set), `Inflection {label; intensity?; events?}`, `InflectionEvent`, `Cue {text; kind; voice; speaker?; inflection?; markers?; emphasis?}`, `CUE_KINDS`, `CUE_VOICES`, `DEFAULT_CUE_VOICES`, `ASTERISK_READINGS`, `DEFAULT_QUOTE_STYLES`, `CueSpan`, `CueMap {source; spans}`, `SpokenAs {voice; voices?; model; applied; ignored}` (no `connection` — R53), `SpokenMeta {spokenAs; cueMap; inflection; template; at}`, `SPEECH_JINJA_FILTERS`, `SPOKEN_LINE_TEMPLATE_SCOPE`, `varInflectionSentence`, `varInflectionTag`, `JinjaFilter`, `RenderOptions`.
- `sdk/src/shapes.ts`: `S.inflection`, `S.cues`, `S.cueMap`, `S.spokenAs`, `S.spokenMeta`; `S.spritePick` assignable to inflection.
- `sdk/src/capabilities.ts`: `audio_streaming` in FEATURES, BANDS [none, emulated, native], label "Streaming speech".
- `sdk/src/template.ts`: **Jinja filter seam** — `render(src, scope, { filters })` understands `{{ x | f }}` and `{% for c in xs | f %}`; filter `(value, scope)`, no args; unknown filter yields nothing; `extractRefs`/`checkTemplate` strip filters.
- `contracts/src/oracles.ts` `speak@1`: in `cues, speaker, language, text (⏳ alias)`; out `main, audio, cueMap, spokenAs, meta`; slots `loadout, connection, sampling, prompts{direction}, template (jinja2), variables, params{streaming=false, gapMs=200}`; `provisional` and `skipCodeBlocks` removed; `review.fields = ['cues','text']`; timeout still 60000 (lead: bump to 180000 at integration).
- `contracts/src/tasks.ts` `core:task/cue-lines@1` (`cueLines`): in `text, speaker, inflection, cast`; out `main, cues`; params `quoteStyles, asterisks (action), voices, language`; effects none.
- `contracts/src/outlets.ts` `attach-audio@1`: params `{replace=false}`, in `meta: S.spokenMeta`.
- `core-catalog/src/seed/speechTemplates.ts` NEW + index export: `SHIPPED_SPOKEN_LINE_TEMPLATES`, `SPOKEN_LINE_TEMPLATE_IDS {whole, dialogue, narration}`, `SHIPPED_SPEECH_VARIABLE_LAYOUTS`, `INFLECTION_SENTENCES`, `INFLECTION_TAGS`, `SPEECH_TEMPLATE_ENGINE`. Ids are R19-derived from seed keys (`core:template/pipeline-context-template-core-spoken-line-whole@1` etc.) — **import the constants, never type the strings**.

## Lead decisions on ★A1–★A3
- ★A1 template ids: keep the R19-derived ids. Lanes import `SPOKEN_LINE_TEMPLATE_IDS`.
- ★A2 emulated band: make the pinned rule hold instead of exempting it — add `audio_streaming: []` to `EMULATABLE_VIA` ("emulated by core itself, via no backend feature") and keep the test. Lane V applies this one-line SDK edit (lane A has finished).
- ★A3 `Cue`: type name stays `Cue` (B/C/D already import it); canon term is **speech cue** (R3), ⚠ not a scene cue; lane E records it.

## Pins expected to move (lane V)
App: `boot/registryHashes.test.ts` (speak, attach-audio hashes; new cue-lines entry; "speak is provisional" assertion ~2217), `boot/bindingCompat.test.ts:94`, `specHashes.test.ts`, `registrySync.int.test.ts`, `contentAddressing.int.test.ts`, `manifest.conformance.test.ts` (FEATURES). SDK: `sdk-tests/rulings.test.ts:572`, `contract.test.ts:146`, `capabilities.test.ts:268` (★A2), `variable-schemas.test.ts` and any FEATURES/listShapes/allVariables snapshot.

## What lane V should test
Filter seam (known/unknown filter, byte-identical without `|`, checkTemplate clean on `a.b | f`); each line template with/without tags and with no `tag` filter; layouts match their `render` for 28 labels + unknown + null; `coreTemplateIdFor(seedKey) === templateId` ×5; a sprite-pick → cue-lines → speak → attach-audio spec validates; `INFLECTION_LABELS` equals `STANDARD_SPRITE_LABELS`.
