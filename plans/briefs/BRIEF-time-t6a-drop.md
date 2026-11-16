# BRIEF — small lane `time-t6a-drop` — remove the per-message seated set (`firsthand_cast_member_ids`)

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-time-t6a-2026-11-15.md` (**the list of everything lane `time-t6a` added: this lane removes exactly
that**), `plans/REPORT-time-t6b-2026-11-15.md` (the filter that replaced it; it does not read the column),
`NOMENCLATURE.md` §14 (**firsthand**) and §25.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`; never `prettier --write`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite"` (dev **and** preview; the Svelte language server's esbuild is
not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`. If a server or a run is up, don't build;
report 'blocked on your dev server'.

## Why

Owner, 2026-11-15, on a per-message record of "seated and not benched": "unreliable, if someone is benched i.e.
user doesn't want them to respond automatically but still considers them in scene". The presence rule became
"spoke in the scene, narrowed by place" (lane `time-t6b`), which reads scenes and the stat trail, never this
column. Asked "Drop yesterday's unused per-message stamp?", the owner answered: **"Yes"** (2026-11-15).

Standing: "0.6 is in users' hands": a **forward** migration (generated: `npm run db:generate`; its index must
exceed the highest applied; today's highest is `0165_message_firsthand`, so this is 0166; never edit or delete
0165) and a test that a second boot changes nothing. Migrations are generated, never hand-written.

## Build

1. Inventory (supervisor, read-only): every reference to `firsthandCastMemberIds`, `firsthand_cast_member_ids`,
   `messages/firsthand.ts` and its exports (`withFirsthandStamp`, `firsthandRedrive`, `repointFirsthand`,
   `firsthandOf`) in both repos, including tests, docs, the SDK's `MESSAGE_HOST_FIELDS`, the `MessageV1`
   "Withheld" doc and `sdk-tests/messageRowContract.test.ts`, branch copies, Reassign's handlers, imports and
   exports of sessions, and any backup / attic code that lists message columns.
2. Remove the column from `src/lib/server/db/schema.ts`; generate migration 0166 (it must contain only the
   column drop); remove `messages/firsthand.ts`, its calls in the message store and the handlers, and its tests.
3. SDK: remove the host field and its doc line; fix the contract test's fixture. `npm run sdk:build`, then
   `npm run sdk:test` (capped form below).
4. A message row must read and write exactly as before lane `time-t6a` in every other respect: the insert adds
   no statement, branch copy, Back, Forward, Reassign and re-drive unchanged.
5. `NOMENCLATURE.md`: the §14 **firsthand** row loses its clause about the column; a §25 line records the removal
   (the word now means only the filter's rule). No docs page mentions the column; confirm.

## Files owned

`src/lib/server/db/schema.ts` (the one column), `drizzle/0166_*.sql` + meta (generated),
`src/lib/server/messages/firsthand.ts` and its tests (deleted), the call sites lane `time-t6a` added (message
store, Reassign handlers, branch copy: only to remove its lines), the SDK's message host fields, doc line and
contract test, `NOMENCLATURE.md`.

## Stop and ask when

Anything outside lane `time-t6a`'s additions reads the column; the generated migration contains more than the
column drop (another lane's unpublished schema change is riding along: report it, do not ship it); the journal's
highest index is not 0165.

## Done means

- Migration 0166 generated, only `DROP COLUMN`; a second-boot test; a fresh database and a database migrated
  from 0165 with stamped rows both end with the same schema.
- `npm run sdk:build` (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t6a-drop-sdk.log 2>&1"`:
  only the four known failures.
- One capped app run at a time
  (`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t6a-drop-<n>.log 2>&1"`):
  `src/lib/server/messages`, `src/lib/server/sessions`, the sockets tests the removed call sites touch, the
  migration / journal / schema-consistency tests under `src/lib/server/db`, `sdk-tests` contract via `sdk:test`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t6a-drop-<date>.md`): the inventory,
the migration's SQL, changed and deleted files in both repos, when you ran `sdk:build`, tests with results,
anything stopped on. Under about 400 words.
