# BRIEF — s4-fold worker 4 — the fold's notes members, member overlays, Back/Forward, riders, timing — 2026-11-08

Supervisor: lane `s4-fold` (brief `plans/briefs/BRIEF-s4-fold.md`). You are a lane-worker; you cannot spawn agents. Worker 3 built `src/lib/server/lorebooks/foldInParent.ts` (1,159 lines; steps as private functions: `lockAndRead`, `readSession` (guard), `snapshotOwn`, `refuseNotesMemberClash`, `carryBookFacts`, `moveSessionLine`, `moveCaptures`, `rewriteOwnRows`, `moveSessionRows`, `repointMembers`, `refileOwnWorldRows`, `readOnlyNotes`, `compareReads`) and its test `foldInParent.int.test.ts` (9 green). Read both first, in full. You finish the fold.

## Owner rulings (quote, never reinterpret)

- ★B-1 (2026-11-08): the fold copies the whole parent — every line; the session's line remapped.
- ★B-2 confirm: _"‹book›'s entries, cast, lines and dates are copied in, **your changes stay on top**, and from then on the session reads only its notes. ‹book› is not changed."_
- **★bk-fold-3 (2026-11-08): fold the notes' member into the copied member** — _"values/sheets/references move, turn ties kept, the emptied notes row deleted"_. Lead's brief: _"a notes member N holding a card P's member M also holds: N's values/configs/sheets re-owned onto M′, turn ties kept, every reference to N re-pointed, N lets go of the card before the copy, N deleted."_
- ★bk-fold-4: re-file the notes' own world rows after the copy (your changes stay on top) — built (`refileOwnWorldRows`).
- §34.3: _"member overlays (`overlay_of = M`) folded into the copy M′ (overlay versions get fresh `write_order` above the copy's; rows a descendant reads are retired, not deleted, §33.2)"_. §33.2: _"One retire mark (`retired_order bigint`): … marks the row retired (`retired_order` = the next write order) instead of deleting it … A reader passes a row when `retired_order` is null or greater than its mark for that source."_
- §33.3 / owner 2026-11-05 late: _"Parent deleted while a branch rides its never-surfaced notes → the notes outlive the parent while any patron rides them."_ — branches of S ride S's notes; the fold must not change what they read.
- 2026-11-05: _"Data wise, the session is a patron of the lorebook and branch, it doesn't own it."_ — P is never written except this session's scene captures.
- P2 (owner principle): _"A module owns its data and every write to it … Two writers of one thing is a bug."_

Terms: S, P (attached book), O (S's own book), M ∈ P, M′ = `maps.bindings.get(M)`, N = a member of O.

## Goal

1. **★bk-fold-3 — notes member N folded into M′.** Replace `refuseNotesMemberClash`'s plain error. N = a non-overlay member of O (`overlay_of` null) whose `character_id` is a card some M ∈ P holds (`lorebook_bindings_character_unique`, `schema.ts` ~1751, is on `(lorebook_id, character_id) where character_id is not null` — so N must let go of the card before `copyLorebookTables`). Read how N arises first (`state/worldScope.ts` ~144 `ownBookMemberOf`, ★M3b-W-2; `sessions/seats.ts` `resolveSeatMember` — the attached member wins a seat, so S's seat normally holds M, not N). Then, after the copy:
   - N's rows re-owned onto M′, **re-filed** (new ids, after M′'s copied rows, every other column kept — anchors, dates, `valid_from_message_id`, `source_*`) so N's values "stay on top" exactly as `refileOwnWorldRows` does for the world: `attribute_values`, `attribute_configs` (template layer and S's session layer), `owner_sheets` and `attribute_carries` (unique keys — on a clash N's row wins, the copy's row goes; say what you did), `zone_contents` owned by N, `cast_presences` of N.
   - Every reference to N re-pointed to M′: seats (`reseatOnto` with `N → M′` in its moves), speaker stamps, `rekeySessionRefs(… memberMoveTranslator(moves))` with N in `moves`, scene cast (`scene_characters.binding_id`), annotations (`cast_member:N` entity keys), `narrative_relationships` nodes, `lore_imprints` member subjects, anchored entries (`anchor_binding_id`), binding suggestions, merge logs — enumerate FKs/columns to `lorebook_bindings` in `schema.ts` and list what you moved.
   - N's character versions: S never read them for the person (the seat read M) — confirm with the guard; delete them with N (they go through the versions module's own delete if it has one — P2; otherwise say so). Then delete N.
2. **Member overlays** (bindings of O with `overlay_of = M`, M ∈ P — the member overlay, 0145): they also hold M's card, so they let go of it before the copy (check this doesn't change what any reader reads — the readers join overlays by `overlay_of`, not by card). After the copy, carry each overlay's own data onto M′ so S reads the same: its character versions copied onto M′ through the versions module's one INSERT (`insertCharacterVersions` in `characters/versions.ts`; the `versionsWriter.guard` test forbids any other INSERT) with **fresh `write_order` above M′'s copies** — and filed so that S, reading O on its line (worker 1's own-notes reading; `cast/memberAsRead.ts` `pickVersions` reads the book of an `onOwnBook` reading along the line), still picks the overlay's version where it picked it before (the pick order is: later date → nearer holder (overlay depth, then line step) → higher life point → higher write order → higher id; `shared/lorebooks/lineReading.ts` `versionInForce`). Before the fold an overlay row read on O's main at depth 0 beat P's row on S's line on a date tie; after, a copy on O's main would lose to M′'s row on the line by line step — so file the carried versions **on S's remapped line** (null = main) unless the guard shows a better rule; say what you chose and why. The overlay's values/configs/sheets → re-filed onto M′ as for N.
   - **Riders:** a branch session B of S (`sessions.branch_ancestry` contains S; B still reads P with its own notes and S's notes in its overlay chain — `state/reading.ts` `overlayChainOf`) reads S's overlay rows of M through the chain. After the fold S no longer asks for M, so leave every overlay binding and its versions **in place** (card released only) when any session's ancestry contains S; delete them (through the owning writers) when none does. Prove B reads the same.
3. **Back / Forward keep ties.** Story writes S made into P may be tied to S's turns (`valid_from_message_id` on `character_versions` and attribute rows; NOMENCLATURE says real books' attribute rows stay unanchored, cast versions may not be). The copy keeps ties (`keepTurnTies`). Check `state/write.ts` Back paths (`~850` deletes `attribute_values` / `attribute_configs` / `zone_contents` **by `valid_from_message_id` across every book**; `retireOrTakeVersions` / `restoreVersions` for versions): after a fold, a Back on S must take and Forward restore the **copies in O** and must leave **P byte-identical**. If a Back path would touch P's originals (a row of P tied to S's message), scope that delete/retire to rows of the books S reads (the own book and its chain) — that hunk of `state/write.ts` is yours; say exactly what you changed. If the fix needs more than scoping the queries, stop and describe it in your report.
4. **P2: the speaker-stamp write moves to its module.** `repointMembers` updates `session_messages.cast_member_id` and `messages.cast_member_id` directly. Move that update into `src/lib/server/messages/store.ts` as one exported 🚧 `repointSpeakerStamps(tx, sessionId, moves: ReadonlyMap<number, number>)` (one JSDoc sentence; inside the caller's transaction; returns the count) and call it from the fold.
5. **Stronger entry guard.** `readSession` compares only `typeId`, `name`, `keys`, `unseen` (what `sessionEntriesAsRead` returns). Add each entry's **content and fields as the session reads them** (dated entry amendments applied on the session's reading): find the reader the prompt path uses for an entry's text on a reading (grep `entry_amendments` / `amendmentsAsOf` / `entriesAsRead` consumers in `state/lorebookState.ts`, `embedding/ragContext.ts`) and add it to the projection, ids mapped. Also add **resolved values** for the session (the world, each seat, each place — `state/resolve.ts` `stateFor` or the reader the state socket uses) so "your changes stay on top" is guarded, not only tested.
6. **Done-means tests** — extend `foldInParent.int.test.ts` (60 s timeouts for DB work in `it`):
   - **★bk-fold-3:** O holds N for card X (written the way production writes it — through `ownBookMemberOf` / a world-scope write for a seated card if reachable, else a fixture) with a value on a slot M also fills; P holds M for X; S's seat holds M. After: N gone, M′ holds X, N's value read on top, a `seated-member:N` ref (if any) on M′, no row names N.
   - **Member overlay:** O holds an overlay of M with a version (a changed description) and a value. After: S reads the changed description and value on M′; the guard passed.
   - **A branch riding the notes still reads:** B branched from S before the fold (use the real branch path, `sessions/branch.ts`) — B's `membersAsRead` / `sessionEntriesAsRead` / values equal before and after S's fold.
   - **Another session on P untouched:** a second session S2 on P (with its own notes) reads exactly the same before and after; P byte-identical except S's captures (the existing dump helper).
   - **Back / Forward after the fold:** S writes a tied value and a tied cast version (through the real writers) on turn T before the fold; after the fold, Back past T takes the copies in O and P stays byte-identical; Forward restores them; Back again; reads match the pre-fold Back reads.
   - **Rollback** stays covered; **second fold refused** stays covered.
   - **Timing on a large book:** an env-gated test (`it.skipIf(!process.env.FOLD_PERF)`) folding a book of ~2,000 entries / 200 members × 5 versions / 1,000 links / 2,000 values into non-empty notes; log the ms. Run it once with `FOLD_PERF=1` and report the time (bk-fold measured the copy alone at ~2.7 s).
   - Run again: `foldInParent.int.test.ts`, `src/lib/server/sessions/seatKeys*.test.ts`, `src/lib/server/lorebooks/tableRegistry*.test.ts`, `src/lib/server/messages/store*.test.ts`, the `state/write*.int.test.ts` files if you touched write.ts, `src/lib/server/characters/versionsWriter.guard*.test.ts` (or wherever the one-INSERT guard lives — grep `versionsWriter`), `src/lib/server/state/ownNotesReading.int.test.ts`, `src/lib/server/sockets/ownBooks.fold.int.test.ts`.
   - tsc: no new errors.

## Files owned

`src/lib/server/lorebooks/foldInParent.ts` + `foldInParent.int.test.ts`; `src/lib/server/messages/store.ts` (`repointSpeakerStamps` only); `src/lib/server/state/write.ts` (only the Back/Forward scoping of item 3, if needed); `src/lib/server/sessions/seats.ts` (`reseatOnto` only, if it needs a change). Read-only everything else — in particular `characters/versions.ts`: use its exported writers; if a writer you need doesn't exist there, stop and say which.

## Out of scope

The socket, doors, docs (done by worker 5); where post-fold writes land (own-book writes on a non-main line) and branching a folded session — the supervisor queues those; `host.ts`; NOMENCLATURE (queue rows).

## Rules you must follow (quoted)

- CLAUDE.md Hard rules: _"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."_ · _"Never seed a row at a hardcoded id."_ · _"It is a **session**, never a *chat*."_
- NOMENCLATURE R1, R3, R6 🚧 on new exported names; the only new exported name allowed is `repointSpeakerStamps`.
- A guard difference you can't trace to a fixable step: **stop and describe the fixture** in your report (supervisor stop-and-ask).
- Comment style: plain present-tense sentences; no history comments ("previously", "used to", "was replaced") — a ratchet test fails on them.

## Commands

- Tests, capped and logged (never pipe vitest into `head`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w4-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w4-tests.log'`
- tsc: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && npx tsc --noEmit -p . > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w4-tsc.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w4-tsc.log'` — another lane edits other files; report errors in your files only.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Prettier: `npx prettier --check` on changed files; only `--write` lines you changed (`foldInParent.ts` and its test whole are fine).

## Report

Final message (no report file): changed files; per goal what you built (step names); the rule chosen for carried overlay versions and why; what references to N you moved (tables/columns); the Back/Forward finding and any `write.ts` change (exact hunk); the guard's added projection; tests with counts; the large-book time; tsc; deviations; **Noticed, not done**; NOMENCLATURE rows (`repointSpeakerStamps`, the notes-member fold rule, the overlay carry rule).
