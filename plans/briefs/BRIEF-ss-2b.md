# BRIEF — build lane `ss-2b` — one writer for a session's genre settings and rigour (programme 2.1, second half)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/briefs/BRIEF-ss-2.md` section C **and** its "Cold review corrections" (C's summaries bullet is dropped;
do not build it), `plans/REPORT-ss-2a-2026-11-16.md` (what the first half changed in the same files),
`plans/INVENTORY-session-settings-2026-11-15.md`, `NOMENCLATURE.md` §1, §24.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write` (nor a scratch-copy
equivalent). Never commit. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-2b-<n>.log 2>&1"`,
one run at a time; wait for other lanes with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration, no SDK change, no full
run, no `npm run build`. Inside `db.transaction` only `tx`.

## Owner

2026-11-15: "lets focus on just cleaning up the mess". P2: "A module owns its data and every write to it …
Two writers of one thing is a bug."

## Build (paths under `src/lib/server/`; re-verify every line)

One module-owned function per stored thing, in the module that owns session settings (`sessions/settings.ts` or
beside `settingsForm.ts`: choose, say why):

- 🚧 `writeGenreFields(tx, sessionId, change)` where `change` is `(current) => next | null`: it **re-reads the
  column inside the transaction**, calls `change`, and writes only when the result is not `null` and differs.
  That shape is required by two callers: `speech/resolveVoice.ts` 408–433 re-reads under a per-session advisory
  lock before deciding (keep its lock; the function runs inside it), and `sessions/authorsNote.ts` 163–178
  compares first and writes nothing when nothing changed.
- 🚧 `writeRigour(tx, sessionId, value)` likewise.
- **Every update of the column goes through them**, each caller keeping its own permission checks and its own
  transaction: `sessions/settingsForm.ts` 333–346 and 410–427 (envoy voices), 313–318 (rigour);
  `sockets/sessions.update.ts` 378–401 (transaction from ~363; rigour ~398); the preset switch
  `sockets/sessions.pipelines.ts` 1166–1202, which today writes presetId, genreFields and rigour in one plain
  update with **no transaction**: wrap it in one (`presetId` stays that handler's own write, in the same
  transaction); `sessions/authorsNote.ts`; `speech/resolveVoice.ts`; `sessions/seatKeys.ts` 1358–1360 (a raw
  `putJson` on the column: route it through the function or, if it is a key rename inside the JSON that must
  not re-read, say why and allow-list it).
- **Not routed, allow-listed by name in the guard, each with its reason:** inserts of a new row
  (`sockets/sessions.create.ts` ~399, `sessions/branch.ts` ~197, `sockets/import.ts` ~1339, ~1490,
  `attic/etl/sessions.ts` ~100), boot / data passes (`sessions/honorModeRetired.ts` 103–106), `utils/testDb.ts`.
- **A guard test** (the repo's source-scanning conformance pattern): no `update(sessions)` that sets
  `genreFields` or `rigour`, and no raw JSON write on those columns, outside the two functions and the
  allow-list. It must catch the `putJson` form too.
- No behaviour change: what each caller writes, when, and what it emits afterwards is the same. The preset
  switch's new transaction must not hold a lock across a model call or a socket emit.

## Tests

Each caller still writes what it wrote (existing tests of the form door, `sessions:update`, preset switch,
author's note, voice resolution, seat keys: find and run them); the function (no write when unchanged or
`null`; re-reads inside the transaction: a concurrent change made between the caller's read and the write is
not lost); the preset switch is atomic (a failure after the genre fields write rolls back the preset id); the
guard. `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

The files named above (only the write sites), the new functions' module, the guard test, `NOMENCLATURE.md` (§25
and the rows that name who writes these columns). Not `pipelines/config/*`, `pipelines/registrations/*`,
`pipelines/boot/*` (the first half's), not `lorebooks/*`.

## Stop and ask when

CLAUDE.md §Decisions applies; a caller cannot use the function without changing what it writes or when; the
preset switch cannot be made atomic without holding a transaction across an await on something slow.

## Report

Final message = the report (lead saves `plans/REPORT-ss-2b-<date>.md`): every writer found and how it now
writes; the allow-list with reasons; names; tests; **Noticed, not done**. Under about 400 words.
