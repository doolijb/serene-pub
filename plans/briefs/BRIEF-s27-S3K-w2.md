# BRIEF s27-S3K-w2 — SDK widget/cast shapes and the docs (seat-cast S3)

Lane **s27-S3K**, worker **w2** (Sonnet). Supervisor: the s27-S3K lane-supervisor. SDK repo `/home/jody/github/serene-pub-sdk`; the app is `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.
**You do not run `sdk:build` at all** — the supervisor does. Most of the SDK repo is uncommitted work by others (`widgets.ts` and `sessionDossier.ts` already carry other lanes' edits): edit only the hunks below, never reformat a whole file, never revert anything you did not write.

## Background (why)
Sessions are moving from seating **cards** to seating **cast members** (a `lorebook_bindings` row; "cast member id"). Stage S3 **adds** the new SDK names; nothing is removed or renamed away. Old forms stay, marked ⏳ "removed in S5" (owner 2026-11-05: removal in S5, after the flip). In S3 the host still emits card forms (`character:<cardId>`) and fills new identity fields so widgets and scripts stop building refs from card ids. A parallel worker (w1) adds to `sdk/src/participants.ts` the participant ref 🚧 `` `seated-member:${string}` `` (a seated cast member by its cast member id) — `ParticipantRef` already exists there; you only import it.

Owner rulings you implement (2026-11-05, quoted):
- "cast entries carry `castMemberId` + optional `cardId`" (`cardId` null when card-less).
- "Everything in session is cast -> active card." — `cardId` is the member's **active card on the timeline** (the dated card at the session's reading).
- ★S3-2: "`SessionStateOwnerV1` gains `ref` + `castMemberId`."
- ★S3-3: "a message carries `castMemberId` only (not a `speaker` ref): `MessageV1`, `TurnHistoryMessage` (and the lane `latest`) gain `castMemberId`." (w1 does `TurnHistoryMessage`.)
- ★S3-4: sprite choices — "Cast member id, cascade to a card based on active card on the timeline and cast member configuration."
- ★S3-8: Scene Portraits keyed by cast member — stored lines `seated-member:<id>=<image>`, the parameter `memberRef`.

**Every new field is OPTIONAL** (`?:`) — a host that predates S3, and the app until its own lane fills them, must still type-check. Doc each as host-filled.

## Goal — exactly these changes

### `sdk/src/widgets.ts`
1. `OwnerRefV1.kind` (~1071) gains 🚧 `'seated_member'` (its `id` the cast member id, `lorebook_bindings.id`). Its doc and `SessionStateOwnerV1`'s head doc (~873) say so; `session_cast` (id = the card) ⏳ removed in S5.
2. `SessionStateOwnerV1` gains 🚧 `ref?: ParticipantRef` (a cast owner's seat ref, as the host fills it — match on it, never build it) and 🚧 `castMemberId?: number | null` (a cast owner's cast member; null/absent for the world and a place).
3. `SessionCharacterV1` (~1126): `ref` widens from `` `character:${number}` `` to `ParticipantRef` (doc: the seat's reference as the host fills it — today `character:<cardId>` ⏳, 🚧 `seated-member:<castMemberId>` once the flip lands; a widget matches on it and never builds it); adds 🚧 `castMemberId?: number | null` (the seat's cast member) and 🚧 `cardId?: number | null` (the member's active card on the timeline; null when card-less). `characterId` gets a ⏳ note: removed in S5 — read `cardId` / `castMemberId`. Fix the interface's "the card owns the art" sentence only if it now contradicts the member-sprites ruling (members carry voice and sprites, own over card) — one clause, else leave it.
4. `AttendeeV1.personaRefs` (~555): `` `character:${number}`[] `` → `ParticipantRef[]`; doc: each seat's `ref` as `characters.v1` carries it.
5. `SessionSceneImageV1.ref` (~1221): → `ParticipantRef | null`.
6. `MessageV1` (~265): add 🚧 `castMemberId?: number | null` beside `characterId`/`personaId` — the speaker's cast member (the member behind `characterId` / `personaId`; the host's `cast_member_id`); a reader resolves the speaker's ref through the cast entry whose `castMemberId` matches, falling back to the card. `ChannelLaneV1.latest` (~2230) gains the same field.
7. `'set-chosen-image'` (~2010): params become a union — `{ memberRef: \`seated-member:${string}\`; mediaRef: string | null } | { characterRef: string; mediaRef: string | null }`. Doc: 🚧 `memberRef` names the member by its cast member (`seated-member:<castMemberId>`, ★S3-8); ⏳ `characterRef` (`character:<id>`) accepted until S5. Do not touch the widget's help text in core-catalog (another lane's).

### `sdk/src/sessionDossier.ts`
8. `ConversationCastV1` (~187): each `sessionPersonas[]` and `sessionCharacters[]` row gains 🚧 `ref?: ParticipantRef` and 🚧 `castMemberId?: number | null` (import `ParticipantRef` type-only from `./participants.js` — check the import style the file already uses).

### Docs only (no type change)
9. `sdk/src/shapes.ts` `spriteChoices` (~419): the shape now names 🚧 `castMemberId` (the speaker's cast member — the identity); the card the art comes from **cascades**: the member's own sprite sets per its configuration, else the card active on the timeline (the dated card at the reading); `characterId` ⏳ (S5) is that card, null when the member's own sets draw. Same sentence, shorter, on `contracts/src/oracles.ts` `pick-sprite`'s `choices` out-port doc (~1539) and its `set` in-port doc ("the cast member's set, then the card's default set" → the cascade).
10. `sdk/src/events.ts` `CastChangePayload` (~1460–1485): the `ref` doc is stale (`persona:<id>` is not a kind). Make it the participant reference of the seat: `character:<id>` ⏳ (a seat by its card, until the flip), 🚧 `seated-member:<id>`, `player-seat:<id>`, `envoy:<slug>`; check `src/lib/server/sockets/sessions.ts` in the app (grep `castChanged`) for what core actually emits and list only those plus `seated-member:`. Both the interface head doc and the field comment.
11. `sdk/src/attributes.ts` ~715 and ~1975: the owner-kind lists add 🚧 `seated_member` beside `session_cast` (mark `session_cast` ⏳).
12. `contracts/src/queries.ts`:
    - `session-state@1` prose (~2875–2900): add one paragraph — 🚧 each `cast.byId` entry carries `ref` (the seat's participant reference, as the host fills it), `castMemberId` (the seat's cast member) and `cardId` (the member's active card on the timeline; null when card-less); a reader looks an entry up by `ref` or `castMemberId`, never by parsing the key (the key is ⏳ the card id until the flip).
    - `lorebook-state`'s `owner` in-port doc (~3040): the translated session kinds add 🚧 `seated_member`.
13. `INTEGRATING.md` (Read by section; most of it is someone else's uncommitted edits — touch only these lines):
    - Step 6 ~360: the inlet's `speaker` participant reference list adds 🚧 `seated-member:<id>` and marks `character:<id>` ⏳.
    - §1c ~881: set-stat-config's `owner` participant reference list adds 🚧 `seated-member:<id>` (`character:<id>` ⏳).
    - §1d "Seating and speaking": one sentence — a seated cast member's reference is 🚧 `seated-member:<castMemberId>` (`character:<cardId>` ⏳ until S5); an envoy has no cast member, so its `castMemberId` is null.
    - §1f ~1050 and ~1056: `MessageOfferedPayload.speaker` list adds 🚧 `seated-member:<id>` (`character:<id>` ⏳); the saved row carries 🚧 `castMemberId` (the speaker's cast member).
    - Keep each edit to the sentence it amends; no new sections.

### Test — new file `sdk-tests/seatedMemberShapes.test.ts`
14. Type fixtures that must compile (the SDK suite runs `tsc --noEmit` first) plus trivial runtime asserts: a `SessionCharacterV1` with `ref: 'seated-member:5'`, `castMemberId: 5`, `cardId: null` (card-less) and one with `ref: 'character:3'` and no new fields (old host); a `SessionStateOwnerV1` with `kind: 'seated_member'`, `ref`, `castMemberId`; an `OwnerRefV1` `seated_member`; an `AttendeeV1` with `personaRefs: ['seated-member:5', 'player-seat:2']`; a `MessageV1` with `castMemberId`; a `ConversationCastV1` with `ref`/`castMemberId`; `set-chosen-image` params both ways (`memberRef` and ⏳ `characterRef`) via the request map type (find how `widgets.ts` exposes the request params type, e.g. a `WidgetRequestParams<'set-chosen-image'>`-style helper; if none, index the map interface). Use `satisfies` where it keeps the fixture honest. Head comment: what is pinned and why. Note: `seated-member:` only parses once w1 lands; your fixtures are types, so they compile against w1's `ParticipantRef` — if w1 has not landed yet when you typecheck, say so and re-run later rather than editing `participants.ts`.

## Files owned (edit only these)
`/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts`, `/home/jody/github/serene-pub-sdk/sdk/src/sessionDossier.ts`, `/home/jody/github/serene-pub-sdk/sdk/src/shapes.ts`, `/home/jody/github/serene-pub-sdk/sdk/src/events.ts`, `/home/jody/github/serene-pub-sdk/sdk/src/attributes.ts`, `/home/jody/github/serene-pub-sdk/contracts/src/queries.ts`, `/home/jody/github/serene-pub-sdk/contracts/src/oracles.ts`, `/home/jody/github/serene-pub-sdk/INTEGRATING.md`, `/home/jody/github/serene-pub-sdk/sdk-tests/seatedMemberShapes.test.ts` (new).

## Files readable
Anything in both repos. w1 edits `sdk/src/participants.ts`, `turnLock.ts`, `turnOrder.ts` and their tests at the same time — never touch those.

## Out of scope
Removing or renaming any old name (S5); core-catalog and Mundi (other lanes); the app; any new exported type name, helper or option; the Scene Portraits help text in `core-catalog/src/registry/widgets.ts`.

## Rules (quoted from CLAUDE.md and NOMENCLATURE)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."
- "Say each assumption when you make it; one that would change the result is a question."
- NOMENCLATURE R1 "One word, one meaning." R3 "Qualify, never abbreviate to the bare noun." R6 "Mark vocabulary that is not permanent … ⏳ Transitional — real today, expires on a known event … 🚧 Provisional — designed but not built, so the words may still move."
- "No @2 bumps before 0.7" — `@1` ids evolve in place; never add an `@2`.
- It is a **session**, never a *chat*.
- Targeted tests only; never pipe a test runner into `head`.

## Stop and ask (in your report, then stop that item) when
A name not listed here seems needed; widening a type breaks a compile in core-catalog or elsewhere (report the error and file:line; do NOT edit core-catalog); anything outside the files owned.

## Done means
From `/home/jody/github/serene-pub-sdk/sdk-tests`:
- `npx tsx --test seatedMemberShapes.test.ts widgetSections.test.ts coreAttendance.test.ts scenePortraits.test.ts coreScenePortraits.test.ts messageRowContract.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S3K-w2-tests.txt 2>&1` — all pass, or each failure shown to fail identically before your change;
- `npx tsc --noEmit -p /home/jody/github/serene-pub-sdk/sdk-tests` clean (it was clean before; covers core-catalog's sources);
- `npx prettier --check` on each `.ts` file you changed (not INTEGRATING.md if it was already unformatted — say so).

## Report
Your final message: changed files with one line each, the exact types you landed (each field as written), tests run with pass/fail counts, assumptions, Noticed-not-done. Start it with `# REPORT s27-S3K-w2`.
