# BRIEF — `s4-verify-w4` (worker of lane s4-verify) — a card-less seat added in Edit Session announces itself (`member-added`) — 2026-11-08

Repo `/home/jody/github/serene-pub`. Supervisor: lane `s4-verify`. Absolute paths; your cwd resets between shell calls.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## The walk finding

On the walk, a card-less cast member added to a session through Edit Session → Add characters (`sessions:update` with `castMemberIds`) was seated (session_cast row, `character_id` null, `cast_member_id` set) but never appeared in **Who speaks next?** — its turn candidates come from the turn order, which recomputes on `member-added`, and none was dispatched. A forced `sessions:fireTurn` with `seated-member:<id>` made it speak as itself, so only the announcement is missing.

Cause (verified by the supervisor — re-check): `src/lib/server/sockets/sessions.ts`, `sessions:update` handler:
- `memberSnapshot` (~6821–6875) keeps only `!c.removedAt && c.characterId != null` character seats and keys them **by card id** (`characters: Set<cardId>`, `characterRefs: Map<cardId, ref>`), so a card-less character seat is invisible to the before/after diff (~7342–7395) that emits `member-added` / `member-removed` through `emitMemberEvent`.
- `membersBefore` (~6876) is only taken when `params.characterIds` or `params.personaIds` is given — a request carrying only `castMemberIds` (handled ~7040) takes no snapshot at all.

## Task (production: that handler only)

1. In `memberSnapshot`, a live character seat is one with no `removedAt`, **not an envoy** (`envoySlug` null), and a card **or** a member (`characterId != null || castMemberId != null`) — S4's seat rule (plan §34.2: "not an envoy, and has a member or a card"). Key the character side of the snapshot by the seat's ref (`ccRef(c)`, already `hostSeatRefOf`'s member form) instead of the card id, so carded and card-less seats diff alike; adjust the delta loop accordingly (the `id` on a delta may become the seat id or be dropped — your call, name it). `ccRef`'s card-form fallback must not produce `character:null` for a card-less seat: for one, `hostSeatRefOf` returns the member form; if it could return null, skip the seat rather than emit a bad ref. Leave the persona side and the `positions` map logic as they are (the positions map may now include card-less seats — that is correct).
2. Take `membersBefore` also when `params.castMemberIds !== undefined`.
3. One-sentence comment at each change saying why (card-less seats announce like any seat).
4. Nothing else in the file changes. No new exported name, event or setting.

## Tests

In `src/lib/server/sockets/sessions.castMemberIds.int.test.ts`, describe "sessions:update with castMemberIds", add: adding a card-less member through `sessions:update` with only `castMemberIds` lands one `member-added` in the session event ledger whose payload `ref` is that seat's member-form ref (`seated-member:<castMemberId>` with the flip on — check what `hostSeatRefOf` returns and assert exactly that) and `change: "added"`; removing it (`castMemberIds: []`) lands one `member-removed` with the same ref. Read the ledger the way `src/lib/server/pipelines/runtime/sessionEvents.emit.int.test.ts` does (`ofEvent`, ~650–700). Then run, in one capped run: that file, `src/lib/server/pipelines/runtime/sessionEvents.emit.int.test.ts`, `src/lib/server/sockets/sessions.storyEmptyCast.int.test.ts`, `src/lib/server/sockets/sessions.dungeonCrawler.int.test.ts`, `src/lib/server/sockets/sessions.cardlessSeatShown.int.test.ts`. All green; report per-file counts.

## Rules you depend on (quoted)

- CLAUDE.md Sockets: "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." (`emitMemberEvent` already carries `sessionId`.)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." · "It is a **session**, never a *chat*."
- The member events are best-effort: "a failed dispatch must never fail the update that caused it" (comment ~7340) — keep the try/catch.
- An int test that opens a DB inside an `it` needs a 60 s timeout. **Never pipe vitest into `head`.**
- Tests only in a capped scope, logged:
  `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w4-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w4-tests.log'`
- **Prettier:** `npx prettier --check` changed files; only `--write` the lines you changed (sessions.ts has many pre-existing prettier diffs — format only your hunks by hand).
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need none.)
- Never `git checkout` / `restore` / `stash`.

## Files owned

`src/lib/server/sockets/sessions.ts` (the `sessions:update` handler's `memberSnapshot`, the `membersBefore` gate and the delta loop only), `src/lib/server/sockets/sessions.castMemberIds.int.test.ts`. Nothing else; another Claude session owns image-generation files.

## Stop and ask when

A listed test outside your new one fails after the change; the fix seems to need another file or a new name.

## Report

Final message: the diff in words, the `id` choice, per-file counts, prettier, **Noticed, not done**.
