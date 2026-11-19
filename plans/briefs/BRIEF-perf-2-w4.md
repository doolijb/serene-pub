# BRIEF — perf-2 worker w4 — the actions push reads the session's functions once per list

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-2`. Report: your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`. Run no git command that changes the index or the working tree. Edit only
`src/lib/server/pipelines/entities/sessionActions.ts`, `buildSessionActions` in
`src/lib/server/sockets/sessions.pipelines.ts`, and the new test file. Not `sessions/actionsPush.ts`, not
`sessions/rewind.ts`, not `sessionGenres.ts`, not `sockets/sessions.ts`.)

## Goal

After every turn `sessions/actionsPush.ts` `pushNow` calls `buildSessionActions(sessionId, userId, "main",
{ member: true, withRewind: true })` (`sockets/sessions.pipelines.ts` ~line 1283) for each watching member. Each
build computes the session's functions **twice** with the same arguments:
`listSessionActions` → `enabledSessionFunctions(db, sessionId, genreId, viewer.userId)`
(`entities/sessionActions.ts` ~311) and `formCollectsOf` → the same call (~506). Measured: ~101 statements each,
two builds per Lair turn → ~200 wasted. (`listSessionFunctions` in `entities/sessionGenres.ts` ~1351 does
`void userId`: the answer does not depend on the viewer, but keep passing it as today.)

Compute it once per `buildSessionActions` and hand it to both:

1. `formCollectsOf(db, sessionId, viewer, opts: { offered?: ReadonlyArray<SessionFunction> } = {})` — mirroring
   `listSessionActions`'s existing `opts.offered` (read its doc comment and its use at ~308–312): when given, use
   `opts.offered.filter((f) => f.enabled)` instead of calling `enabledSessionFunctions`; everything else
   unchanged (the session row read and the `!session` return stay). Add one doc line in the house style.
2. `buildSessionActions`: after the access check, read the session's `genreId` (one `select({ genreId })` on
   `sessions`, `?? STANDARD_GENRE_ID` exactly as both functions do); when the session exists, compute
   `const offered = await listSessionFunctions(db, sessionId, genreId, userId)` (import where the file imports
   its other entity helpers, or dynamically as it does `listSessionActions`), and pass `offered` to
   `listSessionActions` (its existing option) and to `formCollectsOf`. When the session row is absent, call both
   exactly as today (no `offered`). Keep the order of the response's keys and every other line as it is
   (`rewind`, `venues`, `formCollects`, `deleteRefusedThrough`).

Verify before you edit: `listSessionActions` with `offered` = `offered.filter((f) => f.enabled)` is exactly
`enabledSessionFunctions(...)` (`sessionGenres.ts` ~1533 is that filter over `listSessionFunctions`), so
`contributed` and `collecting` are unchanged. Touch nothing else.

## Prove it

1. **Before editing**, a scratch test `src/lib/server/sockets/perf2w4scratch.int.test.ts` (deleted at the end):
   a Lair session (find a fixture: `sockets/sessions.actions.int.test.ts`, `sockets/sessions.actionsSurface.int.test.ts`,
   `sockets/sessions.lairUnknownEntries.int.test.ts`) with an owner and a **guest** (see how tests add a session
   guest), plus a Story session; write `JSON.stringify(await buildSessionActions(sid, uid, "main", { member: true,
   withRewind: true }))` for owner and guest to
   `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/perf2/w4-before/`
   and count statements per build (wrap `db.$client.query`; the module's `db` is the mocked test DB, see the
   fixture you copy). Run; change; run into `w4-after/`; `diff -r` — **identical** except the counts.
2. **Permanent test** (new file `src/lib/server/sockets/sessions.actionsOnce.int.test.ts`,
   `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`): for owner and guest of a Lair session, the
   serialised `buildSessionActions` payload's `venues` and `formCollects` equal those from
   `listSessionActions(db, sid, { userId }, { channel: "main" })` and `formCollectsOf(db, sid, { userId })` called
   without `offered` (the old road), and `formCollectsOf` with `offered` from `listSessionFunctions` equals it
   without; one build reads the functions once (count the statements of one build before→after in the scratch,
   and assert the measured number or spy `listSessionFunctions`/`listGenreActions` call count — say which).
   If a shipped genre has a form-venue action with `collects`, use it so `formCollects` is non-empty; say
   whether it was.

Run only as (one at a time, always at least one path):
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-2-w4-<n>.log 2>&1"`
Never pipe vitest into `head`. Done means green: the new file, `src/lib/server/sockets/sessions.actions.int.test.ts`,
`src/lib/server/sockets/sessions.actionsSurface.int.test.ts`, the scratch diff identical. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-2-w4-tsc.log 2>&1` — 0 errors.
Do not run the two baseline tests (the supervisor does).

## Rules (quoted from the lane's contract)

- "The actions push after a turn: find what repeats … and compute once per push; the payload each recipient gets
  is byte-identical (assert on the serialised push for the owner and a guest)."
- "No behaviour change: … what any read returns, the order of writes and what every socket push carries are
  unchanged. No caching across runs." (Computed per build, never kept.)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." (No transaction here; keep it so.)
- CLAUDE.md Sockets ruling: "one domain context per event family … is the only listener"; this change touches no
  listener and no emit.
- No new user-facing name; `offered` is the existing internal option's name. "It is a **session**, never a *chat*."
- Both source files are already not prettier-clean: `npx prettier --check` only, **never `--write`** — not even
  on your new test file; house style (tabs, double quotes, no semicolons).

## Stop and ask when

The payload differs in the scratch diff; `offered` cannot stand in for `enabledSessionFunctions` exactly; a test
fails for a reason you can't tie to the change.

## Report (final message, under ~300 words)

Changed files; statements per build before→after (owner, guest); diff result; whether `formCollects` was
non-empty in the test; tests with results; tsc; prettier; noticed, not done.
