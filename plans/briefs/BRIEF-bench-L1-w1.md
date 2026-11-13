# BRIEF — bench-L1-w1: the bench writer and the seat writers (data half)

Supervisor: lane bench-L1. Design: `plans/PROPOSAL-benched-seats-2026-11-10.md` (RULED 2026-11-10; you need only the parts quoted here). Repo `/home/jody/github/serene-pub`. Another worker (w2) is editing `src/lib/server/sockets/sessions.ts` and a new data-upgrade file at the same time against the contract below — **do not change the contract without saying so in your report.**

## Owner rulings this applies (2026-11-10, verbatim where quoted)

- "Also fold Removed in": **removing a seat becomes benching it.**
- ★2 "Yes, for unused seats": **a soft Remove** stays for a benched seat with **no lines** (it becomes invisible, `removed_at` set). A seat with lines is never removed, only benched.
- A Dungeon Crawler hero's **retire now benches** the old seat instead of unseating it.
- "Benched" is stored seat state: `session_characters.is_active` (exists) plus a **new `session_personas.is_active`**. Core never benches on its own; a person or an opted-in genre function does.
- "Dragging them back into the seat brings them back and treats them normally": a re-seat (revive) sets `is_active = true`.

## Goal

### 1. The column — LAST, after your code is written
In `src/lib/server/db/schema.ts`, table `sessionPersonas` (`:3885`), add exactly:
```ts
		// 🚧 The bench (owner 2026-11-10, benched seats): false = benched — in the session, out of play. Written only by `setSeatBench` (`sessions/seats.ts`) and the seat writer's revive. Mirrors `session_characters.is_active`.
		isActive: boolean("is_active").notNull().default(true),
```
Place it after `position`. Nothing else in schema.ts. **Do NOT run `npm run db:generate`** — the lead coordinates the migration index; the lane stops before it. Until it is generated, every int test touching `session_personas` fails, so **do not run vitest at all** (see Tests).

### 2. `setSeatBench` — the one bench writer (`src/lib/server/sessions/seats.ts`)
Replace `setSeatEnabled` (`:1621-1641`) with exactly this signature (w2 calls it):
```ts
export async function setSeatBench(
	tx: Db,
	input: { sessionId: number; kind: "character" | "player"; seatId: number; benched: boolean }
): Promise<{ ok: true; changes: SeatChange[] } | { ok: false; refusal: string }>
```
- Reads the seat by `id` AND `session_id` on `session_characters` (kind `character`) or `session_personas` (kind `player`): `castMemberId`, card (`character_id` / `persona_id`), `envoy_slug` (character only), `removed_at`, `is_active`.
- Refuses in words (return `{ ok: false, refusal }`, never throw; these strings are ★ copy for the owner — use them exactly, inline, no new exported constant):
  - no such seat in this session → `"That seat is not in this session."`
  - an envoy seat (`envoy_slug` set) → `"An envoy isn't benched: switch it off instead."`
  - a removed seat (`removed_at` set) → `"That seat has left this session. Seat them again to bring them back."`
- Already `is_active === !benched` → `{ ok: true, changes: [] }` and **no write**.
- Else `UPDATE … SET is_active = !benched WHERE id = seatId AND session_id = sessionId AND removed_at IS NULL` — writes `is_active` and nothing else — and returns one change: `{ kind, change: "enabled", value: !benched, seatId, castMemberId, cardId }` (`cardId` = `character_id` | `persona_id`).
- Doc comment: 🚧, "the one writer of the bench on both seat tables (owner 2026-11-10, benched seats)", the refusals, the no-op, the change it returns. Add it to the module header's "What it owns" list.

### 3. `SeatChange` gains the bench (same file, `:154`)
```ts
export interface SeatChange {
	kind: "character" | "player"
	/** "added" / "removed": joined or left the roster. 🚧 "enabled": a live seat benched (`value` false) or brought back (`value` true) — `cast-changed`'s own word. */
	change: "added" | "removed" | "enabled"
	seatId: number
	castMemberId: number | null
	cardId: number | null
	/** 🚧 Only on `"enabled"`: true = in play, false = benched. */
	value?: boolean
}
```
Grep every reader of `SeatChange` / `.change` on these arrays (`sockets/sessions.ts` only collects them; `lorebooks/foldInParent.ts` returns them) and make sure nothing mistakes an `"enabled"` entry for an add or a remove. Do not edit files outside your list; report any reader that would need it.

### 4. `announceSeatChanges` announces the bench (same file, `:1650`)
Keep today's netting for `"added"`/`"removed"` exactly. `"enabled"` entries are netted separately: per ref, the **last** `value` wins; each is emitted **after** the member events as `sessionEvents.castChanged` with payload `{ sessionId, ref, change: "enabled", value, cause: { kind: "settings", userId } }` — the same payload `sockets/sessions.ts` `emitCastChanged` (`:11515`) sends today, through the same `emitSessionEvent` call shape the function already uses. Ref = the same `hostSeatRefOf(c) ?? (player with card → character:<card>)` rule already there. Best-effort, never throws (as now).

### 5. `unseat` becomes "remove means bench; soft Remove only when benched and unused" (same file, `:1581`)
Keep the signature and `SeatChange[]` return. New behaviour:
- seat missing, or already removed → `[]` (as now);
- live and **not benched** → `setSeatBench(tx, { …, benched: true })` and return its changes (removing becomes benching). A refusal from it (envoy) → `throw new Error(refusal)`;
- live, benched, **has lines** → `throw new Error(\`${removedName?.trim() || "This seat"} has lines in this session, so they can be benched but not removed.\`)` (★ copy);
- live, benched, **no lines** → `removed_at = now()`, `removed_name = removedName` (no longer writes `is_active`: it is already false) → the `"removed"` change as today.
- Update its doc comment (it is still 🚧). Callers in `sockets/sessions.ts` (`sessions:update` diffs, `:7067`, `:7196`, `:7298`) are not yours and stay as they are; they now bench on a first removal.

**"Has lines"** — a private (not exported) helper in seats.ts, over `session_messages` of the session (any row, hidden or not):
- character seat: `character_id = <card>` (when the seat has a card) OR, when it has a member, (`persona_id IS NULL AND cast_member_id = <member>`) OR `metadata->>'speaker' = 'seated-member:<member>'`;
- player seat: `persona_id = <card>` (when it has a card) OR `metadata->>'speaker' = 'player-seat:<seatId>'`.
(Source: `messages/store.ts` `speakerSeatOf`, `:160-240`, the one rule for a row's speaker seat; `seatName.ts:376` reads `metadata->>'speaker'`.) Use `exists (… limit 1)` style; one query.

### 6. Revive paths set `is_active = true` (same file)
- `seatPlayer` gains an input `isActive?: boolean` (mirrors `seatCast`'s). Insert values carry it when given (`...(input.isActive !== undefined ? { isActive: input.isActive } : {})`).
- The card-less revive (`:1011-1020`, the `held` update) and the upsert's `onConflictDoUpdate.set` (`:1065`) both write `isActive: input.isActive ?? true` — matching `seatCast` (`:708`) and `seatCardlessMember` (`:848`).
- Changes: today a revive of a removed row reports `"added"`. Also report, when the row was **live and benched** before and is now active, one `{ change: "enabled", value: true, … }` (select `isActive` in `held` and `before`). Nothing else changes in what it reports.
- `seatCast` / `seatCardlessMember`: no change (they already set `isActive ?? true`). If you see they do not report un-benching a live benched row, write it under Noticed, do not fix it.

### 7. Retire and remove (`src/lib/server/sessions/seatName.ts`)
- `writeSeatName` with `retireSeatId` (`:121-161`): replace the `unseat` call with `setSeatBench(t, { sessionId, kind: "player", seatId: old.id, benched: true })`; a refusal → `throw new SeatNameRefusal(refusal)`; push its `changes` into `collected`. Keep the `old.removedAt` refusal and the ownership check. Update the param doc (`retireSeatId`: "it leaves play — benched, its row and its lines' name kept — and the name opens a NEW card-less seat") and the `changes` doc.
- `editCardlessPlayerSeats` remove (`:426-438`): keep calling `unseat` (which now benches first, soft-removes an unused benched seat, and throws on a benched seat with lines); wrap a thrown `Error` into `SeatNameRefusal(message)`. `removed` keeps collecting the ids it acted on; fix its doc ("Returns the ids benched or removed").
- **Do not** change `cardlessPlayerSeatOf`, `isCardlessPlayerSeat`, `isOwnPlayerSeat` or any other reader: readers are lane L2's. (A benched old seat after a retire will still be picked as the speaking seat until L2 lands — say so in your report; don't fix it.)

### 8. Branch copies the bench (`src/lib/server/sessions/branch.ts`, the copy only)
In the player-seat copy (`:266-279`, `seatInput`), add `isActive: sp.isActive ?? true`. Nothing else in branch.ts.

## Files owned (edit only these)
- `src/lib/server/db/schema.ts` — the one column, nothing else
- `src/lib/server/sessions/seats.ts`
- `src/lib/server/sessions/seatName.ts`
- `src/lib/server/sessions/branch.ts` — the copy line only
- Tests (write/update; see below): `src/lib/server/sessions/seats.int.test.ts`, `src/lib/server/sessions/seatName.mint.int.test.ts`, `src/lib/server/pipelines/routines/seatChangesOfTurn.int.test.ts` (it imports `setSeatEnabled`: move it to `setSeatBench`, update only), `src/lib/server/utils/envoyRoad.int.test.ts` (`:1122` uses `unseat` expecting a departed seat: bench then soft-remove, update only), one branch test — add to `src/lib/server/sessions/branch.cardlessSeats.int.test.ts` (a benched player seat comes across benched; an active one active).

## Files readable
Anything. Useful: `src/lib/server/messages/store.ts:120-300`, `src/lib/server/sockets/sessions.ts:11500-11680` (today's toggle and `emitCastChanged`), `src/lib/server/pipelines/prompt/seatCards.ts:340` (`hostSeatRefOf`).

## Tests to write (do not run them — the migration is not generated yet)
In `seats.int.test.ts` (follow its helpers: `user`, `card`, `book`, `member`, `session`, `inTx`, `seatsOf`):
- `setSeatBench`: benches and brings back a character seat and a player seat (row `isActive` and the returned `"enabled"` change with `value`); a repeat is a no-op (`changes: []`, no write); refuses an envoy seat, a removed seat, a seat of another session, each with its sentence.
- `unseat`: a live seat is benched (not removed); a benched seat with no lines is removed (`removedAt` set, `removedName` kept, `"removed"` change); a benched seat with a line (insert a `session_messages` row as `seatMembers.int.test.ts:328` does) throws the "has lines" sentence and stays benched — for a carded character seat, a card-less character seat (`seated-member:` speaker or `cast_member_id`), and a card-less player seat (`player-seat:<id>` speaker). Rewrite the existing "unseat: one removed change, then none" test (`:1208`) to the new behaviour.
- Revive: `seatPlayer` on a removed carded row and on a removed card-less row (by `castMemberId`) comes back `isActive: true`; on a live benched row it comes back active with one `"enabled"` change.
- `announceSeatChanges`: an `"enabled"` change emits one `cast-changed` `{ change: "enabled", value }` (there is an existing announce test in this file to follow).
In `seatName.mint.int.test.ts`: the retire test (`:91`) now expects the old seat **benched** (`isActive: false`, `removedAt: null`).

## Out of scope (write down, never build)
Readers (turns, prompt, lore gate, `resolve.ts`, SDK `enabled`, Crawler `liveSeats`, `cardlessPlayerSeatOf`) — lane L2. The port `set-seat-bench@1` — L3. UI — L4. Docs and NOMENCLATURE — L5. The data upgrade and every `sockets/sessions.ts` change — w2. The "departed"→"removed" rename.

## Stop and ask when
- CLAUDE.md §Decisions applies (anything a user sees beyond the ★ copy above, a new name beyond `setSeatBench` and the `SeatChange` additions above, a new setting, file outside your list).
- The contract in §2–§5 can't be built as written — report why rather than changing it.

## Rules (quoted by the supervisor; they bind you)
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "`$state(new Set())` … use `SvelteSet`" (n/a here). "It is a **session**, never a *chat*."
- seats.ts header: "⚠ **No static import of `$lib/server/db`**, here or through anything this module imports: every function takes its handle first."
- "Migrations are **generated** (`db:generate`)." You do not generate.
- NOMENCLATURE R3: "qualify, never the bare noun" — say **character seat** / **player seat**, never a bare "seat" in a type name. "benched" / "bench" are the existing user and SDK words; "removed" is a seat with `removed_at`.
- Comments: plain, short sentences; mark new vocabulary 🚧 as the file already does.
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. **Never run `prettier --write` on a file.** Never `git checkout`, `restore` or `clean`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to build the SDK at all.)
- Never pipe vitest into `head`. Scratch files start with `bench-L1-`, in `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/`.

## Checks you run
- After the column is in: one typecheck, capped: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "sessions/(seats|seatName|branch)|db/schema|seatChangesOfTurn|envoyRoad|seats.int|seatName.mint|branch.cardless" ; echo tsc-done'` — clean for your files. (Errors in `sockets/sessions.ts` are w2's while it works; list any you see that come from your contract.)
- `npx prettier --check` on each file you edited.
- No vitest.

## Report
Reply (final message) with: files changed, the exact `setSeatBench` and `SeatChange` as built, each test added/updated (not run), tsc result, every place you deviated from this brief and why, and **Noticed, not done**.
