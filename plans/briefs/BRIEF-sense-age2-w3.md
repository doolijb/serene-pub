# BRIEF — lane `sense-age2`, worker 3 — the end-to-end test: the sleep meter, Back, no clock, real seconds

You are a `lane-worker` for the supervisor of lane `sense-age2` in /home/jody/github/serene-pub. Read this whole
brief before touching anything. Use absolute paths. Return your report as your final message.

## What is already built (read it, do not change it)

- Each `attribute_values` row carries the writing session's story clock (`story_clock_*`), stamped by `setValue`
  (`src/lib/server/state/write.ts` ~2588) from `sessionStoryNowOf`; null when no session wrote it or no clock.
- `valueStampsOf` (`src/lib/server/state/resolve.ts` ~1108) answers the in-force row's stamp.
- `src/lib/server/rulesets/resolve.ts` `writtenAgoOf` (~190) fills `EngineInput.writtenAgo[ownerKey][slotId] =
  { minutes, realSeconds }` and `realNow` (one `Date.now()` per moment), whenever the ruleset runs function modules.
  `out.facts.functions.realNow` (ISO) is recorded when a module-bodied use declares `countsTime` `'real'`/`'both'`.
- `src/lib/server/rulesets/functionRun.ts` `bindingValues` (~360–405): each attribute role a body is handed carries
  `writtenAgo: { [attributeId]: { minutes, realSeconds? } }`; `realSeconds` only when the function declares
  `countsTime: 'real'` or `'both'`, otherwise the key is absent.

## Goal

Write ONE new test file, `src/lib/server/rulesets/writtenAgo.int.test.ts`, that drives real moments through
`resolveRulesetTurn` (see `src/lib/server/rulesets/clockHours.int.test.ts` for the harness and
`src/lib/server/rulesets/functions.int.test.ts` "a ruleset in sections, applied" for a ruleset carrying its own
function **module with a body**, how its deltas are applied in `mode: "apply"`, and how a body's `lines` reach
`facts.functions.lines`). Set a session's story clock the way existing tests do (`state/sessionStoryClock.int.test.ts`,
`state/clockMoves.int.test.ts`: e.g. `advanceSessionStoryClock`). For Back/Forward see
`src/lib/server/state/valueStamp.int.test.ts` (worker 1's, uses `rewindTurn` / `forwardTurn`) and
`src/lib/server/sessions/rewind.int.test.ts`.

A **test** ruleset (defined in the test with `defineRuleset`, never shipped): a bounded number attribute `rest`
(e.g. pool, 0–100, start 50) and a two-word state `asleep`-or-awake (use whatever attribute kind expresses a two-word
state or a flag — read `guides/rulesets.md` in the SDK, "Attributes that are facts: `flag`", and the existing int
tests). One function module with a body, phase `effects`, binding `what` → `rest` and `state` → the state: it reads
`ctx`'s `what.writtenAgo[<rest id>].minutes`; when that is null or 0 it returns no deltas; otherwise it lowers `rest`
by `minutes` (rate 1 per minute) while awake and raises it by `minutes` while asleep. It also returns a line
`"minutes=<n>"` (and, in the real-time variant, `"real=<n>"`) so a reading can observe what it was handed.

Cases (each a `test`, 60 s timeout):
1. **Drains while awake.** Clock on; write `rest` 50 through `setValue` (or let an apply write it); advance the clock
   30 minutes; one `apply` moment → `rest` is 20.
2. **Idempotent.** Straight after case 1's apply, a second `apply` with no time passed → `rest` still 20 (the body
   was handed `minutes=0`).
3. **Refills while asleep.** Set the state to asleep, advance 10 minutes, `apply` → `rest` rises by 10. (Writing
   the state must not matter: the meter's own write time is what counts.)
4. **Back past the write.** Write `rest` anchored to message A at clock T0, advance the clock, write it again anchored
   to message B; a `resolve` moment's line says the minutes since B's write; Back takes B (`rewindTurn`); a `resolve`
   moment's line now says the minutes since A's write (whatever the clock reads after Back — compute the expectation
   from the session's clock at that point, do not hard-code a guess). Forward puts B's back.
5. **No clock.** A session with no story clock and no present: an `apply` moment changes nothing, the line says
   `minutes=null`, and `facts.functions.failed` is empty.
6. **Real seconds, opt-in.** The same body under a function declaring `countsTime: 'real'`: with `Date.now` spied to
   a fixed instant (`vi.spyOn(Date, "now")`, restored after) and the value row's `created_at` set by SQL to a known
   earlier instant, a `resolve` moment's line says the exact whole seconds, and `facts.functions.realNow` is that
   instant's ISO string. The `countsTime`-less variant's line has no real seconds (the key is absent) and
   `facts.functions.realNow` is absent.

If a case is impossible as written (for example the state attribute cannot be written the way you planned), adapt
the mechanics but keep what the case proves, and say what you changed. If the code under test is wrong, **do not fix
it**: report the failing case with the evidence.

## Files owned

Only the new file `src/lib/server/rulesets/writtenAgo.int.test.ts`.

## Run

Capped: `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/rulesets/writtenAgo.int.test.ts"`.
Then `npx prettier --check` on the file.

## Out of scope

Every other file. A shipped sleep ruleset. Any change to the code under test.

## Stop and ask when

The code under test does not do what "already built" says — report, do not patch.

## Report (final message)

The file, each case and its result, anything adapted and why, **Noticed, not done**.

## Rules (verbatim, binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not run `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an overlay): never write
  "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope (above). An int test that opens a DB inside an `it` needs a
  60 s timeout. Never pipe vitest into `head`. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.**
- Another session is editing this repo (visual-novel layout). Do not touch its files.
