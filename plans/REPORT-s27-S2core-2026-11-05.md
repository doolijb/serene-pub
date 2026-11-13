# REPORT s27-S2core (2026-11-05): the cast member as read, `seatOf`, `seatedCastOf`, the card-reach payload, and S1 fixes F1–F5

**Status: BUILT.** Workers w1 and w2 (Sonnet). Briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2core-w1.md` and `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2core-w2.md`. I checked both reports against the briefs and read the code. Lane tests are green and `tsc` shows nothing in lane files. No migration, no SDK edit, no commit, no stash.

## Exported names and signatures (the S2 lanes build on these)

### `src/lib/server/cast/memberAsRead.ts` (new, 🚧, no static `$lib/server/db` import)
```ts
export interface MemberAsRead {
  castMemberId: number; lorebookId: number
  linkedCardId: number | null      // stored lorebook_bindings.character_id
  activeCardId: number | null      // linked card, or the dated card a cast amendment draws them with on this reading
  cardless: boolean
  name: string; nickname: string | null; shownName: string
  aliases: string[]; summary: string | null
  description: string | null; personality: string | null; scenario: string | null; firstMessage: string | null
  alternateGreetings: string[]; exampleDialogues: string[] /* card shape */; groupOnlyGreetings: string[]
  followsCard: RetoldField[]       // retold fields still read from the card on this reading; [] when cardless
  faceMediaId: number | null
  timbre: CharacterTimbreInput | null; voiceFrom: "member" | "card" | null
  spriteSets: { id: number; name: string; isDefault: boolean; position: number }[]; spriteSetsFrom: "member" | "card" | null
  spriteSet: string | null          // member's chosen set by name (lorebook_bindings.sprite_set)
  tags: string[]                    // card-only
}
export interface MemberAsReadOptions { reading?: EntryReading; sessionId?: number }
export interface MemberRowForReading { … }   // the resolved member row (characterId = active card, linkedCardId = stored)
export interface CardRowForReading { … }
export function layerMemberAsRead(member: MemberRowForReading, card: CardRowForReading | null,
  sets: { member: readonly SpriteSetRow[]; card: readonly SpriteSetRow[] }, tags: readonly string[]): MemberAsRead   // pure
export function followsCardFields(retold: RetoldFlags | null | undefined): RetoldField[]                              // pure
export async function membersAsRead(db: Db, memberIds: readonly number[], opts?: MemberAsReadOptions): Promise<Map<number, MemberAsRead>>
export async function memberAsRead(db: Db, memberId: number, opts?: MemberAsReadOptions): Promise<MemberAsRead | null>
```
- **Reading:** `opts.reading`, else the session's (`sessionReadingOf`), else `MAIN_HEAD`.
- **Queries:** one round. Members are read once, overlays once per book (`castOverlaysFor`, then `castMemberAt` without keepCard), then one query each for cards, tags and sprite sets.
- **Carded layering:** name is `memberNames(member, active card)`. Each retold field is the member's while its flag is on, else the card's. Group-only greetings are cleared when greetings are retold. Face follows `memberFaceMediaId`.
- **Card-less layering:** every field is the member's own and flags are ignored.
- **Voice:** the member's `timbre` when set, else the card's.
- **Sprite sets:** the member's own sets when it has any, else the active card's.
- **Not materialised:** the gallery. A reader passes `activeCardId` to the gallery read.

### `src/lib/server/cast/seatedCast.ts` (new, 🚧)
```ts
export interface SeatedCastEntry { seatId: number; kind: "character" | "player"; castMemberId: number | null; cardId: number | null; position: number; asRead: MemberAsRead | null }
export async function seatedCastOf(db: Db, sessionId: number): Promise<SeatedCastEntry[]>
```
- It returns live seats only. Character seats with a card come first (envoys excluded), then player seats (card-less included), each group by position then id.
- It makes one `membersAsRead` call on the session's reading.
- `asRead` is null while a seat has no member yet. The caller then reads the card.

### `src/lib/server/sessions/seats.ts` (additions)
```ts
export interface ResolvedSeat { kind: "character" | "player"; seatId: number; castMemberId: number | null; cardId: number | null; departed: boolean }
export function parseSeatRef(ref: string): { form: "character" | "seated-member" | "player-seat"; id: number } | null
export async function seatOf(tx: Db, sessionId: number, ref: string): Promise<ResolvedSeat | null>
export interface MintedSeatMember { cardId: number; lorebookId: number }
export async function syncMintedSeatMembers(db: Db, minted: readonly MintedSeatMember[]): Promise<void>
settleSeats(tx, sessionId, opts?: { merge?: boolean })   // DEFAULT IS NOW FILL-ONLY
// SettleReport, seatCast's ok result and seatPlayer's result gain mintedMembers: MintedSeatMember[]; resolveSeatMember returns mintedIn: number | null
```
- **How `seatOf` resolves:**
  - `character:<cardId>` finds the character seat, else a player seat with that card.
  - `seated-member:<memberId>` finds a seat by its `cast_member_id`. It is parsed locally until the SDK change in S3.
  - `player-seat:<id>` is scoped to the session.
  - Live beats departed, then character before player, then lowest position, then lowest id. An envoy seat is never returned.

### `lorebooks:bindingsForCharacter` (additive)
Each `members[]` row gains `followsCard: RetoldField[]` (stored flags, like `retold`) and `memberName: string` (`ownNameValue(ownName) || name`). The handler and `Sockets.Lorebooks.BindingsForCharacter.Response` are the only hunks changed in those two files.

## Changed files
- **New:**
  - `src/lib/server/cast/memberAsRead.ts`
  - `src/lib/server/cast/seatedCast.ts`
  - `src/lib/server/cast/memberAsRead.test.ts`
  - `src/lib/server/cast/memberAsRead.int.test.ts`
  - `src/lib/server/sessions/seatOf.test.ts`
  - `src/lib/server/sessions/seatOf.int.test.ts`
- **Edited:**
  - `src/lib/server/sessions/seats.ts` and `src/lib/server/sessions/seatMembers.ts`
  - `src/lib/server/sockets/lorebooks.ts`: the handler plus one import line
  - `src/lib/shared/sockets/types.ts`: the one type
  - `src/lib/server/sockets/sessions.ts`: F1 comments, F3 header, F4 sync sites
  - `src/lib/server/sockets/import.ts`: F4
  - `src/lib/server/sessions/branch.ts`: F4 and F1 comment, seat lines only
  - `src/lib/server/db/schema.ts`: the F5 comment row
- **Edited tests:** `src/lib/server/sessions/seats.int.test.ts`, `src/lib/server/sessions/seatMembers.int.test.ts`, `src/lib/server/sockets/sessions.seatCast.int.test.ts`
- **Edited docs:** `NOMENCLATURE.md` (§25) and `plans/REPORT-s27-S1-2026-11-05.md` (the F2 query line)
- Hand-formatted hunks in the shared files; prettier was run only on new or untracked files.

## Tests (run by me after the workers)
- `npx vitest run src/lib/server/cast src/lib/server/sessions/{seats.int,seatMembers.int,seatSites.int,seatOf,seatOf.int}.test.ts src/lib/server/sockets/sessions.seatCast.int.test.ts`: **8 files, 114/114**.
- `sessions.castBindings.int`, `sessions.castFromLorebook.int`, `castMemberLifecycle.int` and `lorebooks.providedCast.int`: **4 files, 40/40**.
- w2 also ran the import, branch and lorebook int tests that call the writer: 17 files, 176/176.
- `npx tsc --noEmit -p .`: no errors in lane files.
- **The int tests cover:**
  - a batch with carded, card-less, retold and dated members, read at `MAIN_HEAD`, at a moment before the date and after it, and through a session's clock;
  - member timbre and member sprite sets taking precedence over the card's;
  - a soft-deleted card, which still reads;
  - `seatedCastOf`, including envoy and departed seats being excluded;
  - the handler payload;
  - every `seatOf` form, with overlapping id ranges (one N is a card, a member, a character seat and a player seat at once).

## S1 fixes (the lead's F1–F5)
- **F1 (no silent merge on live paths):**
  - `settleSeats` is now fill-only by default. Only the boot pass `seatMembers.ts` passes `{ merge: true }`.
  - Every live path (create, update, reassign, `runLorebookBindingCheck` on attach and overwrite, import, branch) fills members and never departs a seat. Comments claiming a merge were corrected.
  - New test "attach and overwrite never depart a seat" (`sessions.seatCast.int.test.ts`): two live seats of one member go through `runLorebookBindingCheck` twice and both stay live with `merged_into` null.
- **F2 (revive clears `merged_into`):** `seatCast`'s revive sets `mergedInto: null` (tested). The S4 pair query in `plans/REPORT-s27-S1-2026-11-05.md` now ends `WHERE d.removed_at IS NOT NULL`. No code comment stated the query.
- **F3 (wording):** "bookless session" and "reads none" are replaced in `seats.ts` and `seatMembers.ts`, and in the NOMENCLATURE §25 seat-writer row (now "a session whose lorebook is its own book"). The `runLorebookBindingCheck` header is corrected: it mints only into an attached book the owner owns that isn't provided, nothing into the own book (★S1-3), and it never departs a seat.
- **F4 (lock order):**
  - `resolveSeatMember` no longer syncs inside the book-locked transaction.
  - Every minting site collects `mintedMembers` and calls `syncMintedSeatMembers(db, …)` after its transaction commits: create, the cast check, update (×3), addPersona (×2), reassign (×2), import (×2), branch (its own outer `db`, callers unchanged) and the boot pass after each session.
  - A failed sync is logged and the loop goes on, because the seat is already committed.
  - Tests: a minted member's name is `""` in the transaction and filled after the sync, and a failing sync is logged.
- **F5:** added the 🚧 `seated_member` row to the owner-kind comment table in `schema.ts`. Comment only.

**Behaviour change for the S2 lanes:** import, branch and attach can now leave **two live seats on one member** until the next boot pass. Readers must tolerate that. `seatOf` picks the lowest position, then the lowest id.

## NOMENCLATURE §25 rows added (after the `seat-members` row)
1. The **cast member as read** row: `MemberAsRead`, `membersAsRead`, `memberAsRead`, `layerMemberAsRead`, `MemberRowForReading`, `CardRowForReading`, `followsCardFields`. It gives the layering rules and a charter, says "as read" is used in the `entriesAsRead` sense, and warns it is not `RetoldMember`.
2. **`followsCard`** and **`memberName`** on the bindings payload. `followsCard` is the complement of `retold`, never a second flag.
3. **`seatOf`**, `ResolvedSeat`, `parseSeatRef` and `seated-member:<id>`. It warns these are not the local `seatOf` closures in `state/handEdits.ts` and the Crawler tests.
4. **`seatedCastOf`** and `SeatedCastEntry`. It warns these are not the SDK's `CastEntry` and not `SessionLinks.cast`.

The S1 seat-writer row was also updated: fill-only on live paths, only the boot pass merges, revive clears `merged_into`, and `syncMintedSeatMembers` / `MintedSeatMember` / `mintedMembers`.

## Decisions taken inside scope (named, not ★)
- **No voice when neither has one:** a card with no timbre gives `timbre: null, voiceFrom: null`, so `"card"` always means the card has a voice. A member's own non-null `{}` timbre still reads as the member's.
- **`MAIN_HEAD` applies every dated amendment.** This is existing `castMemberAt` behaviour. A reader that wants the stored card uses `linkedCardId`.
- **`activeCardId` is null if the dated card's row is gone,** and the member then reads card-less.
- **`seatOf` falls back to a departed seat,** flagged `departed: true`, so old speakers still resolve. Live beats departed across both tables.
- **`seatedCastOf` lives in `cast/seatedCast.ts`,** not `seats.ts`, so the writer module stays a writer plus the one compatibility read the brief put there.
- **New names the brief did not spell out:** `followsCard` and `memberName` on the socket payload, and `MemberRowForReading` / `CardRowForReading`. They are recorded in §25, and the lead may veto them.

## Open ★
None new. ★S1-1 is ruled and F1 now follows it.

## Noticed, not done
- Test names and comments still say "bookless" or "no book" in `src/lib/server/sessions/seatSites.int.test.ts` (its header and ~176) and `src/lib/server/sockets/sessions.seatCast.int.test.ts` (~535, ~575). F3 named only `seats.ts` and `seatMembers.ts`.
- NOMENCLATURE §25 ~3223 (the m3b-W `worldOwnerOf` row, another lane's) still uses "bookless/reads none" framing.
- The `schema.ts` owner-kind prose under the table still says `owner_id` "points at six different tables", but the table now lists more.
- A soft-deleted card still reads through `memberAsRead`. S4 (★27-6) should copy its words into the member.
- `lorebook_bindings_character_unique` allows one member per card per book, but one card can be a member in several books. S2 readers resolve per seat, not per card.
- `seatCast`'s refusal result carries no `mintedMembers`. That is correct, because a fresh mint cannot collide.

## Scope review (lead, 2026-11-05) — no objection on scope; four low items, dispositions
1. **The boot pass still merges a pair that a live path left** (import, branch, attach can leave two live seats on one member until the next boot). Not a new ruling: the §27 merge rule is the owner's ("the member's active card's seat survives, the other departs, lines re-stamped to the survivor, values merge newest-wins"); ★S1-1 ("refused in words") covers *new* seats. P1 still asks that the merge be shown → **S4**: the departed seat with `merged_into` shows its cause in the session's cast (★ copy in that lane); attach goes away with "no swapping" in S4.
2. **`memberName` uses its own name rule** (`ownNameValue(ownName) || name` from the binding's synced copy; empty if a post-commit sync failed) → lane **S2-client** derives it with the `memberShownName`/`memberNames` rule from the requested card (one name rule, R1).
3. **Unflagged extras** (`voiceFrom`, `spriteSetsFrom`, `linkedCardId`, `shownName`, `spriteSet`, `SeatedCastEntry.position`, `seatOf`'s departed fallback + `ResolvedSeat.departed`) → **kept** (all in §25; `*From` serve the "made visible" direction; the departed fallback keeps old speakers resolving).
4. **Leftover "no book" test wording** also at `seats.int.test.ts:857`, `sessions.seatCast.int.test.ts:7` and `:458` → joins the S4 wording sweep with `:535`, `:575`, `seatSites.int` and the `worldOwnerOf` §25 row.
