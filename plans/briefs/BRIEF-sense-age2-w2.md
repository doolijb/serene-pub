# BRIEF — lane `sense-age2`, worker 2 — hand a ruleset function how long ago each value was written

You are a `lane-worker` for the supervisor of lane `sense-age2` in /home/jody/github/serene-pub (sibling SDK at
/home/jody/github/serene-pub-sdk). Read this whole brief before touching anything. Use absolute paths. Return your
report as your final message.

## Background

Owner, 2026-11-11: "Lets make sure a time delta since last save/update on a property is accessible by scripts."
"I.e. sleep could incriment down while awake, incriment up by x while asleep." "yes on real time as well, opt in of
course". Then, ruling the storage: "I think we are okay just tracking stat time relative to the session."

So each `attribute_values` row now carries the **writing session's story clock** (five nullable `story_clock_*`
columns, stamped by `setValue`; null when no session wrote it). **Worker 1 is building, in parallel**, the read
that returns it, in `src/lib/server/state/resolve.ts` — code against this exact signature (it may not exist yet when
you start; it will by the time the supervisor runs the integration test):

```ts
export interface ValueWriteStamp {
	clock: StoryClock | null   // the writing session's story clock; null: no session wrote it / no clock / predates stamping
	writtenAt: Date            // the row's created_at
}
export async function valueStampsOf(
	db: Db, sessionId: number, owner: StateOwner, slotIds: readonly string[],
	known?: { links?: SessionLinks | null }
): Promise<Map<string, ValueWriteStamp | null>>   // per slot: the stamp of the row valueOf takes its value from; null when no stored row answers
```

Already built by the first lane (do not change): `FunctionProps.countsTime?: 'story' | 'real' | 'both'` in the SDK —
**this is the real-time opt-in**: a function whose declaration says `'real'` or `'both'` is handed real seconds;
nothing else is.

## The envelope key: `writtenAgo` (chosen by the supervisor under NOMENCLATURE §24; `since` is taken by the
`stat-trail` in-port and a history "since {date}"; `elapsed` is `EngineInput.elapsed`). Grepped: no `writtenAgo`
and no `realNow` anywhere in either repo.

## Goal

1. **Minutes arithmetic** — `src/lib/server/rulesets/clockHours.ts`. Lift the absolute-minute count out of
   `hoursCrossed` into a shared internal helper and add, exported:
   `minutesBetween(from: StoryTime, to: StoryTime, calendar: StoryCalendar | null): number | undefined` — `to − from`
   in whole minutes (may be negative), on the same rules `hoursCrossed` uses: with a calendar the day index is
   `storyDayIndex`; free-form only when both ends share year and month (the `day` is the index); a missing hour or
   minute is 0; anything that cannot be placed is `undefined`. `hoursCrossed` must answer exactly what it does today.
   (`StoryClock` from `state/storyTime` has `null`s where `StoryTime` has optional fields; convert at the call site
   or widen the parameter type — your choice, say which.)
2. **The moment's input** — `src/lib/server/rulesets/types.ts`, `EngineInput`, add:
   ```ts
   /**
    * 🚧 How long ago each owner's stat values were written (lane sense-age2), by owner key, then slot id:
    * `minutes` — story minutes from the row's story-clock stamp to the session's clock now (null: no stamp,
    * no clock, or it cannot be placed — including a stamp later than now); `realSeconds` — whole seconds from
    * the row's write to `realNow`, never below 0 (null: no stored row). Absent when no function with a body runs.
    */
   writtenAgo?: Readonly<Record<string, Readonly<Record<string, { minutes: number | null; realSeconds: number | null }>>>>
   /** 🚧 The host's real instant for this moment (ms since the epoch), taken ONCE; every `realSeconds` is measured against it. */
   realNow?: number
   ```
3. **Fill it** — `src/lib/server/rulesets/resolve.ts`, where `input: EngineInput` is built (~505–534). Only when
   `runsModules(ruleset)` (exported by `functionRun.ts`): take `realNow = Date.now()` once; read the story now
   ONCE with `storyClockOf(db, session)` (already imported from `./read`; reuse that one value for the existing
   `clock: writes ? … : null` line instead of reading it twice); call `sessionLinks(db, sessionId)` once and, per
   owner view, `valueStampsOf(db, sessionId, owner.owner, owner.stats.map((s) => s.slotId), { links })`. Then per
   slot: `minutes` = stamp?.clock and story now ? `minutesBetween(stamp.clock, now.now, now.calendar)` mapped
   `undefined` or negative → null : null; `realSeconds` = stamp ? `Math.max(0, Math.floor((realNow − stamp.writtenAt.getTime()) / 1000))` : null.
   Fill it in **every** mode (resolve, propose, apply): functions run in a reading too.
4. **Hand it** — `src/lib/server/rulesets/functionRun.ts`, `bindingValues` (~350–414). Beside `values` and `bounds`
   on an attribute role, add `writtenAgo: { [attributeId]: { minutes, realSeconds? } }` for each attribute id the
   role is handed a value for (not entry fields, not ids withheld by `bindingKindRefusal`). Look it up by the owner's
   key and the attribute's slot (`slotOf.get(id)`); missing (no owner, no entry) → `{ minutes: null }`.
   `realSeconds` is present **only** when the use's declaration says `countsTime: 'real'` or `'both'`
   (`use.decl?.countsTime`); otherwise the key is absent, never 0 (value `null` when opted in but no stored row).
   Update the module note's `ctx` description (top of file) by one clause.
5. **Record the instant** — in `run()` of `rulesets/resolve.ts`, `out.facts.functions` (~893–905): add
   `realNow: new Date(input.realNow).toISOString()` when `input.realNow` is set **and** any function use with a
   module body declares `countsTime` `'real'` or `'both'`. So the run's record reproduces every `realSeconds`.
6. **Say it where authors read** —
   - SDK `/home/jody/github/serene-pub-sdk/guides/rulesets.md` ~274–279: replace the sentence "🚧 No real-time fact is
     handed to a body yet: `'real'` and `'both'` change only the fit rating until what a body receives is decided."
     with a short paragraph: each attribute role also carries `writtenAgo[id].minutes` — story minutes since a
     session last wrote that value, measured on the session's story clock; null when the story has no clock, the
     value was never written by a session (a starting value, a book's or a card's value), or the time cannot be
     placed (a free-form calendar across a month); writing the value brings it to 0, so a rule that drains by it
     applies once. `'real'` or `'both'` also hands `writtenAgo[id].realSeconds`, the real seconds since the value was
     written; one instant is taken per moment and recorded on the run, and **a rule that reads real time gives a
     different result on a re-run, by design**. No code block (a fenced `ts` block is compiled by the guide tests).
   - App `/home/jody/github/serene-pub/docs/rulesets.md` line 129: replace "Rules aren't told how much real time has
     passed yet: for now, saying that a rule counts real time changes only this rating." with user-facing words
     (no code names): rules can tell how long ago a value last changed in the story, counted on the session's own
     clock, and rules that ask for it how much real time has passed; a value nothing in the session has changed yet
     has no such time. Keep it to two or three sentences, in the file's voice.
   - `/home/jody/github/serene-pub/NOMENCLATURE.md`: (a) the Rulesets vocabulary row at line ~1759 — replace its last
     sentence "🚧 The fact a body would be handed — how long since a value was last written — is **not built**: it
     waits on a ruling (lane sense-age ★A)." with one saying what is built (`writtenAgo` on an attribute role:
     `minutes`, and `realSeconds` for `countsTime` `'real'`/`'both'`; counted from the `attribute_values.story_clock_*`
     stamp, the writing session's clock; `realNow` on the run's facts). ⚠ Not `elapsed` (the moment's story time
     passed), not the `stat-trail` `since`. (b) A new §25 entry after the "time a function counts on, time a genre
     keeps" entry (~line 3628), heading `### time since a value was written — 2026-11-11 (owner ruling ★A1; PLAN-sensible-engine §2.12, lane sense-age2)`,
     a Was/Is/Cost table in the same format as its neighbours: Was — nothing told a function body when a value was
     last written; Is — _(new)_ 🚧 `writtenAgo` (`{ minutes, realSeconds? }` per attribute id on an attribute role),
     `EngineInput.writtenAgo` · `realNow`, `facts.functions.realNow`, `valueStampsOf` · `ValueWriteStamp`
     (`state/resolve.ts`), `minutesBetween` (`rulesets/clockHours.ts`), five nullable `attribute_values.story_clock_*`
     columns (migration `0154_red_the_watchers`, same names as `session_messages`'); grepped 2026-11-11, no other
     `writtenAgo` / `realNow`; Cost — the files.

## Files owned (edit only these)

`src/lib/server/rulesets/clockHours.ts`, `rulesets/types.ts`, `rulesets/resolve.ts`, `rulesets/functionRun.ts`, and
the tests beside them (`clockHours.test.ts`, `functionRun.test.ts`); `docs/rulesets.md`; `NOMENCLATURE.md` (the one
row and the one §25 entry); SDK `guides/rulesets.md`.

## Files readable

Anything. `rulesets/read.ts` (`storyClockOf` ~600, `ownerViews` ~410), `state/storyTime.ts`, `NOMENCLATURE.md` §1
and §24, the SDK `sdk/src/functions.ts` (`countsTime` ~298).

## Tests to write (fail before, pass after)

- `clockHours.test.ts`: `minutesBetween` with a calendar across days; free-form inside one month; free-form across
  months → `undefined`; a negative difference; `hoursCrossed`'s existing tests still pass unchanged.
- `functionRun.test.ts` (see how it builds an `EngineInput` and a sandbox): with `input.writtenAgo` set, an
  attribute role carries `writtenAgo[id].minutes`; a use whose decl says `countsTime: 'real'` (and `'both'`) also
  gets `realSeconds`, one with no `countsTime` (and `'story'`) has **no** `realSeconds` key; two functions in one
  moment see the same `realSeconds` for the same value; with no entry for the owner, `{ minutes: null }`.

Do NOT write the end-to-end sleep test (the supervisor gives it to a later worker).

Run, capped, only: `src/lib/server/rulesets/clockHours.test.ts`, `src/lib/server/rulesets/functionRun.test.ts`,
`src/lib/server/rulesets/clockHours.int.test.ts`, `src/lib/server/rulesets/functions.int.test.ts`,
`src/lib/server/rulesets/resolve.int.test.ts` — the last three need worker 1's `valueStampsOf`; if it does not
exist yet when you get there, say so in the report and leave them for the supervisor. Do not run SDK tests.

## Out of scope

The `state/` files, `db/`, migrations (never run `db:generate`); the older seeded-script form (`rulesets/scripts.ts`)
and pipeline-script reads (they are left as they are; the supervisor reports why); a shipped sleep ruleset or any new
core function; the ruleset editor UI; `runtime/host.ts`, `sockets/sessions.ts`; `INTEGRATING.md`; `sdk:build`.

## Stop and ask when

A name beyond `writtenAgo`, `realNow`, `minutesBetween` is needed; a script would receive anything different from
today other than the added `writtenAgo` key (and `realSeconds` under the opt-in); `hoursCrossed` would change.

## Done means

Your unit tests pass; `npx prettier --check` clean on each changed `.ts` file; then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` shows no error in your files (one known error at
`src/lib/client/components/sessionPage/requests/index.ts:380` is another session's; errors in `state/resolve.ts`
about `valueStampsOf` missing just mean worker 1 is not done — say so).

## Report (final message)

Changed files in each repo; the `bindingValues` addition; tests run with counts; anything noticed but not fixed
under **Noticed, not done**.

## Rules (verbatim, binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not run `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
- NOMENCLATURE R1 one word, one meaning · R2 distinctive words · R3 qualify, never the bare noun. Docs copy: plain
  sentences, the product's words, no code names in `docs/`.
- Another session is editing this repo (visual-novel layout: dialogue-box widget, `show-line` request). Do not touch
  its files.
