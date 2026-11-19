# BRIEF — worker `el-1b-w3` — HM2: a card-less seat's sheet follows who made its cast member; the creator written on three more paths

App repo `/home/jody/github/serene-pub`. SDK repo is read-only. Supervisor: lane `el-1b`. Report: your final message
(under ~600 words) — changed files with lines, the matrix as built (which rows changed), tests run with results, every
new sentence you wrote, Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all.)

## Rules you work under (quoted from CLAUDE.md and the lane brief)

- The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
  prettier with `--write` and never pipe its output into a file. **No migration, no schema change**: the column exists
  (`lorebook_bindings.created_by`, TS `createdBy`, nullable user reference, on delete set null, migration 0169). No
  `db:generate`, no SDK edit, no `npm run build`.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Comments state the rule, never history. Run `src/lib/shared/conformance/commentHistory.test.ts` before you finish.
- Tests only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/el-1b-w3-<n>.log 2>&1"`
  (always at least one path), one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
  (other lanes share vitest; waits can be long). Never pipe vitest into `head`. An int test that opens a DB inside an
  `it` needs a 60 s timeout. `NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` (once, at the end;
  report only errors in your files).
- Another worker (`el-1b-w1`) edits `state/write.ts`, `characters/versions.ts`, `rulesets/ties.ts`,
  `pipelines/runtime/host.ts`, `pipelines/runtime/castMember.ts`, `sockets/lorebooks.ts`, `shared/lorebooks/runLocks.ts`
  at the same time: never edit those. No docs, no `NOMENCLATURE.md` (the supervisor does those). Re-read any file right
  before each edit.
- **`src/lib/server/sockets/sessions.update.ts` belongs to the live lane `gs-3a3b-1`.** You may change exactly **one
  call** there (step 3). Re-read the file right before the edit; if the code around that call is being rewritten (it no
  longer matches what step 3 describes, or the file changes under you), do not edit it: say so in your report. Never
  edit `sessions/seatKeys.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`, `messages/permissions.ts`,
  `sessionPageProjections.ts`.
- **Statements must not rise**: read `created_by` with the rows the judge already loads (a `leftJoin` on an existing
  select adds no statement). No new query in `handEditJudge`.

## The rule (owner HM2, 2026-11-17: "A seat the guest made is theirs; a cast member they took or were handed stays the owner's"; it refines honour mode 2026-11-05 "cards the player owns + their card-less seat")

`seatSheetHolder` (`src/lib/server/state/handEdits.ts` ~103–119, lane gs-3a3a's one function; HM1 already there: a seat
holding the session owner's card is the card owner's) gains the card-less half. For a **card-less seat** (a player seat
with no card, or a character seat with no card — its person is the player, or the seater):
- its cast member's `createdBy` **is** the seat's person → the person holds the sheet (a seat they named, their
  shared-card copy);
- `createdBy` is **someone else** → the **session's owner** holds it (a member of the lorebook or the notes the person
  took or was handed, a seat the owner named for them);
- `createdBy` is **null** (or the seat has no member) → **today's rule: the person** (existing sessions do not change).
Carded seats keep HM1 exactly. Keep `seatSheetHolder` pure and the one place the rule lives: add one optional input
(e.g. `memberCreatorId?: number | null`, given only for a card-less seat) and update its doc comment to state HM2.

## What to build

1. **`state/handEdits.ts`**: read the seat member's `createdBy` with the rows already loaded — the `seatRows` select of
   `sessionPersonas` (leftJoin `lorebookBindings` on `castMemberId`) for card-less player seats, and the
   `sessionCharacters` select that fills `seaterOfMember` (same leftJoin) for card-less character seats. Pass it to
   `seatSheetHolder` through `holderOf` at the card-less places: the player-seat branch of `whose`, the
   `role === "player"` branch (`played` seat; the card-less `seated_member` line that today returns
   `mine(seaterOfMember…)`), and the owner's branch. The owner's view (`userId` null) holds what the rule moved to the
   session's owner, as `holds(holder, hm1)` already does for HM1. `assertSeatDecider` (`state/write.ts`) follows through
   `judge.whose`; do not edit it.
2. **The refusal words** for a guest on such a seat (today they would get "only ‹Seat›'s player or the session's owner
   can change their sheet.", which is wrong when they are the player): in `notTheirs`, beside the HM1 case, return
   🚧 `‹Name› is not a seat you made, so only the session's owner changes its sheet.` (name = the seat's name, else
   "That seat"). Mark it `// 🚧 Provisional copy: the owner has not seen this sentence.`
3. **The creator on the paths el-1a left** (the member's maker = the person doing it; null when no person acts):
   - `sockets/sessions.update.ts` ~1366 (an owner seating a guest by name through `playerSeatsFor`):
     `seatNamed(t, sessionId, e.toUserId, e.seatName!, position++, changes)` → pass the acting owner (`userId`) as the
     last argument (`createdBy`), so that seat's sheet is the owner's under HM2 ("a cast member they … were handed").
   - `sessions/creationModes.ts` ~152 (`seedNextChapter`, the owner's own named seat carried into the next chapter):
     pass `createdBy: userId` to `writeSeatName` (a member minted for the person's own named seat).
   - `lorebooks/starterKits.ts` ~855 (a starter kit's cast copied into a book): **leave null** (a copied starter
     member was not made by anyone at the table). Do not edit the file.
   - `lorebooks/tableRegistry.ts` ~506 (Duplicate / fold / starter copies through `insertCastMemberCopy`, which spreads
     the original row and so keeps its maker): set `createdBy: null` on the copy. Then run
     `src/lib/server/sockets/lorebooks.duplicate.int.test.ts` ("the copy equals the original modulo ids"; lane el-1a
     reverted a copier-id change because this test failed). If exactness fails only because a seeded member has a
     creator, prefer leaving the test's seed null; if it fails because exactness genuinely forbids it, revert and report.
4. **Tests** — `src/lib/server/state/handEdits.cardOwner.int.test.ts`: extend `cell` so a card-less seat (player seat
   and character seat) has a cast member with a chosen `createdBy` (guest · owner · null; a card-less player seat gets a
   member via `insertCastMember` and `sessionPersonas.castMemberId`), and the MATRIX gains the card-less rows ×
   creator × person, each under both levels the test already loops (`as-ruled`, `no-edits`). Expected: creator guest or
   null → today's answers; creator owner with a guest person → owner sees `own`, guest sees `other` (both seat kinds;
   mark them as HM2 rows); person owner rows unchanged. Add: the new sentence reaches the guest on both seat kinds; a
   model proposal for such a seat waits for the session owner (guest's Accept refused, owner's accepted), as the HM1
   proposal test does; `seatSheetHolder` unit cases for the creator input. Update the file's header comment to the
   rule. Also test that a guest naming their own seat (`writeSeatName` with `createdBy`, or the socket) and an owner
   seating a guest by name (`playerSeatsFor` with `seatName`) store the expected `createdBy` — beside the existing
   `src/lib/server/cast/createdBy.int.test.ts` if it fits.
   Also run: `src/lib/server/cast/createdBy.int.test.ts`, `src/lib/server/sockets/lorebooks.duplicate.int.test.ts`,
   `src/lib/server/lorebooks/tableRegistry.copyInto.int.test.ts`, the existing `src/lib/server/state/handEdits*.test.ts`
   files, any `sessions.ownerCardForGuest*.int.test.ts` / `creationModes*.test.ts` / next-chapter test that exists,
   and `src/lib/shared/conformance/commentHistory.test.ts`.

## Stop and ask (in your report, then stop) when

A new query would be needed in the judge; a carded row of the matrix would change; a file outside this list would need
editing; `sessions.update.ts` is mid-rewrite.

Files owned: `src/lib/server/state/handEdits.ts`, `src/lib/server/state/handEdits.cardOwner.int.test.ts`,
`src/lib/server/sessions/creationModes.ts` (that one argument), `src/lib/server/sockets/sessions.update.ts` (that one
call), `src/lib/server/lorebooks/tableRegistry.ts` (that one field), `src/lib/server/cast/createdBy.int.test.ts`,
`src/lib/server/sockets/lorebooks.duplicate.int.test.ts` (only if step 3 needs it).
