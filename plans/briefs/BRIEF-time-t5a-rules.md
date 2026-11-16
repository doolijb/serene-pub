# Rules every `time-t5a` worker follows (quoted by the supervisor; read before you start)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**In this lane: no SDK edit, no `sdk:build`, no `npm run build`, no dev server, no GPU or local model.** The
owner's own server holds his real database. Another Claude session shares the checkout.

## Owner rulings this lane builds

- 2026-11-13, asked what a session that plays at a story date does to an existing entry under Full: "Write a
  dated change straight into the lorebook".
- 2026-11-13: "file it right away. if review is off, write directly to the lorebook".
- 2026-11-14, "Lets go with all your recommendations", which rules: one version per entry, line and date, a
  second write that day updates it; a version cannot be dated before the entry's Beginning; "the turn's undo is
  the per-turn record; every write also lands in the edit history"; ★FD-9 (Apply's move path and rule C: the
  day waits with the reason).
- 2026-11-14: "Settle one scene behind" (how settling works now; this lane does not change it).
- 2026-11-12: "a routine-saved summary never settles; Back resets it" (do not disturb).
- Standing P1: a new automatic behaviour shows its cause and how to undo it. P2: one writer per thing —
  `lorebooks/imprints.ts` owns the per-turn record (`lore_imprints`); dated versions (`entry_amendments` rows
  with `base` NULL) have ONE writer, `writeEntryVersion` in `lorebooks/entryVersions.ts`.

## Words

A **dated version** / **entry version** is an `entry_amendments` row with `base` NULL on a lorebook, at a line
(`branch_id`, null = main) and date (`year`, `month`, `day`). A **held change** is an `entry_amendments` row in a
session's notes (own book) with `base` set: it waits for Apply. The **per-turn record** is `lore_imprints`
(code: *imprint*); the **edit history** is `lore_redlines` (code: *redline*). It is a **session**, never a
*chat*.

## Hard rules

- Migrations are generated only (`db:generate`), never hand-written; a new migration's index must exceed the
  highest applied or it is silently skipped. **Workers generate no migration** (the supervisor made 0164).
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a hardcoded id.
- An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload. (No new
  event is expected in this lane; if you think you need one, stop and report.)
- Comments state the rule, not the story (no "added for lane X", no "previously").
- Never `prettier --write` beyond the lines you changed (never on a whole file or directory). Check with
  `npx prettier --check <file>` and leave pre-existing format failures alone.
- An int test that opens a DB inside an `it` takes a 60 s timeout (`vi.setConfig({ testTimeout: 60_000,
  hookTimeout: 60_000 })` as the sibling tests do).
- Never `kill -9` anything. Never `git checkout` / `restore` / `stash`.
- No new user-facing sentence, name, setting, event or table beyond what your brief names; if one seems needed,
  stop and say so in your report.

## Running tests

One file set at a time, from the repo root, and only after checking nobody else's vitest is running:

```
ps -eo pid,args | grep -E "node.*vitest" | grep -v grep     # wait while anything prints
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t5a-<name>.log 2>&1"
```

Never pipe vitest into `head`. Read the log with `tail`/`grep`. Typecheck your files with
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (it is slow; run once at the end; report only
errors in your files).

## Report

Your final message: changed files; each test file run with pass/fail counts and log path; every name and
user-facing sentence you added; anything you could not do as briefed; Noticed, not done (findings outside
your brief, never fixed in passing).
