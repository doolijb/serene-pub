# Lane A — SDK contracts (supervisor: Opus; workers: 2 Sonnet)
Owns seam **S3** only. Goal: the types and node changes every other lane imports. Short lane; finish first.
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
- Build plan §1 S3, §2 Lane A, §4. Design plan §10 (sed -n '/^## 10\./,/^## 11\./p') and §11 (sed -n '/^## 11\./,/^## 12\./p').
- `../serene-pub-sdk/contracts/src/oracles.ts` lines 880-925 (speak@1) and the generate-image decl for a prompts slot; `contracts/src/outlets.ts` attach-audio (grep -n "attach-audio@1"); `contracts/src/tasks.ts` assemble@2 for a template slot (grep -n "core:task/assemble@2"); `sdk/src/capabilities.ts` lines 418-470 and 560-590; `sdk/src/sampling.ts` 662-698; `core-catalog/src/seed/` for template/variable seed rows (ls first, read one).
## Work items (A1 types/nodes · A2 catalogue seeds)
1. `sdk/src/speech.ts` (new): Cue, Inflection, CueMap, SpokenMeta, INFLECTION_LABELS (sprite standard 28 + neutral — copy from app `src/lib/shared/sprites/index.ts:73`). Export from sdk index.
2. `core:task/cue-lines@1` in contracts tasks.ts: ports/params per S3; effects none; pure.
3. `speak@1`: ports in { cues, speaker, language?, text? (alias, one release) }, out { main: audio, audio, cueMap, spokenAs }; slots loadout (default Narration), prompts { direction }, template (line, jinja2), sampling (S.tts), params { streaming:boolean=false, gapMs:number=200 }; remove skipCodeBlocks; remove `provisional: true`.
4. `attach-audio@1`: params { replace: boolean=false }; in gains `meta?: SpokenMeta`.
5. `audio_streaming` in FEATURES with BANDS [none, emulated, native]; doc comment says what emulated means (host splits by cue group).
6. Seeds: variable templates `core:var/inflection-sentence@1`, `core:var/inflection-tag@1`; context templates `core:template/spoken-line-whole@1`, `-dialogue@1`, `-narration@1` (Jinja; filters tag/dialogue/narration/strip_code/spell_numbers are registered by lane D — just use them).
7. `sdk:build` when :5173 is free. Note every hash/pin test you expect to move in the report (do not fix pins).
Done when the SDK's `tsc` passes and the app's `npx tsc --noEmit -p .` sees the new types.

## Mundi coordination (another agent, concurrent, planning today, may start editing any time)
Files its plans name, which may change under you: SDK `contracts/src/outlets.ts` (advance-story-clock), `sdk/src/extension.ts`, `sdk/src/widgets.ts`, `sdk/src/descriptors.ts`, `sdk/src/annexFields.ts`, `sdk/src/rulesetSections.ts`, `core-catalog/src/functions/time.ts`; app `src/lib/server/db/schema.ts`, `src/lib/client/sessions/fullscreen.svelte.ts`, plugin package/assets code. Rules: edit these ADDITIVELY in your own region (append a block; never reorder); re-read the file immediately before each edit; if `git diff --stat -- <file>` shows hunks you did not make, do not revert them — work around and report. Migration numbers: if the journal max is no longer 128 when you generate, take the next free index and say so.
