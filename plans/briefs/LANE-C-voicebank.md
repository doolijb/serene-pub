# Lane C — voicebank, timbre, resolver, media (supervisor: Opus; workers: 4 Sonnet)
Owns seams **S4, S5, S8** and migration **0129**. Write S4/S5 type files in the first hour.
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
- Build plan §0 (A1, A2, A7), §1 S4 S5 S8, §2 Lane C, §4. Design plan §4.1 and §5 (sed -n '/^### 4.1/,/^## 6\./p') and §12 (sed -n '/^## 12\./,/^## 13\./p').
- `src/lib/server/db/schema.ts` 1071-1135 (loadouts table pattern); `src/lib/server/sockets/connections.ts` admin-gate pattern (grep -n requireAdmin | head); `src/lib/shared/characters/likeness.ts`; `src/lib/server/characters/likeness.ts`; `src/lib/server/characters/cardIO.ts` 300-320; `src/lib/server/sockets/characters.ts` 460-480; `src/lib/server/media/cull.ts` 1-80; `src/lib/server/sockets/media.ts` (listing); `src/lib/server/media/generatedMedia.ts`; `src/lib/shared/connectionAdapters/speechFacts.ts` (lane B's S1 — if absent yet, code to the shape in build plan S1).
## Work areas
- C1 schema block `voicebankVoices` + `npm run db:generate` (confirm journal max 128 first; expect 0129) + sockets `voicebank:list|create|update|delete|setDefault` (admin) and `voicebank:pickable` (member) + seed one `pub` default entry when the Narration loadout is filled (boot defaults sync pattern: grep -rn "defaultFor" src/lib/server/pipelines/boot | head).
- C2 `src/lib/shared/characters/timbre.ts` + `src/lib/server/characters/timbre.ts` (validate, export drops `voice`), hook in characters:update (ONE function) and cardIO export/import.
- C3 `src/lib/server/speech/resolveVoice.ts`: timbre → session narrator (settings key `speech.narratorVoice`, read by name; lane D declares it) → voicebank default → loadout sampling voice → service default; language chain (A2); A7 validation (entry must be on the Narration pair; refuse with reason).
- C4 media: `files.meta.spoken` treated as derived in cull.ts; listing excludes spoken by default; sockets `media:spokenSummary`, `media:clearSpoken { sessionId? }`; pub setting `speech.keepSpokenAudio` + sweep hook on the schedule tick (grep -rn "schedule-tick" src/lib/server | head).
Done when the resolver's fixtures cover every `from` value and 0129 applies on a scratch DB (`reference_isolated_dev_instance_recipe` memory: cat it).

## Mundi coordination (another agent, concurrent, planning today, may start editing any time)
Files its plans name, which may change under you: SDK `contracts/src/outlets.ts` (advance-story-clock), `sdk/src/extension.ts`, `sdk/src/widgets.ts`, `sdk/src/descriptors.ts`, `sdk/src/annexFields.ts`, `sdk/src/rulesetSections.ts`, `core-catalog/src/functions/time.ts`; app `src/lib/server/db/schema.ts`, `src/lib/client/sessions/fullscreen.svelte.ts`, plugin package/assets code. Rules: edit these ADDITIVELY in your own region (append a block; never reorder); re-read the file immediately before each edit; if `git diff --stat -- <file>` shows hunks you did not make, do not revert them — work around and report. Migration numbers: if the journal max is no longer 128 when you generate, take the next free index and say so.
