# REPORT: lane s4-follow-b (2026-11-09)

All 8 goals are built and their targeted tests pass. Two things hold the lane back from a clean finish:
- **The SDK build is blocked.** The owner's `vite dev` is running on :5173. tsc and check each show the same 3 errors, and all 3 clear once `sdk:build` runs.
- **Media access needs an owner decision (★s4-fb-4).** A reader who can see a cast member but not its card sees the "From the card" sprites as broken images.

This was a restart. On disk at the start: no `follow-b` worker briefs, and no owned file touched since 11-08.

## Goals

### 1. Show secrets (★s4-fixes-1b) — worker w1
The person who seated an AI character seat gets a **Show secrets** switch on that seat's sheet. While it is on, they see that seat's holder-only values on their own screen; nobody else's view changes.

How it works:
- **Server.**
  - `state/earshot.ts` has a new pure helper, `overheard(hearing, links, memberIds)`. `hearingOf` and `runtime/portrayals.ts` are untouched, so the AI still plays the seat.
  - In `sockets/state.ts`, `state:get` takes a new param `overhear?: string[]` (seat refs). When the param is present, even as `[]`, it replaces this connection's set in `socket.data.overhear`. Only seats the caller seated are kept (new `seatsSeatedBy`, which reads `session_characters.seated_by_user_id`).
  - At read time, `overheardMembers` checks the set again against the seats the caller still holds.
  - `callerView` = `callerHearing` plus the overheard seats. It is used only for reads that hand state to a person: `state:get`, the `settled()` reply, and `state:ledger`.
  - Every write gate, the proposals listing, `state:decide`, `handEditJudge` and `carriesOnWire` keep using `callerHearing`. **Overhearing never grants a write.**
  - Seat owner rows the viewer seated carry `overhearing: boolean`, but not when the viewer is the session owner, who already hears everything. `mine` is unchanged.
- **Client.**
  - `sessionState.svelte.ts` keeps a `SvelteSet` of overheard refs. It is cleared when the store switches session and sent on every `state:get`; `setOverhearing(ref, on)` changes it. So the switch is not remembered across visits: a reload or another session starts it off.
  - New request handler `requests/overhearSeat.ts`, registered in `requests/index.ts`.
  - `projections/sessionState.ts` carries `overhearing` through, with a TODO cast until the SDK build.
  - `widgets.css` gives `stats.overhear-switch` the same rules as `stats.carry-switch`.
- **SDK.**
  - `sdk/src/widgets.ts`: `SessionStateOwnerV1.overhearing?`, plus a new `'overhear-seat'` request (`{ owner, on }`), granted `'core'` with reach `'session'`.
  - core-catalog `StatsWidget.svelte`: an `overhearBlock` (widget parts `stats.overhear*`) drawn after `carriesBlock`.
  - `INTEGRATING.md`: one sentence.
- **Tests:**
  - new `earshot.overheard.test.ts`, `state.overhear.int.test.ts`, `overhearSeat.test.ts`;
  - existing `earshot.test`, `state.earshot.int`, `state.int`, `cardlessSeat.readers.int`, `sessionState.test` re-run;
  - **8 files, 76 tests, all pass.**
  - The int test covers carded and card-less seats: off, on, still on after a write's reply, off again; another guest never sees the values; the owner's view is unchanged; and the seater's write on the holder-only value is refused exactly as before.

### 2. One Add characters picker — worker w2
- `CharacterSelectModal.svelte`:
  - `cardlessMembers` is replaced by `castPickMembers`, which returns every non-overlay member and its `cardId`.
  - The book's cast comes first, under the book's name, one row per individual. A member and its offered card are one row: it shows the member's name and picks the card id. A card-less member picks its member id, in multi mode only.
  - The second group is the remaining cards, under **Your other characters**, with the line *Picking one adds someone new to the story.*
  - The old line *Cast members with no character card.* and the **Character cards** heading are gone.
  - With no cast to offer, the list is flat as before.
- `StartSessionForm.svelte` and `EditSessionForm.svelte`: picker wiring only. The selected and offered member lists keep to card-less members. ★s4-seat-live-1 (multi-select only when the book has unseated card-less members) still holds. `characterIds` and `castMemberIds` go to the server as before.
- The modal's stale prop comment was corrected after the scope review.
- Tests: `CharacterSelectModal.castMembers.dom.test.ts` rewritten.

### 6. Guests see the own-notes reading (★s4-verify-2) — worker w2
- Checked first: the server already answers a guest. `lorebooks:lines` → `assertReadableBook` → `lorebookAccessFor` returns `"owner"` for any session member on a session's own notes (`ownBookAccessFor`).
- `EditSessionForm.svelte`:
  - `ownReadingBookId` no longer excludes guests.
  - The own-notes `SessionLorebookReading` gets `readOnly={isGuest}`.
  - Save sends the own-notes reading only for the owner.
  - The book-name line (follow-a's) is untouched.
- Tests: new `editSessionGuestOwnNotesReading.dom.test.svelte.ts`. `editSessionOwnNotesReading.dom` is updated, because it asserted the old "guest sees nothing".

### 7. Save parity, card vs card-less seats — worker w2
- Audit result: before this change, a card seat's remove asked first and had the on/off switch; a card-less seat had neither.
- Fixed, everything still on **Save**:
  - A card-less remove now asks through the same `RemoveFromSessionModal`, with the same words as a card remove (`removeType "member"`).
  - Card-less rows get the identical switch, kept in `memberActiveDraft` (keyed by member id, separate from the card-id draft). It is counted in the dirty check and reset on re-read.
  - Save emits `sessions:setCastSeatEnabled { sessionId, castMemberId, enabled }`. **The server half is s4-follow-a's** (lead ruling).
  - Discard was already right for both lists.
- *Ready to add* cannot appear for either kind of seat in the edit form, because it only shows when there is no session; both behave identically.
- Tests: new `editSessionSaveParity.dom.test.svelte.ts`; `editSessionCastMembers.dom` updated (the confirm click).
- **w2 totals: 6 files / 29 tests pass, plus `noCharacterVisibility` and `createSession` (115 tests) pass.**

### 3. Characters view: favourites first, nickname shown — worker w3
- `cast/characterRows.ts`: the page order now leads with a favourite rank (`fav_rank`): the asker's own favourite cards first, then everything else by name. The cursor gains `f`; an old three-key cursor gets `CHARACTER_ROWS_STALE_CURSOR`, which the view already answers by asking for the first page again.
- New `CharacterRow.nickname`: the card's nickname on a card row, `MemberAsRead.nickname` on a member row, null when blank.
- `CharacterRowItem.svelte` shows `nickname || shownName` everywhere the row shows a name.
- `CharactersSidebar.svelte` needed no change: it never re-sorts rows.
- Tests: new `characterRows.favorites.int.test.ts`, covering order, paging across the favourite boundary, the stale cursor, a shared card's star, and the nickname. Also new cases in `characterRowItem.dom`, and `nickname: null` added to the fixtures in `characterRowsView.test` and `charactersSidebar.dom`. The existing `characterRows.*.int` tests are green. **9 files pass.**

### 4. Member Sprites tab cascades — worker w4, under the lead's grant for `sockets/sprites.ts`
- `sprites/choices.ts`: new exported `memberDrawsOwnSprites` (does the member have sets with pictures), now called by `spriteChoicesFor` with no change in behaviour.
- `sockets/sprites.ts` `buildSpriteList`: for a member owner whose own art doesn't win, it attaches `fromCard?: { characterId, sets }`. The card is the active card at the book's present, else the linked card; whichever comes first with pictures. It is read under the member's read rule and carries only the sets.
- `types.ts`: one field.
- `SpritesTab.svelte`, display part only (no reply-key code touched):
  - When a member has no sets, the card's sets show read-only under *From the card: ‹name› is drawn with these until they have sprites of their own.*, and editors keep Upload and the standard set.
  - When a member's own sets have no pictures yet, the tab adds *Until these have pictures, ‹name› is drawn with the card's sprites.*
  - The tab never says "has no sprites" while the card's sets show.
- Tests: new `sprites.fromCard.int.test.ts` (9/9) and `spritesTabFromCard.dom.test.ts` (4/4); the existing `choices.*`, `memberSprites`, `ownerWriters` and `spritesTab.memberOwner.dom` are green.
- **Media finding:** see ★s4-fb-4.

### 5. Member voice reads as an override — worker w3, under the lead's grant for two `CastMemberForm` lines
- `VoiceTab.svelte`: new optional prop `castMember?: { linked }`.
  - A member with a card reads *‹name›'s own voice in this book, used instead of the card's.*
  - Members drop *Travels with the card.*
  - A card-less member sees the plain header.
  - The card form is unchanged.
- `CastMemberForm.svelte`: exactly two exact-string edits, with no prettier run. It now passes `castMember`, and shows *Uses the card's voice.* under the switch while it is on.
- Tests: new cases in `VoiceTab.dom.test.svelte.ts`.

### 8. Cascade audit: report only, plus trivial fixes
No built-in session, reply or boot path writes card content today. Three doors are latent violations: they accept a card target from a session, though no built-in spec or UI sends one yet.

| Site | What it writes, and when | Verdict |
|---|---|---|
| `sockets/state.ts` `owner()` ~221 → `state/write.ts` `setValue` ~2462 / `configure` ~2547 | `attribute_values` / `attribute_configs` with `owner_kind='card'`, from a session sheet edit | **Latent violation, but deliberate (plan B0)**, pinned by `state.ownerScope.int.test.ts:249`, which lets the session owner write their own card's stats. Not a one-liner: refusing it reverses a built rule. → ★s4-fb-1 |
| `pipelines/runtime/host.ts:9862` `offer-media` → `characters/portrait.ts:180` (**serene-pub-43**) | puts a session run's picture into the card's gallery | **Latent violation.** Fix: resolve the seated member and use `addToMemberGallery` (about 8 lines). Queued for serene-pub-43. |
| `host.ts:9923` `attach-sprite` → `sprites/attach.ts:116/175/181` | card-owned sprite set and sprites from a session run | **Latent violation.** Fix: the same seat→member route, writing to `{castMemberId}`. Queued; coordinate with serene-pub-43 (fill flow). |
| `library/writes.ts:271/273` via `host.ts:2563` `update-character` | the card's current version, from a genre pipeline in a session | **Unclear.** This is the management API the owner allows, but nothing stops it targeting a seated member's card. Recommendation: refuse when the card is seated in `scope.sessionId` and point to `update-cast-member`. → ★s4-fb-2 |
| `utils/markCharacterAsPersona.ts:30`, from `sessions:create`, `saveDraft`, `addPersona`, `reassignRemovedParticipant`, `branch.ts:296` | the library flag `characters.is_persona = true` | **Unclear.** It is a library flag, not content. Leave it unless the owner says the flag counts as card data. |
| `pipelines/runtime/cutOut.ts:236-238` | a cut-out joins the card's gallery | **Unclear, low risk.** A cut-out of a member's file loses its book provenance until `attach.ts` puts it back (Noticed). |
| Content-neutral: `characters/versions.ts:429` `ensureCardVersion` (lazy v1 snapshot), `embedding/vectorizationQueue.ts:862` (derived index), `characters/versionsLift.ts` (one-time boot pass) | — | OK |
| Management only: `sockets/characters.ts` (tags, update, delete, import, gallery upload, `setAvatar`, `setDefaultPersona`), `sockets/portrait.ts`, `characterFolders`, `appletLibrary` `update-character`, imports and dowry, plugin install, `state/cardState.ts`, `cardFromMember.ts`, `sockets/sprites.ts` editor events, `reexpress.ts`, library undo/redo | — | OK |
| Writes that touch only member, seat or session data: cast-version writers, member sets, `sessions:setSpriteSet` → `session_cast`/`seated_member`, `durable.ts` → `cast_member`/`lorebook`, `bindings.state.ts` `castOwnerOfRef` (never `card`), `seatName`, `amendments`, `resolveVoice` → `sessions.genreFields`, `cardless.ts`, `characterBindingSync` | — | OK |

None of the violations was a one-liner in this lane's files, so none was fixed.

## Files changed
- **Server:** `src/lib/server/state/earshot.ts`, `src/lib/server/sockets/state.ts`, `src/lib/server/cast/characterRows.ts`, `src/lib/server/sprites/choices.ts`, `src/lib/server/sockets/sprites.ts` (granted)
- **Shared:** `src/lib/shared/sockets/types.ts` (fields: `State.Get.Params.overhear`, `StateOwnerRow.overhearing`, `ListSprites.Response.fromCard`), `src/lib/shared/characters/characterRows.ts`
- **Client:** `src/lib/client/state/sessionState.svelte.ts`, `src/lib/client/components/sessionPage/requests/index.ts`, new `requests/overhearSeat.ts`, `src/lib/client/components/sessionPage/projections/sessionState.ts`, `src/lib/client/styles/widgets.css` (one selector), `src/lib/client/components/modals/CharacterSelectModal.svelte`, `src/lib/client/components/sessionForms/StartSessionForm.svelte`, `src/lib/client/components/sessionForms/EditSessionForm.svelte`, `src/lib/client/components/listItems/CharacterRowItem.svelte`, `src/lib/client/components/sprites/SpritesTab.svelte`, `src/lib/client/components/characterForms/VoiceTab.svelte`, `src/lib/client/lorebooks/cast/CastMemberForm.svelte` (2 lines, granted)
- **SDK:** `../serene-pub-sdk/sdk/src/widgets.ts`, `../serene-pub-sdk/core-catalog/components/shared/stats/StatsWidget.svelte`, `../serene-pub-sdk/INTEGRATING.md`
- **Docs:** `docs/sessions.md` (picker, edit-form seats, guests' own-notes line/clock), `docs/characters.md` (favourites first, nickname), `docs/lorebook-cast.md` (voice override, sprites from the card), `docs/stats-and-states.md` (Show secrets; the scope reviewer accepted this as the earshot area doc). The generated docs (`src/lib/generated/docs`) still need `docs:build`.
- **Tests:** listed per goal above.
- **Worker briefs:** `plans/briefs/BRIEF-s4-follow-b-w1.md` … `-w4.md`.

## Typecheck, check and tests
- No baseline was taken before the change.
- **After:** `npx tsc --noEmit -p .` has **3 errors**, all waiting on `sdk:build`:
  - `requests/index.ts(627,2)` TS2353 `"overhear-seat"`
  - `requests/index.ts(627,20)` TS7006
  - `requests/overhearSeat.ts(11,30)` TS2339
- `npm run check`: the same 3 errors, 8 warnings, none in this lane's files.
- After the build, drop the TODO cast in `projections/sessionState.ts:130`.
- `castMemberId` on `setCastSeatEnabled` gave no tsc error; the type and the handler change land from s4-follow-a.
- SDK tests were not run (they need the build).
- Final re-run after the supervisor's touch-ups: `state.overhear.int`, `CharacterSelectModal.castMembers.dom`, `characterRows.favorites.int`, `sprites.fromCard.int` — 4 files, 29 tests, all pass.
- Logs: `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-*.log`.

## Open ★ (each with the lane's recommendation)
New copy, built as recommended:
- **★s4-fb-c1:** "Show secrets", with *Shows what only ‹name› knows, on your screen only. The AI still plays ‹name›.*
- **★s4-fb-c2:** **Your other characters**, with *Picking one adds someone new to the story.*
- **★s4-fb-c3:** *From the card: ‹name› is drawn with these until they have sprites of their own.* and *Until these have pictures, ‹name› is drawn with the card's sprites.*
- **★s4-fb-c4:** the select label **Card sprite set** on the read-only card sets. Recommend keep: it tells the card's sets apart from the member's own.
- **★s4-fb-c5:** *‹name›'s own voice in this book, used instead of the card's.* The lead already accepted *Uses the card's voice.*

Decisions for the owner:
- **★s4-fb-1:** Should a session sheet still be able to write the owner's **card** stats (`owner_kind='card'` via `state:set` / `state:configure`, plan B0, pinned by `state.ownerScope.int.test.ts`)? Under the cascade principle it should not. **Recommendation:** refuse `card` at the `sockets/state.ts` door ("Card stats are edited in the card editor.") and update that test. Trade-off: it reverses a built B0 rule.
- **★s4-fb-2:** Should `core:outlet/update-character` refuse a card seated in the run's session? **Recommendation:** yes, and point to `update-cast-member`. Trade-off: a genre that edits a seated card on purpose loses that.
- **★s4-fb-3:** Show secrets reveals values to read only, never to write. Holder-only pending proposals stay hidden while it is on, and `mine` doesn't change. **Recommendation:** keep it so (the brief says read-only).
- **★s4-fb-4 (media access):** A reader who can read a member but not its card can't load the card's sprite files, because `canViewMedia` checks a card's files only through `canViewCharacter`. `fromCard` is still sent, so the words are right, but those readers see placeholder images. Options:
  - (a) let `canViewMedia` admit a card's sprite file to readers of a member linked to that card. This exposes only the sprite images, which session faces already cascade.
  - (b) send `fromCard` only to readers who can see the card.

  **Recommendation: (a).** It is a security widening, so it is the owner's call.
- **Carried, not the lane's to rule:** the owner's s4-fixes-1b note asked whether secrets should be "a keyed aspect on the seat or session". That question is still open. Show secrets is built on today's earshot (holder-only slots); the "cast lore" rename is ruled for S5.

## NOMENCLATURE rows queued (§25 ledger; all 🚧)
- **overhear** (§9 Session, earshot): a seater reading their own AI seat's holder-only values on request, read-only. The UI label is **Show secrets**; the internal word avoids `secret`, which plugin settings own (secret handle, R63).
  - `overheard(hearing, links, memberIds)` in `state/earshot.ts`
  - `callerView` / `overheardMembers` / `seatsSeatedBy` in `sockets/state.ts`
  - the `state:get` param `overhear?: string[]` (seat refs)
  - per connection, `socket.data.overhear`
- **`overhear-seat`** (SDK widget request, `'core'` grant, `'session'` reach) and **`SessionStateOwnerV1.overhearing?: boolean`** (SDK, @experimental). Priority, because plugins see them on the SDK surface.
- **`ListSprites.Response.fromCard?: { characterId, sets }`** (§18 Media / sprites): a member's card's sets while the card draws the member; read-only. Plus `memberDrawsOwnSprites` (`sprites/choices.ts`) and `cardSpritesDrawingMember` (local to `sockets/sprites.ts`).
- **`CharacterRow.nickname`** (§8 Content); the page keyset gains the favourite rank `fav_rank` / cursor `f`.
- **`castPickMembers` / `PickMember.cardId`** (client picker, internal); **`memberActiveDraft`**; **`VoiceTab` prop `castMember`**.
- **Retired copy:** *Cast members with no character card.*; the **Character cards** picker heading; for members, *Travels with the card.*

## Noticed, not done
- **Waiting on s4-follow-a:** `sessions:setCastSeatEnabled` must accept `castMemberId` (manage rule = the session's). Its card-seat `canManage` still uses the card's owner rather than the seater; the lead says leave that for now.
- **Picker:** a carded member whose card is already chosen, or is someone else's, is not offered and not explained. New World lists only your characters.
- **Edit form:** card-less rows can't be reordered (card rows can); new card-less seats go at the end.
- **Edit form:** the comment above `RemoveFromSessionModal` (~line 3454) says it models only character and persona; it now also handles member removal.
- **Goal 4 uses its own card-choice logic,** separate from `choices.ts`'s (scope finding 3). `cardDrawingMember` was not extracted. In `choices.ts` the card choice is tangled with the session reading (seat, amendments, speaker fallback), while the editor reads at the book's present. The two agree for a carded member today, but they could drift.
- **Characters view:** a member's nickname edit also rewrites `lorebook_bindings.name`, so member rows sort and search by nickname, while card rows sort by the card's stored name (existing behaviour).
- **Audit:** the three latent card-write doors above (two belong to serene-pub-43); `cutOut.ts` drops `lorebookId` provenance briefly.
- **Prettier:** `earshot.ts`, `sockets/state.ts`, `sessionState.svelte.ts`, `requests/index.ts`, `choices.ts`, `sockets/sprites.ts`, `SpritesTab.svelte`, `VoiceTab.svelte` and `StartSessionForm.svelte` already failed prettier on lines this lane didn't write; left alone. This lane's three helpers in `sockets/state.ts` were formatted by hand. A few of its lines inside other code there are still long.
- **Process:** a w3 wait loop (pid 748433) that a permission check refused to kill had already exited when checked.
- **Docs:** `docs:build` has not been run.

## Scope review (`scope-reviewer`)
**5 low-to-medium findings, nothing blocking.**
1. **(medium)** The new names were not yet in NOMENCLATURE. They are queued above.
2. **(low)** The worker briefs added carrier files beyond the lane brief's list: `types.ts` fields, `sessionState.svelte.ts`, `requests/*`, `projections/sessionState.ts`, one `widgets.css` selector. Each is the smallest carrier its goal needs. Lead to accept.
3. **(low)** Goal 4 has a second card-choice function. Accepted, with the reason in Noticed.
4. **(low)** Helper names beyond the briefs' allowed lists (`overheardMembers`, `answerOverhearSeat` / `OverhearSet`, `cardSpritesDrawingMember`). All are module-local; accept.
5. **(low)** A stale prop comment in `CharacterSelectModal.svelte`. **Fixed.**

The reviewer cleared `docs/stats-and-states.md` as the right area doc, and confirmed no edits outside owned or granted regions.
