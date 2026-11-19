# BRIEF — perf-3 worker w1 — the `session_settings` query case uses its own host (cut 1)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-3`. Report: your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build` — do not run it at all: an isolated app instance may be running. Run no git command that
changes the index or the working tree: no add, reset, checkout, restore, stash, commit.)

## Goal

`src/lib/server/pipelines/runtime/host.ts`, the `case "session_settings":` of the host's `read` (~line 2268–2281),
ends `return await resolveSessionSettings(db, sessionId)`. `resolveSessionSettings`
(`src/lib/server/sessions/settings.ts:96`) already takes `opts: { host?: CoreHostServices }` (lane perf-2 added it);
without a host, its `readCast` (`settings.ts` ~306) builds **a host of its own**, so this query pays a second
`session_cast` read and a second narrator build (a whole `buildWorld`) — measured once per Lair reply (the
`core:query/round-worth@1` binding, `roundWorth.ts:42`, reads `session_settings` in the round-tick run).

## Exact change (one line)

In that case, pass the host the case belongs to: `return await resolveSessionSettings(db, sessionId, { host })`.
`host` is the `const host: CoreHostServices = { … }` object (~line 1945) the case lives in — already referenced
the same way inside `read` at ~line 2572 (`readSessionCast({ db, scope, host, node, q }, …)`). Verify that the
`db` the case uses is the same handle the host was created with (it is `createHost(db, scope)`'s parameter).

Touch nothing else in `host.ts`. **Do not change the two host memos (`narratorNameOf`, `sessionCastReads`), their
invalidation (`hostInFlight`, the `castWrite` epoch) or anything near them.** Do not move code, rename or reformat.

## Why the document cannot change (verify, do not re-prove from scratch)

A run's host has `scope.userId` / `scope.channel`; `readSessionCast` adds exactly two keys from them
(`viewerUserId`, `turnChannelVoice`), and `readCast` in `settings.ts` already drops both on every host (perf-2,
tested in `src/lib/server/sessions/sessionSettings.runHost.int.test.ts`). Nothing else in the settings document
depends on the host.

## What could invalidate it

The settings read now reads and fills the run host's `session_cast` memo. That memo is cleared when any
`host.call` / `host.commit` starts and ends, is bypassed while one is in flight, and writers outside both go through
`castWrite` (epoch). A write by another request is not seen — as before. Your test must prove a same-run write is
still seen.

## Tests (new file `src/lib/server/pipelines/runtime/host.sessionSettingsQuery.int.test.ts`)

Model fixtures on `src/lib/server/sessions/sessionSettings.runHost.int.test.ts` (copy its mocks and seeding:
the voiced genre, character seat, player seat, the `BENCH` outlet, statement counting by wrapping
`db.$client.query`). `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`. Read the document through the
host the way the query node does: `host.read!("session_settings", { sessionId }, <a node with
definitionId "core:query/session-settings">)` (check `assertScoped` in host.ts for what the node needs).
- **Same document:** on `createHost(db, { sessionId, userId, channel })` (channel naming the voiced lane, so both
  scope-only keys would appear), the query's result `toStrictEqual`s **and** `JSON.stringify`-equals
  `resolveSessionSettings(db, sessionId)`.
- **One host serves both:** after `host.read!("session_settings", …)`, the same host's
  `read!("session_cast", …)` issues **0** statements; and a `session_settings` read on a host that already read
  `session_cast` issues fewer statements than the same read on a fresh host.
- **A same-run write is still seen:** `session_settings` read on a host, then `host.commit!` the seat-bench outlet
  on one seat, then `session_settings` again on the same host shows that seat benched in `cast`.
- **No caching across hosts:** a direct DB change between two hosts is seen by the second.

Run only as (one at a time, always at least one path; never pipe vitest into `head`):
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-3-w1-<n>.log 2>&1"`

Done means green: the new file, `src/lib/server/sessions/sessionSettings.runHost.int.test.ts`,
`src/lib/server/pipelines/runtime/host.sessionCastMemo.int.test.ts`,
`src/lib/server/pipelines/runtime/host.narratorNameMemo.int.test.ts`. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-3-w1-tsc.log 2>&1` — 0 errors.
Do not run the two baseline tests (the supervisor does).

## Rules (quoted from the lane's contract)

- "No behaviour change: every prompt fingerprint in both baseline tests stays byte-identical …; what any read
  returns, the order of writes and what every socket push carries are unchanged. No caching across runs."
- "`pipelines/runtime/host.ts` (the `session-settings` case only: lanes `perf-1` and its fix own the memos: do not
  change them)."
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- CLAUDE.md: "It is a **session**, never a *chat*." No new name, setting or option.
- `npx prettier --check` only, **never `--write`** (host.ts is not prettier-clean today; leave it so). House
  style: tabs, double quotes, no semicolons.

## Stop and ask when

The case's `db` is not the host's handle; a scope-dependent output other than the two keys appears; a test fails
for a reason you cannot tie to your change.

## Report (final message, under ~250 words)

Changed files; what you verified; tests with results (log paths); tsc; prettier; noticed, not done.
