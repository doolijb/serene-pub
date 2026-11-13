# BRIEF s27-S2core-w1 — `cast/memberAsRead.ts`, `cast/seatedCast.ts`, the card-profile reach payload

Supervisor: lane s27-S2core (seat-cast programme, stage S2, plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §27). App `/home/jody/github/serene-pub`. You are a Sonnet `lane-worker`. Report = your final message (the supervisor reads it): changed files, exported names + signatures, tests run with results, choices made, anything you could not do.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal (owner ruling 2026-11-05: "Cards seed cast, cast defaults to reading active linked card"; members carry voice and sprites, own over card)
One function every S2 reader will use to get what a cast member (`lorebook_bindings` row) *is*, layered over its active card. No existing reader is switched in this brief.

### 1. `src/lib/server/cast/memberAsRead.ts` (new) — exports, exactly these names
```ts
/** 🚧 A cast member as read: the member layered over its active card, on one reading. */
export interface MemberAsRead {
  castMemberId: number
  lorebookId: number
  /** The member's stored linked card (`lorebook_bindings.character_id`). */
  linkedCardId: number | null
  /** The card the member is drawn with on this reading: the linked card, or the dated card a cast amendment draws them with by then (`castMemberAt`, no keepCard). */
  activeCardId: number | null
  /** No active card on this reading: every field is the member's own. */
  cardless: boolean
  name: string
  nickname: string | null
  /** nickname || name (memberShownName rule). */
  shownName: string
  aliases: string[]          // member's own (amended)
  summary: string | null     // member's own (amended)
  description: string | null
  personality: string | null
  scenario: string | null
  firstMessage: string | null
  alternateGreetings: string[]
  /** The card's shape: one entry per dialogue (member text split with `splitExampleDialogues`). */
  exampleDialogues: string[]
  /** Card-only; [] when the member retells firstMessage or alternateGreetings (as `applyRetold`). */
  groupOnlyGreetings: string[]
  /** The retold fields (RETOLD_FIELDS order) still read from the card on this reading; [] when cardless. */
  followsCard: RetoldField[]
  faceMediaId: number | null
  timbre: CharacterTimbreInput | null
  voiceFrom: "member" | "card" | null
  spriteSets: { id: number; name: string; isDefault: boolean; position: number }[]
  spriteSetsFrom: "member" | "card" | null
  /** The member's chosen set by name (`lorebook_bindings.sprite_set`, amendable), as stored. */
  spriteSet: string | null
  /** Card-only (the active card's tag names); [] when cardless. */
  tags: string[]
}
export interface MemberAsReadOptions { reading?: EntryReading; sessionId?: number }
export function layerMemberAsRead(member: …, card: … | null, sets: { member: …[]; card: …[] }, tags: string[]): MemberAsRead   // PURE
export async function membersAsRead(db: Db, memberIds: readonly number[], opts?: MemberAsReadOptions): Promise<Map<number, MemberAsRead>>
export async function memberAsRead(db: Db, memberId: number, opts?: MemberAsReadOptions): Promise<MemberAsRead | null>
export function followsCardFields(retold: RetoldFlags | null | undefined): RetoldField[]   // PURE: RETOLD_FIELDS minus retoldFieldList(retold)
```
(Shape the `member`/`card` parameter types of `layerMemberAsRead` as exported interfaces if you need them — name them `MemberRowForReading` / `CardRowForReading`; no other new exported names without asking.)

**The layering rules (`layerMemberAsRead`, unit-tested one by one):**
- The `member` passed in is ALREADY resolved on the reading (`castMemberAt(row, overlays, reading)` WITHOUT `keepCard`, so its `characterId` is the active card). `activeCardId = member.characterId`; `linkedCardId` = the stored row's `characterId` (pass both).
- **Carded** (`card != null`): name/nickname = `memberNames(member, card)` (`$lib/shared/lorebooks/memberIdentity`); each retold text field (`description`, `personality`, `scenario`, `firstMessage`, `exampleDialogues`) and `alternateGreetings`: `retold[field] === true` → the member's (`?? ""`, `[]`, examples split with `splitExampleDialogues` from `lorebooks/retold.ts`), else the card's. `groupOnlyGreetings` = card's unless firstMessage or alternateGreetings retold → []. Face = `memberFaceMediaId(member, card)`. `followsCard = followsCardFields(member.retold)`. Tags = the card's.
- **Card-less** (`card == null`): every text field is the member's own column regardless of flags (null stays null, greetings [] default); name = `memberNames(member, { name: member.name, nickname: null })`; face = `member.faceMediaId`; `followsCard = []`; tags []; groupOnlyGreetings [].
- **Voice:** `member.timbre != null` → the member's, normalised with `timbreOfExtensions({ serenepub: { timbre: member.timbre } })` (`$lib/shared/characters/timbre`), `voiceFrom: "member"`; else the card's `timbreOfExtensions(card.extensions)`, `voiceFrom: "card"`; no card and no member timbre → `null`/`null`.
- **Sprite sets:** the member's own sets (`sprite_sets.cast_member_id`) when it has any, `spriteSetsFrom: "member"`; else the active card's sets (`sprite_sets.character_id`), `"card"`; none → [] and `null`. Sorted by position then id.
- A soft-deleted card (`characters.is_deleted`) still reads (seats still seat it; S4 copies words into the member). Note it in your report only.

**The DB read (`membersAsRead`)** — one round of queries, not per member: members by id (`inArray`); reading = `opts.reading` ?? (`opts.sessionId` → `sessionReadingOf(db, sessionId)`) ?? `MAIN_HEAD`; overlays once per distinct lorebook (`castOverlaysFor(db, lorebookId, reading)`); resolve each member with `castMemberAt`; then ONE query each for the distinct active cards, their tags (`character_tags` ⋈ `tags`), and sprite sets (members' OR cards'). Import `state/reading` and `state/entriesOnReading` **dynamically** inside the function, exactly as `retoldMembersForSession` in `src/lib/server/lorebooks/retold.ts` does (read it first; reuse `RETOLD_MEMBER_COLUMNS`-style selection, `splitExampleDialogues`). Unknown ids are absent from the map; empty input → empty map, no query.

### 2. `src/lib/server/cast/seatedCast.ts` (new)
```ts
/** 🚧 One live seat of a session and the cast member it seats, as read. ⚠ Not the SDK's `CastEntry`. */
export interface SeatedCastEntry {
  seatId: number
  kind: "character" | "player"
  castMemberId: number | null
  cardId: number | null
  position: number
  /** null when the seat has no member yet (S1 mints none into a session's own book) — the caller reads the card. */
  asRead: MemberAsRead | null
}
export async function seatedCastOf(db: Db, sessionId: number): Promise<SeatedCastEntry[]>
```
Every LIVE seat (`removed_at IS NULL`): character seats (`session_characters` rows with `character_id` set — envoy seats excluded) by position then id, then player seats (`session_personas`, card-less ones included, `cardId` null) by position then id. One `membersAsRead(db, ids, { sessionId })` for all members.

### 3. `lorebooks:bindingsForCharacter` payload (additive)
In `src/lib/server/sockets/lorebooks.ts`, ONLY `lorebookBindingsForCharacterHandler` (~1316–1395): each `members[]` row gains `followsCard: RetoldField[]` (`followsCardFields(b.retold)` — the stored flags, like `retold`) and `memberName: string` (`ownNameValue(b.ownName) || b.name` — the member's own name in that book, else its stored name, which the card sync keeps). In `src/lib/shared/sockets/types.ts`, `Sockets.Lorebooks.BindingsForCharacter.Response.members` (~8243–8264): add the two fields with doc comments (_the fields this member still reads from the card — what editing the card changes for them_; _the member's name in that book_). Touch nothing else in either file; re-read the region immediately before editing (other lanes edit these files; lane pl4 owns the lorebook DUPLICATE handler — don't touch it).

## Tests (Done means)
- `src/lib/server/cast/memberAsRead.test.ts` (unit, pure): every rule above — carded retold on/off per field, own name/nickname, face retold vs card avatar, card-less reads own columns ignoring flags, voice member/card/null, sprite sets member/card/none, groupOnlyGreetings cleared, examples split, `followsCardFields`.
- `src/lib/server/cast/memberAsRead.int.test.ts` (int, PGlite): one book with a carded member, a card-less member, a retold member (some flags on), and a dated member (a cast amendment draws them with a second card from a date — copy how `src/lib/server/lorebooks/retold.int.test.ts` / `src/lib/server/pipelines/runtime/datedCardLore.int.test.ts` make one); `membersAsRead` batch at MAIN_HEAD and at a reading past the date (activeCardId moves, linkedCardId does not); member timbre over card timbre; member sprite set over card sets; a session's `seatedCastOf` with a character seat, a player seat with a card, a card-less player seat, an envoy (excluded), a departed seat (excluded); the bindings handler payload (`followsCard`, `memberName`) — call the exported handler the way other `sockets/lorebooks*.int.test.ts` do, or test the pure part if the handler can't be driven; say which.
- Copy the int setup from `src/lib/server/sessions/seats.int.test.ts` (vi.mock of `$lib/server/db` with `createTestDb`, `mkdtemp` dir prefixed `serene-pub-vitest-memberAsRead-`, `releaseDataDir`). Run: `npx vitest run src/lib/server/cast` (never pipe into `head`), and `npx tsc --noEmit -p .` then grep its output for your files only (other lanes' errors are not yours).

## Rules (quoted from CLAUDE.md / NOMENCLATURE — your work depends on them)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- **No static import of `$lib/server/db`** in `cast/**` (tests mock it; pass `db`). Every function takes its handle first.
- "Never write "no book"/"no lorebook"": every session has a lorebook (its own book or an overlay). Comments say "a session whose lorebook is its own book", never "bookless"/"reads no book".
- "It is a **session**, never a *chat*."
- NOMENCLATURE R3 "Qualify, never abbreviate to the bare noun" — no new bare `type`/`source`/`key` names. No new exported names beyond those above without asking (report the need instead). Mark new exported names 🚧 in their doc comment.
- 60 s timeouts for int tests (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`).
- Never pipe vitest into `head`. Run only these targeted tests.
- Never edit files outside: `src/lib/server/cast/**`, the one handler in `sockets/lorebooks.ts`, the one type in `shared/sockets/types.ts`. Don't touch `state/**`, `sessions/**`, `NOMENCLATURE.md`.
- Prettier: `npx prettier --write` only on your NEW files; on the two shared files, match the surrounding style by hand (never reformat a file dirty at HEAD).
