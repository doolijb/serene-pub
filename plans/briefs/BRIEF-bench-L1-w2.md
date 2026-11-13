# BRIEF — bench-L1-w2: the socket doors and the data upgrade (data half)

Supervisor: lane bench-L1. Design: `plans/PROPOSAL-benched-seats-2026-11-10.md` (RULED 2026-11-10; you need only the parts quoted here). Repo `/home/jody/github/serene-pub`. Worker w1 is building, at the same time, the seat-writer half in `src/lib/server/sessions/seats.ts` / `seatName.ts` / `branch.ts` and the schema column. **Build against the contract below; never edit w1's files.**

## Owner rulings this applies (2026-11-10)

- "Also fold Removed in": removing a seat becomes benching it, and **existing removed rows become benched** — narrowed by the binding challenge answers: "The upgrade now skips removed rows with no lines (★2) and any row whose member a live seat holds (K-4), and adds a second-boot test."
- ★3 "Yes, bench them": **removing a guest benches their player seats.**
- Reassign: "Reassign… becomes a ⋯ item on benched carded rows" — the door accepts a benched seat as well as a removed one.
- Core never benches on its own; a person does (these doors), or an opted-in genre function (lane L3).

## The contract w1 is building (`src/lib/server/sessions/seats.ts`)
```ts
// A new column: session_personas.is_active boolean NOT NULL DEFAULT true  (schema: sessionPersonas.isActive)
export interface SeatChange {
	kind: "character" | "player"
	change: "added" | "removed" | "enabled"   // "enabled": a live seat benched (value false) or brought back (value true)
	seatId: number
	castMemberId: number | null
	cardId: number | null
	value?: boolean                           // only on "enabled"
}
export async function setSeatBench(
	tx: Db,
	input: { sessionId: number; kind: "character" | "player"; seatId: number; benched: boolean }
): Promise<{ ok: true; changes: SeatChange[] } | { ok: false; refusal: string }>
// - refuses (in words, as { ok:false, refusal }) a seat not in the session, an envoy seat, a removed seat;
// - already so → { ok: true, changes: [] }, no write;
// - else writes only is_active and returns one { change: "enabled", value: !benched, ... }.
// announceSeatChanges(db, io, { sessionId, userId }, changes) now also emits `cast-changed`
//   { change: "enabled", value, cause: { kind: "settings", userId } } for each "enabled" entry
//   (after the member events) — the same payload `emitCastChanged` sends today.
// setSeatEnabled is GONE.
```
Until w1 lands, `tsc` on `sockets/sessions.ts` may show errors about these — that's expected while you type; re-check at the end.

## Goal

### 1. `src/lib/server/sockets/sessions.ts` — three handlers only
Check `git diff src/lib/server/sockets/sessions.ts` first: other sessions edit this file. Touch nothing outside the import line and these three handlers (plus deleting `emitCastChanged` if it becomes unused).

**a. `sessions:setCastSeatEnabled`** (`sessionsSetCastSeatEnabledHandler`, `:11550-11685`). Keep its params, access checks, seat lookup and every answer shape. Replace the `setSeatEnabled` call with
`const result = await db.transaction(async (tx) => setSeatBench(tx as unknown as Db, { sessionId: params.sessionId, kind: "character", seatId: seat.id, benched: !params.enabled }))`.
`!result.ok` → `return refuse(result.refusal, !!seat.isActive)`. `result.changes.length === 0` → answer only (as today's `!changed`). Otherwise: answer, `resendSession(...)`, then `announceSeatChanges(db, socket.io, { sessionId: params.sessionId, userId }, result.changes)` **instead of** `emitCastChanged` (which then has no caller: delete it). Update the import list (`setSeatEnabled` → `setSeatBench`). Do **not** widen the params with `playerSeatId` — that needs `src/lib/shared/sockets/types.ts`, which isn't ours; it's queued for the lead.

**b. `sessions:removeGuest`** (`sessionsRemoveGuestHandler`, `:7788-7885`). Put the guest-row delete and the benches in one `db.transaction(async (tx) => …)` (use only `tx` inside). When the delete removed a row, find that guest's **live player seats** in this session — `session_personas` with `session_id = sessionId`, `removed_at IS NULL`, and `user_id = guestUserId` OR (`user_id IS NULL` AND the seat's card `persona_id` is owned by `guestUserId`, i.e. `characters.user_id`) — and call `setSeatBench(tx, { sessionId, kind: "player", seatId, benched: true })` for each; collect `changes` (a refusal can't happen for a live non-envoy seat; if one does, throw its sentence so the transaction rolls back). After it commits, `announceSeatChanges(db, socket.io, { sessionId, userId }, changes)` **before** `broadcastSessionToParticipants`. Everything else in the handler stays.

**c. `sessions:reassignRemovedParticipant`** (`sessionsReassignRemovedParticipantHandler`, `:8130-8395`). Accept a **benched** seat as well as a removed one:
- character: the `removedCC` lookup's `isNotNull(cc.removedAt)` becomes `or(isNotNull(cc.removedAt), eq(cc.isActive, false))`;
- player: the `removedCP` lookup likewise with `cp.isActive` (the new column).
- When the old row was **live** (benched, `removedAt` null), deleting it takes a member off the roster: push `{ kind, change: "removed", seatId: <old row id>, castMemberId: <old row's castMemberId>, cardId: oldId }` onto `reassignedChanges` after the transaction, so `announceSeatChanges` says it. Nothing else changes (error strings stay as they are — copy is lane L4/L5's).
- Doc comment: "a removed or benched (soft-deleted or benched) participant".

### 2. The data upgrade — **temporary file name** `src/lib/server/db/dataUpgrades/benchedSeats.ts` (+ `benchedSeats.int.test.ts`)
The migration that adds `session_personas.is_active` is **not generated yet**; the continuation will rename both files to `<generated tag>.ts` and add the `index.ts` entry. **Do not edit `dataUpgrades/index.ts`.** Pattern: `dataUpgrades/0149_familiar_silk_fever.ts` — `export async function run(tx: MigrationTx): Promise<void>`, raw SQL through `tx.execute(sql\`…\`)` and `rawRows` (`../rawRows`) only, no schema-typed tables, no app imports, no ids written down, one `console.log("[upgrade benched-seats] …")` line with counts when it did anything.

Header comment (plain): what it does, the skips, why (owner 2026-11-10 "fold Removed in"; challenge answers 2–3), "a second run changes nothing".

Behaviour — each **removed** row (`removed_at IS NOT NULL`) of `session_characters` and `session_personas` becomes **benched**: `is_active = false`, `removed_at = NULL`, `removed_name` kept as it is. **Skip** (the row stays removed):
1. `merged_into IS NOT NULL` (character rows; merge victims);
2. envoys (`envoy_slug IS NOT NULL`);
3. character rows with neither a card nor a member (`character_id IS NULL AND cast_member_id IS NULL`);
4. **rows with no lines**, by the one "has lines" rule (same as w1's private helper), over `session_messages` of the row's session:
   - character row: `character_id = <row card>` (card set) OR, member set, (`persona_id IS NULL AND cast_member_id = <row member>`) OR `metadata->>'speaker' = 'seated-member:' || <row member>`;
   - player row: `persona_id = <row card>` (card set) OR `metadata->>'speaker' = 'player-seat:' || <row id>`;
5. **any row, carded or not, whose resolved member a live seat of the session already holds** — "live seat" = a row of **either** table with `removed_at IS NULL` (character rows: not envoys) and that member in `cast_member_id`. **Resolved member** = the row's `cast_member_id`; else, for a carded row, the card's member as `resolveSeatMember` finds it without minting — linked (`lorebook_bindings.character_id = card`) or drawn by a dated card (`character_versions cv join character_versions pv on pv.id = cv.parent_version_id where pv.card_id = card and cv.cast_member_id is not null`), in the session's attached book (`sessions.lorebook_id`) first, else its own book (`lorebooks.session_id = s.id`). See `src/lib/server/sessions/seatMembers.ts:60-110` (`knows`, `ATTACHED`, `OWN`) for the same predicates in SQL. A row with no resolved member is not skipped by this rule.
   Converting is sequential: within a session, character rows first, then player rows, each newest `id` first; a row converted adds its resolved member to the session's held set, so a second removed row resolving to the same member is skipped. Do the selection in SQL, the loop in TS, each conversion an `UPDATE … WHERE id = <selected id>`.
Never delete a row. Never touch a live row.

## Tests to write (do not run them — the migration is not generated yet)
**`benchedSeats.int.test.ts`** on the real schema: follow `src/lib/server/sessions/seatMembers.int.test.ts` (its `vi.mock("$lib/server/db", … createTestDb …)`, `serene-pub-vitest-…` data dir, `releaseDataDir`, helpers, and how it inserts `session_messages` rows, `:328`). Write rows directly with drizzle (removed rows with `removedAt` set), then `await db.transaction(async (tx) => run(tx))`. `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`. Cases, each its own `test`:
- converts: a removed carded character row with a line; a removed card-less character row (member, no card) with a line; a removed carded player row with a line; a removed card-less player seat with a `player-seat:<id>` line — each ends `isActive: false`, `removedAt: null`, `removedName` unchanged;
- skips: a merge victim; an envoy; a character row with neither card nor member; a removed row with no lines (character and player); a row whose member a live character seat holds; a carded row whose card's linked member a live seat holds (row `cast_member_id` null); two removed rows resolving to one member → only the newer converts; a live row is untouched;
- **second boot**: a session holding several of the above; run the upgrade, then `seatMembers(db)` (`src/lib/server/sessions/seatMembers.ts`) twice; the first pass reports `merged: 0`; a snapshot of both seat tables (all columns, ordered by id) after the second pass equals the one after the first; running the upgrade again changes nothing and logs nothing.

**Socket tests** (update only where the ruling changes the expectation; list each change in your report): grep `src/lib/server/sockets/*.int.test.ts` for `setCastSeatEnabled`, `removeGuest`, `reassignRemovedParticipant`, `playerSeatChanges`, and removals through `sessions:update` (`characterIds` / `personaIds` / `castMemberIds` dropping a seat). Known: `sessions.participantRemoval.int.test.ts`, `sessions.seatEvents.int.test.ts` (`:280` — a card-less player seat's `remove: true` now benches: a `cast-changed` enabled false, no member-removed; a second remove of the unused benched seat → `member-removed`), `sessions.seatCast.int.test.ts`, `sessions.seatMemberEdits.int.test.ts`, `sessions.participantWritesAnswer.int.test.ts`, `sessions.characterOwnershipToggleVisibility.int.test.ts`, `sessions.dungeonCrawler.int.test.ts`. The new `unseat` rule (w1): a removal of a **live, not benched** seat **benches** it; a removal of a **benched seat with no lines** removes it (`removed_at`); a removal of a **benched seat with lines** is refused with "‹name› has lines in this session, so they can be benched but not removed." Add new tests (in the closest existing file, or a new `src/lib/server/sockets/sessions.benchedSeats.int.test.ts`):
- `setCastSeatEnabled` benches and brings back through `setSeatBench` (row + one `cast-changed` enabled), a repeat answers without a write;
- `removeGuest` benches the guest's live player seats (card-less and carded), leaves the owner's and another guest's alone, and announces each;
- Reassign on a **benched** carded character seat and a benched player seat: history re-pointed, old row gone, new seat live, a `member-removed` for the old one.

## Files owned (edit only these)
- `src/lib/server/sockets/sessions.ts` — the import line, the three handlers above, and the `emitCastChanged` deletion only
- `src/lib/server/db/dataUpgrades/benchedSeats.ts`, `src/lib/server/db/dataUpgrades/benchedSeats.int.test.ts` (new)
- the socket test files named above (update only), and the new `sessions.benchedSeats.int.test.ts`

## Out of scope (write down, never build)
Readers (turns, prompt, lore gate, SDK `enabled`, Crawler `liveSeats`) — L2. The port — L3. UI and `shared/sockets/types.ts` — L4/lead. Docs, NOMENCLATURE — L5. `sessions:update`, `sessions:addPersona` (it refuses a benched persona's re-add as "already in the session" — Noticed only), any other handler. `dataUpgrades/index.ts`.

## Stop and ask when
CLAUDE.md §Decisions applies (anything a user sees, a new name, setting, file outside your list); the upgrade would delete data or seat two live rows on one member; the contract above can't be built as written.

## Rules (quoted by the supervisor; they bind you)
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test." "Migrations are **generated** (`db:generate`)." (You generate nothing.) "Never seed a row at a hardcoded id."
- Standing ruling: "**0.6 is in users' hands.** A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- Standing ruling, sockets: "one domain context per event family … is the only listener, and the only place that toasts" (server side: emit through the existing helpers; never toast). "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`…) in the payload, or `emitToUser` silently sends nothing."
- `dataUpgrades/index.ts`: "an upgrade runs against the schema as it existed at its anchor migration … it must not import app modules whose queries drift with the schema. Raw SQL through `tx` ages far better."
- It is a **session**, never a *chat*. NOMENCLATURE R3: say **character seat** / **player seat**.
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. **Never run `prettier --write` on a file.** Never `git checkout`, `restore` or `clean`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to build the SDK.)
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Scratch files start with `bench-L1-`, in `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/`.

## Checks you run
- No vitest (the column has no migration yet).
- At the end, once `grep -n "export async function setSeatBench" src/lib/server/sessions/seats.ts` finds it: one capped typecheck — `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "sockets/sessions\.ts|dataUpgrades/benchedSeats|sockets/sessions\..*int\.test" ; echo tsc-done'` — clean for your files. If w1 hasn't landed after you finish, report that instead of waiting long.
- `npx prettier --check` on each file you edited.

## Report
Reply (final message) with: files changed, each handler change, the upgrade's SQL summary, each test added/updated (not run) and why, tsc result, deviations from this brief and why, and **Noticed, not done**.
