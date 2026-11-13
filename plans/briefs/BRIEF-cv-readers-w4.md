# BRIEF cv-readers-w4 — the profile fields reach every member: greetings, strokes, pictures, voice, sprites, embedding

Read `plans/briefs/BRIEF-cv-readers-wcommon.md` first (the rules and the design). Lane cv-readers, worker 4 (Sonnet). Report as your final message: `# REPORT cv-readers-w4 (2026-11-06)`.

## Goal
What a seated person *is* — every character-profile field — comes from the **member as read** (owner ruling 2026-11-05: "Everything in session is cast -> active card"; owner 2026-11-05: "If a casts feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member."). The profile now lives on each version, so a card-less member has all of it. Make each reader below take it from the member as read (or from a seat card row that went through `seatCardsAsRead` / `seatCardAsRead`, which now lays **every** profile field over the card row), never from the card's frozen columns. A card no member answers for reads the card's **current version** (`cardsNow`). For each file: read it, decide whether it already reads through the member (several were moved by earlier lanes — then just add the test), fix it if not, and report which.

## Files owned (edit only these, plus their tests and new tests)
- `sessions/greetings.ts` — greetings, incl. **group-only greetings from the member's merged greetings** (`MemberAsRead.greetings` / the overlaid `groupOnlyGreetings`): the `with: { character: true }` / `with: { persona: true }` relational reads (~102, ~108, ~236) feed `seatCardsAsRead`; a seat it can't find a member for must read `cardsNow`, not the row's frozen columns.
- `pipelines/prompt/cardStrokes.ts` (~54, ~96) and `pipelines/prompt/contextFields.ts` (post-history instructions ~106–131, strokes ~54) — confirm they read the seat card row as overlaid (strokes are paused, `STROKES_ENABLED = false`; just make sure the member's strokes are the ones read).
- `pipelines/runtime/illustrateScene.ts` (scene reference images: likeness → member face → avatar), `pipelines/runtime/cardAction.ts` (runs on a card with no session — it keeps reading the card's current version; confirm, don't move it onto members).
- `embedding/ragContext.ts` (~763–850, the character RAG candidate by the session's card ids) and `embedding/vectorizationQueue.ts` (`characterEmbedText` ~773, `enqueueSessionGroup` ~612): **the card embedding's text moves to the card's current version** (name + description from `character_versions`, highest `number`, not `characters.name || description`); the candidate the prompt shows for a seated card reads the seat's member (`cardsNowAsSeatsRead`). Vectors stay on `characters.embedding` — **no new column, table or migration**; if you find a per-member vector is needed, stop and write it as ★.
- `sessions/backdrop.ts` — `castImages` / `inCast` (~106–170): member galleries count — a file with `files.cast_member_id` of a member seated in the session (either seat table) is a cast image too. `inCast`'s dated-card path uses `sessionsDrawingCard` (worker 2 moved it onto versions) — confirm.
- `speech/resolveVoice.ts` — timbre (incl. language, `silent`) from the member as read; the card half reads the card's current version (earlier lane) — confirm.
- `sprites/choices.ts` (~186–199) — sprite choice for a speaker: the seat's member's sprite sets (`MemberAsRead.spriteSets` / `spriteSetsFrom` / `spriteSet`) over its card's; today keyed on the speaker's card id — read the member of the seat holding that card.

## Tests (Done means)
- A card-less member (member made with `insertCastMember` and no card, seated — or a member whose card was unlinked) gets: its group-only greetings in a group session (`sessions/greetings.ts`), its likeness in the scene picture's references (`illustrateScene`), its timbre (`resolveVoice`), its sprite set (`sprites/choices`).
- `sessions/backdrop.ts`: a member's gallery file (`files.cast_member_id`) is a cast image; **a dated card change written as a version** (`insertDatedCardVersion`) makes that card's gallery count for the session's backdrop.
- `embedding`: the embed text of a card after `newCardVersion` is the new version's name + description.
- Run with `--maxWorkers=2`: the tests of every file you touched (`ls` siblings: `sessions/greetings*`, `pipelines/prompt/cardStrokes*`, `contextFields*`, `pipelines/runtime/illustrateScene*`, `cardAction*`, `embedding/ragContext*`, `vectorizationQueue*`, `sessions/backdrop*`, `speech/resolveVoice*`, `sprites/choices*`), plus `characters/frozenColumns.guard.test.ts`.
- `npx tsc --noEmit -p .` clean on your files.

## Out of scope (note, don't fix)
`pipelines/runtime/host.ts`, `pipelines/prompt/promptFields.ts`, `pipelines/prompt/seatCards.ts`, every `sockets/*` file (worker 3 is editing those now); the card editor and library; `sprites/index.ts` (worker 1 done).
