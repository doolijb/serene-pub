# BRIEF — lane `dbg-1`, worker 2 — app server: the stored switch, its socket, the run option, the notice, the Overview item

Supervisor: lane `dbg-1`. App repo `/home/jody/github/serene-pub`. SDK `/home/jody/github/serene-pub-sdk` (read only for you).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You do not run `sdk:build`, `db:generate`, `npm run build`, `npm test`, `tsc` or `npm run check`: the supervisor does. Never `git checkout / restore / stash` in either repo. Never `prettier --write`. Never `kill -9` anything.

## Goal

Owner, 2026-11-15: "Lets add a global debug off switch in the admin for pipeline step await time so we have a safety
fallback." One pub-wide admin setting, **off by default**, admin only. While on, core passes the SDK run option
`stepTimeLimitsOff: true` (being added to `RunOptions` by another worker right now; until the supervisor rebuilds the SDK,
TypeScript will not know the field: that is expected, write the code anyway) so the executor applies no step limit and no
ceiling for runs that **start** after the change. While on, administrators get a standing notification and the admin
Overview's *Needs you* list carries an item. The browser side (the Diagnostics card, the Turn line) is another worker's.

## Names (fixed by the supervisor; use exactly these)

- Column: `stepTimeLimitsOff: boolean("step_time_limits_off").notNull().default(false)` in `system_settings`.
- Reader: `export async function stepTimeLimitsOff(db: Db): Promise<boolean>` in `pipelines/runtime/callTether.ts`.
- Socket event: `systemSettings:updateStepTimeLimitsOff`, params `{ enabled: boolean }`, response `{ success: boolean; enabled: boolean }`.
- Notification kind `STEP_TIME_LIMITS_OFF`, id `core:notification/step-time-limits-off@1`; `regardingFor.stepTimeLimitsOff()` → `app:step-time-limits-off`.
- Where the notice and the Overview item land: `/admin/diagnostics#step-time-limits-off` (the card's `SettingSwitch name`).
- Overview fact: `pipelines.stepTimeLimitsOff: boolean`; attention item id `pipelines:stepTimeLimitsOff`.

## Files owned (only these)

1. ~~`src/lib/server/db/schema.ts`~~ — **done by the supervisor**: the column exists (beside `contextDebuggingEnabled`) and the migration `drizzle/0168_sparkling_lethal_legion.sql` is generated. Do not edit `schema.ts` or anything under `drizzle/`.
2. `src/lib/server/pipelines/runtime/callTether.ts` — the reader.
3. `src/lib/server/pipelines/runtime/runTurn.ts` and `src/lib/server/pipelines/runtime/cardAction.ts` — read once at run start, pass the option.
4. `src/lib/server/sockets/systemSettings.ts` — the handler + registration.
5. `src/lib/shared/sockets/types.ts` — the event's namespace beside `UpdateContextDebuggingEnabled` (~15094); the Overview response's `pipelines.stepTimeLimitsOff` (~3150). Another lane may be editing this file: make small, additive edits with `Edit`, re-read the region just before each edit.
6. `src/lib/client/sockets/typedSocket.ts`, `src/lib/shared/sockets/interest.ts`, `src/lib/server/adminLogbook/events.ts` — register the event wherever `systemSettings:updateContextDebuggingEnabled` is registered (grep it; follow each entry exactly; there may be drift tests that require every event to appear).
7. `src/lib/shared/notifications/kinds.ts` — the kind and the `regardingFor` key.
8. New `src/lib/server/notifications/stepTimeLimitsOff.ts` — the producer.
9. `src/lib/server/sockets/adminOverview.ts`, `src/lib/server/admin/attention.ts` — the fact and the item.
10. Tests: `src/lib/server/admin/attention.test.ts` (append), new `src/lib/server/sockets/systemSettings.stepTimeLimitsOff.int.test.ts`, `src/lib/server/pipelines/runtime/callTether.test.ts` (append, if the reader is tested there), and whatever test proves runTurn/cardAction pass the option (see below).

Do not touch `src/lib/server/sockets/sessions.ts` or any `sessions.*.ts` socket module, `pipelines/runtime/bindings.*`,
`pipelines/runtime/host.ts`, or the SDK.

## Work

### 1. Column (schema.ts) — already done by the supervisor, for reference only

```ts
/**
 * 🚧 **Turn off step time limits** (Admin › Diagnostics; owner 2026-11-15, lane dbg-1): a diagnostic switch, off by
 * default. While on, runs that start pass `stepTimeLimitsOff` to the executor, which then applies no step
 * `timeoutMs` and no ceiling; Stop still ends every run. Limits enforced inside a call stay on whatever this says:
 * script and plugin sandbox deadlines, tool hooks, the connection's idle watchdog. Read only through
 * `stepTimeLimitsOff()` (`pipelines/runtime/callTether.ts`).
 */
stepTimeLimitsOff: boolean("step_time_limits_off").notNull().default(false),
```

### 2. Reader (callTether.ts)

Precedent: `scriptsEnabledFor(db)` in `pipelines/scripts/chains.ts` ~894 (select the one column from row id 1;
missing row or a read error → `false`, i.e. limits on; never throws). JSDoc: the one function every caller uses; nobody
reads the column themselves. Keep `callTether.ts`'s imports light (check how `chains.ts` imports schema / drizzle and
whether `callTether.ts` is imported somewhere that must not load the DB; take `db` as a parameter, never import
`$lib/server/db` here).

### 3. Run start (runTurn.ts, cardAction.ts)

- `runTurn.ts`: beside `const scriptsOn = await scriptsEnabledFor(request.db)` (~966) read
  `const limitsOff = await stepTimeLimitsOff(request.db)`; at the `run(...)` options (~1200, beside
  `timeoutCeilingMs: ceilingFor(...)`) add `...(limitsOff ? { stepTimeLimitsOff: true } : {})` with a one-line
  comment. Keep `timeoutCeilingMs` as it is.
- `cardAction.ts` (~282): the same, reading with its `db`, once before `run(...)`.
- Only these two call the executor's `run` in core (checked by the supervisor).

### 4. Socket handler (systemSettings.ts)

Model it on `systemSettingsUpdateLoreWriteModeDefault` (~419: `refusable(...)`, admin check with a sentence, write,
reply, broadcast `systemSettings:get` to every interested socket with `emitToInterested`, because every admin's
Diagnostics card and every admin's Turn line read it). Admin check sentence:
`"Only an administrator can turn step time limits on or off."`; refusable fallback:
`"Step time limits could not be changed."`. After the write: call the producer (5) with the new value, then
`markAdminOverviewStale()` (`$lib/server/admin/overviewStale`). Register it in `registerSystemSettingsHandlers`.
`params.enabled` must be a boolean or the handler refuses (`"Say on or off."` is fine; check how
other handlers here validate booleans and match them).

### 5. The notice (kinds.ts + stepTimeLimitsOff.ts)

Kind, placed beside `UPDATE_AVAILABLE`, with a JSDoc saying it is a **condition** (it clears only when the switch goes
off; viewing it only marks it read), raised for every administrator:

```ts
export const STEP_TIME_LIMITS_OFF = defineNotificationKind({
	id: "core:notification/step-time-limits-off@1",
	level: "attention",
	clearsOn: "resolve",
	title: "Step time limits are off",
	detail: "A stuck step waits until someone stops it.",
	cta: "Open Diagnostics"
})
```

`regardingFor.stepTimeLimitsOff: () => "app:step-time-limits-off"`.

Producer `syncStepTimeLimitsNotice(on: boolean, db?: Db): Promise<void>` in the new file, modelled on
`notifications/updateAvailable.ts` (header JSDoc, `db ?? appDb`, never throws, logs): on → `raiseNotification` to every
admin who is not deleted, `href: "/admin/diagnostics#step-time-limits-off"`; off → `clearNotifications({ regarding }, "acted", d)`.
Read the `kinds.ts` header ("What it is not") and `NOTIFICATION_CLEARED_HOW`; the owner asked for this notice explicitly
(2026-11-15: "notification/activity, admin dashboard, and in the session activity/turn order widget"), which is why a
condition is also a notification here: say so in the kind's JSDoc in one line.

### 6. The Overview (adminOverview.ts, attention.ts, types.ts)

- Fact: `pipelines.stepTimeLimitsOff` gathered with the reader (`await stepTimeLimitsOff(db)`), typed in
  `Sockets.Admin.Overview.Response.pipelines` with a one-line JSDoc.
- Item in `attentionFor`, placed after the extensions items, before the sort:

```ts
// 🚧 A diagnostic switch an admin left on (lane dbg-1): while it is, a stuck step waits for Stop in every session.
if (facts.pipelines.stepTimeLimitsOff) {
	out.push({
		id: "pipelines:stepTimeLimitsOff",
		level: "attention",
		title: "Step time limits are off",
		detail: "A stuck step waits until someone stops it, in every session.",
		section: "/admin/diagnostics",
		action: { label: "Open Diagnostics", href: "/admin/diagnostics#step-time-limits-off" }
	})
}
```

- Any other fixture that builds a full `OverviewFacts` / `Overview.Response` (grep `runs24h` across `src/**/*.test.ts`
  and `*.svelte.ts`) gets `stepTimeLimitsOff: false` so types hold.

### 7. Tests

- `attention.test.ts`: the item appears when the fact is true (id, level `attention`, action href), and not when false.
- New `systemSettings.stepTimeLimitsOff.int.test.ts` (pattern: `systemSettings.summarizationAlwaysOn.int.test.ts`: the
  `vi.mock("$lib/server/db", …createTestDb)` and `defaults.sync()` in `beforeAll` with a 60 s timeout, `releaseDataDir`
  in `afterAll`; give each `it` that opens or writes the DB a 60 s timeout): the column defaults to false on a fresh
  migrated DB and `stepTimeLimitsOff(db)` reads false; a non-admin socket is refused and nothing is written; an admin
  turns it on → column true, reader true, one open `core:notification/step-time-limits-off@1` row per admin (seed a
  second admin and a member: the member gets none); turning it off → the reader false and those rows cleared with
  `clearedHow` `acted`. Check how other int tests fake the socket for a `refusable` handler (its `io` may be absent:
  the broadcast must tolerate that, as the precedent does).
- runTurn / cardAction pass the option: find the lightest existing harness that captures the options handed to the
  SDK's `run` (grep `vi.mock("@serene-pub/sdk"` and `runTurn` tests; `runTurn.int.test.ts` exists). If one exists,
  add a case: switch on → `run` got `stepTimeLimitsOff: true`; off → the key absent. If none exists and building one
  would be large, do not build it: say so in your report and the supervisor decides.

Run tests only like this, one run at a time, from the app root, after waiting for no other vitest:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dbg-1-w2-<n>.log 2>&1"
```

Never pipe vitest into `head` (the SIGPIPE leaks PGlite temp dirs). The migration is generated (0168), so the int test can run.

## Rules (quoted by the supervisor)

- CLAUDE.md Hard rules: "Migrations are **generated** (`db:generate`)." "Inside `db.transaction(async (tx) => …)` use only `tx`." "Never seed a row at a hardcoded id." "It is a **session**, never a *chat*."
- CLAUDE.md Standing rulings, Sockets: "one domain context per event family (provided by both shells) is the only listener, and the only place that toasts". (Server side: emit the reply and the `:error` as the precedent does.)
- P1: "every automatic action shows its cause and how to undo or switch it off." The notice and the item each say where to switch it off (the href).
- STYLE-GUIDE §10: "Sentence case everywhere." "A button says what happens." "errors say what went wrong and what to do." §6.11: "Status is a dot plus words … `primary` for needed-and-missing or anything else to act on".
- NOMENCLATURE R6: new vocabulary is 🚧 provisional; mark it in JSDoc.
- Do the asked thing at the asked size; anything else you notice goes in your report under **Noticed, not done**.

## Done means

All the above written; `attention.test.ts` (+ `callTether.test.ts` if touched) green; the int test green; `npx prettier --check` on each edited file (report; never `--write`; say if
a file failed before your edit). Final message to the supervisor: files changed, tests run with results (log paths),
anything not done and why, Noticed-not-done.
