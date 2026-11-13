# BRIEF s27-S2core-w2 — `seatOf` in `sessions/seats.ts`, and the S1 scope-review fixes F1–F5

Supervisor: lane s27-S2core (seat-cast programme, stage S2, plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §27; S1's report `plans/REPORT-s27-S1-2026-11-05.md`). App `/home/jody/github/serene-pub`. You are a Sonnet `lane-worker`. Report = your final message: changed files, exported names + signatures, tests run with results, choices made, anything you could not do.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Read `src/lib/server/sessions/seats.ts` (701 lines) whole first, and `src/lib/server/sessions/seatMembers.ts`.

## 1. `seatOf` (new, additive, in `src/lib/server/sessions/seats.ts`)
```ts
/** 🚧 A session participant ref resolved to its seat (S2's compatibility read; S5 removes the card form). */
export interface ResolvedSeat {
  kind: "character" | "player"
  seatId: number            // session_characters.id | session_personas.id
  castMemberId: number | null
  cardId: number | null     // character_id | persona_id (null: a card-less player seat)
  departed: boolean         // removed_at set
}
/** 🚧 Pure: `character:<n>` · `seated-member:<n>` · `player-seat:<n>` → { form, id }; anything else → null. */
export function parseSeatRef(ref: string): { form: "character" | "seated-member" | "player-seat"; id: number } | null
export async function seatOf(tx: Db, sessionId: number, ref: string): Promise<ResolvedSeat | null>
```
- Parse locally (the SDK's `parseParticipantRef` does not know `seated-member:` yet — S3 adds it; do NOT edit the SDK). Ids are positive integers (`/^\d+$/`, `Number.isSafeInteger`, > 0); trim the ref.
- `character:<cardId>` — a card. A player seat with a card is that card (NOMENCLATURE: "a player seat with a card is that card, `character:<id>`"), so: the session's character seat whose `character_id` = cardId, else its player seat whose `persona_id` = cardId (character seats first: the precedent in `state/resolve.ts` `sessionLinks`, which takes character seats before personas).
- `seated-member:<memberId>` (🚧, ruled ★27-2) — the session's character seat whose `cast_member_id` = memberId, else its player seat whose `cast_member_id` = memberId.
- `player-seat:<seatId>` — `session_personas.id` = seatId **and** `session_id` = sessionId.
- In each form: live seats (`removed_at IS NULL`) before departed; among several, lowest `position` then lowest `id` (two live seats can share a member until the boot pass settles them). Envoy seats (`envoy_slug`) are never returned. Always scoped to `sessionId`. Null when nothing matches.
- Update the module's header charter ("What it does not own: Readers of `cast_member_id` (S2)") to say it owns this one compatibility read too.

## 2. S1 fixes (from the S1 scope review; owner ruling ★S1-1, 2026-11-05: "a second card of a person already seated is refused in words", never merged silently — P1 "Deterministic, never hidden")
**F1 (MEDIUM) — no silent merge on live paths.** `settleSeats` step 3 (the merge) runs from `runLorebookBindingCheck` (`sockets/sessions.ts`, fired on attach from `sockets/summarize.ts` and on a lorebook overwrite from `sockets/lorebooks.ts` `seatReadingSessions`), so a character silently departs. Fix: `settleSeats(tx, sessionId, opts?: { merge?: boolean })` — **default fill-only** (steps 1–2 only; `merged` stays []); step 3 only with `{ merge: true }`, passed ONLY by the boot pass `seatMembers.ts`. Live paths then leave two live seats on one member seated (the boot pass and S4 handle the pair) — nobody departs outside the boot pass. Because the default flips, the other callers (`sockets/sessions.ts`, `sockets/import.ts`, `sessions/branch.ts`) need no argument change; update their comments that claim a merge happens (e.g. `sockets/sessions.ts` ~1382 "backstop", `branch.ts` ~172) and `seats.ts`'s header "## The merge rule" (import/branch now seat with `"allow"` and are settled fill-only; only the boot pass merges). Tests: existing tests that expect a merge from a live path move to `{ merge: true }` or to asserting both stay seated; add **"attach and overwrite never depart a seat"**: a session with two live character seats whose cards resolve to one member, then `runLorebookBindingCheck(...)` (exported from `sockets/sessions.ts`; a stub socket + `emitToUser` as other `sockets/*.int.test.ts` do) → both seats live, `merged_into` null.
**F2 (MEDIUM) — revive clears `merged_into`.** `seatCast`'s `onConflictDoUpdate` revive set (~366–380) gains `mergedInto: null`. Test: merge two seats with `settleSeats(..., { merge: true })`, then `seatCast` the departed seat's card with `secondCard: "allow"` → live and `mergedInto` null. Any code comment stating the S4 merge-pair query gets `AND d.removed_at IS NOT NULL` (the supervisor fixes the report file).
**F3 (LOW) — wording.** There is always a lorebook (owner 2026-11-05: "All sessions have a lorebook, [own book] or overlay"). Replace "bookless session" / "the session reads none" / "a card in a bookless session" in `seats.ts` (~180, ~184) and `seatMembers.ts` (~24, ~56) with "a session whose lorebook is its own book". Correct the `runLorebookBindingCheck` header comment (`sockets/sessions.ts` ~5608–5616): settling fills each live seat's member — made only in an attached book the session's owner owns and that is not provided; S1 makes nothing in the own book (★S1-3) — and **never departs a seat** (fill-only; the boot pass alone merges).
**F4 (LOW) — lock order.** `resolveSeatMember` takes `pg_advisory_xact_lock(lorebookId)` then calls `syncLorebookBindingsForCharacter` (which opens its own transaction and takes a per-character advisory lock) in the same transaction — `utils/characterBindingSync.ts` ~72–86 says it "MUST NOT be called from inside another already-open advisory-locked transaction", and `findOrInsertBinding`'s doc (~270–274) says the caller "syncs a new row's name and aliases from the card after the commit … as `resolveOrCreateBindingRow` does" (~239–249). Fix:
  - remove the in-transaction sync; `resolveSeatMember` returns `mintedIn: number | null` (the lorebook id it minted into);
  - new 🚧 `export interface MintedSeatMember { cardId: number; lorebookId: number }` and 🚧 `export async function syncMintedSeatMembers(db: Db, minted: readonly MintedSeatMember[]): Promise<void>` — de-duplicates, calls `syncLorebookBindingsForCharacter(cardId, db, { lorebookId })` for each, OUTSIDE any transaction; a failure is logged (`console.error`, naming card and book) and the loop goes on (the seat is committed; the name catches up on the card's next sync) — say so in its doc;
  - `seatCast`'s ok result, `seatPlayer`'s result and `SettleReport` each gain `mintedMembers: MintedSeatMember[]` (keep `minted` as is);
  - every caller that can mint collects them and calls `syncMintedSeatMembers(db, …)` **after its transaction commits**: `sockets/sessions.ts` (create ~1388–1420, `runLorebookBindingCheck` ~5653, update ~6493/6599/6616, ~6905/6909, reassign ~7544/7620), `sockets/import.ts` (~1347–1361, ~1499–1512), `sessions/branch.ts` (~175, ~207, ~407 — return them out of its transaction), `sessions/seatMembers.ts` (after each session's transaction). Envoy seats never mint (`pipelines/entities/envoys.ts`, `sessionGenres.ts` — leave them). Where a site already relists on `minted`, keep that.
  - Test: a seat that mints into the attached book leaves the member's name empty inside the transaction and `syncMintedSeatMembers` fills it from the card after; existing tests that read a minted member's name right after `seatCast` must now call `syncMintedSeatMembers` first.
**F5 (LOW)** `src/lib/server/db/schema.ts` owner-kind comment table (~9717–9726): add after the `player_seat` row: `// | \`seated_member\` 🚧 | \`lorebook_bindings.id\` — the seated cast member (CHECK only until S4) | the session |`. Comment only — no schema change, no migration.

## Files owned (only these; minimal additive hunks in the shared ones — re-read each region immediately before editing, other lanes are live in these files; never reformat a file dirty at HEAD, so no `prettier --write` on the shared files)
`src/lib/server/sessions/seats.ts`, `src/lib/server/sessions/seatMembers.ts`, `src/lib/server/sessions/seats.int.test.ts`, `src/lib/server/sessions/seatMembers.int.test.ts`, `src/lib/server/sessions/seatSites.int.test.ts`, `src/lib/server/sockets/sessions.seatCast.int.test.ts`, a new `src/lib/server/sessions/seatOf.test.ts` (pure) and `src/lib/server/sessions/seatOf.int.test.ts`; and ONLY the hunks named above in `src/lib/server/sockets/sessions.ts`, `src/lib/server/sockets/import.ts`, `src/lib/server/sessions/branch.ts` (lane pl4 is live near `copyOwnBookToBranch` — touch only the seat lines), `src/lib/server/db/schema.ts` (the comment row). Not `state/**`, `sessions/rewind.ts`, `lorebooks/ownBook.ts`, `NOMENCLATURE.md`, the SDK.

## Tests (Done means)
- `seatOf.test.ts` (unit: `parseSeatRef` forms, junk, zero, negative, spaces); `seatOf.int.test.ts`: each ref form; a card that is both a character seat and a player seat → the character seat; live before departed; a player-seat ref from ANOTHER session → null; **overlapping id ranges** (pick ids so a card id equals some member id and some seat id, and show `character:N`, `seated-member:N`, `player-seat:N` each find the right, different seat); envoy never returned.
- F1/F2/F4 tests as above.
- Keep green: `src/lib/server/sessions/seats.int.test.ts`, `seatMembers.int.test.ts`, `seatSites.int.test.ts`, `src/lib/server/sockets/sessions.seatCast.int.test.ts`, `src/lib/server/sockets/sessions.castBindings*.int.test.ts`, `src/lib/server/sockets/sessions.castFromLorebook*.int.test.ts` (find the exact names with `ls src/lib/server/sockets | grep -i cast`), and the import/branch int tests that call the writer (`grep -rl "settleSeats\|seatCast" src --include=*.int.test.ts`). Run each with `npx vitest run <files>` (never pipe into `head`); `npx tsc --noEmit -p .` and report only errors in your files.

## Rules (quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test."
- `seats.ts` must keep **no static import of `$lib/server/db`** (its header says why); `syncMintedSeatMembers` takes `db`.
- "Migrations are generated" — none here; F5 is a comment.
- "Never write "no book"/"no lorebook"" — every session has a lorebook: its own book or an overlay.
- CLAUDE.md Decisions: do what was asked at the size asked; findings go under "Noticed, not done", never fixed in passing. No new names beyond `ResolvedSeat`, `parseSeatRef`, `seatOf`, `MintedSeatMember`, `syncMintedSeatMembers`, `mintedMembers`, `mintedIn`, the `merge` option — ask (in your report) if you need another.
- 60 s int timeouts; `mkdtemp` prefix `serene-pub-vitest-<yourfile>-`, released with `releaseDataDir`.
