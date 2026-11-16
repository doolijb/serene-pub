# BRIEF (NOT READY: see the last section; do not build from this) — build lane `time-t7` — recall reads Decay: a living entry fades, and says how long ago

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §1 (Decay and recency), §2, §5 rule 3, §6 (T7), §7 including
"Measured 2026-11-15", `plans/NOTES-entry-time-and-lines-2026-11-13.md` (~262–270, ~326, ~342–346),
`plans/REPORT-time-t2-2026-11-14.md`, `plans/CHARTER-time-model-2026-11-15.md`,
`../serene-pub-sdk/INTEGRATING.md` (the steps on ranking and on prompt rendering, read only),
`docs/pipelines.md` (recall / ranking), `docs/lorebook-time.md` (Beginning and decay), `NOMENCLATURE.md` §1,
§24, §23 and the rows for **Decay**, *recall*, *ranking*, *mention*.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance. The owner's own server (a suspended
`vite preview` on port 4173) holds his real database.

## Goal

Decay stops being a stored number nothing reads.

1. **A living entry fades in recall.** An entry whose Decay is above 0 is recalled less as the story moves on
   without it. A **Fact** (Decay 0: every entry that exists today) is ranked exactly as before, so no existing
   lorebook changes behaviour.
2. **A living entry says how long ago** in the prompt: a plain time delta (*3 years ago*, *2 days ago*, *40
   rounds ago*), as measured on 2026-11-15, never a date and never an extra hint.
3. The row's stopgap sentence *Stored now; recall does not use it yet.* goes, replaced by what is now true.

## Owner rulings (quote them in worker briefs)

- 2026-11-13: "Decay: Fact | Living"; the rate is "a value between 0 and 1, core by default will use a
  reasonable multiplier against that. Modders can query and calculate against that number how ever they want,
  or ignore it out-right."
- 2026-11-13: "Maybe we can update recency to use the new decay rate and switch." · a living entry's age in the
  prompt: "A time delta is better I think".
- 2026-11-14, "Lets go with all your recommendations", which rules: Decay only lowers recall, never removes (a
  name or keyword still recalls the entry; pinned ignores it); "Fade takes the fresher of rounds-since-it-came-up
  and story time; a negative gap is zero; a declared rate outside 0–1 is clamped with a validation warning"
  (§5.3); "'Last came up' cannot live on the entry. Two sessions read one lorebook at different points. Decay is
  derived per reading … Nothing stored, nothing shared between sessions"; a floor under the fade so a strong
  meaning match still wins (S5); with a timeline: story time; without: rounds, "not real time. A story paused
  for a week should not have faded."
- Measured 2026-11-15 (plan §7): a plain delta reads as "old" on two local models; *may have changed since*
  adds nothing. Use the plain delta.
- 2026-11-15: "Go ahead and proceed with everything in the order you see fit." — the go.
- Standing: P1 (same inputs, same result; an automatic behaviour shows its cause: the entry's **Read in?**
  test view says how much it faded and why); "Prompts: comprehension and fidelity first"; cast members get no
  Decay.

## A fact the plan had wrong (verified by the lead 2026-11-15; re-verify)

The plan's ★8 worried that "existing entries (all facts) lose today's lift". They cannot: today's recency lift
is **messages only** (`src/lib/server/pipelines/ranking/semantic.ts` ~98–119 `recencyBoost`: "Messages only.
Lore has no position in the conversation to be recent *to*"; `SemanticParams.recencyBoost` / `recencyDecay`,
`ranking/weights.ts` ~536–565). Lore entries have no recency lift to lose. So this lane **adds** a fade for
living entries and leaves the message lift exactly as it is; the plan's measurement 2 ("do facts lose recall?")
is moot and is replaced by the check in "Done means".

## Build

### A. Inventory first (supervisor, read-only) — report with file:line

1. The ranker's stages for a lore entry in both modes (keyword and meaning): where a candidate's score is made,
   where the author's priority tier applies, where pinned entries bypass ranking, where the adaptive cutoff and
   the source budgets cut (`pipelines/ranking/semantic.ts`, `weights.ts`, `signals.ts`, and the keyword
   mechanism). Where one multiplicative factor on a living entry's score belongs so that: a keyword or name
   match still brings the entry in; pinned ignores it; the cutoff can still drop a faded, weakly matching entry.
2. "Rounds since it came up" for this session: what the ranker already tracks about mentions
   (`ranking/signals.ts` ~1054 "mention recency" and whatever stores per-entry "read in last turn" / last-read
   positions: the lorebook list shows *read 31 of 31 · last at rank…*). Is a per-session, per-entry "last read
   at message N" already stored? If yes, use it; if no, **stop and report** what the smallest stored fact would
   be (a new table or column is a migration and a design decision).
3. "Story time since": the reading's moment and the date of the newest version of the entry the session reads
   (the entry's Beginning or its newest dated version in force); `compareDates` is the ordering key; how to
   turn two story dates into a duration through the lorebook's calendar (an existing helper for *Time passes*
   lines, or none).
4. Where a lore entry is rendered into the prompt (the app's `pipelines/prompt/renderers.ts` or an SDK
   template the app only feeds). If the delta can be added app-side (a value handed to the existing template,
   or text the app renders), say how; if it needs an SDK template change, **stop and report** (no SDK edit in
   this lane) and build only the ranking half.
5. Where the entry's **Read in?** test view gets its per-entry explanation, to add the fade's line.

### B. The fade

- One pure function, with a table of tests: `fadeFactor({ rate, roundsSince, storyGap })` → a number in
  (floor, 1]. `rate` 0 → 1 always. The gap used is the **fresher** of the two clocks: each clock gives its own
  factor and the larger factor wins (the entry counts as recent if either says so). A missing clock is
  ignored; both missing → 1. A negative gap is 0. The rate is clamped to 0–1.
- Core's multiplier (🚧, one named constant each, in `ranking/weights.ts` beside the other ranking numbers, not
  a setting): half-life in rounds at rate 1 and in story days at rate 1, scaled by `1 / rate`; and the floor.
  Proposed: at rate 0.25 (the row's starting value) an entry is at half strength after about 200 rounds or
  about one story year; floor 0.35. State the numbers in the report with a small table of rate × gap → factor;
  they are the lead's proposal and the owner will see them.
- Applied to living lore entries only, at the stage the inventory names; never to messages, cast members,
  pinned entries, or an entry brought in by a name or keyword match (those arrive regardless; the factor may
  order them among themselves but never removes them).
- Deterministic: the factor reads the session's message position and story date at ranking time; no wall clock.
- The ranking record of a turn (what the **Read in?** view and the run's receipt show) carries the factor and
  the gap it came from, so "why was this not read in" can answer *faded: last came up 240 rounds ago* 🚧.

### C. The time delta in the prompt

For a living entry that is read in, one short parenthetical before or after its title, from the fresher clock:
*(3 years ago)*, *(2 days ago)*, *(40 rounds ago)*; nothing when the gap is zero or under a small threshold (a
day of story time, or 10 rounds), and nothing for a Fact. One pure function turns a gap into words through the
lorebook's calendar, with tests. Exactly where it sits in the rendered text follows the existing template's
style; show three rendered examples in the report.

### D. The row, docs, names

`time/BeginningDecayRow.svelte` (the entry row): the Decay help becomes *A living entry is recalled less as the
story moves on without it; a name or keyword still brings it in.* 🚧 (one sentence). The bulk dialog's Decay
description (`BulkTimeDialog.svelte`) may say *how each entry fades* again, now that it is true.
`docs/lorebook-time.md` (Beginning and decay: what fading is, both clocks, the floor, that pinned and named
entries ignore it, one example), `docs/pipelines.md` if it lists ranking factors. `NOMENCLATURE.md`: the
**Decay** row's charter updated (it now owns the fade factor; the ranker owns applying it), §25 for every new
name. No other product's name.

## Files owned

`src/lib/server/pipelines/ranking/` (the fade function, its constant, the one stage that applies it, the
ranking record's new fields), the app-side prompt renderer for lore if the inventory shows it is app-side, the
**Read in?** view's explanation, `src/lib/client/lorebooks/time/BeginningDecayRow.svelte`,
`src/lib/client/lorebooks/BulkTimeDialog.svelte` (copy only), tests beside each, the docs above,
`NOMENCLATURE.md`. `src/lib/server/pipelines/{boot,config,registrations,entities}` and
`src/lib/server/pipelines/runtime/host.ts` are not this lane's.

## Out of scope

Any SDK file; a setting or a per-pipeline option for the fade (the rate on the entry is the control); defaults
per entry type (`time-t5b`); familiarity and distances (genre logic, T9); cast Memory (T6); the message recency
lift; changing what "pinned" or a keyword match does.

## Stop and ask when

CLAUDE.md §Decisions applies; "rounds since it came up" needs a new stored fact; the delta needs an SDK
template change; applying the factor would change the ranking of any entry whose Decay is 0; a published name
or a migration seems needed.

## Done means

- Tests, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t7-<name>.log 2>&1"`,
  one at a time, checking for a running vitest first: the fade function's table; the delta's words; a ranking
  test over a fixture lorebook showing (a) **with every entry at Decay 0 the ranking is identical, candidate for
  candidate and score for score, to the ranking before this lane** (this replaces the plan's measurement 2),
  (b) a living entry not mentioned for many rounds ranks below an equal fresh one, (c) it is still read in when
  named or keyword-matched, (d) pinned ignores it, (e) a strong meaning match still brings a faded entry in
  (the floor), (f) a clock moved back gives a gap of zero; the rendered prompt examples; the **Read in?** line.
- The wider regression: all of `src/lib/server/pipelines/ranking`, `src/lib/server/pipelines/prompt`,
  `src/lib/server/pipelines/runtime/ragContext*`, and the existing budget tests (`npm run test:budgets` is a
  separate script: run it in the same capped way and report).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t7-<date>.md`): the inventory with
file:line; the function and its numbers as a table; three rendered prompt examples; changed files; tests with
results; names and sentences; open ★ (the multiplier and floor are the owner's to see); **Noticed, not done**.
Under about 900 words.

## Cold review, 2026-11-15: this brief's premise is wrong. NOT READY to build.

1. **Lore entries already have a recency lift, in every shipped genre.** `lastRefRecency` gives weight 0.1 to
   world lore, character lore and history (`ranking/weights.ts` ~270–278, ~306), fed by `buildLastRefMap`
   ("where each entry was last referenced, scanning all messages", `ranking/signals.ts` ~1052–1124), summed at
   `select.ts` ~362, published per pipeline as **Recently referenced** (`../serene-pub-sdk/contracts/src/tasks.ts`
   ~544–558). Every shipped genre ranks with `rankHybrid`; the `recencyBoost` this brief cited
   (`semantic.ts`) is `rank-semantic` only, which no core genre wires. So the section "A fact the plan had
   wrong" is itself wrong: **the plan's ★8 and measurement 2 stand** (owner 2026-11-13 "update recency to use
   the new decay rate and switch"; ruled 2026-11-14 "Moving recency onto Decay although existing entries (all
   facts) lose today's lift, pending measurement 2").
2. **A pipeline must be able to ignore the fade** (owner: "or ignore it out-right"). Route it through the
   existing published weight `signalLastRefRecency` (a pipeline sets it to 0); do not rule a per-pipeline option
   out.
3. **The rounds clock is `buildLastRefMap`** (derived from the messages, so it follows Back; keyed entries only;
   counts message index). **Never `ranking_subject_stats`** (cumulative, wall-clock, "last included": a feedback
   loop, and it does not follow Back, a branch or settling).
4. **The prompt delta:** lore renders as a JSON object keyed by entry name (`prompt/assemble.ts` ~226–243), the
   measurement used a prose bullet, and "rounds ago" was never put to the owner. Story time only; measure in the
   JSON shape first; how it reaches the template is a stop-and-ask ("No magic in core … appended in-pipeline or
   logically inserted in the template", owner 2026-09-30).
5. **The shipped path is `keywordQuery` + `select`**: additive scores, budget-led selection, no score cutoff
   (`select.ts` ~736–800). "A keyword match still brings it in" is not true even for facts (a matched entry
   competes for budget). Scope the lane to `rank-hybrid`; skip the factor when the keyword or name signal is
   above 0.

**Next, before this brief is rewritten:** measurement 2 (replay a recorded session's rankings with
`signalLastRefRecency` at its shipped weight and at 0, and report which entries are read in or drop out), and the
delta measured in the JSON shape.
