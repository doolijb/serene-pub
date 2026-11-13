# BRIEF — lane `sense-age` — a script can read how long since a property last changed

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then plan §2.12 in
`plans/PLAN-sensible-engine-2026-11-11.md`, `docs/rulesets.md` (functions; "Some things wear off or come due as
time passes", about line 127), `docs/lorebook-time.md` (the story clock; every line is stamped with the clock),
`docs/scripts.md`, the SDK's guide for ruleset functions (find it under `../serene-pub-sdk/guides/`),
`../serene-pub-sdk/INTEGRATING.md` sections on rulesets and the rules sandbox, NOMENCLATURE §1, §24, §25 and the
Rulesets vocabulary table, and CLAUDE.md P1 ("Same inputs, same result").

## The owner's ask (2026-11-11, verbatim)

"Lets make sure a time delta since last save/update on a property is accessible by scripts."
"I.e. sleep could incriment down while awake, incriment up by x while asleep."
"yes on real time as well, opt in of course"
"and it should be a measurable against ruleset compatibility"

## Goal

1. **Inventory first.** List every door through which a script reads a stat (a ruleset attribute's value): the
   function envelope's attribute roles (`src/lib/server/rulesets/functionRun.ts`, `bindingValues` about 350–400
   and `envelopeOf` about 426–452), the legacy handler form if it still runs, and any pipeline-script or template
   read of state (`src/lib/server/rulesets/scripts.ts`, `src/lib/server/state/resolve.ts` `vocabularyFor`, the
   script reads in `docs/scripts.md`). Say in the report which you changed and which you left, and why.
2. **The fact.** For each attribute a role is handed, beside `values` and `bounds`: the **story time since that
   value was last written, in whole minutes**, or null when it cannot be placed (the story has no clock; the value
   was written before the story had one; the value is a default nobody wrote). Proposed key: `since`, a map from
   attribute id to `{ minutes: number | null }`. Grep both repos and the schema for a collision first (§24); if
   `since` collides, pick by §24 and say what you chose.
3. **Derived, never stored; the body never reads a clock.** Work the story-time number out in the host from the
   value's writing message (`attribute_values.valid_from_message_id`) and that message's story-clock stamp, against
   the session's clock at this moment, with the calendar's own arithmetic (`rulesets/clockHours.ts` shows the
   absolute-minute count and its limits: with no calendar it can only count inside one month; outside that the
   answer is null). Confirm where a message's clock stamp is stored before relying on it. The sandbox pins
   `Date.now()` to 0 on purpose: leave that.
3b. **Real time, by opt-in only.** A function whose **declaration** asks for it is also handed the real elapsed
   time since each handed value was written, in whole seconds (from the value row's own write time). Nothing else
   receives it: with no opt-in the field is absent, not zero. The host takes "now" **once per resolve moment** and
   records it on the run, so every function in the moment sees the same instant and the record reproduces the
   number. The opt-in is one new key on the function's declaration: name it by NOMENCLATURE §24 after grepping for
   collisions, record it in §25, make an unknown or malformed value a declare-time finding, and say in the guide
   that a real-time rule gives different results on a re-run by design. Proposed shape:
   `since[id] = { minutes: number | null, realSeconds?: number }`.
4. **It must follow the story.** After Back, a branch, or a rewrite of the value, the number is what those rows
   say; writing the value brings it to 0.
4b. **What time a ruleset needs is declared, and ruleset fit measures it.** Read the SDK's `rulesetFit` and how a
   genre's `uses` feeds it, and the app's `src/lib/server/rulesets/genreFit.ts` and `genreOffer.ts` (the rating
   shown as "Story: Great · Lair: Good · Dungeon Crawler: Poor" on the Rulesets and Lorebooks views and on the
   start form's Rules card, each with a one-line why).
   - **The ruleset's side.** A function declares which time it counts on: story, real, or both. The real-time
     opt-in of 3b **is** this declaration (one key, not two). `core:function/recurring@1 { every: 'hour' }` already
     counts on story time (`rulesets/clockHours.ts`, `usesHourlyRecurring`): fold it into the same reading. A
     ruleset's need is the union of its functions'.
   - **The genre's side.** A genre says which time it keeps: a story clock, real time, or neither. Find what
     already states this before adding anything (a genre's registrations, its calendar declaration, its `uses`);
     if a new key is unavoidable it is one key on the genre's declaration, named by §24. Core's genres: Story, the
     Lair and the Dungeon Crawler keep a story clock; the Guide and Chat run on real time.
   - **The measure.** `rulesetFit` weighs need against what is kept and gives its why in one sentence, in the
     product's words: for example, rules that count story time, on a genre that runs on real time, would never
     move. **Genres expect, never lock** (standing ruling): this changes a rating and its sentence only. It never
     refuses a ruleset, hides one, or blocks a session from starting.
   - An existing ruleset that declares nothing rates exactly as it does today.

5. **The sleep meter is the test, not a shipped ruleset.** A test ruleset with a bounded number and a two-word
   state (awake · asleep) and one function body: on a clock move it lowers the meter by a rate times the minutes
   while awake, and raises it while asleep; run again with no time passed it changes nothing; with no clock it
   changes nothing and does not fail.
6. **Say it where authors read.** SDK types for the envelope (if they are published types, this is an additive
   field), the functions guide, `docs/rulesets.md`, NOMENCLATURE §25 and the Rulesets vocabulary row.

## Files owned

- `src/lib/server/rulesets/functionRun.ts`, `rulesets/types.ts`, `rulesets/engine.ts` and `rulesets/resolve.ts`
  only where the moment's inputs must carry the write stamps, `rulesets/clockHours.ts` if its minute arithmetic is
  lifted into a shared helper, and the tests beside them.
- The state read that supplies the stamps (`src/lib/server/state/resolve.ts` or `state/reading.ts`): the smallest
  addition that returns, per value, its writing message's clock stamp. No change to what is resolved.
- In `../serene-pub-sdk/`: the envelope's type where it is declared, the function declaration's new key and its
  findings, `rulesetFit` and the genre declaration key if one is needed, core-catalog's genre and function
  declarations that must state their time, the functions and rulesets guides, the tests and golden pins these move.
- `src/lib/server/rulesets/genreFit.ts`, `genreOffer.ts` and their tests, only where the rating's inputs change.
- `docs/rulesets.md`, `docs/scripts.md`, `NOMENCLATURE.md` (§25 and the one row; this lane owns it for this change).

## Out of scope

A shipped sleep ruleset or any new core function; real time for anything that did not opt in; a new column or migration (stop and report if
you find derivation impossible); the ruleset editor's UI; `runtime/host.ts`, `sockets/sessions.ts`; anything about
who knows what.

## Stop and ask when

A stored stamp, column or migration would be needed; a published name would change or be removed; the fact cannot
be handed without changing what a script already receives.

## Done means

Tests that fail before and pass after: the envelope carries the minutes since each handed attribute was written;
the sleep body drains while awake, refills while asleep, and is idempotent with no time passed; after Back past
the write the number reflects the earlier write; with no clock it is null and nothing fails; a ruleset whose function counts on story time rates lower, with its
sentence, on a genre that runs on real time, and unchanged on one that keeps a story clock; a ruleset that declares
nothing rates as before; a function that opts in receives real seconds and one that does
not receives no such field; two functions in one moment see the same instant.
`npm run sdk:build` once at the end if the SDK changed (after the `pgrep` check).

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-age-2026-11-11.md`):
the inventory, the key you chose, changed files in each repo, tests and results, open ★, **Noticed, not done**.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
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
