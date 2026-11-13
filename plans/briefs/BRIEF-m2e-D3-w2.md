# BRIEF m2e-D3-w2 — `frameCauseOfInvoke` asks `personMay`

Lane `m2e-D3`, worker 2. Supervisor wrote this from the lane brief `plans/briefs/BRIEF-m2e-D3.md` (context only; THIS file is your contract). Work in `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` for this task.)

## Shared tree
Other agents edit server files at the same time (a story-playtest programme edits `auth/actingPerson.ts` among others — you only IMPORT from it, never edit it; worker w1 edits `sockets/starterKits.ts`, `sockets/plugins.ts`, `plugins/providedBooks.ts`). **Re-read your file immediately before every edit**, additive minimal hunks, **never reformat** (no prettier --write).

## Files owned
- `src/lib/server/plugins/pluginActions.ts` — only `frameCauseOfInvoke` (~line 45–63) and the import list
- `src/lib/server/plugins/pluginActions.int.test.ts` (only if a case needs adjusting or one is worth adding)

## The fix
`frameCauseOfInvoke` decides session access with `checkSessionAccess(fromApplet.sessionId, userId, db)` (~line 57), while the owner's ruling ★B made `personMay` the one decider for a press. Replace that check with:
```ts
const person = await actingPersonFor(db, { via: "view", userId })
if (!person || !(await personMay(db, person, "read", { kind: "session", id: fromApplet.sessionId })).ok) return undefined
```
— the acting person built the way the applet door does (`src/lib/server/plugins/appletDoor.ts:55`: `actingPersonFor(db, { via: "view", userId: … })`). Import `actingPersonFor` and `personMay` from `$lib/server/auth/actingPerson`. Drop the `checkSessionAccess` import if nothing else in the file uses it (check). Behaviour is unchanged today (`personMay`'s `session`/`read` branch is `checkSessionAccess(...).hasAccess`), so a later narrowing applies to both doors. Check `PersonAnswer`'s shape in `actingPerson.ts` (`.ok`) before writing; check `actingPersonFor` returns null for a deleted/unknown user (then: no cause). Update the doc comment's "a session the person may open" only if it now reads wrong; no other prose.

## Rules (quoted)
- "Decide implementation inside the asked scope … name the choice in your report." "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." No new exported name, setting, event or migration (lane brief).
- Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx`." (n/a unless you add one; don't.)
- Tests: targeted only; **never pipe vitest into `head`**; int tests opening a DB in an `it` need a 60 s timeout. Run `cd /home/jody/github/serene-pub && npx vitest run src/lib/server/plugins/pluginActions.int.test.ts src/lib/server/plugins/pluginActions.storage.int.test.ts 2>&1 | tail -40`.
- End with `npx tsc --noEmit -p . 2>&1 | grep "plugins/pluginActions"` and report the result.

## Done means
`src/lib/server/plugins/pluginActions.int.test.ts` green with the existing cases a–f unchanged and passing; `pluginActions.storage.int.test.ts` green.

## Report
Write `plans/briefs/REPORT-m2e-D3-w2.md`: the hunk, tests run with counts, tsc grep result, Noticed, not done. Then end.
