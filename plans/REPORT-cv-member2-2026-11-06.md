# REPORT cv-member2 (2026-11-06)

No status question was relayed. B1–B5 and the §25 rows are built. The lane's targeted tests pass, except one known stale expectation from cv-readers (`retold.int`, below). Whole-app `npx tsc --noEmit -p .` exits 0. Nothing was committed, nothing stashed, and no `sdk:build` was run.

Four Sonnet workers ran, two at a time: w1 server ‖ w2 client, then w3 server ‖ w4 client. Their briefs are `plans/briefs/BRIEF-cv-member2-w1.md` … `-w4.md`. Before either pair started, I wrote the wire contract myself (`types.ts`, `typedSocket.ts`, `interest.ts`). I checked each report against its brief, read the key server hunks, and fixed five things myself (listed under "My own edits").

## Names and signatures
**Wire contract** (`src/lib/shared/sockets/types.ts`), all 🚧:
- `Sockets.Lorebooks.CastVersionColumns`: one cast version in the member form's column names, plus `groupOnlyGreetings` and `characterId` (the parent card).
- `Sockets.Lorebooks.CastRowVersion` `{ castVersionId, groupOnlyGreetings, baseColumns, cardVersion, cardCurrentVersion, behindCard }`.
- `Sockets.Lorebooks.CastMemberRow` = the binding row + `CastRowVersion` (+ `character` / `persona`).
- `BindingList.Response.present`: the book's present on main, or null.
- `BindingsForCharacter` members gain `cardVersion`, `cardCurrentVersion` and `behindCard`.
- `UpdateBinding.Params.lorebookBinding.groupOnlyGreetings?`; `UpdateBinding.Response.lorebookBinding: CastMemberRow`.
- New `Lorebooks.UpdateMemberToCardVersion` `{castId}` → `{lorebookId, castId, moved, cardVersion, lorebookBinding}`.
- `Amendments.CastRow.columns: CastVersionColumns`; `Amendments.List.Response.laterVersions?`.
- `Admin.Overview.Response.data.castLiftCount`.
- New `Admin.CastLiftNotes` `{}` → `{count, members: [{castMemberId, lorebookId, lorebookName, memberName, note}]}`; new `Admin.CastLiftFollowGreetings` `{castMemberId}` → the same list.

**Events:**
- `lorebooks:updateMemberToCardVersion`: in `GATED_EVENTS`, and in `SCOPED_EVENTS` on `lorebookId`.
- `admin:castLiftNotes` and `admin:castLiftFollowGreetings`: in `GATED_EVENTS`, restricted `admin:` prefix.
- Each has a `:error` event, and all three `:error` events are in `HANDLED_ERROR_EVENTS` (`Layout.svelte`).

**Server:**
- `characters/versions.ts`:
  - `bookPresentOf` is now exported.
  - 🚧 `versionsAtBookPresent(h, members: {id, lorebookId}[]): Promise<Map<memberId, VersionRow>>` makes one `castVersionsInForce` call per book.
  - 🚧 `followCardGreetingsAfterLift(tx, castMemberId): Promise<number>`.
  - `memberProfileOf`'s input takes `groupOnlyGreetings?`.
- `lorebooks/retold.ts`: `MemberColumnsOfVersion.groupOnlyGreetings`. `castChangesOfMemberEdit` counts a greetings edit when `groupOnlyGreetings` changes. `retoldUpdateProblem` refuses a `groupOnlyGreetings` that isn't `string[]`.
- `sockets/lorebooks.ts`:
  - `castMemberRowsOf(h, members)` (internal) replaces `withBaseColumns`.
  - `writeMemberEdit(…, { onto: "base" | "shown" })`, with the internal `writeShownEdit`.
  - Exported `updateMemberToCardVersionHandler`.
- `sockets/amendments.ts`: cast rows carry `columns`. `groupOnlyGreetings` is amendable. The `create` / `update` broadcasts carry `laterVersions`.
- New `admin/castLiftNotes.ts` `castLiftNotes(db)`, and new `sockets/adminCastLift.ts` (`registerAdminCastLiftHandlers`). `adminOverview.ts` fills `castLiftCount` from the same function.

**Client:**
- New `lorebooks/cast/castVersionRead.ts`: `readCastVersion`, `withBaseVersion`, `asVersionAmendments`, `foldMoment`, `afterBaseWrite`.
- New `cast/CardUpdateOffer.svelte` (props `castId, lorebookId, memberName, cardVersion, cardCurrentVersion, onUpdated?`) and `cast/cardUpdateWords.ts`.
- `castSave.ts`: `laterVersionCount(rows, {kind:"base", shownVersionId?})`.
- `retoldRows.ts`: `greetingListOf` and `withGreetingList`.
- `CastMemberForm.svelte`: prop `canUpdateCard`.
- `CastLine.svelte`: prop `onChanged`.
- New `admin/sections/data/CastUpgradeCard.svelte` and `castUpgradeWords.ts`.

## What it does
- **B2, the member page reads versions.**
  - Every cast member row is the cast version in force at the book's present on main. The owner ruled it "The most recently active" (2026-11-06). Its columns, `characterId` and `character` come from that version and its parent card. The binding's own name, aliases and summary stay the row's.
  - **Save** writes that version:
    - When it is the base, through the base's author write.
    - Otherwise through `updateCastVersion`.
    - After a link or unlink at the present, the target is picked again, so the edit lands on the carrier.
  - ★CV-13's later versions are the ones after the shown version, on the server and in the client's count.
  - After a Save, `amendments:list` is emitted again.
  - Each Changes row carries its whole version (`columns`).
  - The client reads a member as their base with the Changes rows folded whole, not diffs, which drops the stopgap. "Now" on main reads at `present`.
  - Tested both ways: a link and an unlink at a present show correctly. On the server the rows come out right; on the client the member page shows **From the card** now and the member's own words at the earlier moment.
- **B1, the Update offer.**
  - `lorebooks:updateMemberToCardVersion` runs under the book's lock. It is for the book's owner, and refused on a primer.
  - It shows on the member page (Character card panel) and under the cast line. The cast line covers both the card editor and the card's profile. After an update the line is asked for again.
  - There is no bulk button and no Undo.
- **B3, the admin lift list.**
  - The Overview's **Data and backups** card shows _N cast members read differently since the upgrade_ when the count is above 0. It opens the **Since the upgrade** card on Admin › Data and backups (`#cast-upgrade`).
  - That card lists each member with its book and one sentence per difference.
  - A mixed-greetings member also gets **Follow the card's greetings** (ruled). It makes the lift's copies of the mixed list follow the card again, and drops `mixedGreetings` from the note. The note becomes null when no difference is left.
  - Failures show inline. The new code raises no toasts.
- **B4.** `laterVersions` rides the `amendments:list` broadcast that answers the asker's own cast create or update, so the **Save as of** toast reports it.
- **B5.** Group-only greetings are kept on the member wire and in `memberProfileOf`, and they are amendable. The member's **Greetings** row has **Group sessions only** per greeting while it is retold.

## Changed files (all under /home/jody/github/serene-pub)
**Contract (me):**
- `src/lib/shared/sockets/types.ts`, `src/lib/shared/sockets/interest.ts`, `src/lib/client/sockets/typedSocket.ts`
- `src/lib/shared/sockets/scopedReplies.test.ts`: the `SCOPE_PATHS` pin for the new scoped event.

**Server:**
- `src/lib/server/sockets/lorebooks.ts`, `src/lib/server/sockets/amendments.ts`, `src/lib/server/lorebooks/retold.ts`, `src/lib/server/characters/versions.ts`
- New: `src/lib/server/admin/castLiftNotes.ts`, `src/lib/server/sockets/adminCastLift.ts`
- `src/lib/server/sockets/index.ts`, `src/lib/server/sockets/adminOverview.ts`
- Tests:
  - New: `sockets/lorebooks.memberShownVersion.int.test.ts` (9), `sockets/lorebooks.updateMemberToCardVersion.int.test.ts` (4), `sockets/adminCastLift.int.test.ts` (1).
  - Extended: `lorebooks/retold.test.ts` (+4).
  - Fixture or expectation moves:
    - `admin/attention.test.ts`: `castLiftCount: 0`.
    - `sockets/lorebooks.castVersions.int.test.ts`: the `withLaterVersions` book gets `storyClockYear: 100`, so the base stays the shown version. The ★CV-13 assertions are unchanged.
    - `lorebooks/retold.int.test.ts`: the banner `toEqual` gains the three card-version fields.
    - `sockets/content.interestGate.test.ts`: the mock gains `leftJoin`, and `select(lorebooks)` goes from 2 to 3. The third read is the reply row's present read; there is still no cast read.

**Client:**
- `src/lib/client/lorebooks/LorebooksWorkspace.svelte` and `CastWorkspace.svelte`.
- `src/lib/client/lorebooks/castPool.ts`.
- `src/lib/client/lorebooks/cast/`: `castSave.ts`, `CastMemberForm.svelte`, `retoldRows.ts`, `memberDraft.ts`.
- New: `cast/castVersionRead.ts`, `cast/cardUpdateWords.ts`, `cast/CardUpdateOffer.svelte`.
- `src/lib/client/components/characterForms/`: `CastLine.svelte`, `castBannerWords.ts`, `CharacterForm.svelte` and `CharacterViewPanel.svelte` (the `bindingsForCharacter` re-ask only).
- `src/lib/client/admin/sections/overview/Page.svelte`, `src/lib/client/admin/sections/data/Page.svelte`.
- New: `admin/sections/data/CastUpgradeCard.svelte`, `admin/sections/data/castUpgradeWords.ts`.
- `src/lib/client/components/Layout.svelte` (`HANDLED_ERROR_EVENTS` only).
- Tests:
  - New: `cast/castVersionRead.test.ts`, `cast/cardUpdateWords.test.ts`, `cast/cardUpdateOffer.dom.test.ts`, `cast/memberPageVersions.dom.test.ts`, `characterForms/castLineOffer.dom.test.svelte.ts`, `admin/sections/data/castUpgradeWords.test.ts`, `admin/sections/data/castUpgradeCard.dom.test.svelte.ts`, `admin/sections/overview/overviewCastLift.dom.test.svelte.ts`.
  - Edited: `cast/castSave.test.ts`, `cast/retoldRows.test.ts`, `cast/castMemberFormLater.dom.test.ts`.

**Docs:**
- `docs/lorebook-cast.md`: the page shows the member at the book's present; Save; the Update offer; **Group sessions only**; the later-versions line.
- `docs/characters.md`: the offer under the cast line.
- `docs/system-settings.md`: the **Since the upgrade** card and the Overview line.
- STYLE-GUIDE: no rule moved.

**`NOMENCLATURE.md` §25:** 9 rows appended after cv-sweep's row (3355–3363). I re-read the file before the edit.
- cv-sdk's 4 queued rows, verbatim.
- One row for cv-client's queued editor words.
- 4 rows for this lane: rows read versions; the Update offer and its event; the admin lift list; member group-only greetings.

**Briefs:** `plans/briefs/BRIEF-cv-member2-w1.md`, `-w2.md`, `-w3.md`, `-w4.md`.

## My own edits (after checking worker reports)
1. **`castVersionRead.ts`: the binding's aliases are row-owned.** Before this, the fold took them whole from the version, which would drop the card's names that the binding merges in. The base never overwrites them, and a Changes row applies them only where its `fields` changed them, as the diff fold did. Summary stays version-folded. Added a test.
2. **`LorebooksWorkspace.svelte` `lineDifferences`:** w2 noticed that `compareLines` still folded diffs over what are now present-version rows. It now goes through `withBaseVersion` and `asVersionAmendments`.
3. **`content.interestGate.test.ts`:** taught its db mock `leftJoin` and moved the count, so w1's createBinding reply projection fits its mocked db.
4. **`scopedReplies.test.ts`:** pinned the new scoped event.
5. **`followCardGreetingsAfterLift`:** dropped its unused `writtenBy` parameter (an edit in place keeps the row's `writtenBy`).

## Tests
- **Server, one grouped run, 25 files: 355 passed, 1 failed.** Log: `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-member2-server.log`. The run covered:
  - the three new int files;
  - `lorebooks.castVersions`, `amendments.castVersions`, `amendments.int`, `castMemberLifecycle`, `lorebooks.memberName`, `providedCast`, `mutationScoping`, `scopedReplies.lorebooks`, `refusals`;
  - `content.interestGate`, `index.interestGate`;
  - `retold` (unit and int), `castOwnNames`;
  - the `versions` suites (`test`, `authoring`, `write`), `versionsLift.int`, both guards (`versionsWriter`, `frozenColumns`);
  - `memberAsRead.int` and `attention`.

  The 1 failure is `retold.int.test.ts` › "a retold description reaches the prompt's card and drops the strokes". It is not this lane's: cv-readers made strokes reach every seat's prompt and moved the same expectation in `host.seatMembers.int` and `seatCards.int` (cv-readers report, line 71), but missed this file. It is queued below.
- **Client, one grouped run, 92 files: 917/917 passed** (after the `scopedReplies` pin). Log: `.../scratchpad/cv-member2-client.log`. The run covered:
  - `lorebooks/cast`, `castPool`, `lorebooks/time`;
  - `lineConformance` (both), `lorebooksWorkspace.counts`;
  - `components/characterForms`, `client/admin`, `shared/sockets`.
- **`npx tsc --noEmit -p .`:** exit 0, no errors.
- **Not run:** `npm run check` (svelte-check), which is left to the lead's grouped verification. The `.svelte` edits are covered by DOM tests only.
- **Prettier:** the lane's new files are clean.
- **`/tmp/serene-pub-vitest-*`:** one dir appeared during phase B that no worker claims: `/tmp/serene-pub-vitest-jyGy4c` (08:15:49). I can't tell it is ours, so I deleted nothing.

## Open ★ (for the owner)
1. **★cv-member2-1, the most recently active version with no present.** A book with no story clock and no dated history entry shows (and Save writes) main's newest version. That is the head pick, the same as "now" read on main today. The lead's reading ("in force at the book's present") doesn't cover this case. The alternative is the base.
2. **★cv-member2-2, the Update offer's words.**
   - _On card v1.0; the card is on v1.1._ and **Update ‹name› to card v1.1**, from cv-client's proposal.
   - Refusals: _‹name› reads no card in this lorebook, so there is no card version to update to._ and _‹name› already reads the card's current version, ‹label›._
   - Fallbacks: _That cast member could not be updated to the card's current version._ (server) and _The member could not be updated._ (client).
3. **★cv-member2-3, the admin list's words and placement.**
   - **Words:**
     - Title **Since the upgrade**.
     - Help: _These cast members read a little differently than before the upgrade to character versions._
     - Row: _‹member› in ‹book›_.
     - Difference line: _On main|On ‹line›, from ‹date›|before their first change[, at life point N], reads the ‹fields› differently than before the upgrade._
     - Mixed-greetings line: _Their greetings became their own list, because only some of them were told in their own words before._
     - Overview line: _N cast members read differently since the upgrade_.
     - Refusals: _This cast member's greetings were not changed by the upgrade._ and _This cast member reads no card now, so there are no card greetings to follow._
   - **Placement:** a card on Data and backups, not a new admin section or route, and not a Needs-you item, because nothing in it is broken.
   - **Overview behaviour:** the Overview card is one link. While the count is above 0, the whole Data and backups card opens `#cast-upgrade`, since a link inside it would be a nested link.
4. **★cv-member2-4, new wire names.**
   - New: `castVersionId`, `baseColumns`, `cardCurrentVersion`, `present`, `columns`, `groupOnlyGreetings`, `castLiftCount`, `admin:castLiftNotes`, `admin:castLiftFollowGreetings`.
   - From the brief: the event `lorebooks:updateMemberToCardVersion`.
   - Changed from the brief's examples: I used `cardVersion` `{id, number, label}` + `behindCard` in place of `cardVersionId` / `cardVersionLabel`, because `CastMemberV1` already publishes those names (R1). `cardCurrentVersion` is added because the ruled words name the target label.
5. **★cv-member2-5, what Follow the card's greetings changes.** It changes the base and the lift-written versions that still hold the base's exact mixed list. A version someone has since given other greetings keeps them.
6. **★cv-member2-6, "the Characters row".** I read it as the cast line, which both the card editor and the card's profile in the Characters view wear. The Characters sidebar list row has no offer: it would need a per-card cast read on `characters:list`.
7. **★cv-member2-7, the save menu's words.** Saving a member "outright" while reading at a date now writes the shown version, with later versions keeping their words unless **Change later versions too** is on. The menu's **Change the card everywhere** / "for every moment at once" wording (in `docs/lorebook-cast.md` "Changing a member over time" and the form's menu) is no longer exact. It needs a copy decision; I left the words as they are.

## Choices made inside scope (named)
- The server's link or swap path treats a card as a move only when it also differs from the card the shown version reads.
- The admin list selects bases by a parseable `note`, not by `written_by`. Edits keep `note`: `updateCastVersion` and the base's coalesced author write never touch it.
- The client's `resolveCast` takes an optional second argument (`write`) for the masked-save warning.
- The member greetings list reads with `greetingsOf` and writes with `greetingColumnsOf`, so an empty opener keeps positions.
- A card-less version's own name folds. A carded version's null name never does.

## Queued (not my files / not my lane)
- **`src/lib/server/lorebooks/retold.int.test.ts:129`**: `expect(character.strokes).toBeNull()` is stale since cv-readers ("Everything in session is cast -> active card."). It should become the member's strokes as read, as cv-readers moved it in `host.seatMembers.int` and `seatCards.int`.
- **8 interest-gate failures from earlier waves, not this lane's:**
  - `cast.interestGate`: `characters:create` / `setAvatar`, where the mock db has no `transaction`.
  - `sessions.interestGate`: `sessions:typing`, where the mock has no `selectDistinctOn`.
  - `sessionAdjacent.interestGate`: `narrativeGraph:build`, where `pickVersions` gets a mocked row without `castMemberId`.

  I fixed only `content.interestGate`, whose failures came from this lane.

## Noticed, not done
- **Prettier reflow in w2's files.** w2 ran `prettier --write` on whole files before the rule went into the later briefs. `CastMemberForm.svelte` and `LorebooksWorkspace.svelte`, and possibly `CastWorkspace.svelte` and `castPool.ts`, now carry unrelated whitespace and wrapping reflow beside other lanes' uncommitted hunks. Behaviour is unchanged.
- **One-argument `resolveCast` typings.** `lenses/types.ts` and `bookData.svelte.ts` still type `resolveCast` with one argument. They are assignable, so the code works.
- **`updateMemberToCardVersion` (cv-core) has no retire step.** It re-parents every version on an older version of the card, retired rows and rows a branch reads included, with no retire step. `reparentCastVersions` got one in cv-fix2.
- **Admin list dates are free-form.** They read like _Year 1204, Mo. 3, Day 12_, because the wire carries no book calendar.
- **The lorebooks family has no domain context.** Existing cast views still toast directly. The new code doesn't toast.
- **Untested re-ask.** The card editor's and profile's re-ask after an update has no test of its own; `CastLine`'s `onChanged` is tested.
- **Undated rows after a non-base target.** After a Save lands on a non-base version, undated later rows (a session's write before any clock) don't count as later.
- **Leftover from cv-client.** `docs/sessions.md:54` still says "If the old session had no lorebook".
