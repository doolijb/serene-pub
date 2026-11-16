# BRIEF — notes-unlisted worker 3 — prove the "written notes" rule against the real create and seat paths

Supervisor: lane `notes-unlisted` (`plans/briefs/BRIEF-notes-unlisted.md`). Report as your final message (the
supervisor saves it). Repo: `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`: do not run one.)

Never run `prettier --write` on anything but the one file you create, and never on a directory or glob.

## Why

`writtenNotesOf(db, lorebookIds)` (`src/lib/server/lorebooks/notesShown.ts`, read its header: the rule) decides
whether a session's notes (its own book, `lorebooks.session_id` set) are listed in the Lorebooks view's **Session
notes** section. Owner ruling 2026-11-13: "Only notes with something in them" — notes that hold only the cast members
made for seated characters must read **unwritten**. Its existing tests (`notesShown.int.test.ts`) build sessions by
direct inserts, so they cannot show what the **real** create and seat paths write into notes (a branch line, a clock,
an annex default, a presence, a version…). If the real path writes anything the rule counts, every real session's
notes would read written and the owner's complaint stays.

## Files owned (the only file you may create or edit)

NEW `src/lib/server/lorebooks/notesShown.realCreate.int.test.ts`.

Read only: `src/lib/server/sockets/sessions.seatCast.int.test.ts` (copy its harness: the `vi.mock`s, `publishGenre`,
`beforeAll` with `defaults.sync()` and `bootstrapPipelines`, `socket()`, `recorder()`, `make()` calling
`sessionsCreateHandler.handler`, and `sessionsUpdateHandler` if you need to seat later), `notesShown.ts`,
`src/lib/server/sessions/seats.ts` (`seatBookOf` ~l.240–300: seat members land in notes only when the session has no
attached book, or the attached book is not the owner's own, or is a marked book).

Never edit any other file. In particular never `src/lib/server/sockets/sessions.ts`, `entries.ts`, `db/schema.ts`,
`notesShown.ts` (if the rule is wrong, report it; do not fix it).

## Cases (each through `sessions:create`, the real handler)

1. A notes-only session (no `lorebookId`) created with two character cards and a persona → its notes
   (`lorebooks` where `session_id = session.id`) hold the seated members, and `writtenNotesOf` says **unwritten**.
2. A session reading **another user's** book shared with the creator (or, if sharing is awkward to set up, a
   marked/provided book — see how `seatBookOf` decides `attachedMintable`) with one character → members land in the
   notes; **unwritten**.
3. Case 1, then add a character through the real seat path after create (`sessions:update` with a new character list,
   as `sessions.seatCast.int.test.ts` does) → still **unwritten**.
4. Case 1, then one real story write into the notes through an existing helper if one is cheap to reach (e.g. insert
   one `lorebook_entries` row with the fixtures in `$lib/server/pipelines/testing/fixtures`) → **written** (sanity).

If case 1, 2 or 3 reads **written**, do not change the expectation to pass: find which table or column made it
written (query each one the rule reads for that book id) and report exactly which row the real path wrote, with the
file:line that writes it. That is the main finding.

## Tests — how to run (binding)

Only inside a capped scope, from the repo root, with the full path, one run at a time:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 /home/jody/github/serene-pub/src/lib/server/lorebooks/notesShown.realCreate.int.test.ts > /home/jody/github/serene-pub/plans/notes-unlisted-w3-<n>.log 2>&1"`

Before each run: `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep`. If any vitest is running, wait a
few minutes and check again; never loop on `pgrep -f`. Never pipe vitest into `head`. 60 s test and hook timeouts.
Then `npx prettier --check` on your file (you may `npx prettier --write` that one file only) and
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep notesShown.realCreate`.

## Report (final message)

Each case: pass/fail, and for any "written" the table, row and the writer's file:line. Test counts, log path, tsc and
prettier results. **Noticed, not done.**
