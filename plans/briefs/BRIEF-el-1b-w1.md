# BRIEF — worker `el-1b-w1` — the cast member lock's server checks: no run changes a locked cast member

App repo `/home/jody/github/serene-pub`. SDK repo is read-only. Supervisor: lane `el-1b`. Report: your final message
(under ~600 words) — changed files with the line of each check, tests run with results, every new sentence or
fragment you wrote, Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all.)

## Rules you work under (quoted from CLAUDE.md and the lane brief)

- The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
  prettier with `--write` and never pipe its output into a file. **No migration, no schema change**: the column exists
  (`lorebook_bindings.cast_member_lock`, TS `castMemberLock`, boolean default false, migration 0169). No `db:generate`,
  no SDK edit, no `npm run build`.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Comments state the rule, never history. Run `src/lib/shared/conformance/commentHistory.test.ts` before you finish.
- Tests only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/el-1b-w1-<n>.log 2>&1"`
  (always at least one path), one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
  (other lanes share vitest; waits can be long). Never pipe vitest into `head`. An int test that opens a DB inside an
  `it` needs a 60 s timeout. `NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` (once, at the end;
  report only errors in your files).
- Another worker (`el-1b-w3`) edits `state/handEdits.ts`, `sessions/creationModes.ts`, `lorebooks/tableRegistry.ts`,
  `sockets/sessions.update.ts` at the same time: never edit those. Never edit `sessions/seatKeys.ts`, `sessions/seats.ts`,
  `sessions/guestSeats.ts`, `messages/permissions.ts`, `sessionPageProjections.ts` (live lane `gs-3a3b-1`). No docs, no
  `NOMENCLATURE.md`, no client files (the supervisor does those). Re-read any file right before each edit.
- **Statements per reply must not rise.** Every check reads the lock from a row the code **already loads** (add the
  column to that existing select; `select()` of the whole row already has it). The only new statements allowed are on
  paths that are not part of an ordinary reply and are named below (the two art doors, one select each).

## The rule (owner EL1, 2026-11-17: "We can probably add a cast member lock as well to prevent pipeline edits to cast members, I.e. a pipeline that adjusts cast member details over time" · "Build it now, as described")

While a cast member's `castMemberLock` is true, **no run** changes the member's own details and words (its row and its
cast versions), its art (sprites, gallery) or its **durable sheet** (attribute values whose owner is
`{ kind: "cast_member" }`). The write is skipped and leaves one non-halting note; the reply completes and its other
writes land. **Not stopped:** a person's hand edit, a person's Accept of an earlier proposal, import, the plugin's own
sync, the `dc-cairns` boot pass, **session-layer values** (`seated_member`, `session_cast`, `player_seat`: what dice and
play change — those writes must not load the member row for this), seating / benching / handing over a seat, knowledge
ties and links (their own rows). Quoted from the lane brief's cold review, verbatim:

> "**A refused write never halts the reply.** … Use the carrier that does not halt: a write's result
> `{ written, notes: [sentence] }` … a write to a locked row returns `written: false` and one note naming the row; it
> never throws `HostScopeError` or `StateRefusal` and never rolls back the step's transaction."

(For the state writes below a `StateRefusal` IS the non-halting carrier: `set-state@1` (`bindings.state.ts` ~1105–1122)
and the rules engine (`applyChangeSet`, `rulesets/resolve.ts` ~1026) turn it into a `refused` line and go on. Keep that.)

> "an **accepted model proposal** is written with `updatedBy: proposal.proposedBy` (`state/write.ts:3079`; `isHandEdit`
> false): refuse the proposal **when the model makes it**; a person's Accept of an older proposal goes through."

Mirror lane el-1a's entry lock (`src/lib/shared/lorebooks/runLocks.ts`; `host.ts` ~7203–7216 `update-lore-entry`'s
early return; `rulesets/ties.ts` ~739 `its entry '…' is locked`).

## What to build

1. **`src/lib/shared/lorebooks/runLocks.ts`**: add `castMemberLockedAgainstRuns(row: { castMemberLock?: boolean | null }): boolean`
   (🚧, same shape as `entryLockedAgainstRuns`) and `RUN_LOCK_SENTENCES.castMember: (name: string) => \`${name} is locked, so this run left it as it is.\``
   (callers pass the name quoted, `'Mira'`, as the entry callers do). The lock is read only through the predicate and
   worded only through this sentence.

2. **The story-write funnel — `characters/versions.ts` `storyWrite`** (~1867): right after `memberOf(tx, input.member)`
   (a whole-row select: the lock is already there), if `castMemberLockedAgainstRuns(member)` and the writer is a run's
   (`input.writtenBy` starts with `run:`, `session:` or `script:`; `dc-cairns` and `user:`… are not) throw an exported
   `CastMemberLockRefusal extends Error` (🚧; message = the sentence with `member.name`, else `cast member <id>`), before
   any overlay row, anchor or version is made. Every story write goes through here: today
   `pipelines/runtime/castMember.ts writeCastMember` (`update-cast-member@1`), `rulesets/ties.ts writeColumn` cast-state,
   and `sessions/dcCairns.ts` (boot pass, not refused). Author writes (`at:`) are persons', plugins', imports': untouched.

3. **`pipelines/runtime/castMember.ts writeCastMember`**: catch `CastMemberLockRefusal` around the transaction and
   **return** `{ written: false, castMemberId: id, notes: [e.message] }` (no `id`, no `castVersionId`: the
   `offer-media` door's `written: false` result, `host.ts` ~5580, is the precedent the executor already takes). Widen the
   return type. The host door (`host.ts` ~7369) returns it as is; check nothing there assumes `castVersionId`.

4. **`rulesets/ties.ts writeLandings`** cast-state block (~1063–1145): add `castMemberLock` and `name` to the existing
   `cols` select of the member; when `castMemberLockedAgainstRuns(b)`, set `fact.skipped = \`its cast member '${name}' is locked\``
   (mirror the entry wording at ~739) and write nothing — before **both** the notes-overlay branch (`overlayInNotes`,
   which never reaches `storyWrite`) and the direct branch. Confirm `writeColumn(…, "cast-state", …)` has no other
   caller; if it has one, catch `CastMemberLockRefusal` there and return the same words.

5. **Durable sheet — `state/write.ts`**: `assertSessionOwner`'s `cast_member` branch (~1887) already selects the member;
   add `castMemberLock` and `name` to that select and **return** what a writer needs (e.g. `{ runLocked: name | null }`;
   the function returns nothing today). Do **not** refuse inside `assertSessionOwner`: it is also called to validate
   owners with no write (`bindings.state.ts` ~750 / ~779, `worldScope.ts`, `declarations.ts`). In **`setValue`**
   (~2591) and **`proposeChange`** (~2850), when the owner is `cast_member`, `ctx.userId == null` (a run: runs never set
   `userId`; a person's hand edit and a person's Accept, `decideProposal` ~3079, always do) and the member is locked,
   throw `StateRefusal(RUN_LOCK_SENTENCES.castMember(\`'${name}'\`))` before any transaction. Leave `configure`, `give.ts`,
   the overlaid-place path and every other owner kind alone.

6. **Art — `pipelines/runtime/host.ts`** `core:outlet/offer-media` (~5526) and `core:outlet/attach-sprite` (~5591): when
   `castMemberId != null`, before calling the writer, read `{ castMemberLock, name }` of that member (one select: these
   are card actions on one member, never part of a reply) and, when locked, return without writing:
   offer-media `{ written: false, characterId: null, castMemberId, offered: [], notes: [sentence] }`; attach-sprite
   `{ written: false, characterId: null, castMemberId, setId: null, attached: [], missing: [], notes: [sentence] }`
   (match the shapes of their existing `written: false` returns). A card's own art (no member) is untouched.

7. **The lock door — `sockets/lorebooks.ts` `lorebooks:updateBinding`** (~2616): today it strips `castMemberLock`
   (~2706, "the cast member lock has no door here"). Make it the door, with the same access as a hand edit (the existing
   `findOwnedBook` + `primerRowEditProblem` checks, which already refuse a provided book and a reader): when the payload
   names `castMemberLock` (boolean) and **nothing else but `id`**, update only that column and answer as the handler
   does (`relistBindings`, `emitToUser("lorebooks:updateBinding", res)`, the response row) — **no** version write, no
   redline, no `markImprintsKept`, no entity sync, no `amendments:list`: locking is not a content change and writes no
   history row. In any other payload keep stripping it as today. Fix the comment there. `createdBy` stays stripped.
   (`CastMemberRow` already spreads the binding row, so the client receives `castMemberLock` with no type change.)

## Not built (the supervisor's ★, don't do these)

Back / swipe / regenerate taking back a run's earlier cast version of a member locked afterwards (still taken). The
automatic Apply has no member items (nothing to do). No run removes or archives a member today (nothing to do).

## Tests (new file `src/lib/server/cast/castMemberLock.int.test.ts`; model it on
`src/lib/server/pipelines/runtime/host.entryLock.int.test.ts`, `castMember.int.test.ts`, `rulesets/ties.int.test.ts`)

Per door, a locked member: nothing written, the result is `written: false` / a `refused` line / `fact.skipped` with
the exact sentence, nothing thrown, and (where a step has other writes) the other writes land; the same write to an
unlocked member works:
- `update-cast-member@1` through the host (no cast version written, no overlay row made, notes = the sentence);
- `set-state@1` apply mode on a `cast_member` owner (refused line; a second change in the same list to the session layer
  lands) and propose mode (no proposal row);
- a session-layer write (`player_seat` or `session_cast`) on a seat of a locked member lands;
- a person's hand edit of the locked member's sheet (`setValue` with `updatedBy: "user", userId`) lands; a person's
  Accept (`decideProposal(..., userId)`) of a proposal made **before** the lock lands;
- the ties cast-state landing (direct and, if practical, the notes overlay) is skipped with the words;
- `offer-media` and `attach-sprite` on a locked member write nothing and return the note;
- `lorebooks:updateBinding` lock-only: the owner locks and unlocks (no `character_versions` row added, no redline);
  a stranger and a reader are refused; a provided book's member is refused; a full update with `castMemberLock` in it
  does not change the lock.
Also run: `src/lib/server/pipelines/runtime/castMember.int.test.ts`, `castMember.nodeState.int.test.ts`,
`src/lib/server/rulesets/ties.int.test.ts`, `src/lib/server/characters/versions.write.int.test.ts`,
`src/lib/server/sockets/lorebooks.castVersions.int.test.ts`, `src/lib/server/characters/portrait.int.test.ts`,
`src/lib/server/sprites/memberGenerate.int.test.ts`, `src/lib/server/sessions/dcCairns*.test.ts` (if present),
`src/lib/shared/conformance/commentHistory.test.ts`. Do not run the prompt baselines (the supervisor does).

## Stop and ask (in your report, then stop) when

A check would need a new statement on a reply path; a run's write cannot be told from a person's at the writer; a
refused write would have to halt; a new event, setting or migration would be needed; a file outside this list would
need editing.

Files owned: `src/lib/shared/lorebooks/runLocks.ts`, `src/lib/server/characters/versions.ts` (storyWrite check only),
`src/lib/server/pipelines/runtime/castMember.ts`, `src/lib/server/rulesets/ties.ts` (cast-state check only),
`src/lib/server/state/write.ts` (assertSessionOwner return, setValue / proposeChange check only),
`src/lib/server/pipelines/runtime/host.ts` (the two art doors only), `src/lib/server/sockets/lorebooks.ts`
(updateBinding lock door only), the new test file.
