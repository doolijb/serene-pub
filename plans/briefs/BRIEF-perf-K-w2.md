# BRIEF — perf-K worker 2 — plugin fetch cap (★P4) and invocation log retention (★P5)

Supervisor: lane `perf-K` (`plans/briefs/BRIEF-perf-K.md`). Report to `plans/REPORT-perf-K-w2.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Owner rulings (2026-11-13) you are applying

- **★P4:** "4 MB fetch cap, refused with a named sentence." Larger payloads belong in `ctx.storage`, not a hook return.
- **★P5:** "Invocation log: keep 30 days or newest 50,000, pruned every 100 writes." Recommendation text it ruled:
  "Keep 30 days or the newest 50,000 rows, whichever is smaller, pruned every 100 writes like notifications."
  → *whichever is smaller* means the KEPT set is the smaller of the two, i.e. **both** cuts apply every prune: delete
  rows older than 30 days, and delete everything beyond the newest 50,000.

## Files owned (edit only these)

- `src/lib/server/plugins/fetchHost.ts` (+ `fetchHost.test.ts`, `fetch.int.test.ts`)
- `src/lib/server/plugins/store.ts` (+ `store.int.test.ts`, or a new `store.retention.int.test.ts`)
- `docs/plugins.md` (one sentence for the fetch cap)

**Files readable:** anything. Notably `plugins/engineHost.ts:60` (`ENGINE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024`, the
naming and size pattern to follow), `notifications/store.ts` (`PRUNE_EVERY`, `raisesSinceBoot`, `pruneNotifications`
~l.406 — the pattern to copy), `plugins/index.ts:51` (the only caller of `writeInvocation`: `void writeInvocation(handle, rec).catch(...)`),
`plugins/QuickJsSandbox.ts` / `SesWorkerSandbox.ts` (how `FETCH_HOST_SOURCE` is spliced into both backends).

## Step A — fetch cap (`fetchHost.ts`)

`FETCH_HOST_SOURCE` is a **source string** evaluated in the worker's Node scope (the eval workers cannot import
modules); `fetch` there is Node's, so `res.body` is a web `ReadableStream`. Today, ~l.315:
`var text = mask(await res.text());` reads the body unbounded.

1. Export a named constant from `fetchHost.ts`: **`FETCH_RESPONSE_MAX_BYTES = 4 * 1024 * 1024`** (the name is
   fixed by the supervisor; NOMENCLATURE §25 records it). Splice its value into the source string with `${...}` the
   way the file already splices `pluginRuleRef(...)`, so the number exists once.
2. Replace `res.text()` with a bounded read: if `Content-Length` is present and exceeds the cap, refuse before
   reading; otherwise read `res.body` chunk by chunk with a `TextDecoder` (`{ stream: true }`, then a final
   `decode()`), counting **bytes**; the moment the count exceeds the cap, `reader.cancel()` and refuse. A null
   body is `""`. A body of exactly the cap passes.
3. The refusal is **one named sentence**, thrown as an `Error` like the file's other refusals and identical on both
   backends:
   `fetch: the response is larger than 4 MB — keep bigger payloads in ctx.storage`
   (derive "4 MB" from the constant so they cannot drift.) Do not add a new `pluginRuleRef` id.
4. Masking still runs on the text that passed (`mask(text)` as now), and on the headers as now.
5. Redirect hops are already capped at 5 — keep that untouched. Do not touch the allowlist, SSRF, secrets or
   cancellation code.

Tests (in `fetch.int.test.ts`, which already runs a 127.0.0.1 server on both backends — follow its patterns):
- a body of `FETCH_RESPONSE_MAX_BYTES + 1` bytes is refused with that sentence (both a `Content-Length` response
  and a chunked one with no length — two cases);
- a body of `FETCH_RESPONSE_MAX_BYTES - 1` bytes passes intact (check length);
- the secret-echo masking (see the `secret handles at the network boundary` block) still masks a body that passed.
- Both backends (`describe.each(BACKENDS)` where the file does).

Doc: `docs/plugins.md` l.39 is the network-permission bullet. Add one plain sentence there (owner-facing, no code
words): a reply bigger than 4 MB is refused; a plugin keeps bigger things in its own storage.

## Step B — invocation retention (`store.ts`)

`writeInvocation(db, rec)` (~l.166) inserts one row per hook call and nothing ever deletes them.

1. Exported constants (names fixed by the supervisor): **`INVOCATION_RETENTION_DAYS = 30`**,
   **`INVOCATION_MAX_ROWS = 50_000`**; a module-local `PRUNE_EVERY = 100` and a `writesSinceBoot` counter, exactly
   the notifications shape: prune when `writesSinceBoot++ % PRUNE_EVERY === 0` (so the first write after boot
   prunes too).
2. An exported `pruneInvocations(db: Db, now: Date = new Date(), opts: { days?: number; maxRows?: number } = {})`
   that runs **two queries, one each, on the `db` handle it was given**:
   - `DELETE … WHERE finished_at < now − days`;
   - `DELETE FROM "plugin_hook_invocations" WHERE "id" IN (SELECT "id" FROM "plugin_hook_invocations" ORDER BY
     "finished_at" DESC, "id" DESC OFFSET <maxRows>)` (or an equivalent single statement).
   The new index `plugin_hook_invocations_finished_idx` on `finished_at` (migration 0158, already generated) backs
   both.
3. `writeInvocation` calls it after its insert, on the same handle. A prune failure must not fail the insert's
   promise silently or loudly in a way that loses the row: catch it and `console.warn` one line
   (`[plugins] invocation log prune failed: …`).
4. No setting, no timer, no randomness (P1, P3).

Tests: insert rows past both limits with `pruneInvocations(db, now, { days: 30, maxRows: 5 })`-style small limits
(and one test at the real constants' *logic* with small opts, not 50,000 real rows): rows older than the cut are
gone; only the newest `maxRows` by `finished_at` survive; when both apply, the survivors are the intersection.
Plus one test that the 100-write cadence calls the prune (e.g. the first write prunes; spy or observe an
over-age row disappearing on the first `writeInvocation` after a fresh module import — pick one honest check).

## Rules (quoted from CLAUDE.md and the lane brief — they bind you)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." The prune
  uses the handle `writeInvocation` was given — never import the global `db` into `store.ts` for it.
- "Never seed a row at a hardcoded id."
- P1: "markers and retention are deterministic (count- and date-based, no randomness, no timers beyond what
  notifications already do)". P3: "no setting for any of this."
- P2: "`plugins/store.ts` owns invocation rows; the prune lives there."
- Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in
  passing. Introduce no name beyond `FETCH_RESPONSE_MAX_BYTES`, `INVOCATION_RETENTION_DAYS`,
  `INVOCATION_MAX_ROWS`, `pruneInvocations` (and module-locals).
- Do not touch `db/schema.ts` or `drizzle/`.

## Hygiene (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You should not need `sdk:build`.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)."
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.
- Use absolute paths; the repo is `/home/jody/github/serene-pub`.

## Done means

Green in a capped scope: `src/lib/server/plugins/fetchHost.test.ts`, `src/lib/server/plugins/fetch.int.test.ts`,
`src/lib/server/plugins/store.int.test.ts`, `src/lib/server/plugins/store.pluginId.test.ts`, any new test file.
`npx tsc --noEmit -p .` shows no error in your files (filter by path). `npx prettier --check` on each file you
edited (say which were already unclean at HEAD).

## Report (`plans/REPORT-perf-K-w2.md`)

Changed files; each rule and how you met it; tests with pass counts; the exact refusal sentence as shipped;
**Noticed, not done**.
