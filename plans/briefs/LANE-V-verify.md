# Lane V — verification (supervisor: Opus; workers: 5 Sonnet) · runs LAST
Owns every test file. Start by reading all five lane reports `plans/REPORT-speech-lane{A,B,C,D,E}-2026-10-28.md`.
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
## Read first
- `plans/briefs/CROSS-LANE-NOTES.md`, then the five lane reports.

## Work areas
- V1 unit: cue-lines fixtures (quote styles, asterisks, Name:, markers, CJK), filters, crosswalks, **determinism conformance** (one line × every shipped profile → identical request bodies across two runs).
- V2 adapters: dialect per type with the fixtures the B report lists (applied/ignored; Ollama rejects extras; KCPP instruction extraction; ElevenLabs settings); facts probe.
- V3 int (explicit 60 s timeouts; capped scope; PGlite /tmp leak — clean your own dirs): voicebank sockets + gate, resolver, timbre export/import, media exclusion/clear/sweep, migration 0129 on a scratch copy.
- V4 browser walk on an isolated instance (memory `reference_isolated_dev_instance_recipe`): KoboldCPP + Kokoro; audio.cpp + Qwen3 CustomVoice if installed: Read aloud on/off, Say it as…, replace, Clear; screenshots into the report.
- V5 ONE grouped run at the end: `npx tsc --noEmit -p .`, `npm run check`, `npm run sdk:test` (re-pin the spec/registry hashes lanes A/D listed), docs compile, `npm run test:budgets`; then the targeted suites you wrote. Never the whole `npm test` under load without the lead's say.
Report every pin that moved and why; every red with output.

## Mundi coordination (another agent, concurrent, planning today, may start editing any time)
Files its plans name, which may change under you: SDK `contracts/src/outlets.ts` (advance-story-clock), `sdk/src/extension.ts`, `sdk/src/widgets.ts`, `sdk/src/descriptors.ts`, `sdk/src/annexFields.ts`, `sdk/src/rulesetSections.ts`, `core-catalog/src/functions/time.ts`; app `src/lib/server/db/schema.ts`, `src/lib/client/sessions/fullscreen.svelte.ts`, plugin package/assets code. Rules: edit these ADDITIVELY in your own region (append a block; never reorder); re-read the file immediately before each edit; if `git diff --stat -- <file>` shows hunks you did not make, do not revert them — work around and report. Migration numbers: if the journal max is no longer 128 when you generate, take the next free index and say so.
