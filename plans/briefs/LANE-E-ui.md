# Lane E — surfaces, docs, canon (supervisor: Opus; workers: 5 Sonnet)
Owns `src/lib/client/**`, `docs/**`, NOMENCLATURE/STYLE-GUIDE rows. Start on seam stubs; switch to real sockets as lanes B/C/D land (poll their reports).
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
- Build plan §0 (A1!), §1 (S1 S4 S5 S6 S7 S8), §2 Lane E, §4. Design plan §6 (sed -n '/^## 6\./,/^## 7\./p') and §12.
- STYLE-GUIDE.md §6.3 and §6.6 (grep -n "^## 6\|^### 6\." STYLE-GUIDE.md); `src/lib/client/components/loadouts/LoadoutSheet.svelte` + `loadoutsGrid.ts`; `src/lib/client/components/characterForms/LikenessTab.svelte`; `src/lib/client/admin/sections/connections/IdPage.svelte`; `src/lib/client/components/sessionForms/SessionSettingsForm.svelte`; the Messages widget under `src/lib/client/components/sessionPage/` (grep -rln "core:image" there, then the audio sibling); `docs/connections.md` §Loadouts + §Sound from OpenAI; `docs/sessions.md`; NOMENCLATURE §10 rows loadout/sampling, §9 envoy/portrayal, §25 ledger tail.
## Work areas
- E1 shared `VoicePicker.svelte` (facts-driven filters from labels; preview; *Try with this line*; origin line discovered/catalogue/typed) + card **Voice** section (timbre description always; picker only when `canPickVoice` — admin-only in phase 1).
- E2 admin Loadouts → **Voices** panel (voicebank CRUD, default star, consequence line per entry) + Models page **Voices** table with Refresh + managed KoboldCPP **Speech model** field + ⏳ deprecation chip for OpenAI.
- E3 session settings block (S7) + narrator voice + line controls (play, *Spoken as*, Say it again, Say it as…) + autoplay newest line when readAloud=play + cue highlighting from cueMap.
- E4 Media **Spoken lines · N files · X MB · Clear** folded row (admin panel + session media) + retention setting in Admin → General.
- E5 docs: connections.md **Speech** section; sessions.md **Read aloud**; session-layout.md line controls; coming-from-sillytavern.md voice-map paragraph; NOMENCLATURE rows + §25 ledger.
Pickers explain why (lede + reasons + chosen value visible + find row on long lists). Toasts never cover Save. No pixel-perfect polish; screenshots + "looks decent".

## Mundi coordination (another agent, concurrent, planning today, may start editing any time)
Files its plans name, which may change under you: SDK `contracts/src/outlets.ts` (advance-story-clock), `sdk/src/extension.ts`, `sdk/src/widgets.ts`, `sdk/src/descriptors.ts`, `sdk/src/annexFields.ts`, `sdk/src/rulesetSections.ts`, `core-catalog/src/functions/time.ts`; app `src/lib/server/db/schema.ts`, `src/lib/client/sessions/fullscreen.svelte.ts`, plugin package/assets code. Rules: edit these ADDITIVELY in your own region (append a block; never reorder); re-read the file immediately before each edit; if `git diff --stat -- <file>` shows hunks you did not make, do not revert them — work around and report. Migration numbers: if the journal max is no longer 128 when you generate, take the next free index and say so.
