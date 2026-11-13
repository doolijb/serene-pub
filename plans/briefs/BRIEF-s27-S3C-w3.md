# BRIEF s27-S3C-w3 — `sessions:get` seat rows carry identity; state owner kind; tie-side door test (seat-cast S3, server)

Worker for lane **s27-S3C** (supervisor: lane-supervisor, Opus). App `/home/jody/github/serene-pub`. You are worker **w3**; nobody else in this lane is editing now. Other lanes run in other files: never edit `src/lib/client/**`, `src/routes/**`, `../serene-pub-sdk/**`, `../mundi-sp/**`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`. Don't run one.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Background (S3: "Host fills, consumers read")
The server fills identity fields so consumers stop building refs from card ids. Lane s27-S3C already fills them on the pipelines' `session_cast` read (`src/lib/server/pipelines/runtime/host.ts` `case "session_cast"` — **read it as your model**, search `seat-cast S3` there) and on `state.cast.byId`. The client lane (s27-S3W) now reads them off the **`sessions:get`** payload too, which doesn't carry them yet. Values, exactly as on the `session_cast` read:
- **`ref`** = the seat's emitted ref today: `character:<the card the seat holds>` for a character seat and for a **carded** player seat (a carded player seat is its card); `player-seat:<session_personas.id>` for a card-less player seat.
- **`castMemberId`** = the seat's stored `cast_member_id` (already on the row — `session_characters.cast_member_id` / `session_personas.cast_member_id` come out whole); null when none. Never the attached book's member.
- **`cardId`** = the member's **active card on the timeline**: `MemberAsRead.activeCardId` from the member read (`seatMembersAsRead` in `pipelines/prompt/seatCards.ts`; for a card-less player seat that stores a member, `membersAsRead(db, ids, { sessionId })` from `cast/memberAsRead.ts`, which `seatMembersAsRead` skips). No member read → the held card (null for a card-less player seat). A member read whose `activeCardId` is null → null. One batch per call, never per row.

## Items
1. **`src/lib/server/sockets/sessions.ts` `withSessionExtras`** (~5191–5250, the hunk that already calls `seatMembersAsRead` over character seats then carded player seats): set `ref`, `castMemberId` (only if absent) and `cardId` on each `sessionData.sessionCharacters[]` and `sessionData.sessionPersonas[]` row, reusing the `asReads` already computed there (don't read members twice). Card-less player seats too. Keep the existing `try/catch` behaviour: a failed member read must not lose the payload — on failure fill `ref` and leave `cardId` as the held card (or null for card-less). Check every path that sends `sessions:get`-shaped seat rows goes through `withSessionExtras` (`buildSessionGetResponse`, `buildSessionRefresh`, anything else calling `getSessionFromDB`); report the ones that don't and fill them only if they hand seat rows to the page. Edit this file **by hunk only**; it is ~11k lines with other lanes' uncommitted work: re-read the hunk right before editing, never reformat, never run prettier `--write` on it.
2. **`src/lib/shared/sockets/types.ts`** (shared; additive, re-read right before each edit, touch only these types):
   - `Sockets.Sessions.Get.Response`: find the seat row types its `session` carries (`sessionCharacters[]` / `sessionPersonas[]`); add optional `ref?: string`, `castMemberId?: number | null` (if missing) and `cardId?: number | null`, each with a one-line 🚧 doc ("host-filled, seat-cast S3; match on it, never build it"). If those rows are typed by a shared type used elsewhere, add the optional fields there (optional fields don't break other users) and say which type.
   - `Sockets.State.StateOwnerRow` (~16760): `kind` gains `"seated_member"` (its `ref?` / `castMemberId?` exist already). Then `npx tsc` — fix only type errors this widening causes in **server** files (an exhaustive switch etc.); list any client-file error in your report, don't edit it.
3. **`state:showTieSide`** (`src/lib/server/sockets/state.ts` ~1655–1700): it already translates the owner through `seatedOwnerAtDoor` (`storedSeatOwner`). Verify, and write the test: a `{ kind: "seated_member", id: <memberId> }` owner shows the tie side of that member's seat (stored under the seat's `session_cast` / `player_seat` owner), a member nobody is seated as is refused with `NOT_IN_CAST`, and a `session_cast` owner works as before. Look at how existing socket handler int tests drive `stateShowTieSide`'s siblings (`grep -rln "stateSetTieShown\|stateSetOwnerFace\|seated_member" src/lib/server/sockets --include=*.int.test.ts`) and reuse their fixtures; if `setTieSideShown` needs a tie entry that is heavy to build, it's fine to assert the door (refusal vs passing the translated owner to `setTieSideShown`, e.g. with `vi.spyOn` on the dynamically imported `$lib/server/rulesets/ties`).

## Files owned
`sockets/sessions.ts` (the `withSessionExtras` hunk, and any other `getSessionFromDB`-caller hunk you report), `sockets/state.ts` (only if a test proves the tie door wrong), `src/lib/shared/sockets/types.ts` (the two types), new test files beside them.

## Rules (quoted)
- **Look up, never parse.** Never parse a card id out of a ref, never `Number(key)`.
- **No stored key changes, no migration, no removal.** Keys and emitted refs stay card form until S4.
- "Inside `db.transaction(async (tx) => …)` use only `tx`." No static `$lib/server/db` import in modules tests mock.
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId` …) in the payload, or `emitToUser` silently sends nothing" — don't drop `sessionId` from a payload.
- **Every session has a lorebook** — never write "no book", "no lorebook", "bookless".
- New exported names: none expected; a new one → stop and report it.
- Targeted tests only; **never pipe vitest into `head`**; int tests that open a DB inside an `it` need a 60 s timeout. Before your first run, `ls -d /tmp/serene-pub-vitest-* 2>/dev/null > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/s27-S3C-w3-tmp-before.txt`; afterwards delete only new dirs your runs left, by name. Scratch files start with `s27-S3C-w3-`.

## Tests (both shapes)
- `sessions:get` (`buildSessionGetResponse` or the socket handler, as existing tests do — `grep -rln "buildSessionGetResponse\|sessions:get" src/lib/server/sockets --include=*.int.test.ts`): a character seat (`ref: character:<held>`, `castMemberId`, `cardId` = held card), a carded player seat, a card-less player seat (`player-seat:<id>`, `cardId: null`), a card-less player seat storing a member, and **a dated active card ≠ the held card** (reuse the amendment fixture in `src/lib/server/pipelines/runtime/host.seatIdentity.int.test.ts`) → `cardId` the dated card, `ref` the held card.
- The tie-side door as in item 3.
- Existing tests of `sessions:get` stay green **unchanged** (run the ones you find).

Run with `npx vitest run <files>` from the app root. Then `npx tsc --noEmit -p . 2>&1 | grep "error TS"` — the old `arrangeCanvas.dom` error is known; report anything else.

## Report
Your final message: changed files + hunk ranges, where each field is filled, tests run with pass counts, existing tests changed (should be none), tsc result, Noticed-not-done.
