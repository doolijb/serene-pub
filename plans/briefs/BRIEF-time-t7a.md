# BRIEF (NOT READY: waits on the owner, see the last section) — build lane `time-t7a` — recall reads Decay: a living entry fades (the ranking half)

Repo `/home/jody/github/serene-pub`. This brief **replaces** `plans/briefs/BRIEF-time-t7.md`, which is withdrawn
(its premise was wrong; read only its last section, for why). Supervisor: read `.claude/guides/multi-agent.md`
first, then `plans/PLAN-entry-time-and-lines-2026-11-14.md` §1 (Decay, recency), §5 rule 3, §6 (T7), §7
"Measured 2026-11-15", §8 ★7, ★8, `plans/REPORT-time-t7-measure-2026-11-15.md`, `plans/REPORT-time-t2-2026-11-14.md`,
`src/lib/server/pipelines/ranking/weights.ts` (~130–310, ~590–600), `ranking/signals.ts` (~1040–1130),
`ranking/keywordQuery.ts`, `ranking/select.ts`, the `rank-hybrid` binding and its `SIGNAL_FIELDS`
(`src/lib/server/pipelines/runtime/bindings.ts` ~429–443 and where `rankHybrid` is called),
`../serene-pub-sdk/contracts/src/tasks.ts` ~544–558 (**Recently referenced**, read only), `docs/pipelines.md`
(ranking), `docs/lorebook-time.md` (Beginning and decay), `NOMENCLATURE.md` §1, §24, §23 and the **Decay** row.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no migration, no GPU.

## Goal

An entry's Decay stops being a number nothing reads, **without changing how any existing lorebook is recalled**.

- A **Fact** (Decay 0: every entry that exists today) is ranked exactly as before, including today's
  **Recently referenced** lift.
- A **living** entry (Decay above 0) is recalled less the longer the story has gone on without it: its
  **Recently referenced** signal is replaced by a fade that depends on its rate.
- A pipeline that sets the **Recently referenced** weight to 0 ignores both, as today.

The time delta in the prompt (*3 years ago*) is **not** this lane: it is `time-t7b`, after a decision on how it
reaches the template.

## Owner rulings and what was measured (quote them in worker briefs)

- 2026-11-13: "Decay: Fact | Living"; the rate is "a value between 0 and 1, core by default will use a
  reasonable multiplier against that. Modders can query and calculate against that number how ever they want,
  or ignore it out-right."
- 2026-11-13: "Maybe we can update recency to use the new decay rate and switch."
- 2026-11-14, ruled as written: ★8 "Moving recency onto Decay although existing entries (all facts) lose today's
  lift, pending measurement 2" — the plan: "if recall of facts drops, facts keep the lift"; ★7 "Decay with a
  timeline: story time, with the 'fresher of two clocks' rule; without: rounds"; §5.3 "Fade takes the fresher of
  rounds-since-it-came-up and story time; a negative gap is zero; a declared rate outside 0–1 is clamped with a
  validation warning"; "'Last came up' cannot live on the entry … Decay is derived per reading … Nothing stored";
  a floor so a strong match still wins.
- Measured 2026-11-15 (`plans/REPORT-time-t7-measure-2026-11-15.md`): on the owner's data the lift is zero
  (every entry of the one qualifying lorebook is keyless and the lift exists only for entries with keys), so
  whether facts lose recall **could not be measured**. **Lead's decision (★T7-1 for the owner): take the safe
  side of the ruling. Facts keep today's lift exactly.** Only living entries change.
- 2026-11-15: "Go ahead and proceed with everything in the order you see fit." — the go.
- Standing: P1 (same inputs, same result; no wall clock; an automatic effect shows its cause); P5; "No magic in
  core for pipeline data".

## Facts (from the cold review of the withdrawn brief; re-verify each)

- Every shipped genre ranks lore with `rank-hybrid`: `keywordQuery` + `select`. Scores are additive; selection is
  budget-led; there is no score cutoff (`select.ts` ~736–800). `rank-semantic` (`semantic.ts`) is wired by no
  core genre: **do not touch it**.
- `lastRefRecency` is one additive signal with a per-type weight (0.1 for world lore, character lore, history;
  `weights.ts` ~270–306), fed by `lastRefRecencySignal` over `buildLastRefMap` ("where each entry was last
  referenced, scanning all messages", `signals.ts` ~1052–1124; **keyed entries only**, ~1100; counted in message
  index), summed at `select.ts` ~362, a published `rank-hybrid` parameter (`signalLastRefRecency`) a pipeline
  may set to 0.
- **Never use `ranking_subject_stats`** for "last came up" (cumulative, wall-clock, "last included": a feedback
  loop that does not follow Back, a branch or settling).
- A story duration: `storyDayIndex` (`../serene-pub-sdk/sdk/src/storyTime.ts` ~440) gives day counts through a
  custom calendar.
- The entry's **Read in?** view reads `entries:recentDecisions` and, for admins, `pipelines:runExplain`
  (`client/lorebooks/editor/retrievalReadout.svelte.ts` ~35–77).

## Build

### A. Inventory first (supervisor, read-only) — report with file:line

1. Exactly where `lastRefRecency` is computed and summed for a lore candidate, and what the candidate row carries
   there (is the entry's `decayRate` at hand; if not, the cheapest way to carry it, with no added query per
   candidate).
2. What `lastRefRecencySignal` returns today as a function of "messages since last referenced", so the fade for
   a living entry can be defined **relative to it**.
3. How to count **rounds** from message indices (what a round is in a session with several seats), or whether
   message count is the honest unit; the brief says "rounds" where the owner did.
4. The story clock at ranking time (the reading's moment) and the date of the newest version of the entry the
   reading sees (its Beginning or its newest dated version in force), for the story-time clock.
5. What the ranking record of a turn stores per candidate signal, so the explanation can show the fade.

### B. The rule

For a lore candidate at ranking time:

- `rate = clamp(decayRate, 0, 1)`. **`rate === 0` → the code path and the number are today's, bit for bit.**
- `rate > 0`: the `lastRefRecency` signal's value is replaced by `fade(rate, roundsSince, storyGap)`, a pure
  function with a table of tests:
  - each clock gives a freshness in [0, 1] (1 = just now); the **fresher** clock wins (the larger value); a
    missing clock is ignored; both missing → the value today's signal gives an entry never referenced;
  - a negative gap is 0; a keyless living entry has no rounds clock (state it in the docs), only story time;
  - at `rate` 1 freshness halves every `HALF_LIFE_ROUNDS_AT_FULL_RATE` rounds and every
    `HALF_LIFE_STORY_DAYS_AT_FULL_RATE` story days, scaled by `1 / rate` (🚧 two named constants beside the other
    ranking numbers in `weights.ts`; lead's proposal: at rate 0.25 half strength after about 200 rounds or one
    story year);
  - the result never falls below a floor (🚧 a third constant; proposal 0.35 of the full signal) so a strong
    keyword or meaning match still brings the entry in.
- The value is multiplied by the same per-type weight as today, so `signalLastRefRecency: 0` in a pipeline
  switches fact lift and living fade off together.
- Pinned entries, and how keyword or name matches bring candidates in, are unchanged. Nothing is removed by this
  rule: it changes one additive term.
- The turn's ranking record carries, for a living candidate, the rate, which clock won and its gap, so the
  explanation can say *Living: last came up 240 rounds ago* 🚧 / *Living: 3 years since its newest version* 🚧
  where the per-signal explanation is shown today. No new screen.

### C. The row, docs, names

`src/lib/client/lorebooks/time/BeginningDecayRow.svelte`: the Decay help *Stored now; recall does not use it
yet.* becomes *A living entry is recalled less as the story moves on without it.* 🚧 (one sentence);
`BulkTimeDialog.svelte`'s Decay line may say how each entry fades again. `docs/lorebook-time.md` (what fading
is, both clocks, the floor, that a Fact is unchanged, that a pipeline's **Recently referenced** weight at 0
switches it off, one example), `docs/pipelines.md` (the **Recently referenced** signal's description).
`NOMENCLATURE.md`: the **Decay** row (charter: Decay owns the rate and the fade function; the ranker owns
applying it; R1 note: `lastRefRecency` / **Recently referenced** is the signal the fade rides on, `recencyBoost`
is `rank-semantic`'s message lift and unrelated), §25 for every new name. No other product's name.

## Files owned

`src/lib/server/pipelines/ranking/signals.ts`, `weights.ts` (the three constants), `keywordQuery.ts` and
`select.ts` only where the signal is computed and recorded, a new pure module for `fade` beside them, the
ranking record's explanation text where `lastRefRecency` is described (`sockets/pipelines.ts` ~3533),
`src/lib/client/lorebooks/time/BeginningDecayRow.svelte`, `src/lib/client/lorebooks/BulkTimeDialog.svelte`
(copy), tests beside each, the two docs, `NOMENCLATURE.md`. The replay harness
(`ranking/recallRecency.replay.int.test.ts`) may be extended, not rewritten.

## Out of scope

`rank-semantic`; the prompt (the time delta: `time-t7b`); any SDK file or new published parameter; a setting;
defaults per entry type (`time-t5b`); familiarity, distances; `ranking_subject_stats`.

## Stop and ask when

CLAUDE.md §Decisions applies; a Fact's score would change by any amount; the entry's rate cannot reach the
ranker without a query per candidate; "rounds" cannot be counted honestly; a published name, a migration or a
setting seems needed.

## Done means

- Tests, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t7a-<name>.log 2>&1"`,
  one at a time, checking for a running vitest first: the `fade` table (rate 0, both clocks, the fresher wins, a
  missing clock, a negative gap, the floor, the clamp); a ranking fixture with keyed entries showing **(a) with
  every entry at Decay 0, every candidate's score and the selection are identical to the code before this lane**
  (assert against values captured from the unchanged path in the same test: compute both), (b) a living entry
  not referenced for many rounds scores below an equal one referenced just now, (c) a living entry referenced
  just now scores no lower than the same entry as a Fact, (d) `signalLastRefRecency: 0` makes living and fact
  score alike, (e) a clock moved back gives a gap of 0, (f) pinned is unchanged; the explanation line.
- The wider regression: all of `src/lib/server/pipelines/ranking`, `src/lib/server/pipelines/runtime/ragContext*`
  and the tests that pin ranking output (`promptDiff`, budgets: run `npm run test:budgets` in the same capped way
  and report).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t7a-<date>.md`): the inventory with
file:line; the function and its numbers as a rate × gap table; changed files; tests with results; names and
sentences; open ★ (★T7-1 and the three constants are the owner's to see); **Noticed, not done**. Under 800 words.

## Cold review, 2026-11-15: NOT READY. Four things, the first two for the owner

1. **★8 as ruled says facts lose the lift.** "Moving recency onto Decay although existing entries (all facts)
   lose today's lift, pending measurement 2"; the other branch ("facts keep the lift") applies only "if recall of
   facts drops". The measurement did not trigger that branch, and it showed the lift is zero on the owner's data,
   so the ruling as written costs nothing there. Deciding "facts keep the lift" is a reinterpretation: **the
   owner's call (★T7-1)**, not the lead's.
2. **The fade rarely changes what is read.** With a budget and caps that do not bind, every candidate is taken
   (`select.ts` ~790–870; on the owner's data no lore candidate was ever left out). Lore with a title renders in
   arrival order and history by date (`prompt/assemble.ts` ~201, ~232–238), so score does not move an entry in
   the prompt either. The fade bites only when a budget or a cap binds (history 10, world 20, character 15,
   `weights.ts` ~744–748). The rounds clock sees only the last 100 messages (`LORE_MESSAGE_WINDOW`,
   `runtime/bindings.ts` ~335): a 200-round half-life is mostly outside it. **Whether to build the ranking half
   at all now is the owner's call (★T7-2).**
3. **The rule in Build B is wrong and must be replaced if this is built:** a Fact's signal is `exp(-0.01·d)`
   (halving about every 69 messages), so a living entry at any rate below about 0.72 would have scored ABOVE the
   same entry as a Fact, and the floor on a replaced value would have been a permanent bonus. The right shape:
   for a living entry, **today's signal × m(rate, gap)** with m in [floor, 1], never rising with rate; test: at
   any gap a living entry never scores above the same entry as a Fact. Under ★8 as written the Fact's value
   becomes 0 in one line and the rule still holds.
4. **Keyless entries** (every entry the owner's pipelines write) have no rounds clock (`withKeys`, `signals.ts`
   ~1105), and Story Minimal, Chat and Guide have no story clock: Decay would do nothing there while the row said
   it did. Either give a keyless living entry a rounds clock from its name (the keyword scorer already reads
   `keys + name`, `keywordQuery.ts` ~1184) or say in the row when neither clock exists. Also: the decision record
   holds no per-signal breakdown (`schema.ts` ~7238–7255), so the cause must go into its `why` / `detail`; the
   admin label "came up recently in the conversation" and the SDK's description of `signalLastRefRecency` would
   no longer be true for a story-time fade (a published description: the owner's call).

Verified and fine: `decayRate` reaches the candidate rows with no extra query (`utils/lorebookEntries.ts` ~323);
weight 0 zeroes the term; meaning-half candidates never get it; constants in `weights.ts` fit the convention.
