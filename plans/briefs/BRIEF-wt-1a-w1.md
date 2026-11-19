# BRIEF — worker `wt-1a-w1`: core's scene compiler lists speakers only, minus those their place rules out

Repo `/home/jody/github/serene-pub` (app). The SDK repo `/home/jody/github/serene-pub-sdk` is **read-only** for you.
Supervisor: lane `wt-1a`. Report back as your final message (under ~500 words).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` in this task: do not run one.)

The repo is staged by the lead: run **no git command** that changes the index or the working tree (no add, checkout, restore, reset, stash). Never run prettier with `--write`, never pipe its output into a file. No migration, no schema change. No `npm run build`, no full test run.

## Goal (owner rulings, quoted)

- D57 (2026-11-16): "Attended = spoke in the scene" … "It's up to the sessions scene management/compiler to determine who gets listed in the scene. For core catelogue, we will go with: Spoke at least once, and further filtering by cast members position."
- B1 (2026-11-17): "Active means spoke at least once in the scene". A seat that spoke and was then benched is listed; a seat that never spoke is not, benched or not.
- B2 (2026-11-17): "hand edits aren't treated differently. Just keep a change history so a user can overwrite." → the latest write of a scene's cast stands. (Change history is NOT built here.)
- Standing: "Bench is not absence" — benching plays **no part** in the rule.

**The rule to build (core's compiler):** a scene's stored cast (`scene_characters`, role `participant`) lists each cast member that **sent at least one line in the scene's range** and whose **place does not rule it out**. The roster (seated characters, player seats) and names found in lines (speech tags, people spoken to, gazetteer hits) **no longer make a participant**. Nothing is written for a person only named: they remain only the derived mentions (`utils/sceneMentions.ts`).

**The place rule (exactly this, no other reads):** for each line a member sent, compare the member's **own** value of `core:slot/location@1` (SDK `HOST_PLACE_SLOT_ID` from `@serene-pub/sdk`) **as of that line** (`valueOf(db, { sessionId, owner, slotId: HOST_PLACE_SLOT_ID, asOfMessageId: line.id }, { links, vocabulary })`, `src/lib/server/state/resolve.ts` ~895–912) with **the scene's place at that line** (the world value of the genre's declared place key as of that line: `scenePlaceKeyOf` + the `worldStateReader` reader, `scenes/liveScenes.ts` 505–610). A line **passes** when: the genre declares no place key, OR the member has no known place at that line, OR the scene has no place at that line, OR one of the member's place values names the scene's place (both turned to words by liveScenes' own `stateValueText`; compare with SDK `sameName`). A member is listed when **at least one** of its lines passes. **No session (world) fallback for the member's own place** (unlike `lorebooks/entryKnowledge.ts` — do NOT touch or import from that file). The member's owner: `castOwnerOf` (`state/owners.ts` 167): for a character line `{ characterId, seatMemberId: line.castMemberId ?? <the seat's castMemberId for that card> }`; for a player line (`personaId`) `{ characterId: personaId, playerSeatId: <session_personas.id of that persona's seat, live before departed, then position, then id> }`.

## Files owned (edit only these)

- `src/lib/server/scenes/liveScenes.ts`
- `src/lib/server/utils/sceneCastProposal.ts` — doc comments only (the header's stale "🚧 Not wired yet … NOTHING calls it" paragraph: say core's live compiler calls it and keeps only the sender tier for the stored cast; textual and roster tiers no longer make a stored participant). Do not change `proposeSceneCast`'s behaviour.
- New test file `src/lib/server/scenes/liveScenes.castRule.int.test.ts`
- Existing tests that the rule change breaks, assertions only: `scenes/liveScenes.castMembers.int.test.ts`, `scenes/liveScenes.playerSeats.int.test.ts`, `scenes/boundaryWatcher.genre.int.test.ts`, `messages/seatMemberNames.int.test.ts`, and any `src/lib/server/sockets/scenes.*.int.test.ts` that asserts a live scene's written cast. For each assertion you change, report file:line and before → after, and why it is the new rule.

Not yours (never edit): `sockets/scenes.ts`, `utils/sceneCast.ts`, `boundaryWatcher.ts`, `lorebooks/entryKnowledge.ts`, `shared/sockets/types.ts`, docs, NOMENCLATURE, anything under the SDK. If you need a change there, stop and report.

## Build

1. **Probe first, before any code change.** In the new test file, write a test that sets up a Story-like world with an open scene (a genre that declares a place key and `castRefresh`, as `boundaryWatcher.genre.int.test.ts` `makeWorld` does) with ~4 lines from two speakers, then counts the statements one `refreshOpenSceneCast(db, { sessionId, channel: "main", messageId })` costs on a new line by a speaker already in the cast (count by wrapping `$client.query`, as `pipelines/runtime/unknownEntries.reply.int.test.ts` 176–205 does), and also one on a line by a new speaker; `console.info` both as `[wt-1a refresh] same=<n> new=<n>`. Run it against the **unchanged** code and put the two numbers in your report as "before". Keep the probe in the file (it logs, it does not assert a count).
2. **One exported helper in `liveScenes.ts`:** `sceneCastSpeakers(db, sessionId, lines, seats?)` → `Promise<Set<number>>`: the sender card ids (`characterId ?? personaId`) of `lines` (`{ id, characterId, personaId, castMemberId }[]`) that spoke at least once and that the place rule above does not rule out. `seats` (optional) is `{ memberOfCard: Map<number, number>; playerSeatOfPersona: Map<number, number> }`; absent, the helper loads them itself, **only when a place key is declared** and a line needs a check. Costs: with no declared place key, it reads nothing but `scenePlaceKeyOf`; it loads `sessionLinks` + `vocabularyFor` once per call; it reads the scene's place at a line only after the member's own place at that line is known; it caches the scene's place per line id; it stops checking a member at its first passing line. Doc comment: 🚧, the rule in two sentences, the owners' words (D57, B1), and "a genre or plugin may compile a scene's cast differently; the reads only ask the stored cast".
   - Refactor `worldStateReader` minimally so the helper can reuse its decl lookup with links/vocabulary it already loaded (e.g. an internal `worldStateReaderWith(db, sessionId, links, vocabulary)` that `worldStateReader` calls). `worldStateReader`'s exported behaviour must not change.
3. **`readCastProposal`** (used by every live write — open, close, move, merge, `refreshOpenSceneCast` — and by Chronicle's Open scene card): keep calling `proposeSceneCast` (with the gazetteer, so the evidence words still say "named twice"), but **stop passing the roster** and **drop the now-unneeded active-character-seat query** (`sessionChars`, ~915–924) and the roster's card ids from the card load (load only the cards that sent a line, plus what naming the senders needs). Then keep only participants that have `sender` evidence **and** whose sender card is in `sceneCastSpeakers(...)` (pass the seat maps it already builds; add `id` to the `sessionPersonas` select for `playerSeatOfPersona`). Update its doc comment ("the scene's cast as core's compiler lists it now: whoever sent a line, minus those their place rules out, each with its evidence; nothing written"). Update the `proposeAndWriteCast` / `writeProposedCast` / `refreshOpenSceneCast` comments where they say roster or names. Open-tier names can no longer come back (they only ever had textual evidence): adjust the `ProposedSceneCastMember` / `proposeAndWriteCast` comment that says open-tier names are returned.
4. Statement cost: with the probe, run again after the change and report "after". If either number rose, try first: skipping the place work entirely when no line's member has a known place (each member's first `valueOf` returns nothing → pass, no scene-place read). Report what you did.

## Tests (new file `scenes/liveScenes.castRule.int.test.ts`, 60 s timeouts, its own `/tmp/serene-pub-vitest-castrule-*` data dir released in `afterAll`)

Each through the real writers (`openScene`, `closeScene`, `moveSceneBoundary`, `mergeScene`, `refreshOpenSceneCast`) and reading `scene_characters`:
- spoke → listed; never spoke (seated, active, silent) → not listed; a player seat that never sent a line → not listed;
- only named in a speech tag / spoken to in a line → not listed (and no member minted for an open-tier name);
- benched after speaking → listed; benched and silent → not listed (bench via setting `is_active=false` on the seat row is enough);
- place: genre declares a place key; member's own location at its line differs from the scene's place at that line → not listed; same place → listed; member with no own location → listed; genre with no place key and differing values → listed; a member who spoke once elsewhere and once in the scene's place → listed;
- open-scene refresh (adds a new speaker; a silent seat is never added); close; move (a speaker moved out of the range leaves the cast); merge;
- latest write stands: a hand-written cast (`writeSceneCast` with a silent member) on an open scene is replaced at the next refresh that differs; on a **closed** scene, later lines and a new scene's open/refresh leave its stored cast untouched (existing stored casts are not rewritten);
- the window: open at a set story clock, move the session clock, close: `opened_story_clock_*` and `closed_story_clock_*` hold the two clocks (year, month, day, hour, minute). Read how open/close stamp them (`liveScenes.ts` ~1219, 1432–1436, 1653–1674, 1746, 2140) and pin them.
- The probe test from step 1.

## Rules you depend on (quoted from the project's CLAUDE.md)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "Never seed a row at a hardcoded id."
- P1: "Code decides what code can; the model only judges. Same inputs, same result."
- "It is a **session**, never a *chat*." Use **scene's cast** / **stored cast** in comments; never the word *attendance* (taken by the Who's here widget).
- Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. No option, hook or extension point nobody asked for.

## How to run tests (exactly)

Before every run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Then
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <paths> > plans/wt-1a-w1-<n>.log 2>&1"` (always at least one path; never pipe vitest into `head`). Typecheck: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report errors in your files only).

## Done means

Green: `src/lib/server/scenes/liveScenes.castRule.int.test.ts`, `src/lib/server/scenes/liveScenes.castMembers.int.test.ts`, `src/lib/server/scenes/liveScenes.playerSeats.int.test.ts`, `src/lib/server/scenes/boundaryWatcher.genre.int.test.ts`, `src/lib/server/messages/seatMemberNames.int.test.ts`, `src/lib/server/utils/sceneCastProposal.test.ts`, `src/lib/server/sockets/scenes.live.int.test.ts`, `src/lib/server/sockets/scenes.laneE.int.test.ts`, `src/lib/server/sockets/scenes.captureAndLine.int.test.ts`, `src/lib/server/sockets/scenes.cues.int.test.ts`, `src/lib/server/sockets/scenes.displayNames.int.test.ts`; `tsc` 0 errors in your files; `npx prettier --check` clean on the **new** test file (the existing `liveScenes.ts` and `sceneCastProposal.ts` already fail `--check` before your change: match the surrounding style, never reformat the file).

## Report

Changed files; the helper's signature; probe numbers before/after; each changed existing assertion (file:line, before → after); tests run with results and log names; anything that needed a stop; **Noticed, not done**.
