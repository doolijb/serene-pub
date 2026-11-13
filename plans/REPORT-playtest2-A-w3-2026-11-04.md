# REPORT playtest2-A-w3 — Ask retired from Story

Status question: none relayed.

## Changed files
SDK (/home/jody/github/serene-pub-sdk):
- core-catalog/src/genres/defaults.ts: Story registers `actionRegistrations(storyAnswerSpec())`; dropped the `storyAskSpec` import; doc comment notes Ask retired.
- core-catalog/src/genres/story/ask.ts: doc comment only (retired 2026-11-04, §0-F; still published; Answer stays). Graph and contributes untouched, so its hash is unchanged.
- core-catalog/src/index.ts: the CORE_SPECS row comment only (row kept).
- core-catalog/src/genres/story/index.ts: comment only.
- sdk-tests/coreGenreDefaults.test.ts: removed `core:spec/story-ask#ask` from Story's expected actions; added test "Story registers no Ask ... and Answer stays" (every Story preset: no action starting `core:spec/story-ask`, `core:spec/story-answer#answer` present).
App: docs/genre-story.md § Actions: removed Ask/Answer from the composer sentence; Stop paragraph rewritten as briefed.

## Commands and results
- `npx tsx --test coreGenreDefaults.test.ts` (sdk-tests): first run FAILED (stale core-catalog dist; sdk-tests resolve the dist). After sdk:build (no serene-pub vite dev running; flock'd): 16 pass, 0 fail. `tsc --noEmit` in sdk-tests clean.
- `npm run sdk:build`: succeeded.
- App vitest (5 files): 2 files pass, 3 fail (3 tests fail / 36 pass), log at /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-A-w3.log:
  1. `readers.int.test.ts:182` expects `core:spec/story-ask#write` label "Ask": CAUSED BY THIS CHANGE (Ask is no longer a registered action). Not my file. Fix: delete line 182 (and Ask from the "Look, Ask and the form answer" comment at 180), or assert it is absent.
  2. `0108_layering_registrations.int.test.ts:192-196`: expected dropped list includes `"story-ask#ask→story-ask"` (line 196): PARTLY CAUSED BY THIS CHANGE. Fix: remove line 196. The received list also has extra `speak-message#read-aloud→speak-message` and `speak-message#say-it-as→speak-message` (speech verbs, not mine): that is the pre-existing failure the lead named, so removing line 196 alone will not turn it green; the two speak-message entries must be added too.
  3. `specHashes.test.ts:1933`: five `*-create` pins differ (assistant-create@1.0.0, story-create@2.2.0, guide-create@1.1.0, lair-create@1.0.0, dungeon-crawler-create@1.0.0): NOT mine (no Ask pin changed; `story-ask@1.0.0` pin `aaaf5626cd65b` still matches). Another programme's create-spec edits.
  - postHistoryTrigger.int.test.ts and specShape.test.ts pass (they use the published Ask spec, which is intact).
- Prettier --check: warns on docs/genre-story.md and on 4 of the SDK files (defaults.ts, ask.ts, index.ts, coreGenreDefaults.test.ts); story/index.ts passes. Pre-existing: HEAD versions of docs/genre-story.md and core-catalog/src/index.ts already fail prettier. I did not reformat (would touch lines outside my task).

## Boot re-projection finding
project.ts (lines ~96-108) calls `replaceRows(db, {kind:'genre', genreId}, defaults, ['genre'])` for every genre at boot: rows of origin `genre` at genre scope are replaced by the declaration, so a stale `story-ask#ask` genre-origin row is replaced away at the next boot. Rows an administrator added (other origin) are left alone. No pass needed. I did not run a two-boot test; this is from reading the code (the 0108 test's received list confirms Ask drops out of the projected set).

## Other Ask hits (not edited)
- docs/sessions.md:103 "Story's **Look**, **Ask**, **Rest** and **Time passes**" (lane H)
- docs/sessions.md:169 "in Story, **Narrate**, **Side character**, **Image**, **Scene**, **Look**, **Rest**, **Ask**, **Answer** and **Time passes…**" (lane H)
- docs/pipelines.md:313 "such as Story's **Ask**"
- docs/session-actions.md:84 "Story's **Ask** puts a question with…"
- core-catalog/src/seed/prompts.ts:531-541: Ask's prompt seed (out of scope, kept)
- App tests naming Ask: readers.int.test.ts:182, 0108_layering_registrations.int.test.ts:196 (above); specHashes.test.ts:650 (pin, still valid); promptPath.int.test.ts:481, postHistoryTrigger.int.test.ts:164, specShape.test.ts:138 (use the published spec, fine).
- No slash-command help or client copy naming Ask found in src (only tests).

## Assumptions
- Answer's registered key is `core:spec/story-answer#answer` (read from the test's list).
- Ask's `ask.ts` comment at line ~69 ("the composer's chip and `/ask`") still describes the spec's contributes, accurate for the unregistered spec.

## Noticed, not done
- The three failing app tests above need their owners' edits (listed with exact fixes).
- docs/session-actions.md:84 and docs/pipelines.md:313 use Ask as the example of a form; the forms mechanism stays, but the example is no longer something Story offers (Lair's Roll is).
