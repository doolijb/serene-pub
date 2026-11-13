# BRIEF cv-fix2-w1 — the re-parent: per-version follows, the retire step, scoped undo, and "from the book's present"

Worker (Sonnet) for lane **cv-fix2** (supervisor: Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
Change `reparentCastVersions` in `src/lib/server/characters/versions.ts` (today ~lines 735–867; read it and `updateCastVersion` ~1530–1690 first) and add one function beside it, so that:
1. **Per-version follows** (owner ★CV-13 ruling, 2026-11-05: *"2 later versions keep their own words"*). When `follows` is given, it is the set of fields that **may** follow the new card; each version follows only those of them it did not write itself.
2. **The retire step** (plan §33.2, quoted: *"Back, swipe, delete or an in-place change of a row some descendant reads (its cut passes it) marks the row retired (`retired_order` = the next write order) instead of deleting it; an in-place change then inserts the new row."*). Retired rows are never touched.
3. **A scoped undo**: the socket lane (worker w2, after you) undoes a removed or re-dated dated card change. It needs to move only the versions that read the removed change's card, up to the next card change, back onto the **exact** card version the earlier version had.
4. **"The book's present"** (owner 2026-11-06, quoted: *"a link from the member page applies from 'The book's present' (earlier versions keep their own words)"*). Add a function that re-parents from the book's present. w2 calls it from the member page's link and from the provided-book "card appears" path.

## The new signature (exactly this; w2 codes against it)
```ts
export async function reparentCastVersions(
	tx: Db,
	castMemberId: number,
	input: {
		cardId: number | null
		/** The exact card version to land on; must be a version of `cardId`. Absent: `cardId`'s current card version (`ensureCardVersion`), as today. */
		cardVersionId?: number
		follows?: readonly CharacterProfileField[]
		from?: { branchId: number | null; date: StoryDate } | null
		/** Present (even null): only versions whose parent is a version of this card are in scope; null = only card-less ones. Absent: no filter. */
		onCard?: number | null
		/** Only versions dated before this (exclusive). An undated version counts as before any date. */
		until?: StoryDate
	}
): Promise<number>

export async function reparentFromBookPresent(
	tx: Db,
	castMemberId: number,
	input: { cardId: number; follows?: readonly CharacterProfileField[]; writtenBy: string }
): Promise<{ present: StoryDate | null; changed: number }>
```

## Rules for `reparentCastVersions` (in this order)
- **Scope** (today's `from` filter stays as it is), then:
  - drop rows with `retiredOrder != null`. This is a change: today's doc says "Retired rows are included".
  - drop rows outside `onCard` when the key is given (`input.onCard !== undefined`). Read each row's parent card with one query (`parentVersionId → cardId`). `null` keeps only rows with `parentVersionId == null`.
  - drop rows dated on or after `until` (`compareDates(rowDate, until) >= 0`).
- **Target**: `cardVersionId` given means load it. Refuse in words when it doesn't exist or isn't a version of `cardId`: 🚧 `Character version ${id} is not a version of card ${cardId}.` (list the sentence in your report). It is invalid with `cardId: null`; refuse that too. Absent: `ensureCardVersion(tx, cardId)` as today.
- **The reference** is computed once, **before any update**: the version the member reads just before the move point.
  - With `from`: `versionInForce` (import it from `$lib/shared/lorebooks/lineReading`, beside `rowReadsOnLine`) over the member's non-retired versions that are undated or dated strictly before `from.date`. Use `line = lineOfBook(tx, member.lorebookId, from.branchId)`, `moment = from.date`, `appearance = null`.
  - Without `from`: the member's base (`isBaseVersion`), as it is before the change.
  - Its **resolved profile** is `followedProfile(profileOf(ref), ref.follows, <its parent's profileOf, or null>)`. Null when there is no reference.
- **Follows per version**:
  - `follows` given: the version's follows are the given fields, in the given order, that are either already in `row.follows` or have an own value deep-equal to the reference's resolved value. Use a stable JSON compare with object keys sorted; treat `undefined` as `null`. With no reference, only the already-followed ones.
  - `follows` absent: each keeps its own, as today. A card-less target follows nothing, as today.
- **A field that stops following** takes its old parent's words, as today (`followedProfile` over the old parent). **Except** when the target is card-less and the reference is card-less (`ref.parentVersionId == null`): then it takes the **reference's** value. This restores the words a link replaced, because by the rule above a field only followed where it equalled the reference.
- Followed fields hold the empty value in their own column (today's rule). `checkFollows` as today. Skip a row whose parent and follows already match (today's `same`).
- **The retire step**: when `row.sourceSessionId != null && await descendantReads(tx, row.sourceSessionId, row)`:
  - set `retiredOrder = await nextWriteOrder(tx)` on the row;
  - insert the re-parented copy through `insertRows(tx, [copy], false)`. The copy is a new id with a new write order, carries the same provenance (branch, date, `historyEntryId`, time of day, life point, source session, source message, `validFromMessageId`, `writtenBy`, note), and has the new parent, follows and field values.
  - Mirror exactly how `updateCastVersion` builds its copy (`copyOf` + the place columns). Every other row is updated in place, as today.
  - The answer counts both kinds.
- Update the doc comment. Remove *"Done in place with no retire mark, on purpose…"* and *"Retired rows are included."*, and describe the new rules in plain sentences.

## Rules for `reparentFromBookPresent`
**The book's present** is main's present: the book's story clock, else the newest dated history entry on main (`docs/lorebook-time.md`: *"With no clock set, the present is the newest history entry."*). Build it in a private `bookPresentOf(tx, lorebookId) → { date: StoryDate; historyEntryId: number | null } | null`:
- Read `schema.lorebooks.storyClockYear/Month/Day` and pass them through `momentOf`.
- **Clock set**: `date` is the clock. `historyEntryId` is `writeDatingAt(tx, await readingOf(tx, lorebookId, { moment: clock }))?.historyEntryId` only when that dating's date `compareDates`-equals the clock; else null.
- **No clock**: `writeDatingAt(tx, await readingOf(tx, lorebookId))` gives `{ date, historyEntryId }`, or null.
- `momentOf`, `readingOf`, `writeDatingAt` and `lineOfBook` all come from `$lib/server/state/reading` through `await import(...)`, as the file already does. **This module must stay a leaf**: read the header ~lines 1–20, and never add a static import of `$lib/server/db` or of any module that imports it.

Then:
- **No present**: `changed = await reparentCastVersions(tx, id, { cardId, follows })`. This is every version, today's behaviour.
- **A present**:
  1. Find the version in force on main at the present: `castVersionsInForce` through `await import("$lib/server/cast/memberAsRead")`, exactly as `authorWrite` calls it, with `branchId: null`, `moment: present.date`, `appearance: null`.
  2. Write a **carrier** version there: `writeCastVersion(tx, { member: id, changes: { nodeState: source.nodeState ?? member.nodeState }, writtenBy, at: { branchId: null, date: present.date, historyEntryId: present.historyEntryId, personalPosition: null } })`. It is a no-op change. An authored version already at that key is updated in place (`authorWrite` does that); otherwise a copy of the version in force is inserted.
  3. `changed = await reparentCastVersions(tx, id, { cardId, follows, from: { branchId: null, date: present.date } })`.
- Return `{ present: present?.date ?? null, changed }`. Doc comment: 🚧, one paragraph, quoting the owner's 2026-11-06 ruling.

## Tests — `src/lib/server/characters/versions.authoring.int.test.ts` (the `reparentCastVersions` describe; add a `reparentFromBookPresent` describe)
Every existing test must still pass. If one fails, stop and report it rather than editing its expectation, **unless** it asserts that a retired row is re-parented (that is now wrong).

Add:
- **A later version's own description survives a link.** A card-less member (`world({ card: false })`, base description "Her own description."). Author a version at year 5 with `{ description: "Her own at five." }`. Run `reparentCastVersions({ cardId, follows: ["description", "personality"] })`.
  - The base follows both fields.
  - The year-5 version follows `personality` only and keeps "Her own at five.".
  - `memberAsRead` at year 6 shows "Her own at five." if that is easy to read; the row assertions are enough otherwise.
- **The same through `from`.** A card-less member with versions at 3 (own description), 5 (copy, no description change) and 8 (own description "At eight.").
  - Run `from: { branchId: null, date: { year: 5 } }` with `follows: ["description"]`.
  - The year-3 version and the base are untouched.
  - The year-5 version follows description: it equals the reference, which is the year-3 version.
  - The year-8 version keeps "At eight." and follows nothing.
- **The retire step.** A session-written version that a branch reads: reuse `sessionWrite` and `branchReading` from the file's top (`updateCastVersion`'s retire test shows how).
  - Re-parent onto another card.
  - The original row now has `retiredOrder` set and its old parent.
  - A new row with the same `sourceSessionId`, date and `historyEntryId` has the new parent.
  - The answer is 1 for that row.
  - A row that is already retired is untouched by a second re-parent.
- **`onCard` + `until` + `cardVersionId`.** A carded member (card A) with versions at 10 and 20, swapped onto card B from 10 (`from` 10). Then:
  1. Re-parent back with `cardId: A`, `cardVersionId: <A's v1 id>`, `from: 10`, `onCard: B`, `until: { year: 20 }`. The year-10 version is back on A v1; the year-20 version stays on B.
  2. Make a new card version of A (`newCardVersion`) and repeat on a fresh world. The target is A v1, not A's current version.
  3. Refusals: a `cardVersionId` of another card, and `cardVersionId` with `cardId: null`.
- **Going card-less restores the reference's words.** A card-less member (base "Her own description."), with an authored year-30 version (summary only).
  1. Link from 20 (`from` 20, `follows: ["description"]`). The year-30 version follows description, and its own column holds the empty value.
  2. Then `reparentCastVersions({ cardId: null, from: 20, onCard: card.id })`. The year-30 version is card-less with description "Her own description." (the reference's), not the card's words.
- **`reparentFromBookPresent`**:
  - (a) **No clock and no dated history entry**: every version is re-parented and `present` is null. This matches today's undated link.
  - (b) **Clock at year 100** (update `schema.lorebooks.storyClockYear = 100` on the world's book), on a card-less member with versions at 50 (own description "At fifty.") and 150 (own description "At one-fifty."):
    - `present` is `{ year: 100, … }`;
    - the base and the year-50 version are untouched and card-less;
    - a new authored version at main/100 reads the card's current version and follows description (it equals the year-50 reference);
    - the year-150 version is on the card and keeps "At one-fifty.".
  - (c) **No clock, one history entry at year 80** (`historyValues`, as the `repointVersionHistory` test does): the carrier lands at 80 with that entry's `historyEntryId`.

## Files owned
`src/lib/server/characters/versions.ts`, `src/lib/server/characters/versions.authoring.int.test.ts`. Nothing else.

## Files readable
Anything. Useful:
- `shared/lorebooks/lineReading.ts` (`versionInForce` ~545)
- `shared/characters/profile.ts` (`followedProfile`, `profileOf`, `emptyCharacterProfile`)
- `state/reading.ts` (`momentOf` ~108, `readingOf` ~210, `writeDatingAt` ~451, `lineOfBook`)
- `cast/memberAsRead.ts` (`castVersionsInForce`)

## Out of scope
- `sockets/*`, `plugins/*` (w2's).
- `resolveFollows`, `updateMemberToCardVersion`.
- Any new option beyond the signature above.
- The NOMENCLATURE ledger (the supervisor writes it).

## Rules quoted (CLAUDE.md and the lane contract)
- Inside `db.transaction(async (tx) => …)` use only `tx`: the outer `db` deadlocks PGlite silently.
- No static `$lib/server/db` import in modules that tests mock. `versions.ts` is a leaf.
- 60 s timeouts on int tests (the file already sets `vi.setConfig`).
- Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs.
- Every session has a lorebook. Never write "no book" in code, comments or sentences.
- Refusal sentences are plain English, say what to do, and are marked 🚧 in your report.

## Stop and ask (in your report; carry on with the rest) when
- An existing test's expectation contradicts these rules.
- You'd need a name, option or file not listed here.
- A rule above is ambiguous for a case you hit.

## Done means
- `npx vitest run src/lib/server/characters/versions.authoring.int.test.ts src/lib/server/characters/versions.int.test.ts src/lib/server/characters/versions.write.int.test.ts --maxWorkers=2` is green.
- `npx tsc --noEmit -p .` shows no errors in your two files. Report other files' errors as seen, don't fix them.
- `npx prettier --check` on the test file. For `versions.ts`, format only your own hunks if the file wasn't clean before.
- Compare `ls -d /tmp/serene-pub-vitest-*` before and after. Delete only leftovers your runs made, by name.

## Report
Your final message, starting `# REPORT cv-fix2-w1`:
- the final signatures;
- the refusal sentences;
- changed files;
- tests run and their results;
- anything you chose inside the rules;
- **Noticed, not done**.
