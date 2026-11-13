# BRIEF s4-st-w1 — starters copy people card-less (lane s4-st, wave 5) — 2026-11-08

Supervisor: lane `s4-st`. Repo `/home/jody/github/serene-pub`. Use absolute paths. Report in your final message (the harness may refuse report files): changed files, tests run with results, decisions, anything you could not do, Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You should not need `sdk:build` at all.)

**Prettier:** run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit. If a file fails only on lines you didn't touch, leave it and say so.

## Owner rulings (quote, never reinterpret)

- 2026-11-05: "every starter copies people card-less"; "Plugins can only ship lorebooks as starters. They contain cast, not cards."
- 2026-11-05: "If a cast's feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member."
- 2026-11-08 ★5: cards that 0.6 starters already copied into libraries **stay** — no migration, no cleanup.
- 2026-11-08 ★S4-1: a provided book keeps its plugin-stamped cards hidden as the release carrier; every starter copy is card-less. (Another worker does the hide; you don't.)
- Memory rule "There is ALWAYS a lorebook": never write copy, comments or code paths that frame a session as having no lorebook — say own book / overlay / notes.

## Goal (plan §34.2 "Starters card-less")

1. **`src/lib/server/lorebooks/starterKits.ts`**
   - Delete `ownCastCards` (~531–658). In `bookFromKit`'s book-row path, after `duplicateLorebookRows` (versions come with it), run **every** member of the copy through `makeMemberCardless(tx, memberId, { cause: "starter" })` (`src/lib/server/cast/cardless.ts`) — for every kit (admin kit, provided primer row, a clone), whoever asks, the asker's own cards included. Read the members (id, characterId) **before** the calls.
   - **Annotations:** `ownCastCards` used to rewrite the copy's annotation keys `character:<old>` → `character:<copy>`. Keep the copy's annotations right the same way, now to the member: for each card that exactly **one** member of the copy was linked to, rewrite that copy's entries' `entry_annotations` rows `entity_key = 'character:<card>'` → `'cast_member:<memberId>'` with `character_id = null` (that is how the annotations module writes a card-less member's key: `annotations/index.ts` `valuesFor` sets `characterId` only for `character` refs; `pipelines/ranking/entities.ts` `entityKey`/`parseEntityKey`). A card two or more copy members shared is left for the annotation lane's re-sweep (the copy's vocabulary hash differs, so those rows are stale and get re-annotated). Check `schema.entryAnnotations` for a unique index on (entry, key) and handle a collision without failing the copy; say what you chose.
   - `writePrimerInto` (~822): the cast loop inserts **card-less members** — `insertCastMember(tx, { lorebookId, characterId: null, binding: await deriveNextBindingToken(lorebookId, tx), name: m.name, description: m.description })` (the member's base version takes them as its own words: `characters/versions.ts` `memberProfileOf`, `card == null` branch). No `insertCard`. Its return drops `characterIds` (keep `entryIds`). Update its JSDoc ("cast: a character card for `userId` and a cast member binding it" → a card-less cast member…).
   - `afterKitCopy` (~662): keep only the cover (`ownCopiedCover`) and the vectorizer queue for the **book** (`autoEnqueueLorebook`). Remove the card avatar uploads and `autoEnqueueCharacter`. Keep its signature `(copy, userId, ownerName)` — `sockets/lorebooks.ts` (another lane's file) calls it.
   - `KitCopy`: remove the card list's meaning. **But** `src/lib/server/sockets/lorebooks.ts` ~708 (owned by lane s4-fixes — do NOT edit it) still reads `copy.cards.length`. So keep the field as a transitional stub so that file compiles and runs: `/** ⏳ Always empty: starters copy their cast card-less (S4, plan §34.2). Goes with the \`characters:list\` emit in \`sockets/lorebooks.ts\` lorebooks:create (queued to the lead). */ cards: readonly never[]`, always `[]`. Nothing in your files reads it.
   - Remove imports nothing uses any more; update the file's header comment (it describes `ownCastCards`; say a copy's cast is card-less, each member through `makeMemberCardless`, cause `starter`).
2. **`src/lib/server/cast/cardless.ts`** — the cause only: `CardlessCause` gains `"starter"` (a non-unlink cause: the full detach already happens for every cause but `unlink`). Update the header's "Not for starters yet." and its "It never writes annotations" sentence only as far as needed to stay true (the writer itself still writes none; the starter path rewrites its copy's keys as `ownCastCards` did).
3. **`src/lib/server/lorebooks/tableRegistry.ts`** — `remapEntityKey` only (~163) and its two call sites (~609, ~1035): it also remaps `cast_member:<id>` keys to the copy's member through `maps.bindings` (a key naming a member the map lacks is dropped, as an `entry:` key is). Signature e.g. `remapEntityKey(key, maps: Pick<IdMaps, "entries" | "bindings">)` or a third parameter — your choice, name it. Update its JSDoc. Nothing else in the file.
4. **`src/lib/server/plugins/providedPrimers.ts`** — `importPrimer` no longer has cards to stamp or queue (`written.characterIds` is gone): remove the card-stamping block and the `autoEnqueueCharacter` loop; keep the book's mark and `queueImportedBook`. Update the header (⚠ "Not diffed on an upgrade: the cast and its cards" → the cast). Existing primer rows keep their already-stamped cards (★5 / ★S4-1): no migration, no cleanup.
5. **`src/lib/server/sockets/starterKits.ts`** — `finishCopy` no longer emits `characters:list` (drop the branch and the now-unused import); `saveFromBook`'s `finishCopy(..., { lorebookId, cards: [], coverFrom })` keeps compiling against the stub; fix the `starterKits:clone` JSDoc that says a kit "gives its cast's cards to the clone".
6. **`src/lib/server/sockets/sessions.ts`** — **only** the hunk ~1570: `if (madeFromKit.cards.length) { … emitToUser("characters:list" …) }` goes. Touch nothing else in this file.

## Files owned (edit only these)

The six files above (with the hunk limits stated), and tests: `src/lib/server/lorebooks/starterKits.int.test.ts`, `src/lib/server/lorebooks/starterKitsVersions.int.test.ts`, `src/lib/server/plugins/providedPrimers.int.test.ts`, `src/lib/server/plugins/primerRowReadOnly.int.test.ts`, any `tableRegistry` / `lorebookDuplicate` test that pins `remapEntityKey`, and a new `src/lib/server/lorebooks/starterKits.cardless.int.test.ts`.

## Files readable

`cast/cardless.ts` (and its tests `src/lib/server/cast/*cardless*.test.ts` for fixtures: sprite sets, gallery `cast_member_files`, faces), `characters/versions.ts`, `utils/lorebookDuplicate.ts`, `sprites/index.ts`, `media/index.ts`, `annotations/index.ts`, `sockets/sessions.castMemberIds.int.test.ts` (how a test seats card-less members through `sessions:update` / create), `plans/PLAN-sdk-creation-seams-2026-10-30.md` §34.2.

## Out of scope

The hide of carrier cards (worker w2); docs (w2); `sockets/lorebooks.ts`, `state/**`, `annotations/index.ts`, `characters/versions.ts`, `sessions/convertRuleset.ts`, `EditSessionForm.svelte` (lane s4-fixes); Copy to my characters; any migration (none is needed: ★5); new names, settings, events.

## Stop and ask when

A change would need a file outside the owned set; a new name (type, column, event, UI word) seems needed — `"starter"` as a `CardlessCause` value is already queued in the canon, nothing else is; `makeMemberCardless` can't do something a starter copy needs (say what, don't patch `cardless.ts` beyond the cause). Put it in your report and finish the rest.

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently (`db/transactionGuard.ts` throws in test).
- Never add a top-level `await` to `src/lib/server/db/index.ts`. No migration. Never seed a row at a fixed id.
- It is a **session**, never a chat.
- A DB-opening int test needs `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })` (the existing starter tests show the pattern, including the `vi.mock` of `$lib/server/db`, embedding and vectorizationQueue).
- Never pipe vitest into `head`.

## Done means (tests — write or rewrite these; old assertions that pinned copied cards become card-less assertions)

1. Starting from **a primer** (catalogue, no row), **an admin kit** another admin owns (with a card that has a sprite set with an image, a gallery picture and a face), and **a provided primer row** (`syncProvidedPrimers` / `importPrimer` as `providedPrimers.int.test.ts` sets up) creates **no `characters` rows** for the asker (count the asker's cards before/after; also `lorebooks:create` from a kit and `sessions:create` from a kit through their handlers).
2. Every copy member: `character_id` null; every version's `follows` empty and `parent_version_id` null; the words read as the card's (name, description via `membersAsRead` or the base version).
3. Annotations: the copy's `character:<kitCard>` rows are `cast_member:<member>`; a source `cast_member:<id>` key is remapped to the copy's member (duplicate a book that has one); an unmapped one is dropped.
4. Sprite sets, gallery and faces present on the copy's members and their files owned by the asker (`files.user_id`).
5. A session started from a kit seats the notes' members card-less (create from the kit, then seat them by `castMemberIds` as `sessions.castMemberIds.int.test.ts` does) — seats with `cast_member_id` set and no card.
6. `writePrimerInto` writes card-less members with the primer's name and description.
7. The kit row itself is unchanged (its members still linked to its cards).

Run, in a capped scope, logged (scratch files in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, names starting `s4-st-w1`):

```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-st-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-st-w1-tests.log'
```

Files: the owned test files, plus `src/lib/server/cast/` cardless tests, `src/lib/server/utils/lorebookDuplicate*.test.ts` (whatever exists), `src/lib/server/sockets/sessions.castMemberIds.int.test.ts`. Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0` with `NODE_OPTIONS=--max-old-space-size=8192` (baseline is 0 errors). Report counts.
