# REPORT cv-core (2026-11-05)

Status question: none was relayed. Wave 1 is built: the one writer, the one reader, the session line, the story-write anchor and the boot pass. My grouped targeted run passes: **29 files, 450/450**. `tsc` shows only the old `arrangeCanvas.dom` error. No `/tmp/serene-pub-vitest-*` dirs were left behind (I compared listings before and after), and I deleted none. No dev server was up, and I ran no `sdk:build`.

Heads-up first: the cv-line handover said "narrow candidates to active rows". I did not, and I'm asking you to drop that instruction. `node_state` is the person's story state: `deceased` / `missing` / `departed` are amendable today (`CAST_AMENDABLE` names `nodeState`). A filter would skip a later "deceased" version and read the older active one. The reader returns node state as data, and a test pins that a later `deceased` version wins.

## Names and signatures (all 🚧 unless marked)

**`src/lib/shared/characters/profile.ts`** (I wrote this one myself as the shared contract; the workers imported from it):
- `CharacterProfileV1`, `CharacterGreeting {text, groupOnly?}`, `CharacterCreatorNotes {text, lang?, variants}`.
- `CHARACTER_PROFILE_FIELDS`, `CharacterProfileField`, `isCharacterProfileField`.
- `emptyCharacterProfile`, `profileOf`, `followedProfile(own, follows, parent)`, `profileDifferences`.
- `mergeGreetings`: the opener is kept only when non-empty, every alternate is kept, group-only greetings are marked.
- ⏳ `legacyGreetingsOf`, `creatorNotesOf`.
- `nextVersionLabel` (★CV-4: bump the last number).

**`src/lib/server/characters/versions.ts`**, the one writer. It is a leaf: no db import, and callers own the transaction.
- `insertCharacterVersions(tx, rows)` is the table's only INSERT. It draws ids from the sequence and sets `write_order` from the id unless the caller passes one. It refuses, in words, `follows` without a parent and any `follows` entry that isn't a profile field.
- `nextWriteOrder(tx)`.
- `ensureCardVersion(tx, cardId)` writes v1, idempotently.
- `insertCard(tx, values)`.
- `insertCastMember(tx, values)` writes the member and its base. An overlay row gets no base.
- `newCardVersion(tx, cardId, profile, {label?, writtenBy?})` and `updateCardVersion(tx, versionId, changes)`. Writing the current version also writes the ⏳ card copies: name, nickname, avatar_media_id, description.
- `updateMemberToCardVersion(tx, castMemberId, cardVersionId)`.
- `resolveFollows(tx, {cardId?, castMemberId?}, {detach?})`.
- `cardProfileOf(card)` and `memberProfileOf(member, cardProfile)` → `{own, follows, mixedGreetings}`. This is the one conversion that the base insert, the lift and the lift's verify step share.
- `writeCastVersion(tx, {member, changes, writtenBy, note?, session? | at?})` and `CastVersionChanges`.
  - The story path takes `lockStateVersion` first.
  - It writes to the target (the member, or an overlay row in the session's own book under ★CV-8 — no card link, no base).
  - `ensureSessionLine` forks the session's line first if needed.
  - It dates the version at the day plus the clock's hour and minute, anchored by `anchorFor`'s story-write case.
  - It coalesces into the in-force row when the key matches. If a descendant reads that row, the row is retired (§33.2) and a new row is inserted instead.
  - Otherwise it inserts a copy that keeps the copied row's life point (★CV-15) and takes a new write order.
  - The author path (`at`) edits the row at exactly that key in place, or else copies the row in force there.
  - Nothing calls it yet; that is wave 2.

**`src/lib/server/lorebooks/sessionLine.ts`**: `ensureSessionLine(tx, sessionId): Promise<number | null>`. It runs under the book's write lock, names the line after the session, and dedupes the name. It is called from `bookWritePlace` (book-layer writes that aren't the session's own notes') and from `loreWriteTargetFor` (route `book`).

**`src/lib/server/state/write.ts`**:
- `lockStateVersion` is now exported.
- `anchorFor(…, opts?: { storyWrite?: boolean })` gives a real-book `cast_member` row the world's turn. Without the option nothing changes.
- `bookWritePlace` makes one indexed flag read, then forks the line if the flag is set.

**`src/lib/server/lorebooks/ownBook.ts`**: `loreWriteTargetFor` calls `ensureSessionLine` on route `book`.

**`src/lib/server/state/reading.ts`**:
- `sessionCutsOf(db, sessionId)` builds the cuts from `branch_ancestry` plus the max live `origin_message_id` per ancestor.
- `overlayChainOf(db, sessionId)`.
- `sessionReadingOf` puts the cuts on its `line`. A session with no ancestry pays no extra query.

**`src/lib/server/cast/memberAsRead.ts`**:
- `castVersionsInForce(db, memberIds, opts)` → `Map<memberId, {version, overlayDepth}>`. It makes the same pick the writer copies from.
- `layerVersionAsRead(...)` is pure.
- `MemberAsRead` gains `castVersionId`, `cardVersion`, `follows` (with ⏳ `followsCard` derived from it), `behindCard`, the profile fields and `nodeState` / `nodeVisibility`. The three greeting fields are now ⏳ and derived from `greetings`.
- `MemberAsReadOptions.appearance`.
- `activeCardId` is now the parent version's card (the key flip).
- ⏳ A member with no version at all is read the old way and logged once.
- One `membersAsRead` round is 5 queries.

**`src/lib/server/utils/castMemberCards.ts`**: a member's cards are now the linked card, then its versions' parent cards, then ⏳ the cards its amendments name.

**`src/lib/server/characters/versionsLift.ts`**: ⏳ the `character-versions` boot pass, `liftCharacterVersions(db)` → `CharacterVersionsLiftReport {cards, members, versions, noted, seats, failed}`. It is registered in `startup/index.ts` after `seat-members` and before `plugins`, with `failsHealth`.
- Fast no-op: one query.
- One transaction per card set and one per book, with the book lock taken first.
- Verify loop: for each (line, breakpoint, tier), lowest tier first, it compares today's read with the new read.
  - Where they differ it inserts a version.
  - Life point: a numeric tier keeps its value, the `below` tier gets null, and the null tier gets the highest position.
  - Anything still different goes into the note on the member's base.
- Seats: one UPDATE fills `seated_by_user_id` from the held card's owner.
- Rows are worked out in memory, then inserted base-first through `insertCharacterVersions`, so the note never needs a second write.

## Changed files
- New: `/home/jody/github/serene-pub/src/lib/shared/characters/profile.ts`, `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts`, `versions.test.ts` (19), `versions.int.test.ts` (16), `versions.write.int.test.ts` (18), `versionsLift.ts`, `versionsLift.int.test.ts` (15); `/home/jody/github/serene-pub/src/lib/server/lorebooks/sessionLine.ts`, `sessionLine.int.test.ts` (12); `/home/jody/github/serene-pub/src/lib/server/cast/memberAsRead.versions.int.test.ts` (13); `/home/jody/github/serene-pub/src/lib/server/state/reading.sessionCuts.int.test.ts` (4); `/home/jody/github/serene-pub/src/lib/server/utils/castMemberCards.versions.int.test.ts` (5).
- Edited:
  - `/home/jody/github/serene-pub/src/lib/server/cast/memberAsRead.ts`, `memberAsRead.test.ts` (+4 tests)
  - `/home/jody/github/serene-pub/src/lib/server/state/reading.ts`
  - `/home/jody/github/serene-pub/src/lib/server/utils/castMemberCards.ts`
  - `/home/jody/github/serene-pub/src/lib/server/state/write.ts` (only the three named hunks, plus the `ensureSessionLine` import)
  - `/home/jody/github/serene-pub/src/lib/server/lorebooks/ownBook.ts` (`loreWriteTargetFor` and the import)
  - `/home/jody/github/serene-pub/src/lib/server/utils/characterBindingSync.ts` (`findOrInsertBinding`)
  - `/home/jody/github/serene-pub/src/lib/server/utils/summarizer/availableSceneCast.ts` (`resolveOrCreateBindingByName`)
  - `/home/jody/github/serene-pub/src/lib/server/pipelines/testing/fixtures.ts`
  - `/home/jody/github/serene-pub/src/lib/server/startup/index.ts` (the task registration)
  - `/home/jody/github/serene-pub/NOMENCLATURE.md` (§25: 9 rows appended after the cv-line rows, lines 3292–3300)
- Worker briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-core-w1.md` … `-w4.md`.

## Tests
Grouped targeted run with `--maxWorkers=4`: **29 files, 450/450 pass**. It covered:
- the lane's new tests, `src/lib/server/characters` and `src/lib/server/cast`;
- `sessionLine`, `ownBook.int`, `reading.sessionCuts`, `reading.historyEntryDate`, `sessionLoreWrites.int`, `state/write.int`;
- `castMemberCards.versions`, `characterBindingSync.test`, `availableSceneCast.test`;
- `seats.int`, `seatMembers.int`, `branch.seatMembers.int`;
- `lineReading.test`, `lineSql.int`, `characterVersions0146.int`.

The workers also ran, all green: `sessions.seatCast.int`, `castMemberLifecycle.int`, `datedCardLore.int`, `seatCards`, `rowProjection.seatCast.int`, `noLorebook.int`, `durable`, `clockMoves`, `handEdits`, `refusals.int`, `primerRowReadOnly.int`, and the `characterBindingSync` int tests.

Still red, and not mine: `tableRegistry.test.ts`, waiting on V-member registering `character_versions`.

What the lift tests found:
- In the ★CV-1 branch chain, **`noted` is 0**: inserting versions on the branch at the later dates expresses every case.
- Mixed greetings are noted once per member.
- An attic tiny upgrade followed by the pass lifted everything with 0 failed, and a second run was all zeros.

## Choices I accepted (inside scope)
- A story-write copy takes a **new** write order. If it inherited one, a descendant's mark would leak the parent's later write into the branch. "A copy inherits" applies only to identical copies.
- `resolveFollows({detach})` also clears the parent on versions in scope that follow nothing.
- The base for an unlifted member with no amendments is written lazily by `writeCastVersion`. With amendments, the write refuses.
- `memberAsRead` keeps `tags`. §32 §6 says "Tags drop out", but readers still use them; dropping them is wave 3's call.
- The lift does not verify the head separately; it equals the last breakpoint by construction.
- `versions.ts` statically imports `splitExampleDialogues` from `lorebooks/retold`, which is itself a leaf.

## Open ★
1. **★cv-core-1: the lift note's wording**, user-visible once the admin list ships (wave 3). Proposed:
   - header "Lifted from the old cast changes; these still read differently:", then one line per difference: `<line> · <date | the head | before the first change> · <appearance N | every appearance> · <fields>`;
   - the greetings line: "Greetings: one half was retold, so the retold half and the card's others became the member's own list (Follow the card's greetings undoes it)."
   - Recommendation: keep it. Trade-off: it is admin-facing prose stored in data, so a later rewording leaves old notes as they were written.
   - The count _N cast members read differently since the upgrade_ = base versions with `written_by = 'lift'` and a non-null `note`.
2. **★cv-core-2: the session line name.** The session's name, or _Session <id>_ when blank. A taken name gets _ (2)_, _ (3)_; names are capped at 60 characters. These names show in the book's line list. Recommendation: keep it.
3. **★cv-core-3: two refusal sentences.**
   - "<name> hasn't been moved onto character versions yet; restart the server so the upgrade lifts them."
   - "<name> has no card to follow, so <field> stays their own."
   - Plus an author-path guard: "An undated cast version can only be on main with no life point…".

## Queued for the lead and other lanes (not my files)
- **Between-waves hazard (important).** Once a database boots on wave 1, the boot lift moves every member onto versions, and the reader then reads only versions. Every writer not yet moved stops reaching sessions: the card editor (except the four ⏳ copies), `lorebooks:updateBinding` and retold edits, `amendments:create`, and the name/alias sync. Don't boot a lasting dev or owner database on wave 1 without wave 2. 0146 + wave 1 should land together with wave 2.
- **New members' aliases (wave 2, the sync write-through).** `findOrInsertBinding` inserts with `aliases []`, and `syncLorebookBindingsForCharacter` fills the binding after commit. The base's own `aliases` stays `[]`, so a new member reads with no aliases until the sync also writes the base.
- **`insertNarrativeNodeRow`'s bound branch** (a test fixture UPDATE of binding columns) leaves a fixture-made member's base stale. This affects tests only.
- **`bookWritePlace` callers aren't in a transaction.** `setValue`, `setOverlaidPlaceValue`, `configure` and `proposeChange` call it on the outer `db`, so `ensureSessionLine`'s book lock lasts one statement there. Two simultaneous first writers race, and the unique line name refuses the loser. This is documented in `sessionLine.ts`. The versions writer and `loreWriteTargetFor` with `tx` get the full guarantee.
- **V-time:** `branch.ts` must write `branch_ancestry`, `line_on_first_write` and the origins. Until then `sessionCutsOf` is always `[]`, and nothing sets the flag.
- **V-member:** register `character_versions` in `tableRegistry.ts`.

## Noticed, not done
- **Mixed greetings with an empty card opener.**
  - Example: a card with `firstMessage` "" and alternates [x, y], and a member who retold only the opener. Today it reads [own, x, y]; the lift gives [own, y].
  - Cause: `mergeGreetings` drops an empty opener, so `memberProfileOf` takes x as the card's opener and leaves it out.
  - The lift notes the case and lifts anyway, and a test pins it.
  - Fixing it needs the raw card columns in `memberProfileOf`.
- The coalesce key includes `at_minute`, so a clock that ticks by the minute starts a new version each minute. That is what §32 §4 specifies.
- `ensureSessionLine` doesn't run `assertDateLands` on the fork date, which comes from the session's own clock.
- A session with an own book but no cuts pays two `overlayChainOf` queries on each `membersAsRead({sessionId})`. Ancestry is also read twice (once by `sessionReadingOf`, once by `overlayChainOf`).
- `reading.ts`, `castMemberCards.ts`, `write.ts`, `ownBook.ts`, `startup/index.ts` and the three creation-site files were not prettier-clean before this lane. Only our hunks are formatted. `NOMENCLATURE.md` is not prettier-clean either, and I didn't reformat it.
- I didn't run a `scope-reviewer`; per the guide that belongs to whoever accepts the lane.
- No `docs/*.md` change: nothing user-facing moves until waves 2 and 3.
## Scope review (lead, 2026-11-05 late) — in scope; findings → lane cv-fix (after wave 2, before cv-guards)
1. MEDIUM the unruled lift-note wording is stored for good (`versionsLift.ts` ~687–693; a lifted member is never revisited) → **the note becomes structured data** (the differences: line, date or head, appearance, fields; the mixed-greetings case as a kind), worded by the wave-3 admin list once ★cv-core-1 is ruled.
2. MEDIUM a story write with `messageId: null` is unanchored and coalesces forever → **refused in words** on the story path (an unanchored change is the author path, `at`); the test that pins null-anchoring changes with it.
3. MEDIUM-LOW `ensureSessionLine` forks before the write's checks (`bookWritePlace` on the outer `db`; refused `setValue`/`configure`, `proposeChange`, `durable.ts` ~176) → **fork inside the write's transaction after its checks**; a proposal forks at accept.
4. LOW NOMENCLATURE contradicts itself on write order (~3284 vs ~3294) → a §25 row: a story-write copy takes a new write order; only a restored row (Forward) keeps its own; §32 §1's line superseded.
5. LOW `ensureMemberBase` creates a base at runtime labelled `lift` → **refuse in words** (as the amended case), so a straggler is never hidden.
