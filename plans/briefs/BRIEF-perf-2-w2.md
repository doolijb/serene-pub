# BRIEF — perf-2 worker w2 — the run's settings read uses the run's host

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-2`. Report: your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`. Run no git command that changes the index or the working tree. **Do not edit
`src/lib/server/pipelines/runtime/host.ts`** or any `host*.ts`: another lane owns it.)

## Goal

Each run reads its settings document before its host exists: `runTurn.ts` ~line 1064
`resolveSessionSettings(request.db, request.sessionId)`, then ~line 1137 `host: createHost(request.db, scope)`.
`resolveSessionSettings` (`src/lib/server/sessions/settings.ts:95`) reads the cast through `readCast`
(`settings.ts:306`), which builds **a host of its own** (`createHost(db, { sessionId })`) — so every run pays a
second `session_cast` read (~53 statements) and a second narrator build (a whole `buildWorld`), because the host's
two per-run memos (`narratorNameOf`, `sessionCastReads` in `host.ts` ~lines 806–850) live on the host object.
Measured: Story 2 such settings reads per reply, the Lair 3.

Let the run create its host first and hand it to the settings read, so one host serves both. Callers of
`resolveSessionSettings` outside a run (`host.ts` `session-settings` query case, `sessionSpeech.ts`,
`sessionKeepsEveryTurn`, sockets…) keep today's path unchanged.

## Exact change

1. `settings.ts`: `resolveSessionSettings(db, sessionId, opts: { host?: CoreHostServices } = {})` (import the type
   from `host.types.ts` as a type import), passing `opts.host` to `readCast(db, sessionId, host?)`. In `readCast`,
   use the given host when there is one, else `createHost(db, { sessionId })` exactly as now; call
   `host.read!("session_cast", { sessionId }, <same node>)` exactly as now.
2. **The document must not change.** A run's host has `scope.userId` and `scope.channel`, and
   `readSessionCast` (`host.read.sessionCast.ts`) adds exactly two keys from them that the own-host read never
   has: `viewerUserId` (~line 727, from `scope.userId`) and `turnChannelVoice` (~line 670, from `scope.channel`
   when the genre shapes channels). Verify that these are the only scope-dependent outputs (grep `scope` in that
   file; also check nothing in it reads `host`). Then drop both in the destructure beside `lorebookBindings`
   (`const { lorebookBindings: _roster, viewerUserId: _viewer, turnChannelVoice: _voice, ...cast } = raw ?? {}`),
   always (on the own host they are absent, so nothing changes there), with a short comment in the house style:
   the document is the session's, never the run's, so whichever host reads it the cast carries no run's viewer
   or turn channel. Key order of the remaining keys is preserved by the rest destructure.
3. `runTurn.ts`: create the host before the settings read — `const host = createHost(request.db, scope)` (or
   another local name if `host` is taken in that scope; check) just above the `resolveSessionSettings` import at
   ~1062 — pass `{ host }` to `resolveSessionSettings`, and in the `run(doc, { … })` options use that same host
   (`host,` / `host: <name>,`) instead of `createHost(request.db, scope)`. Verify first: (a) `scope` is not
   reassigned between the two lines (it is mutated at ~1011 `scope.loadoutChains = …`, before; the host keeps the
   object reference); (b) `createHost` does nothing at construction but build closures (no reads, no registry,
   no side effect) — read its top level; if it does something, stop and report.

Touch nothing else. Do not move code, rename anything, or reformat lines you don't change.

## What could invalidate it (say so in your report, and prove each with a test)

The settings read now fills the run host's `sessionCastReads` memo, which the run's first cast reads may then
serve. The memo is cleared when any `host.call` or `host.commit` starts and ends. A write that does **not** go
through the host between the settings read and the run's first cast read would be missed. Check what runs
between the two in `runTurn.ts` (token counter, script extras, the executor's run start) and list any write it
makes to a table `readSessionCast` reads (sessions, session_characters, session_personas, character rows and
versions, users, session_guests, lorebooks/bindings, story clock). If you find one, stop and report.

## Tests (new file `src/lib/server/sessions/sessionSettings.runHost.int.test.ts`)

Model fixtures on `src/lib/server/pipelines/runtime/host.sessionCastMemo.int.test.ts` (session + character seat
+ player seat + lorebook, statement counting by wrapping `db.$client.query`, the seat-bench commit) and
`src/lib/server/sessions/sessionSettings.int.test.ts`. `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`.
- **Same document:** `resolveSessionSettings(db, sid, { host: createHost(db, { sessionId: sid, userId, channel }) })`
  `toStrictEqual`s **and** `JSON.stringify`-equals `resolveSessionSettings(db, sid)`, for a session whose genre
  shapes channels with a declared `voice` and a `channel` naming it (find one among the shipped genres —
  grep `voice:` in `../serene-pub-sdk/core-catalog/src/registry/genres.ts`; if none fits, use a session with a
  `userId` set and say so) — so both scope-only keys would have appeared.
- **One host serves both:** after the settings read on a host, that host's `read!("session_cast", …)` issues
  **0** statements.
- **A same-run write is still seen:** settings read on a host, then `host.commit!` the seat-bench outlet on one
  seat, then `host.read!("session_cast")` on the same host shows that seat `enabled: false`; and a second
  `resolveSessionSettings(db, sid, { host })` after the commit shows it benched in `cast` too.
- **No caching across runs:** a direct DB change between two hosts is seen by the second.

Run only as (one at a time, always at least one path):
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-2-w2-<n>.log 2>&1"`
Never pipe vitest into `head`. Done means green: the new file,
`src/lib/server/sessions/sessionSettings.int.test.ts`, `src/lib/server/sessions/sessionSettings.timeline.int.test.ts`,
`src/lib/server/pipelines/runtime/host.sessionCastMemo.int.test.ts`,
`src/lib/server/pipelines/runtime/host.narratorNameMemo.int.test.ts`. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-2-w2-tsc.log 2>&1` — 0 errors.
Do not run the two baseline tests (the supervisor does).

## Rules (quoted from the lane's contract)

- "No behaviour change: every prompt fingerprint … stays byte-identical; what any read returns, the order of
  writes and what every socket push carries are unchanged. No caching across runs."
- "Let the run create its host first and hand it … to the settings read, so one host serves both; callers of
  `resolveSessionSettings` outside a run keep today's path. Mind lane `perf-1`'s memo rules: the cast memo is
  cleared around every `host.call` / `host.commit`."
- "You do not edit `host.ts` except to read its memos through their existing accessors."
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
  Never hand the run's host (built on the outer `db`) to a settings read made inside a transaction callback.
- CLAUDE.md: "It is a **session**, never a *chat*." No new user-facing name; `host` is an internal parameter.
- Both files are already not prettier-clean: `npx prettier --check` only, **never `--write`**; house style
  (tabs, double quotes, no semicolons).

## Stop and ask when

A scope-dependent output other than the two keys exists; a non-host write sits between the settings read and the
run's first cast read; `createHost` has a construction side effect; a test fails for a reason you can't tie to
your change.

## Report (final message, under ~300 words)

Changed files; what you verified (the two keys, `createHost`, the writes between); tests with results; tsc;
prettier; noticed, not done.
