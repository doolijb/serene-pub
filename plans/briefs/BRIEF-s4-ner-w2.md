# BRIEF — lane `s4-ner`, worker w2 — scene readers map a `cast_member:` mention straight to the member (2026-11-08)

Supervisor: lane `s4-ner` (report to it; it checks your diff against this brief). Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

Owner ruling 2026-11-06: **"Entity recognition → card-less cast members recognised as cast members (a `cast_member:<id>` mention kind, stored beside card mentions)."** ★9 (2026-11-08): stored as the **entity key only, no migration**; **readers filter out members that no longer exist**.

Context — what exists now:
- The supervisor changed `src/lib/server/pipelines/ranking/entities.ts`: `EntityRef.kind` is `"character" | "cast_member" | "entry"`; `cast_member` ids are `lorebook_bindings.id` (the cast member row). New helper **`parseEntityKey(key): EntityRef | null`** (under `entityKey`) — use it; **never slice a key prefix or regex a key by hand** in the files you touch.
- Worker w1 is changing `annotations/index.ts` `loadVocabulary` in parallel so a member with no live card (card-less, or card soft-deleted) resolves to `cast_member:<memberId>`; a carded member stays `character:<cardId>`. **Don't edit `annotations/index.ts`.** Your tests must not depend on w1's change: write annotation rows yourself with the `cast_member:<id>` key and the hash `loadVocabulary` returns at that moment (or pass `vocabularyOverride`), as the existing tests do.

Your work:

1. **`deriveSceneMentions`** (`src/lib/server/utils/sceneMentions.ts` ~170–275). Today it reads `messageAnnotations.characterId` and maps card → member via `castMemberCards(db, lorebookId).memberOf`. Make it read each fresh row's `entityKey` with `parseEntityKey`:
   - `character:<card>` → the member exactly as today (`memberOf`);
   - `cast_member:<id>` → that member id **directly (no card hop)**, but only when a `lorebook_bindings` row with that id exists **in this lorebook** — one batched query for all such ids. A missing member (deleted, or another book's — e.g. a copied book's stale key) is skipped silently, never thrown;
   - `entry:` / `open:` / sentinel → ignored as today. "Present beats mentioned" applies to both kinds. Keep the coverage/freshness logic byte-for-byte in meaning. Drop the `characterId` select if nothing else reads it.
   - Update the header's "What can never be derived" paragraph (~42–48): card-less (background) members with a name now resolve and can appear; only a member with no name stays unseen.
2. **Live scenes** (`src/lib/server/scenes/liveScenes.ts`) — the caller that turns a `proposeSceneCast` proposal into `scene_characters`:
   - `writeProposedCast` (~726–755): a `character:<card>` key keeps going through `resolveOrCreateBinding` as now; a `cast_member:<id>` key maps **straight to that member** when it is a member of `scene.lorebookId` (batched lookup), else `bindingId: null` and nothing written for it. Never call `resolveOrCreateBinding` for it.
   - `refreshOpenSceneCast` (~765–805): its "same cast?" check compares card ids only. Make it compare like with like: give each stored participant binding the key the vocabulary would give it (live card → `character:<card>`, no card or a soft-deleted card → `cast_member:<bindingId>`; join `characters` for `is_deleted`) and compare that set with the proposal's `character:` / `cast_member:` keys (other keys ignored, as now). A line by someone already in the scene must still write nothing.
   - This file has a lot of uncommitted work from earlier lanes: touch only these two functions (and imports). No other change.
3. **`src/lib/server/utils/sceneCastProposal.ts`** is pure and passes keys through, so a gazetteer `cast_member` ref already proposes `cast_member:<id>`. Change only its doc: the "A recall limit that is structural" section (~82–92) is now narrower — a named card-less member resolves; only a name with no member arrives as a suggested new character. `isNonPerson` must not treat `cast_member:` as a non-person (it doesn't today; keep it so).

## Files owned (edit nothing else)

- `src/lib/server/utils/sceneMentions.ts`
- `src/lib/server/scenes/liveScenes.ts` (`writeProposedCast`, `refreshOpenSceneCast`, imports only)
- `src/lib/server/utils/sceneCastProposal.ts` (doc comments only)
- Tests: `src/lib/server/utils/sceneMentions.int.test.ts`, `src/lib/server/utils/sceneCastProposal.test.ts`, `src/lib/server/scenes/liveScenes.castMembers.int.test.ts` (new).

## Files readable

Anything. Useful: `src/lib/server/utils/sceneMentions.int.test.ts` (its `makeScene` / `annotate` helpers), `src/lib/server/scenes/liveScenes.playerSeats.int.test.ts` (how a live scene and `readCastProposal` are set up in a test), `src/lib/server/utils/castMemberCards.ts`, `src/lib/server/db/schema.ts` (`lorebookBindings`, `characters.isDeleted`, `messageAnnotations`, `sceneCharacters`), `src/lib/server/annotations/index.ts` (read-only: `annotationTextHash`, `loadVocabulary`, `EXTRACTOR_VERSION` use).

## Tests to write (DB inside `it` → **60_000** timeout each)

`sceneMentions.int.test.ts` (add a `describe` for cast members):
- a fresh message annotation keyed `cast_member:<id>` for a card-less member of the book → that member id in `bindingIds`;
- the same key for a member that has been **deleted** (row gone) → filtered out, status still `derived`, no throw;
- a `cast_member:<id>` naming a member of **another** book → filtered;
- a `cast_member` member who is a scene participant → excluded (present beats mentioned);
- the existing `character:` cases still pass unchanged.

`sceneCastProposal.test.ts`: a gazetteer with `{name, ref:{kind:"cast_member", id}}` proposes a participant keyed `cast_member:<id>` (with a speech tag or vocative as evidence) carrying that `ref`.

New `liveScenes.castMembers.int.test.ts`: opening/closing (or `refreshOpenSceneCast` on) a live scene whose lines name a card-less member writes that member's binding id to `scene_characters` without minting a binding; a second `refreshOpenSceneCast` with nothing new returns `false`; a `cast_member` key of a gone member writes nothing for it. Find the narrowest exported entry point (`refreshOpenSceneCast` is exported); seed with `loadVocabulary`'s gazetteer by giving the member a name (if w1's change hasn't landed when you run, the card-less member won't be in the gazetteer — in that case test `refreshOpenSceneCast`'s comparison and the write through a scene whose cast proposal you can drive, and say in your report which assertion depends on w1; the supervisor will re-run after both land).

## Run (only these, in a capped scope, logged)

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/utils/sceneMentions.int.test.ts src/lib/server/utils/sceneCastProposal.test.ts src/lib/server/scenes/liveScenes.castMembers.int.test.ts src/lib/server/scenes/liveScenes.playerSeats.int.test.ts src/lib/server/scenes/liveScenes.rewind.int.test.ts src/lib/server/utils/sceneCast.int.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-ner-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-ner-w2-tests.log'
```
Never pipe vitest into `head`. Don't run tsc / `npm run check` — the supervisor does. Run `npx prettier --check` on each changed file; **only `--write` the lines you changed** (never reformat a whole file; if a file fails only on lines you didn't touch, leave it and say so).

## Rules that apply (CLAUDE.md, quoted)

- "It is a **session**, never a *chat*."
- Owner memory rule "There is ALWAYS a lorebook": never write copy or comments that frame a session as having no lorebook.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." If a function receives a `tx`/`db` handle, every query in it uses that handle.
- P1 "Deterministic, never hidden": the live-scene cast write already runs only where a genre opts in (`castRefresh`); don't widen when it runs, only what a key maps to.
- No migration, no new table/column/setting/event, no new exported name. If you think one is needed, stop and say so in your report.
- Findings outside these files go in your report under **Noticed, not done** — never fixed in passing.
- Existing files have uncommitted work from earlier lanes; edit around it, never revert it.

## Stop and ask (in your report, then stop) when

A change seems to need a file not listed above; a test shows a live flow (graph build, scene review, summarize) depends on card-less members never being mentioned; a new name, setting or migration seems needed.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (No `sdk:build` is needed for this task.)

## Report

Your final message: changed files (with what changed in each), tests run with the pass/fail counts from the log, every implementation choice you made, Noticed-not-done.
