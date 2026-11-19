# BRIEF — perf-2 worker w3 — `rowNaming` builds the narrator name only when the own voice needs it

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-2`. Report: your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`. Run no git command that changes the index or the working tree. Do not edit `host*.ts`,
`sessions/rewind.ts` or any file but the two below.)

## Goal

`rowNaming(db, sessionId)` (`src/lib/server/sessions/turnYield.ts` ~line 233) is called on every rewind check of
the actions push (`rewind.ts:520`, and per creator run through `turnYieldOf` → `turnYield.ts:197`; 5 calls per
Lair turn). Each call runs `narratorNameFor` — a whole `buildWorld` (~100 statements) — in parallel with
`sessionDeclaredEnvoys`. But the narrator name feeds only `ownVoice = ownVoiceName({ envoys: declared,
narratorName })`, and `ownVoiceName` (`src/lib/shared/sessions/ownVoiceName.ts:46`) uses it **only when no
fallback envoy names the own voice** (fallback envoy's trimmed name, else narrator name, else the unclaimed
line's name). The Lair declares a fallback envoy (Castellan), so all five builds are wasted there.

Change `rowNaming` so it reads the declared envoys first and calls `narratorNameFor` only when the own voice
would consult it — **without copying `ownVoiceName`'s rule**:

```ts
const declared = await sessionDeclaredEnvoys(db, sessionId).catch(() => [])
// The narrator name is the own voice only where no fallback envoy names it
// (`ownVoiceName`): asked the rule itself, with no narrator, and built only when
// its answer is the unclaimed line's.
const narratorName =
	ownVoiceName({ envoys: declared }) === ownVoiceName(null)
		? await narratorNameFor(db, sessionId, undefined).catch(() => undefined)
		: undefined
```

Check `ownVoiceName`'s source type (`OwnVoiceSource`) accepts `{ envoys }` alone and `null`; adapt the call
shape to the types, not the logic. Correctness argument (put it in your report): when the two answers differ, a
fallback envoy named the voice and the narrator name is never read; when they are equal, the narrator is built
exactly as today (including the corner case of an envoy literally named like the unclaimed line, where the
result is still the envoy's). `envoyName` and the returned shape stay exactly as they are. Keep the doc comment
accurate (one line saying the narrator name is built only where the own voice needs it). Touch nothing else.

## Tests (new file `src/lib/server/sessions/turnYield.rowNaming.int.test.ts`)

`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`. Use real shipped genres where you can (find how
tests create a Lair session and a Story session: e.g. `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts`,
`src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts`, or a smaller fixture you find).
- **Lair (fallback envoy):** `rowNaming(db, sid).ownVoice` equals
  `ownVoiceName({ envoys: await sessionDeclaredEnvoys(db, sid), narratorName: await narratorNameFor(db, sid, undefined) })`
  (the old rule computed directly), and `rowNaming` issues no `buildWorld` (count statements by wrapping
  `db.$client.query` as `host.sessionCastMemo.int.test.ts` does and assert fewer than ~20, or spy — say which).
- **Story (no fallback envoy):** the same equality, and the narrator name is consulted (the answer is the
  narrator's name, not the unclaimed line's).
- If you can do it without heavy mocking, a fallback envoy with an empty name falls through to the narrator name
  (mock `sessionDeclaredEnvoys` with `vi.mock` + `importOriginal`); otherwise skip and say so.

Run only as (one at a time, always at least one path):
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-2-w3-<n>.log 2>&1"`
Never pipe vitest into `head`. Done means green: the new file, `src/lib/server/sessions/rewind.int.test.ts`,
`src/lib/server/sessions/rewind.noFloor.int.test.ts`. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-2-w3-tsc.log 2>&1` — 0 errors.
Do not run the two baseline tests (the supervisor does).

## Rules (quoted from the lane's contract)

- "No behaviour change: … what any read returns, the order of writes and what every socket push carries are
  unchanged. No caching across runs." (No memo here at all: the change only skips a read whose answer is unused.)
- "If a cut cannot be made without changing an output, record it as rejected with the reason."
- CLAUDE.md Principles P1: "Same inputs, same result."; one rule, one home: call `ownVoiceName`, never restate it.
- CLAUDE.md: "It is a **session**, never a *chat*." No new name.
- `turnYield.ts` is already not prettier-clean: `npx prettier --check` only, **never `--write`**; house style
  (tabs, double quotes, no semicolons).

## Stop and ask when

The types force a different shape of the check; a rewind test fails for a reason you can't tie to the change.

## Report (final message, under ~250 words)

Changed files; the correctness argument; tests with results; tsc; prettier; noticed, not done.
