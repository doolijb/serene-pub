# BRIEF cv-sweep-w4 — a deleted card's followers keep its words; the last `cast_amendments` reads

Read `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-sweep-wcommon.md` first; its rules bind you.

## Part A — deleting a card resolves its followers first
**Ruling (★27-6, owner 2026-11-05, quoted):** "a card unlinked/deleted → its words copied into the member, the seat plays on". The lead (2026-11-06) ruled it governs over A25's older "a deleted card is nobody" for cast members: "deleting a card resolves its followers' fields into their own …, so no member reads a deleted card." Owner, 2026-11-05: "If a casts feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member."

Today a card delete is a SOFT delete (`characters.is_deleted = true`); a cast version that `follows` fields of that card's version keeps reading the deleted card's words through `follows`. Build: every card delete first calls `resolveFollows(tx, { cardId })` (`characters/versions.ts` ~680 — it exists; read it: for every cast version whose parent is a version of the card and whose `follows` is non-empty, it writes the followed fields' current words as the version's own and empties `follows`), **in the same transaction as the soft delete**.
- **No `detach`** (supervisor's decision): the versions keep their parent (so they stay consistent with `lorebook_bindings.character_id`, which a soft delete leaves pointing at the card); only the words move. State that choice in a comment.
- Sites:
  1. `sockets/characters.ts` `charactersDelete` (~1134): one `db.transaction`; the soft-delete `update … returning({ id })` scoped to the owner as today, then `resolveFollows` only for the card actually deleted (deleting someone else's card stays a no-op and resolves nothing). Use only `tx` inside.
  2. `plugins/providedBooks.ts` `deleteProvidedBooks` (~1513): the cards part (`ids`) in one transaction: `resolveFollows` per card id, then the soft delete.
  3. The user cascade: users are soft-deleted (`sockets/users.ts` ~911) and their cards stay, so there is nothing to do there — confirm and say so. Do not touch `sockets/users.ts`.
- Do NOT touch `library/writes.ts` `undoLibraryChange` (it hides a made card on undo; a Forward can bring it back) — report it under Noticed.

## Part B — the last `cast_amendments` reads
1. `sessions/seatMembers.ts` (the `seat-members` boot pass), the candidate query's `resolvable(...)`: its middle leg `exists (select 1 from cast_amendments a where (a.fields::jsonb ->> 'characterId') = <seat card> and a.lorebook_id in <the session's books>)` finds a member by a **dated card**. Dated changes are cast versions now (`character_versions`: a cast version's `parent_version_id` is a card version whose `card_id` is the card; `lorebook_id` is the member's book). Replace the leg with the versions equivalent (a cast version — `cast_member_id is not null` — in one of the session's books whose parent version's `card_id` is the seat's card). **Check that `settleSeats` (`sessions/seats.ts`) resolves a member by a version's parent card the same way** (it goes through `castMemberCards` / `memberOfCard` / `cardTakenBy`, moved onto versions by cv-readers) so the candidate query and the settle agree — otherwise a session is re-read on every boot. If they disagree, STOP and report. Update the header comment if it mentions amendments.
2. `state/entriesOnReading.ts`: `castOverlaysFor` (~178) and `castMemberAt` (~222) have **no caller** (product or test — verify with grep over `src/` and `../serene-pub-sdk` is not needed). Remove both, and any import only they used (e.g. `castAsOf` — check the others first). Rewrite the header paragraph that names them (~22–28: "⚠ A cast amendment may draw the member with another card…") so it no longer points at removed functions — short, accurate: dated cards are cast versions; seats key on the cast member; `castMemberCards` finds a member's cards. Do not change anything else in the file.
3. `sockets/amendments.ts` `cardMemberAt` JSDoc (~420–445): it describes `castMemberAt` / `castOverlaysFor` as the second entry point "⏳ Until the guards step moves it onto versions". Rewrite that bullet: the member-keyed whole-cast read is `membersAsRead` / `castVersionsInForce` (`cast/memberAsRead.ts`). Doc comment only — no code change in this file.

## Files owned
- `/home/jody/github/serene-pub/src/lib/server/sockets/characters.ts` — `charactersDelete` only.
- `/home/jody/github/serene-pub/src/lib/server/plugins/providedBooks.ts` — `deleteProvidedBooks` only.
- `/home/jody/github/serene-pub/src/lib/server/sessions/seatMembers.ts`
- `/home/jody/github/serene-pub/src/lib/server/state/entriesOnReading.ts` — the two functions, their imports, the header paragraph.
- `/home/jody/github/serene-pub/src/lib/server/sockets/amendments.ts` — the `cardMemberAt` JSDoc only.
- Tests: `/home/jody/github/serene-pub/src/lib/server/sockets/characters.softDelete.int.test.ts`, `/home/jody/github/serene-pub/src/lib/server/plugins/providedBooks.int.test.ts`, `/home/jody/github/serene-pub/src/lib/server/sessions/seatMembers.int.test.ts` — add cases; or new files beside them.

## Tests (int: 60 s timeouts)
- card delete: a member (made with `insertCastMember` from `characters/versions.ts`, linked to the card, following name + description) and a dated cast version following the card: after `characters:delete`, both versions have `follows` empty and hold the card's words; `membersAsRead` (`cast/memberAsRead.ts`) reads the same name and description as before the delete; a seat of that card in a session still resolves its member (`seatedCastOf` in `cast/seatedCast.ts`, or `seatCardsAsRead`) and reads those words — "the seat plays on";
- deleting another person's card resolves nothing;
- provided uninstall with delete: a member in a person's own book following a provided card keeps the words;
- seat-members: a live seat whose card is only a member's **dated card** (a cast version's parent, the member linked to another card) is a candidate and gets that member; a second run changes nothing.
Run also: `sockets/castMemberLifecycle.int.test.ts`, `characters/versions.int.test.ts`, `characters/versions.authoring.int.test.ts`, `sessions/branch.seatMembers.int.test.ts`, `sessions/greetings.seatMembers.int.test.ts`, `characters/versionsWriter.guard.test.ts`, `characters/frozenColumns.guard.test.ts`. If a suite fails at load in `bootstrapPipelines` with "core binds a handler to core:query/cast-member@1 … which no type in this build declares", that is another lane's SDK change in flight: report it as **blocked on cv-sdk**, naming the file.

## Out of scope
`sockets/users.ts`, `library/writes.ts`, `host.ts`, `cast/memberAsRead.ts` (its comment mentioning `castMemberAt` → Noticed), the client, docs.

## Stop and ask when
An existing `expect` would change; `settleSeats` and the candidate query disagree; you need a file not listed.

## Done means
Tests green, `tsc` clean on your files, prettier clean on your hunks. Report per the common brief, starting `# REPORT cv-sweep-w4`.
