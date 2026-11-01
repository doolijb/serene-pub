# Lane D — runtime, templates, specs, verbs (supervisor: Opus; workers: 5 Sonnet)
Owns seams **S6, S7**, host bindings, core-catalog spec edits. Starts when lane A's build is visible (`ls ../serene-pub-sdk/sdk/dist | head`, grep cue-lines).
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
- FIRST: `plans/briefs/CROSS-LANE-NOTES.md` (routed items from finished lanes; re-read when told).
- Build plan §0, §1 (S1 S2 S3 S4 S6 S7), §2 Lane D, §4. Design plan §10–§11 (sed -n '/^## 10\./,/^## 12\./p').
- `src/lib/server/pipelines/runtime/host.ts` 9146-9290 (attach-audio) + ONE oracle case (grep -n 'case "core:oracle/generate-image"'); `runtime/bindings.ts` generate-image entry (grep -n generate-image | head -3); `config/panel/flows.ts` 100-170; `media/generatedMedia.ts`; `src/lib/server/speech/resolveVoice.ts` (lane C) and `src/lib/shared/connectionAdapters/speechFacts.ts` (lane B) — code to the seam shapes if not there yet.
- Core-catalog: `genres/story/respond.ts` 1418-1455 (sprite tail), `genres/story/generateImage.ts` 36-80 (action spec), `genres/lair/fileRoom.ts` 84-135 (message-venue action), `sdk/src/actions.ts` 1150-1200 (core verbs).
## Work areas
- D1 host: `cue-lines@1` handler (pure; tables for quote styles incl. “” ‘’ «» 「」『』, asterisks, `Name:` runs, inline markers [angry] <laugh> *sighs* (((x))), code blocks dropped); `speak@1` handler (group by voice+inflection+language → render line template → direction prompt → resolveVoice → adapter per group → concat PCM with gapMs → storeGeneratedMedia with meta.spoken + transcript → cueMap source 'concatenated'); `attach-audio` replace + S6 metadata; streaming param accepted, treated as off (A5).
- D2 Jinja filters (tag via resolved model vocabulary, dialogue, narration, strip_code, spell_numbers en-only) registered where the app registers template engines (grep -rn jinja src/lib/server/pipelines/entities); render `template` + `prompts.direction` on speak; marker→label crosswalk table.
- D3 spec tails in core-catalog: story respond/narrate/narrateCharacter, guide respond, lair reply — after spritePick, behind the `speech.readAloud` junction, expose session. Content-addressed: note hash moves for V.
- D4 `core:spec/speak-message@1` (core-catalog shared) + core verbs **Read aloud** / **Say it as…** (message venue, item rule; second collects an inflection label).
- D5 S7 settings (`src/lib/shared/sessions/speechSettings.ts` + declaration with reach owner) incl. `session.language`; plumb to cue task.
Done when a reply on an isolated instance with readAloud=make yields an audio part with S6 meta, and Read aloud twice replaces it.

## Mundi coordination (another agent, concurrent, planning today, may start editing any time)
Files its plans name, which may change under you: SDK `contracts/src/outlets.ts` (advance-story-clock), `sdk/src/extension.ts`, `sdk/src/widgets.ts`, `sdk/src/descriptors.ts`, `sdk/src/annexFields.ts`, `sdk/src/rulesetSections.ts`, `core-catalog/src/functions/time.ts`; app `src/lib/server/db/schema.ts`, `src/lib/client/sessions/fullscreen.svelte.ts`, plugin package/assets code. Rules: edit these ADDITIVELY in your own region (append a block; never reorder); re-read the file immediately before each edit; if `git diff --stat -- <file>` shows hunks you did not make, do not revert them — work around and report. Migration numbers: if the journal max is no longer 128 when you generate, take the next free index and say so.
