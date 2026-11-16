# BRIEF — perf-D worker 2 — one expression engine, asleep read once, send/refresh paths stop over-reading

You are a `lane-worker` under lane supervisor `perf-D`. Repository root: `/home/jody/github/serene-pub`.
Use absolute paths. Read only line ranges of large files (`sockets/sessions.ts` is 12k lines — never read it whole).
Line numbers below are from 2026-11-13 and may have shifted; find each site by its code before editing.

## Rules that bind (quoted)

- Owner 2026-11-13: "change how often, never what." Every change below computes exactly what it computes today,
  fewer times. A change that alters an answer has left the brief — stop and tell me.
- Owner P1 (2026-11-04): "Deterministic, never hidden. … Same inputs, same result."
- CLAUDE.md Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- CLAUDE.md Standing ruling (sockets): "views register listeners for local state and never call `toaster`. An event in
  `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends
  nothing." Do not change any payload's scope keys.
- `src/lib/server/sockets/sessions.ts` is a shared file: you may edit ONLY the four sites named in C below
  (`sessionMessagesSendPersonaMessageHandler`, `fireNarratorResponseHandler`, `buildSessionRefresh`, and the two
  `getSessionFromDB` calls in the `sessions:update` handler and `reassignRemovedParticipant` handler). Nothing else in it.

## A. `src/lib/server/state/expressions.ts` — one shared expression Liquid (review row C9)

Today `expressionLiquid(scope, seedLabel)` (~line 289) builds a new `Liquid` per evaluation because the filters
(`slot`, `has`, `count`, `roll`) close over `scope`, `seedLabel` and a `rolls` counter. Build:
- One module-level `Liquid`, built lazily once, with the same options, refused tags and filters.
- Filters read their per-evaluation state from the render context instead of a closure: in `evaluate`, construct
  the context yourself — `new Context(env, liquid.options, {}, { liquid })` (`Context` is exported by `liquidjs`
  10.29; `Liquid._evalValue` does exactly this when handed a plain object, see
  `node_modules/liquidjs/dist/liquid.node.js` ~line 5088) — and put `{ scope, seedLabel, rolls: 0 }` on it with
  `ctx.setRegister(<private key>, …)`. Registers are not reachable from template text, so an expression cannot read
  or spoof them. Filters are `function (this: { context: Context }, …)` and read `this.context.getRegister(key)`.
  Pass `ctx` to `liquid.evalValueSync(expr, ctx)`. A fresh `Context` gets fresh render/memory limiters, as today.
- `checkExpression` and `expressionReads` use the same shared instance (they only parse/analyze).
- Rewrite the "One configured Liquid, for one evaluation … Per evaluation and not shared" comment to say what is true
  now and why state rides the context.
- Tests in `src/lib/server/state/expressions.test.ts` (read it first; keep every existing test unchanged and green):
  1. **Interleave**: evaluation A on scope A is mid-flight when evaluation B on scope B runs to completion on the same
     shared engine, and A then finishes with A's own answer (B with B's). Make the interleave real: e.g. an own-property
     getter on A's `owner` (`Object.defineProperty`) that calls `evaluate(exprB, scopeB, …)` when read, with A's
     expression reading that property before a `| slot` or `| roll` that must still see scope A / seed A. Assert both.
  2. Rolls stay deterministic per evaluation: the same seed label gives the same total across separate evaluations,
     and two rolls in one expression still use counters 0 and 1 (compare with the pre-change numbers — record them
     before you change the code).
  3. Benchmark: `describe.skipIf(!process.env.PERF_BENCH)("bench", …)`, 50 evaluations of e.g. `owner.hp | plus: 1`,
     `console.log` the p50 ms (sort, index 25). No timing assertion. **Run it on the unchanged code first**
     (`PERF_BENCH=1 npx vitest run src/lib/server/state/expressions.test.ts -t bench`) and record before/after.

## B. `src/lib/server/rulesets/resolve.ts` — `sessionAsleep` reads the links once (review row C8, part)

`sessionAsleep` (~line 668) calls `valueOf(db, { sessionId, owner: player_seat, slotId: "core:slot/asleep@1" })` per
seat with no `known`, so each call re-reads `sessionLinks`. Read `sessionLinks(db, sessionId)` once (it is already
imported in this file) and pass `{ links }` as `valueOf`'s third argument. Same short-circuit, same answers. Mark it
`/** Exported for tests. */ export`. Do NOT touch `writtenAgoOf` or `src/lib/server/state/resolve.ts`.
Test: new `src/lib/server/rulesets/sessionAsleep.int.test.ts` (PGlite, follow the setup in
`src/lib/server/rulesets/writtenAgo.int.test.ts`; 60 s timeout on each `it` that opens a DB): no seats → false; two
live player seats, none asleep → false; both asleep → true; one written back to awake → false (the write is seen on
the next call — there is no cache across calls). Write the slot values through the same state write API the existing
ruleset int tests use; find it, don't invent one.

## C. `src/lib/server/sockets/sessions.ts` (review rows C2, C11)

1. **Send handler** (`sessionMessagesSendPersonaMessageHandler`, the `// Check if session exists` block ~line 8864):
   `getPromptSessionFromDb(sessionId, userId)` loads the whole main-channel transcript and the cast only to test for
   null; nothing after it reads `session` (I checked lines ~8864–9050; re-confirm). Replace with an existence read
   that repeats no access check: `db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId), columns:
   { id: true } })`, same `refuse("Session not found")` sentence.
2. **`fireNarratorResponseHandler`** (~line 11534): replace the `getPromptSessionFromDb` read and
   `session.sessionMessages.some((msg) => msg.isGenerating)` with one `select … limit 1` over `session_messages`
   with EXACTLY the filters that snapshot applied to its rows — `session_id = ?`, `is_hidden = false`,
   `channelWhere(schema.sessionMessages.channel, DEFAULT_CHANNEL)` (both already imported/used in
   `getPromptSessionFromDb` ~line 2196) — plus `is_generating = true`. Same refusal sentence. The access check above
   it already proves the session exists, so drop that block's separate "session not found" branch and say so in a
   short comment; adjust the "getPromptSessionFromDb admits guests" comment to stay accurate.
3. **`buildSessionRefresh`** (~line 6195): the payload carries the same rows twice (`session.sessionMessages` and
   `messages`). The client reads `msg.session` → `sessionStore.merge(msg.session, coversFromId)` → its
   `sessionMessages` (`src/lib/client/components/sessionPage/sessionPageData.svelte.ts` ~988,
   `src/lib/client/sessions/store/sessionStore.svelte.ts` ~132); no client code reads the top-level `messages`
   (re-confirm with a grep of `src/lib/client` and `src/routes`). Drop `messages: rows`, keep
   `session: { …, sessionMessages: rows }` and `coversFromId`. `channels/lanePush.ts` narrows either array — leave it.
   Update tests that read the refresh payload's top-level `messages` to read `session.sessionMessages`:
   `src/lib/server/sockets/sessions.refreshPush.int.test.ts` (~lines 108–159) and any other test you find
   (`grep -rn "messages" … | grep -i refresh` over `src/lib/server/**/*.test.ts`, incl.
   `lorebooks.memberSessionPush.int.test.ts`, `sessions.dungeonCrawler.int.test.ts`). Change only what the dropped
   field forces.
4. **`sessions:update` handler** (`const updatedSession = await getSessionFromDB(params.session.id!, userId)` ~line
   7590) and **`reassignRemovedParticipant`** (~line 8772): both re-read every live row with parts for a reply whose
   readers never look at messages (`EditSessionForm.svelte` `handleSessionsUpdate` ~1910 reads `res.session.name`;
   `routes/document-view/sessions/[id]/edit/+page.svelte` `applySession` ~243 reads no `sessionMessages`;
   `handleReassignRemovedParticipant` reads only `success`/`error` — re-confirm each, and grep `src/lib/client` and
   `src/routes` for any other `sessions:update` / `sessions:reassignRemovedParticipant` listener). Pass `"none"` as
   `getSessionFromDB`'s third argument in both. Check tests asserting either reply's `sessionMessages`; if one does,
   stop and tell me rather than editing it.

## Files owned

`src/lib/server/state/expressions.ts` · `src/lib/server/state/expressions.test.ts` ·
`src/lib/server/rulesets/resolve.ts` (`sessionAsleep` only) · `src/lib/server/rulesets/sessionAsleep.int.test.ts` (new) ·
`src/lib/server/sockets/sessions.ts` (the sites in C only) · the socket test files C3 forces you to update.

## Files readable

Everything.

## Out of scope

Every other file and every other function in `sessions.ts` and `rulesets/resolve.ts`. `runtime/host.ts`,
`runtime/bindings.ts` (another session's). Shared types in `src/lib/shared/sockets/types.ts` (if a type comment there
goes stale, tell me). Any new setting, event or name.

## Stop and ask when

An answer would change; a test asserts behaviour you would have to alter; a client reader of a dropped field exists;
a site outside the named ones must change; a name visible outside its module is needed (beyond the `sessionAsleep`
export).

## Done means

All green, run individually with `npx vitest run <file>`:
- `src/lib/server/state/expressions.test.ts`
- `src/lib/server/rulesets/engine.test.ts`, `methods.test.ts`, `resolve.int.test.ts`, `functions.int.test.ts`,
  `writtenAgo.int.test.ts`, `memberForm.ctx.int.test.ts`, `sessionAsleep.int.test.ts`
- `src/lib/server/sockets/sessions.interestGate.test.ts`, `sessions.fireNarratorResponseLock.int.test.ts`,
  `sessions.refreshPush.int.test.ts`, `sessions.participantRemoval.int.test.ts`, `sessions.messageLengthCap.int.test.ts`,
  `sessions.readOnlyMode.int.test.ts`, `lorebooks.memberSessionPush.int.test.ts`, `attachments.int.test.ts`,
  `sessions.narrateDirection.int.test.ts`
- `npx tsc --noEmit -p . 2>&1 | grep -E "state/expressions|rulesets/resolve|sockets/sessions\.ts|sessionAsleep|refreshPush"` — nothing new
  (if `sessions.ts` already had errors before you, list them as pre-existing).
- `npx prettier --check <each changed file>` (if a file already failed before your edit, say so; never reformat a
  whole shared file).

## Report

Reply with: changed files with the functions touched; tests with pass counts; before/after p50 for A; what you
re-confirmed for each client reader; anything you noticed and did not do.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You should need no `sdk:build`.)
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- Never `git checkout` / `restore` in either repo. Never `prettier --write` on a directory. Never `kill -9` a dev server.
- Other uncommitted files in the tree (including other hunks of `sessions.ts`) belong to other lanes; never touch them.
