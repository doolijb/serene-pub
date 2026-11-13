# Lane s4-follow-a: approved server-side follow-ups (2026-11-09)

All 8 goals are built, and so is the lead's mid-lane addition: a card-less seat can now be benched. Every targeted test passes: batch 1 is 18 files (181 passed, 1 skipped), batch 2 is 56 files (602 passed). tsc and svelte-check are each down to 3 errors, all in s4-follow-b's `overhear-seat` work, which needs its SDK build and can't build while the owner's dev server runs.

**Left for the lead (applied by the lead, see the end):** the fold re-points character seats and returns what changed, but nothing announced it. The call belongs in `src/lib/server/sockets/ownBooks.ts`, right after `const folded = await foldInParent(db, { sessionId, userId })`. The fold has already committed by then, so it runs outside any transaction. The scope reviewer's finding 1 is this same gap.

Worker briefs: `plans/briefs/BRIEF-s4-follow-a-w1.md` … `-w6.md`. Logs: `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/` (`s4-follow-a-final1.log`, `-final2.log`, `-tsc-before/after.log`, `-check-before/after.log`). No sdk:build was needed, no migration was made, and no stored data changes.

## Goals

### Goal 1: every roster change goes through the one seat writer (★s4-seat-ev)

**What the seat writer does now** (`src/lib/server/sessions/seats.ts`):
- Every writer reports what it changed:
  - `seatCast` and `seatPlayer` report a seat as **added** only when it wasn't live before: a new seat, or a revived one.
  - `settleSeats` reports a merge (boot only) as **removed**. A fill reports nothing, because the seat didn't join or leave.
  - `reseatOnto` (the fold) reports a removed-then-added pair for each live character seat, since its reference changes with the member. A player seat's reference doesn't change, so it reports nothing.
- New 🚧 `unseat`: a person removing a seat. Removal moves into the writer's "What it owns".
- New 🚧 `announceSeatChanges`: nets the changes by seat reference (an add and a remove of the same seat cancel), builds the member-form reference, and sends `member-added` / `member-removed` with exactly the payload the old emitter used. It never throws and always runs after the transaction has committed.
- New 🚧 `setSeatEnabled`: the bench write.
- New type 🚧 `SeatChange`. The header now says which doors announce.

**Doors:**
- `seatName.ts`: `writeSeatName` and `editCardlessPlayerSeats` take a collector, remove through `unseat`, and the retire path now uses `unseat` too.
- `sockets/sessions.ts`:
  - `sessions:update`: all three removals go through `unseat`, and the changes are announced once, at the spot where the old diff fired. The member half of the old snapshot diff is gone; the snapshot stays only for the reorder (`cast-changed position`) diff, so the order of events is unchanged.
  - `sessions:addPersona` now announces. It sent nothing before.
  - `sessions:reassignRemovedParticipant` now announces. It sent nothing before.
- `foldInParent.ts` returns 🚧 `seatChanges`.

**What the one path does differently from the removed diff:** when a card-less player seat takes a card (`givePlayerSeatACard`), it no longer fires `member-added`. Its reference `player-seat:<id>` doesn't change, so nobody joined.

**Lead's addition, bench a card-less seat:**
- `sessions:setCastSeatEnabled` takes exactly one of `characterId` or `castMemberId`.
- A carded seat keeps today's rule (session owner or the card's owner). A card-less seat is allowed for the session owner or the person who seated it.
- The write goes through `setSeatEnabled` by seat id.
- It fires exactly one `cast-changed { change: 'enabled' }` with `seated-member:<id>`, and nothing on a repeat press.
- "Fire the one event, like the other doors" was read as *one event, of today's kind*, not `member-removed`. See ★-1.

**Tests:** new `src/lib/server/sockets/sessions.seatEvents.int.test.ts` (11 tests through the real handlers):
- each door fires exactly one event per changed seat: carded and card-less character seats, persona and card-less player seats, addPersona, reassign;
- a reorder fires no member event, and a re-save fires none;
- bench by `castMemberId`, a non-manager refused, a repeat press silent.

`seats.int.test.ts` gained 7 tests: changes for new, revived and already-live seats; `unseat` once then nothing; `reseatOnto`; netting. The two `foldInParent.int` expectations were updated for the new result shape.

### Goal 2: a branch no longer reads the parent's post-fork turn-tied rows (★s4-verify-3)
- `state/reading.ts` `rowsOnReading`: when a reading has session cuts, a durable row tied to a message of a cut session is kept only up to that cut's `through` (none at all when `through` is null).
- A non-branch reading is unchanged and runs no extra query.
- The `test.fails` in `ownBook.branchNotes.int.test.ts` is now a passing `test`. New tests: the parent still reads its turn-tied row; a row tied at the fork still reaches the branch.

### Goal 3: member–entry links reach a branch (★s4-last-1)
- `utils/graphEntryLinks.ts` `bookEntryLinks` also accepts ends in the session's overlay chain books. A non-branch session gets the same list as before.
- `lorebooks/ownBook.ts` `copyNotesStatsAndLinks` now copies entry–member links: the entry end through `entryRemap`, the member end kept, since members are shared. Member–member links are still not copied.
- New test: the branch lists the link with the member named, and the parent reads it once. The big branch test was updated to the new expectation.

### Goal 4: the f-emit-3 owner note
- New test: member M played by the AI in session A and by a person in session B. Both sessions' durable writes land on `cast_member:M`.
- **A card-less player seat did not file its member before; it does now.** New loops in `state/durable.ts`, on both the own-notes and the attached-book routes, file it as owner `player_seat:<id>`, with the same tie rule: skipped when a character seat of the same session files that member. Which book holds the member is found with one query; `state/resolve.ts` is untouched.
- New tests: a card-less player seat files its member; with the same member also in a character seat, it is filed once.

### Goal 5: the session's lorebook name on `sessions:get` (★bk-lock-2)
- `withSessionExtras` (the one place both session payloads pass through) sets 🚧 `lorebookName`: the attached book's name, else `SESSION_NOTES_LABEL`.
- The type is updated in `types.ts`.
- In `EditSessionForm.svelte` only the `savedLorebookName` derivation changed, so the read-only line names the book even for a guest.
- New `sessions.lorebookName.int.test.ts`: owner and a guest who can't list the book, each on an attached book and on own notes. One new case in `editSessionLorebookLine.dom.test.svelte.ts`.

### Goal 6: scope keys for member replies (★cp-scope-1)
- `shared/sockets/interest.ts` has a private `ownerScope` extractor (`characterId`, else `member:<castMemberId>`) for the gallery family (list, upload, delete) and the ten sprite events.
- Fill, express, portrait, likeness and describe are untouched. `reorderGallery` isn't in `SCOPED_EVENTS`.
- Client keys switched in three places:
  - `SpritesTab.svelte`: `replyKey` only. A member is scoped only on events the table scopes for members, so the fill and express replies still reach the member tab on the bare key.
  - `EntityGalleryTab.svelte`.
  - `CastMemberForm.svelte` `OWN_LIST_EVENTS`.
- Tests: a 13-event loop in `gatedEvents.test.ts`. `spritesTab.memberOwner.dom.test.ts` and `memberGallery.dom.test.ts` were updated, including their header comments.

### Goal 7: delete from a member's gallery (★cp-del)
- 🚧 `removeFromMemberGallery` in `media/index.ts` unlinks the picture. It deletes the file only when nothing else uses it: no sprite, no character-version face, no other member's gallery, no card gallery, no session, message or conversation. When unsure, it keeps the file.
- `characters:deleteGalleryImage` takes `{castMemberId, mediaId}` under the edit rule, reusing the upload handler's member parsing and wording, and re-sends the member's gallery list.
- The member Gallery tab shows Delete to editors.
- New `characters.memberGalleryDelete.int.test.ts` (4 tests).
- Refusals: "Cast member not found." and "Only someone who can edit this cast member's lorebook can change its pictures." (both the upload handler's existing sentences); new: "That picture is not in this cast member's gallery."

### Goal 8: cast members own or follow post-history instructions, creator notes and likeness (★cp-10)

**Server:**
- `RETOLD_FIELDS` gains `postHistoryInstructions`, `creatorNotes` and `likeness`.
- `memberProfileOf`: a card-less member owns all three; a carded member owns one only when its flag is on. A row without the new keys gives the same `follows` as before, so no stored row changes (tested).
- `memberColumnsOfVersion` and `castChangesOfMemberEdit` carry the three.

**Save path and wire:**
- `sockets/lorebooks.ts`: the three are version-only keys (a private `VERSION_ONLY_MEMBER_KEYS`), stripped before any write to the member's row, never stored as columns.
- They are validated on update and create; likeness goes through `sanitizeLikeness`.
- Refusals:
  - "A cast member's post-history instructions are text, or null to send none."
  - "A cast member's creator notes are null, or { text: string, lang?: string, variants: { [language]: string } } — send variants as {} when there are none."
  - "A cast member's likeness is null, or { imageMediaId?: number, prompt?: string, negative?: string }."
  - "That likeness picture is not one of yours. Upload it again, or send the likeness without imageMediaId."
- The wire types `CastVersionColumns`, `CastRowVersion` and `UpdateBinding` carry them.

**Client:**
- `memberDraft.ts` carries the three, and language variants are never dropped.
- `LikenessTab.svelte` takes 🚧 `owner`. With a member owner it reads the member's gallery and sprites on the member keys and hides Describe from image. The card form's call site is unchanged.
- `CastMemberForm.svelte` has three new blocks — Post-history instructions, Creator notes, Likeness — after the "From the card" block. A carded member gets a **Use from card** switch on each; a card-less member gets just the fields.
- Edits were exact-string only. The Voice section is untouched and there was no prettier run on this file.

**Tests:** new `lorebooks.versionOnlyKeys.int.test.ts` (save an own value, read it back through `membersAsRead`, turn Use from card back on and the text is kept on the version) and new `memberOwned.dom.test.ts`. Cases added to `versions.test.ts`, `retold.test.ts`, `memberDraft.test.ts` and `memberAsRead.test.ts`, including the `followsCard` test on the three fields.

**Extra files approved by the lead for the cp-10 ripple:**
- `src/lib/server/cast/memberAsRead.ts` (`PROFILE_FIELD_OF`, which is also a runtime fix), `memberAsRead.test.ts`, `memberAsRead.int.test.ts`;
- `src/lib/server/sockets/amendments.ts` (`columnsOfMemberRow`);
- `src/lib/client/components/characterForms/castBannerWords.ts` and its test;
- fixtures: `castVersionRead.test.ts`, `memberPageVersions.dom.test.ts`, `castEditNote.dom.test.svelte.ts`.

## Changed files (owned)
- `src/lib/server/sessions/{seats,seatName}.ts`
- `src/lib/server/sockets/sessions.ts`
- `src/lib/server/lorebooks/{foldInParent,ownBook}.ts`
- `src/lib/server/state/{reading,durable}.ts`
- `src/lib/server/utils/graphEntryLinks.ts`
- `src/lib/shared/sockets/{interest,types}.ts`
- `src/lib/server/media/index.ts`
- `src/lib/server/sockets/{characters,lorebooks}.ts`
- `src/lib/{shared,server}/lorebooks/retold.ts`
- `src/lib/server/characters/versions.ts` (`memberProfileOf` only)
- Client: `SpritesTab.svelte` (`replyKey` only), `EntityGalleryTab.svelte`, `CastMemberForm.svelte`, `LikenessTab.svelte`, `memberDraft.ts`, `EditSessionForm.svelte` (`savedLorebookName` only)
- Tests next to all of these.

Three small fixes after the review:
- `withSessionExtras`' fallback now uses `SESSION_NOTES_LABEL` instead of a hard-coded "Session notes".
- The `seats.ts` header sentence is narrowed to the doors that actually announce.
- Two DOM test headers are reworded to match what they test.

## tsc and check, before and after
- tsc: 0 before, 3 after.
- check: 0 errors / 8 warnings before, 3 errors / 8 warnings after.
- All 3 errors in both are the `overhear-seat` ones in `sessionPage/requests/index.ts` and `overhearSeat.ts`, from s4-follow-b. None are this lane's.

## Open ★ for the owner
- **★-1: a bench stays `cast-changed`.** Bench and unbench fire one `cast-changed { change: 'enabled' }`, not `member-removed` / `member-added`. Turn order already hears `cast-changed`. Member events would also re-fire Lair's and Dungeon Crawler's **welcome** pipelines, which listen on `member-added`, every time someone unbenches. *Recommend: keep it.*
- **★-2: a session's birth sends no member events.** `sessions:create`, branch, import and `creationModes` announce with `session-created` / `session-branched`, not one `member-added` per seat. This differs from the brief's wording ("every seat change — `sessions:create`, … branch"), taken to the "would change when turn order hears a seat" stop rule. Doing it the brief's way would run the welcome pipelines at birth. The owner's concern ("…if turn order and story composer can't see the updated roster") is met because the turn order already recomputes on the birth events. *Recommend: keep it.*
- **★-3: copy.**
  - "Name one seat: a character or a cast member." (bench with neither key or both)
  - "Only the session owner or the person who seated this cast member can change this." (bench, card-less seat, not allowed)
  - "That picture is not in this cast member's gallery."
  - "Uses the card's likeness."
  - The cp-10 block titles "Post-history instructions", "Creator notes", "Likeness"
  - The banner words "post-history instructions", "creator notes", "likeness" (likeness listed before face)
  - The cp-10 refusals listed under goal 8
- **★-4: where the cp-10 blocks sit.** They come right after "From the card" and before "Status in world". The card form puts these fields in its Instructions and Notes tabs. *Recommend: keep it; the member form has no tabs.*

## NOMENCLATURE rows queued (the lead merges)
- **§8 "retold" row:** the fields now include `postHistoryInstructions`, `creatorNotes` and `likeness`. These three live on cast versions only, with no `lorebook_bindings` column, and each has **Use from card** on the member form (★cp-10). The `LikenessTab` `owner` prop is 🚧.
- **§9 seat writer row:** 🚧 `SeatChange`, 🚧 `unseat`, 🚧 `announceSeatChanges`, 🚧 `setSeatEnabled`, the 🚧 `changes` result fields and collectors (`changes`, and `seatChanges` on `editCardlessPlayerSeats`), fold 🚧 `seatChanges`. Member events now come from the writer's changes; birth and bench are excepted (★-1, ★-2).
- **§9 session payload:** 🚧 `lorebookName` (★bk-lock-2); `sessions:setCastSeatEnabled` gains 🚧 `castMemberId`.
- **§18 member gallery row:** replace "delete is still card-only, ★cp-del" and "a member's gallery has no delete" with 🚧 `removeFromMemberGallery` (unlinks; deletes the file only when nothing else uses it) and `characters:deleteGalleryImage {castMemberId}` under the edit rule. The gallery and sprite replies are scoped `member:<id>` (★cp-scope-1).
- **§25 ledger entry, "2026-11-09 (lane s4-follow-a)":** all of the above, plus: durable filing of card-less player seats; the branch turn-tie cut (★s4-verify-3); member–entry links copied to branches (★s4-last-1).

## Docs queued
- `docs/lorebook-cast.md:48`: a member's gallery now has **Delete** for editors (still no *Set as avatar* or *Use as likeness image*). Add a line for the three new own-or-follow fields.
- Nothing in `docs/*.md` mentions `member-added`, so the events need no doc change.

## Noticed, not done
- `pipelines/runtime/host.ts` ~l.9091 (a shared file) calls `writeSeatName` with no collector, so a seat named by a pipeline still announces nothing. That was already true before this lane.
- Envoy seats (`envoys.ts`) write seat rows outside the seat writer and announce through their own `emitMemberEvent`; unchanged.
- The dated "Save as of" path (`amendments.ts`) accepts the three cp-10 keys without the shape check that `lorebooks:updateBinding` does. The client only sends well-formed values, but the server should check.
- `castPool.ts` `CastRow.character` doesn't type the card's `postHistoryInstructions`, `creatorNotes` or `extensions`, so the form casts to read them.
- `sessionPage/pageAsks.ts` ~l.444 still listens on the bare gallery key and its comment ("member replies are not scoped") is stale. It still works.
- `EntityGalleryTab` doesn't listen for `deleteGalleryImage:error`, so a refused delete is silent. The card path already had this gap.
- `SessionViewPanel.svelte` could now use the payload's `lorebookName` instead of `session.lorebook?.name`, which is always null.
- Member–member links are still not copied to a branch.
- The old `layerMemberAsRead` path reads the three cp-10 fields as null.
- Prettier `--check` fails on lines nobody in this lane touched in several files (`seatName.ts`, `sessions.ts`, `types.ts`, `characters.ts`, `media/index.ts`, `interest.ts`, `lorebooks.ts`, `retold.ts`, `memberAsRead.ts`, `amendments.ts`, `LikenessTab.svelte`). Left alone; no prettier run on `CastMemberForm.svelte`.
- Two `/tmp/serene-pub-vitest-*` dirs are left (`Mp8YUa` 12:36, `TZqsYB` 12:32); the lane can't tell which lane made them.

## Scope reviewer's verdict
No edits outside the owned or approved files, nothing touching serene-pub-43's image-generation files, the shared-file slices respected (the Voice section untouched), and no unasked-for names, settings or flags. Four findings:
1. **(Medium) The fold's changes are never announced:** the `ownBooks.ts` call above.
2. **(Medium) Create and branch are left off the one path:** carried as ★-2, and the `seats.ts` header is narrowed.
3. **(Low–medium) NOMENCLATURE and docs are stale:** the rows and doc lines are queued above.
4. **(Low) Two test headers contradicted their tests:** fixed.
