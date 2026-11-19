# BRIEF — perf-4 worker w2 — the actions push reads the offer and the rewind state once per push (cuts 2 and 3)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-4`. Report: your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: do not run it at all. Both repos are staged by the lead: run no git command that changes
the index or the working tree: no add, reset, checkout, restore, stash, commit. `git show :<path>` and `git diff`
are fine. Never `prettier --write`. Other tasks are editing other files right now (client session forms and views,
`pipelines/registrations/summarizer.ts` and its importers): touch none of them, and re-read a file right before you
edit it.)

## Goal

`pushNow` (`src/lib/server/sessions/actionsPush.ts:81-128`) builds one list per interested member through
`buildSessionActions` (`src/lib/server/sockets/sessions.pipelines.ts:1283-1362`). Each build reads, again, two things
that do not depend on the member:

- **the offer**: the session row's `genreId` (`:1323-1327`) and `listSessionFunctions(db, sessionId, genreId, userId)`
  (`:1330-1335`); `listSessionFunctions` ignores its user (`pipelines/entities/sessionGenres.ts:1357`, `void userId`).
  About 101 statements per member per push (profiled).
- **the rewind state**: `rewindStateOf(db, sessionId)` (`:1318-1321`, `sessions/rewind.ts:140`) takes no user. About
  45 statements per member per push.

Read each **once per push, lazily, on the first member who passes `hasInterest`** (`actionsPush.ts:104`), and hand
the same value to every member's build. A push with no interested member still costs no statement (the interest
rule, `actionsPush.ts` 17–22). Re-verify every line number first; lane `cpl-A` edited lines 69–77 of
`sessions.pipelines.ts` and has landed.

## Exact change

1. `buildSessionActions` gains one optional field in its `opts`: a per-push holder of the two shared reads, e.g.
   `perPush?: { offered?: Promise<SessionFunction[] | undefined>; rewind?: Promise<RewindState> }` (types from
   `sessionGenres` / `$lib/shared/sessions/rewind`, `import type` only). When it is given, the build takes each
   value from the holder, and the first build that needs one starts the read and stores the **promise** in the
   holder (so a second build that starts while the first is still reading waits on the same read). When it is not
   given, the build reads exactly as today. The offer's read is today's code moved into one place: the row read,
   then `listSessionFunctions` only when the row exists, `undefined` otherwise; keep today's order (the rewind state
   first, under `withRewind`, then the offer). A rejected read is removed from the holder (only if the holder still
   holds that same promise) so the next member reads again: today one member's failed build does not cost the
   others theirs (`actionsPush.ts:119-126`). The value is the same object for every member: check that nothing
   downstream mutates it (see "Check first").
2. `pushNow` makes one holder per push (`const perPush = {}`, no read) before the member loop and passes it in every
   member's `buildSessionActions` options. Nothing else in `pushNow` changes. The holder is a local of one `pushNow`
   call: never module state, never kept past the push.
3. Nothing else changes: not the socket handler's own build (`sessionsActionsHandler`, it passes no holder), not
   `listSessionActions`, `formCollectsOf`, `turnDeleteRefusedThrough`, `rewindStateOf`, `emitToUserRedacted`.
   `sessionActions.ts`, `sessionGenres.ts`, `verbs.ts`, `rewind.ts`, `turnYield.ts`, `host.ts` are **not yours**.

Do this as **two steps**. Step A (cut 2): the holder carries only `offered`. Then run both baselines (below) and
record the counts. Step B (cut 3): add `rewind` to the holder. The supervisor runs the baselines after step B.

## Check first, and say so in the report

- **Nothing mutates the shared values.** `offered` reaches `listSessionActions` (`sessionActions.ts:289`, `:309-312`)
  and `formCollectsOf` (`:498`, `:507-511`): each `.filter`s a new array but keeps the same action objects; follow
  those objects through everything they reach (`resolveAudiences`, `seenSetFor`, the enablement and venue builds,
  `audienceHolds`, the `formCollects` entry, anything that sorts, assigns or deletes a property) and show none is
  mutated and none reaches a payload where a later step mutates it. `rewindStateOf`'s value goes into
  `res.rewind`; `emitToUserRedacted` → `withoutConnectionIdentity` (`connections/visibility.ts:257`) copies rather
  than mutates (check). Today `offered` is already shared between those two reads inside one build (lane `perf-2`).
  If a value is mutated anywhere, stop and report it.
- **The per-member rules stay per member**, each untouched and still running once per member with that member as
  the viewer: portrayals from `resolveAudiences` with the viewer as `runOwnerUserId` (`sessionActions.ts:235`,
  `:343`); `seenSetFor`, the "new" mark (`:349`); `audienceHolds` for see and act (`:406`, `:431`, `:447`, `:465`,
  `:521`); `turnDeleteRefusedThrough`'s owner / player split (`sessions.pipelines.ts:1359`, `verbs.ts:705+`);
  `emitRedacted`'s admin-only strip (`sockets/utils/broadcastHelpers.ts` 94–140). List each with its current line.

## Proof and tests

**A. Frozen literals from the code before the change.** `actionsPush.ts` and `sessions.pipelines.ts` in the working
tree are identical to the index today (checked by the supervisor); confirm with
`git diff --stat -- src/lib/server/sessions/actionsPush.ts src/lib/server/sockets/sessions.pipelines.ts` (must print
nothing) **before editing anything**. Then, before editing, write the permanent test (B) with a capture mode and run
it against the unchanged code: write each member's whole serialised payload (`JSON.stringify`, every world, every
push) to
`/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/perf4/w2-before.json`,
plus the projected values B pins and the two-member push's statement count. Paste the projected values into the
test as frozen literals, keep the capture writing to `w2-after-A.json` / `w2-after-B.json` after each step, and show
`cmp` against `w2-before.json`: **byte-identical** after step A and after step B (ids are stable if the fixture
creates rows in the same order; if a value is not stable across runs, say which and why). Remove the capture code
at the end. (If the diff check is not empty, capture from scratch copies made with `git show :<path>` instead, and
delete them after.)

**B. Permanent test** `src/lib/server/sessions/actionsPush.perPush.int.test.ts`. Reuse the fixtures of
`src/lib/server/sockets/sessions.actions.int.test.ts` (`recordingIo` ~329, `sessionWithGuest` ~171,
`publishActionSpec` ~191, how ~2284–2340 drives `pushSessionActions`) and, for a kept turn,
`src/lib/server/sockets/sessions.dungeonCrawlerFixTurn.int.test.ts` (Dungeon Crawler declares `keepEveryTurn`).
An owner and a guest (a real `session_guests` row), both watching, in one session, in at least: a session where an
action's audience lets the guest see but not act; a contributed action the owner has marked seen and the guest has
not (`seen_actions`); a kept turn with `keepEveryTurn` off so the owner's `deleteRefusedThrough` differs from the
guest's; and a rewind state that is not empty (after a reply). Assert:
- what differs between owner and guest, as frozen literals per member: `canAct`, which actions are visible per
  venue (identities), `isNew`, `deleteRefusedThrough`, and `rewind` (same for both);
- the two-member push issues fewer statements than the one-member push for the owner plus the one for the guest;
- a push with no interested member issues **no** statement (wrap `db.$client.query` as
  `sockets/sessions.actionsOnce.int.test.ts` `counting` does);
- **nothing is kept across pushes:** a write between two pushes (a reply, or a function switched off) is seen by
  the second push.

`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`.

**Baselines after step A** (both, one run):
`bash /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/perf4/base.sh c2`
(it waits for other vitest runs, writes `plans/perf-4-c2.log` and `plans/perf-4-shas-c2.txt`, and must print
`SHAS-IDENTICAL`); copy its output into your report.

Every other vitest run only as (one at a time, always at least one path; never pipe vitest into `head`):
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-4-w2-<n>.log 2>&1"`

Done means green after step B: the new file, `src/lib/server/sockets/sessions.actions.int.test.ts`,
`src/lib/server/sockets/sessions.actionsOnce.int.test.ts`, `src/lib/server/sockets/sessions.refreshPush.int.test.ts`,
`src/lib/server/sockets/sessions.dungeonCrawlerFixTurn.int.test.ts`,
`src/lib/server/sessions/rewind.sharedReads.int.test.ts`; the capture byte-identical after both steps; then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-4-w2-tsc.log 2>&1`: 0 errors (errors in
files you did not touch: list them, say they are not yours).

## Rules (quoted from the lane's contract)

- "No behaviour change: … what any read returns, the order of writes and what every socket push carries to each
  member are unchanged. No caching across runs or across pushes."
- "Files owned for cuts 2–3: `buildSessionActions` (`sessions.pipelines.ts` 1283–1362; two optional values: the
  offer and the rewind state) and `pushNow` (`actionsPush.ts`) only." Plus the new test. Nothing else in
  `sessions.pipelines.ts`.
- "A socket that wants nothing costs no query (`actionsPush.ts` 17–22): read the shared values **lazily, on the
  first member who passes `hasInterest`** (`:105`); test that a push with no interested member still issues no
  statement."
- "Stop and ask when … a cut would change what a member receives; … a cut needs a cache that outlives one push."
- Comments state the rule, never the history. A short comment where the holder is made and where it is read.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." CLAUDE.md: "`socket.off(event)` with no
  handler removes every listener" (not expected here). Never seed a row at a hardcoded id. House style: tabs,
  double quotes, no semicolons.
- `npx prettier --check` only, never `--write`. Both source files fail `--check` today? Check with
  `git show :<path> | npx prettier --stdin-filepath <path> --check`; if a file was clean before, keep it clean by
  wrapping your own lines by hand.

## Stop and ask when

A shared value is mutated; the capture differs by one byte; a per-member rule would read a shared value; a test
fails for a reason you cannot tie to your change.

## Report (final message, under ~400 words)

Changed files; the diff check; the mutation check and the per-member rules with lines; the holder's shape and name;
the capture result after each step; the step A baseline output; statement counts (one-member, two-member, before and
after); tests with results (log paths); tsc; prettier; noticed, not done.
