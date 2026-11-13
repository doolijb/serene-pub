# BRIEF cv-fix2-w2 — undo and move a dated card change, the dated link, keep the history entry

Worker (Sonnet) for lane **cv-fix2** (supervisor: Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## What you build on (already built by w1; read it, don't change it)
`src/lib/server/characters/versions.ts`:
- **`reparentCastVersions(tx, memberId, { cardId, cardVersionId?, follows?, from?, onCard?, until? })`** (~794; read its doc comment).
  - `follows` given = the fields that **may** follow. Each version follows those it already followed, or whose own value equals the value the member read just before `from` (the "reference"). It keeps its own words for the rest.
  - `onCard` (when the key is given) keeps only versions whose parent is a version of that card; null means card-less ones.
  - `until` keeps only versions dated before it.
  - `cardVersionId` is the exact card version to land on.
  - Going card-less when the reference is card-less restores the reference's words.
  - A session's row that a branch reads is retired and copied.
- **`reparentFromBookPresent(tx, memberId, { cardId, follows?, writtenBy })`** → `{ present, changed }` (~1084).
  - Main's present is the book's clock, else its newest dated history entry.
  - With a present, it writes a no-op carrier version at main/present and re-parents from there.
  - With none, it re-parents every version.

## Goal: five fixes (the lead's scope review of lane cv-fix, `plans/REPORT-cv-fix-2026-11-06.md`, last section)

### 1. Removing a dated card change undoes its card switch (`src/lib/server/sockets/amendments.ts`)
Today `amendmentsDeleteHandler` (~1730) deletes the version. The re-parent it made stays on the later versions.

Write ONE private helper, used by both 1 and 2:

```ts
async function cardChangeAround(tx: Db, row: VersionRow, lorebookId: number): Promise<{
	prev: VersionRow | null          // versionBefore(versionsOfMember(...), row, lineOfBook(tx, lorebookId, row.branchId))
	rowCard: number | null           // the card of row's parent version (null = card-less)
	prevCard: number | null          // the card of prev's parent version
	nextChange: StoryDate | undefined // the date of the earliest later version on row's own line whose card is not rowCard
}>
```
- Read the cards with the existing `parentCardsOf`.
- "Later on row's own line" means:
  - `(v.branchId ?? null) === (row.branchId ?? null)`;
  - `v.year != null`;
  - `v.id !== row.id`;
  - `versionOrder(v, row) > 0`;
  - pick the smallest by `versionOrder`.
- Call it **before** the row is deleted or moved.

In the delete handler's cast branch, inside the existing transaction, after `lockBookCalendar`:
1. `const around = await cardChangeAround(tx, row, params.lorebookId)`
2. `await deleteCastVersion(tx, row.id)` (unchanged)
3. If `dateOfVersion(row) != null && around.rowCard !== around.prevCard`:
   ```ts
   await reparentCastVersions(tx, row.castMemberId!, {
     cardId: around.prevCard,
     cardVersionId: around.prevCard != null ? around.prev!.parentVersionId! : undefined,
     follows: around.prevCard != null && around.rowCard == null ? around.prev!.follows as CharacterProfileField[] : undefined,
     from: { branchId: row.branchId ?? null, date: dateOfVersion(row)! },
     onCard: around.rowCard,
     until: around.nextChange
   })
   ```
   The `follows` line covers the undo of a dated **unlink**: the card-less rows go back onto the card following what `prev` followed. Equal words follow again; the rest stays theirs.

### 2. Re-dating a dated card change moves its switch (`rewriteCastChange`, ~1306)
`rewriteCastChange` today, given a `place`, only moves the row.

Restructure it so that, when `place` is given:
- `around = await cardChangeAround(tx, row, subject.lorebookId)` runs **before** `updateCastVersion`.
- Both the fields-less path and the fields path do the move below **after** `updateCastVersion` has moved the row.
- The move happens only when `around.rowCard !== around.prevCard`.
- Let `oldDate = dateOfVersion(row)!`, `newDate = place`, `branch = row.branchId ?? null`, `moved = <the row updateCastVersion answered>`.

**Later** (`compareDates(newDate, oldDate) > 0`). The versions in [old, new) go back:
```ts
reparentCastVersions(tx, memberId, {
  cardId: around.prevCard,
  cardVersionId: around.prevCard != null ? around.prev!.parentVersionId! : undefined,
  follows: around.prevCard != null && around.rowCard == null ? around.prev!.follows : undefined,
  from: { branchId: branch, date: oldDate },
  onCard: around.rowCard,
  until: around.nextChange && compareDates(around.nextChange, newDate) < 0 ? around.nextChange : newDate
})
```

**Earlier**. The versions in [new, old) come onto the change's card:
```ts
reparentCastVersions(tx, memberId, {
  cardId: around.rowCard,
  cardVersionId: around.rowCard != null ? moved.parentVersionId! : undefined,
  follows: around.rowCard != null && around.prevCard == null ? moved.follows : undefined,
  from: { branchId: branch, date: newDate },
  onCard: around.prevCard,
  until: oldDate
})
```

The existing fields card change (`cardChange` → `moveCardFrom`) still runs after this, unchanged. So does `writeToLaterVersions`.

### 3. A re-date keeps the history entry (`rewriteCastChange`)
`placed.historyEntryId` must be `row.historyEntryId ?? null`, not `null`. Also fix the comment in `amendmentsUpdateHandler` (~1576–1579, *"its history entry goes when the date moves"*): it now says the version keeps its line, life point and history entry, as an entry amendment's re-date does.

### 4. A member-page link or swap applies from the book's present (`src/lib/server/sockets/lorebooks.ts`, `writeMemberEdit` ~1390, the link path only)
Owner, 2026-11-06: *"a link from the member page applies from 'The book's present' (earlier versions keep their own words)"*. The earlier ruling the same day: *"linking or swapping a card-less member's card → 'From the link date on'"*.

Today the `movesCard && base` block calls `reparentCastVersions` on every version. Replace it with `reparentFromBookPresent(tx, member.id, { cardId: nextCharacterId!, follows: <the same expression as today: undefined when carded, memberProfileOf(after, newCard).follows when card-less>, writtenBy: opts.writtenBy })`.
- Set `reparented = present == null`: the base moved only when there was no present.
- When `present != null`, the base keeps its card. Compute the base's `changes` with `characterId: member.characterId` on **both** sides of `castChangesOfMemberEdit`, so the form's other fields land on the base read against the card it still has.
  - Today's `card` lookup already reads the base's parent after the move, so it gives the old card (or null).
  - The client sends only `{ characterId }` on a link (`CastWorkspace.svelte` `pickCharacter`), so in practice the changes are null. Don't change the client.
- With no present, everything stays exactly as today.
- Unlink (`opts.unlink`) is **not** touched.
- Update the function's doc comment: a link or swap re-parents from the book's present; with no present, every version.

### 5. The provided-book "card appears" path the same (`src/lib/server/plugins/providedBooks.ts` ~1197–1222)
Replace the `reparentCastVersions(tx, at.binding.id, { cardId, follows })` call with `reparentFromBookPresent(tx, at.binding.id, { cardId: characterId, follows: <same expression>, writtenBy: \`plugin:${row.pluginId}\` })`. Update its comment: "reads it from the book's present on".

## Tests (add; every existing test must stay green — if one fails, stop and report it rather than editing its expectation)
**`src/lib/server/sockets/amendments.castVersions.int.test.ts`** (reuse `world`, `otherCard`, `create`, `update`, `remove`, `readAt`, `versionsOf`):
- `removing a change` › **removing a dated link puts the later versions back card-less, with their own words**.
  - Setup: card-less world; `create` year 30 `{ summary: "Later." }`; `create` year 20 `{ characterId: card.id }`; remove the year-20 change.
  - Read at 35: `activeCardId` null, description "Her own description.", summary "Later.".
  - The year-30 row has `parentVersionId` null and `follows` [].
- `removing a change` › **removing a dated swap puts the later versions back on the card before, at the exact version**.
  - Setup: carded world (card A); `create` 30 `{ summary: "Later." }`; `create` 20 `{ characterId: b.id }`.
  - Make a new card version of A with `newCardVersion`, so A's current is no longer the one the member had.
  - Remove the 20 change. The year-30 row's parent is the version the base has (A's old one), not A's current. Read at 35: `activeCardId` A.
- `removing a change` › **a later card change is spared**.
  - Setup: card-less; link C at 20; swap to D at 40; a version at 50. Remove the 20 change.
  - Read at 25: card-less. Read at 45 and 55: D.
- `moving a change to another date` › **moving a dated link later: the versions between go back; earlier: the versions between come onto the card**.
  - Setup: card-less; `create` 25 `{ summary: "Mid." }`; `create` 20 link.
  - Re-date the link to 30: read at 27 is card-less with "Her own description.", read at 32 is the card.
  - Then re-date to 10: read at 12 and at 27 are both the card.
- `moving a change to another date` › **a re-date keeps its history entry**.
  - Insert a history entry with `historyValues` from `$lib/server/pipelines/testing/fixtures` (see `characters/versions.authoring.int.test.ts` ~590), then `create` with `historyEntryId`.
  - Re-date (year-only); the version's `historyEntryId` is unchanged.
  - If `assertHistoryEvent` needs the entry dated the same as the change, date it so.

**`src/lib/server/sockets/lorebooks.castVersions.int.test.ts`** (reuse `world`, `baseOf`, `w.update`):
- **a member-page link at the book's present leaves an earlier dated version alone; a later version keeps its own words**.
  - Setup: a card-less world. Set `schema.lorebooks.storyClockYear = 100` on its book. Use `writeCastVersion` with `at` main to add a year-50 version `{ description: "At fifty." }` and a year-150 version `{ description: "At one-fifty." }`. Then `w.update({ characterId: w.card.id })`.
  - The base and the year-50 version have `parentVersionId` null; the year-50 description is unchanged.
  - A main/100 version exists, has the card's current version as parent and follows `description`.
  - The year-150 version is on the card with its description "At one-fifty." and not following `description`.
  - `lorebook_bindings.character_id` is the card.
- **a swap at the book's present**.
  - Setup: carded world, clock at 100, a year-50 version, swap to another card.
  - The base and the year-50 version stay on the first card; main/100 and later are on the other.

**`src/lib/server/plugins/providedBooks.int.test.ts`**:
- Next to *"a recorded card-less member that the file now gives a card reads it"* (~1356), add the same scenario with the book's clock set (`storyClockYear`) before the upgrade sync.
- The base stays card-less. A main version at the clock's year is on the card's v1 and follows `description`.
- Copy that test's setup. If the clock can't be set before the sync without the sync clearing it, say so and skip this one test.

## Files owned
- `src/lib/server/sockets/amendments.ts`, `src/lib/server/sockets/lorebooks.ts` (only `writeMemberEdit` and imports), `src/lib/server/plugins/providedBooks.ts` (only the card-appears block and imports).
- The three test files above.
- Nothing else. Lane **cv-readers** is editing many session-path files beside you. Never touch a file not listed here.

## Out of scope (written down, not built)
- The **create** path's dated card change (`writeCastChange` → `moveCardFrom`), which still re-parents from its date with no upper bound. List it under Noticed if you see the effect.
- Unlink from the member page.
- The client.
- `versions.ts` (w1's; if you need a change there, stop and report).
- NOMENCLATURE (the supervisor writes it).

## Rules quoted (CLAUDE.md and the lane contract)
- Inside `db.transaction(async (tx) => …)` use only `tx`: the outer `db` deadlocks PGlite silently.
- No static `$lib/server/db` import in modules that tests mock. The socket modules already import `db`; keep their import style.
- Int tests that open a DB inside an `it` need a 60 s timeout (the files set it).
- Never pipe vitest into `head`.
- Every session has a lorebook. Never write "no book".
- `socket.off(event)` always takes the handler (not expected here).
- Refusal sentences are plain English and marked 🚧 in your report. Don't invent new ones unless needed.

## Stop and ask (in your report; carry on with the rest) when
- An existing test's expectation contradicts these rules.
- You need a new name, option, setting or a file not listed.
- A case isn't covered by the rules above.

## Done means
- `npx vitest run src/lib/server/sockets/amendments.castVersions.int.test.ts src/lib/server/sockets/amendments.int.test.ts src/lib/server/sockets/lorebooks.castVersions.int.test.ts src/lib/server/plugins/providedBooks.int.test.ts src/lib/server/characters/versions.authoring.int.test.ts --maxWorkers=2` is green.
- `npx tsc --noEmit -p .` shows no errors in your files. Report others as seen.
- Prettier: new test hunks are clean; in files that weren't clean before, format only your own hunks.
- Compare `ls -d /tmp/serene-pub-vitest-*` before and after. Delete only leftovers your runs made, by name.

## Report
Your final message, starting `# REPORT cv-fix2-w2`:
- changed files with what changed;
- tests run and their results;
- anything you chose inside the rules;
- **Noticed, not done**.
