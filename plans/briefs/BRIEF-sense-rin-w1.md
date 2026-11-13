# BRIEF — worker `sense-rin-w1` — "Read in?" names the first gate (client half)

You are a `lane-worker` under supervisor `sense-rin`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

The entry editor's **Read in line** (`editor/readIn.ts`, "Not read in last turn · …") and its **Read in? tab**
(`EntryFireTest.svelte` + `editor/signals.ts`, "Would not be read in · …") fall back to the catch-all
"nothing reported on it" for most entries the ranker never judged. The run's explanation already carries the
real reason for many of them, and the code throws it away: `judgedEntryRows` drops every `outcome: "skipped"`
row (a mechanism declined the entry before the ranker), and an `excluded_ineligible` row's generic verdict
("Left out — a rule excluded it…") hides the rule's own sentence, which is in `row.why[0]`.

Make both surfaces state **the first gate that stopped the entry**, in one plain sentence, from facts they
already receive. Keep an honest catch-all only where no gate can be told.

## Files owned (the only files you may edit)

- `/home/jody/github/serene-pub/src/lib/client/lorebooks/editor/readIn.ts`
- `/home/jody/github/serene-pub/src/lib/client/lorebooks/editor/signals.ts`
- `/home/jody/github/serene-pub/src/lib/client/components/lorebookForms/EntryFireTest.svelte` — only the
  `signalFactsFrom(...)` call (about lines 270–278) and the `signalsResult` line if needed. Nothing else in it.
- `/home/jody/github/serene-pub/src/lib/client/lorebooks/editor/readIn.test.ts`
- `/home/jody/github/serene-pub/src/lib/client/lorebooks/editor/signals.test.ts`
- `/home/jody/github/serene-pub/docs/lorebooks.md` — only the paragraph under `### Why was it read in, or not?`
  (about line 92) and the "Read in line" bullet (about line 187).

## Files readable

`src/lib/shared/sockets/types.ts` (`RetrievalRow` ~10842, `RunExplain` ~11090, `Entries.RecentDecisions` ~9234),
`src/lib/client/lorebooks/editor/retrievalReadout.svelte.ts` (passes facts through; do NOT edit),
`src/lib/client/lorebooks/editor/teachMarks.ts` (`MarksHere`, `marksAsRead`: null = the session does not read
the entry — archived there, off its line, dated past its clock), `src/lib/server/sockets/pipelines.ts`
4630–4700 (how skipped rows are built: `verdict: "Never reached the ranker — ${reason}."`, the raw reason is not
kept on the row except inside that verdict — see below), `src/lib/server/pipelines/ranking/keywordQuery.ts`
(`ARCHIVED_SKIP_REASON = "entry is archived"`, `DISABLED_SKIP_REASON = "entry is disabled"`, the miss reason
at ~846: `"no key matched in the last N messages[, and its relevance scored X against a threshold of Y]"`),
`src/lib/server/pipelines/ranking/eligibility.ts` 170–205 and `ranking/shownElsewhere.ts` (the ineligible
sentences), `src/lib/server/pipelines/runtime/bindings.ts` ~3166 (semantic skip reason
`"not visible to the current speaker"` — read only, another lane is editing this file).

**The skipped row's raw reason.** A skipped row carries `verdict: "Never reached the ranker — <reason>."` (or
`"Never reached the ranker."` with none) and no other field holding `<reason>`. Recover `<reason>` from the
verdict by stripping that exact prefix and the trailing `.`; you may not change `pipelines.ts`. Put the prefix
in one named constant with a comment pointing at `pipelines.ts`'s skipped-row block.

## The contract

### 1. Rename the sentence field, align with the wire's vocabulary (R1)

`RunFacts`/`ReadInFacts`/`SignalFacts` today use `reason` for a **sentence**, while `RetrievalRow.reason` and
the ranking store's `ranking_decisions.reason` are select's **code** (`excluded_budget`…). Rename the sentence
field to **`verdict`** (as `RetrievalRow.verdict`), and add to `RunFacts`:

- `reason?: string` — select's code for the decision (`RetrievalRow.reason`, `ranking_decisions.reason`).
- `why?: string` — the decision's own sentence as the ranking store keeps it (`ranking_decisions.why`).

A parallel worker is adding exactly `reason?: string` and `why?: string` to the
`Sockets.Entries.RecentDecisions.Response["facts"]` entries; `retrievalReadout.factsFor` hands those straight to
`readInLine` as `RunFacts` (the owner's path, when there is no run explanation). Update every use and test of
the old `reason` field in your owned files.

### 2. The gate sentences (all 🚧 provisional copy — use exactly these strings)

| Gate | Sentence |
|---|---|
| G1 switched off | `it is switched off` |
| G2 archived | `it is archived` |
| G3 off for a while | `it is off for a while at this point in the story` |
| G4 not on the line / dated after the clock | `it is not on this session's line, or it is dated after the session's clock` |
| G5a another speaker's character lore | `it is another speaker's character lore` |
| G5b a rule (secret, presence, exclusion, shown elsewhere) | the rule's own sentence: an `excluded_ineligible` row's `why[0]` (explanation) or the store's `why`, verbatim except one trailing `.` removed. Do not lowercase it (presence sentences start with a name). If there is no `why`, keep the row's verdict. |
| G6 no match / conditions | a skipped row's raw reason verbatim (it already names the closest score and the threshold when the keyword lane had them) |
| G7 budget (explanation path) | the row's existing `verdict`, unchanged (current behaviour) |
| G7 budget (store path) | `it was left out for budget` for codes `excluded_budget`, `excluded_token_limit`, `excluded_share_cap`, `excluded_group_disabled`, `excluded_unknown_source`; `it is pinned, but it did not fit` for `excluded_pinned_token_limit`, `excluded_pinned_group_disabled` |

Catch-alls stay as they are: `weighed and left out`, `nothing reported on it`, `this turn ranked nothing at all`.

Map skip reasons: `"entry is archived"` → G2; `"entry is disabled"` → G1 in the line (it cannot tell an
amendment from the entry's own Off) and per the precedence below in the tab; `"not visible to the current
speaker"` → G5a; anything else → G6 verbatim. In `readIn.test.ts`, import `ARCHIVED_SKIP_REASON` and
`DISABLED_SKIP_REASON` from `$lib/server/pipelines/ranking/keywordQuery` and assert the client's strings equal
them, so a reworded constant fails a test instead of silently falling back.

### 3. The line — `readInFacts(entryId, explanation)` and `readInLine(facts)`

Signature of `readInFacts` stays `(entryId, explanation)` (the readout store, which you may not edit, calls it).

- A judged row (as today, via `judgedEntryRows`): existing figures, plus `reason = row.reason` when present, and
  `verdict` = G5b for `excluded_ineligible` with a `why[0]`, else `row.verdict`.
- No judged row but a skipped row for the entry (entry rows only — same `isEntryRow` rule): `verdict` from the
  skip reason per §2. No rank, no tokens.
- `readInLine`, when `decision !== "fired"`: `facts.verdict ?? storeVerdict(facts.reason, facts.why) ?? <the
  existing catch-alls>`. `storeVerdict` maps per §2 (G5b for `excluded_ineligible` + `why`, G7 store path),
  else `undefined`.

### 4. The tab — `signalFactsFrom(explanation, { entryId, enabled, reading })`

`enabled` becomes the **base row's** Off (the `enabled` prop), and a new `reading?: MarksHere | null` is the
entry as the verdict's session reads it (`marksHere` in `EntryFireTest`: `undefined` while unknown, `null`
when the session does not read the entry, else `{ off, pinned }`). Import the type from `./teachMarks`. In
`EntryFireTest.svelte` change only the call to pass `enabled` (the prop) and `reading: marksHere`.

Precedence — the first that applies sets `verdict` (and only when the entry is not included):
1. `enabled === false` → G1.
2. a skipped row whose reason is `"entry is archived"` → G2.
3. `reading?.off === true`, or a skipped row whose reason is `"entry is disabled"` → G3 (the base row is on, so
   an amendment switched it off).
4. no judged row, no skipped row, and `reading === null` → G4.
5. a judged (excluded) row → its verdict per §3.
6. a skipped row → per §2 (G5a or G6).
7. no row: `!explanation.ranked` → `this turn ranked nothing at all`; else `nothing reported on it`.

Keep the existing lexical/semantic/headroom figures for a judged row. `signalsResult` prints
`Would not be read in · ${facts.verdict ?? "nothing reported on it"}`.

### 5. Docs

`docs/lorebooks.md` §"Why was it read in, or not?": add one or two sentences saying that when the entry would not
be read in, the tab names the first thing that stopped it — switched off or archived, off for a while, not on
this session's line or dated after its clock, another speaker's character lore or a secret the speaker doesn't
hold, no keyword, name or meaning match (with how close it came), already shown in a slot of its own, or no room
in the budget — and that the Read in line under the editor does the same for the last turn. Plain, short, user
voice; match the surrounding paragraphs. Say **session**, never *chat*.

## Done means (tests that fail before and pass after)

In `readIn.test.ts` and `signals.test.ts`, one test per gate, each asserting the full sentence:
- line: G2, G1 (disabled skip), G5a, G5b (secret `why` "A secret the speaker does not hold."), G5b presence
  (`why` "Hild is not in the world at 3 Frost 1204." keeps its capital), G6 (a miss reason with score and
  threshold), G7 store path (`excluded_budget`), store-path G5b (`reason: "excluded_ineligible"`, `why`),
  pinned store path; the catch-all for an entry with no row and no store facts.
- tab: G1, G2, G3 via `reading.off`, G3 via disabled skip with base on, G4 (`reading: null`, no row), G5a, G5b
  shown elsewhere (`why` "Already in the prompt in a slot of its own."), G6, G7 (existing verdict), the
  "ranked nothing" and catch-all cases (catch-all: no row and `reading` undefined or `{off:false}`), and that an
  included entry gets no verdict even with `reading.off` true.
- the constant-pinning test above.
Update existing tests that use the old `reason` sentence field.

Run, capped:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 src/lib/client/lorebooks/editor/readIn.test.ts src/lib/client/lorebooks/editor/signals.test.ts src/lib/client/lorebooks/editor/retrievalReadout.test.ts"`
Then `npx prettier --check <file>` on each file you changed (not the .md if prettier ignores it), and
`npx tsc --noEmit -p .` is NOT yours to run (the lead runs it) — but do make sure your types line up.

## Out of scope

The ranker, its scores, thresholds, gates; `pipelines.ts`; `retrievalReadout.svelte.ts`; `ReadInLine.svelte`;
`EntryWorkspace.svelte`; `EntryInspector.svelte`; `EntryAdvancedFields.svelte`; any server file; chain depth.
New props, events, settings, files: none. If you think you need one, stop and say so in your report.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `prettier --write` on a directory (on a single owned file is fine). Never `git checkout` / `restore` / `stash`. Never pipe vitest into `head`. Do not start a dev server.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook". No reference to any other project or product in code, comments, tests or docs.
- Copy (STYLE-GUIDE §1.8, §1.12): sentence case, plain words, one sentence.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.

## Report

Return as your final message: changed files, each gate → the test name that asserts it, test command output
summary (pass/fail counts), prettier results, anything you could not do, Noticed-not-done.
