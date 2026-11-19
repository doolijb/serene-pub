# BRIEF — worker `dg-1d-1-w2` — mark the remaining P rows, with their tests

Repo `/home/jody/github/serene-pub` (app). The SDK (`../serene-pub-sdk`) and core-catalog are **read-only**.
Supervisor: lane `dg-1d-1`. All paths below are under `src/lib/server/` unless they start with `src/` or `plans/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: no SDK edit is allowed.) The repo is staged by the lead: run **no git command that changes the index or the working tree** (`git diff`, `git status` are fine). Never run prettier with `--write` and never pipe its output into a file. No `npm run build` (a built app may be running: do not stop it). No migration. No full test run.

## Context: what worker 1 built (read it; do not redo it)

Read `plans/REPORT-dg-1d-1-w1-2026-11-17.md` and the code it names:

- `pipelines/runtime/host.types.ts` (after `HostScopeError`): `forPeople(value, sentence)` attaches a halt's **people sentence** (the words for the people in the session, with no `${node.key}: ` prefix) to an error or a commit's `{ halt }` return; `peopleSentenceOf(value)` reads it; `notePeopleHalt(runId, said, sentence)` / `takePeopleSentence(runId, haltReason)` are the run's record.
- `host.ts`'s wrapper (`notedPlain`, ~7635–7680) records any marked thrown error and any marked `{ halt }` a commit returns. `runSpec` stamps the sentence of the halt that ended the run on `receipt.meta.peopleSentence`; `receiptHaltFor` shows it to every reader, and an unmarked halt reads as plain words plus "An administrator can see the details." to a non-administrator.
- Marked so far: rows 1–3 (`refuseForPeople` in `personLineOf`), row 8 (`SeatNameRefusal`, raise sites in `sessions/seatName.ts`, pass-through host.ts ~4619), row 16 (host.ts ~6053), row 18 (review rejection, structural).

The rule (owner ruling DG1, 2026-11-17; lead's ruling on the inventory): **a halt's words are for people only when the code that raises it says so; everything else is detail. Decided at the raise site, never by matching text.** The thrown or returned message stays **byte-identical**; the mark rides beside it.

## What to build

The work list is `plans/INVENTORY-halt-sentences-2026-11-17.md`, Part A, column **Ruling**. Mark the **P** rows below; **D** and **W** rows, and everything not in Part A, stay unmarked. **Re-verify every line** (lines below are as of the start of this lane, before worker 1's edits shifted host.ts by about +13 after line 1466 and about +3 more after line 4616).

### A. Refusal classes: a constructor flag (brief item 4)

"Where the class is raised in many places, give the class a way to say which of its messages are for people (a constructor flag set at the people sites) and mark at the pass-through only when the instance says so."

For each class below that is declared `extends Error {}` in a file you own, add `constructor(message: string, opts?: { forPeople?: boolean }) { super(message); if (opts?.forPeople) forPeople(this, message) }` (import `forPeople` from `$lib/server/pipelines/runtime/host.types`), with a one-line doc comment stating the rule. Set `{ forPeople: true }` only at the people raise sites.

- `SeatNameRefusal` (`sessions/seatName.ts`): convert worker 1's `throw forPeople(new SeatNameRefusal(m), m)` raises to `throw new SeatNameRefusal(m, { forPeople: true })` (same sites, same messages). The `:86` wrap stays unmarked. Do **not** mark 439 / 441 / 455 (not in the inventory).
- `StoryClockRefusal` (`state/storyTime.ts`): only the raise of `UNDATED_MOVE_SENTENCE` (~575; row 15). Never "There is no session ${id}." Pass-through host.ts ~5356 (was 5343): `throw forPeople(new HostScopeError(`${node.key}: ${e.message}`), peopleSentenceOf(e))`.
- `OfferMediaRefusal` (`characters/portrait.ts`; row 30) and `AttachSpriteRefusal` (`sprites/attach.ts`; row 31): only the **ownership** sentences (who may use the picture / sprite). Not "name a character or a cast member, not both." or any input check. Pass-throughs host.ts (was 5535, 5601) `refused — ${e.message}`: wrap with `forPeople(…, peopleSentenceOf(e))`.
- `BackdropRefusal` (`sessions/backdrop.ts`; row 32): only "That picture belongs to neither this session nor you…". Pass-through host.ts (was 5467) likewise.
- `LibraryWriteRefusal` (`library/writes.ts`; row 36): only the raises carrying `may.reason` (~350, ~406). Pass-through host.ts (was 1360) `return { halt: `${node.key}: ${e.message}` }` → `forPeople({ halt: … }, peopleSentenceOf(e))`.
- `StateRefusal` lives in `state/write.ts`, which you do **not** own: for row 17 mark at the raise sites in `sessions/convertRuleset.ts` (~102, 105, 111, 112, 115) as `forPeople(new StateRefusal(m), m)`; pass-through host.ts (was 6054) `return { halt: e.message }` → `forPeople({ halt: e.message }, peopleSentenceOf(e))`. `setStatConfig`'s `StateRefusal` (was 4809) is D: untouched.

### B. Host raise sites (`pipelines/runtime/host.ts`)

- Row 4, `assertMayAct` (was 1578): `throw forPeople(new HostScopeError(`${node.key}: ${MESSAGE_ACTION_REFUSAL}`), MESSAGE_ACTION_REFUSAL)`.
- Row 5 (was 5995), row 6 (was 5777, 5848), row 11 (was 493): the sentence exists only inside a template string. Split it so the sentence is its own value (e.g. `const sentence = `message ${id} is still being written — stop it first, or wait.``) and throw `forPeople(new HostScopeError(`${node.key}: ${sentence}`), sentence)`. The full message stays **byte-identical**.
- Row 7 (was 5153): `SettledRefusal` is raised in one place (`sessions/settle.ts:123`, only `SETTLED_SENTENCE` / `EVERY_TURN_KEPT_SENTENCE`), so every instance is for people: `forPeople(new HostScopeError(…), e instanceof SettledRefusal ? e.message : peopleSentenceOf(e))`. Do not edit `settle.ts`.
- Row 9 (was 4691): every `setSeatBench` refusal (`sessions/seats.ts` ~1816, 1820, 1825; confirm there are no others) is a people sentence and is a string, so mark at the pass-through: `forPeople({ halt: done.refusal }, done.refusal)`. Do not edit `seats.ts` unless a refusal there is not one of the three.
- Row 10 (was 310, 559, 6862): `undatedLoreWriteRefusal` returns only `UNDATED_LORE_WRITE_SENTENCE` or null: `forPeople(new HostScopeError(`${nodeKey}: ${refusal}`), refusal)`.
- Genre-shape guards (lead ruled P): `loreWriteRefusal` throws (was 1150, 6499, 7087, 7344, 7484: `noLore`), `seatWriteRefusal` (was 4666: `return { halt: refusal }`), `libraryWriteRefusal` (was 1303: `no`). Confirm each value comes only from that guard (`messages/writes.ts` 101, 125, 175). **Not** `pluginLibraryRefusal` (was 1300, D), **not** `NOBODY_ACTING_SENTENCE` (was 1312, D).

### C. `pipelines/runtime/host.loreWrites.ts`

- Row 12 (~151): the template sentence ("“${name}” is the name of more than one entry … Rename one of them…"): split and mark as in B.
- Row 13 (~780, ~783): `LINKED_THAT_WAY` + `LINKED_IN_PART` / `linkNotStanding`: mark with the sentence (no prefix) as the people sentence.
- Not 968 (D), not 1136 (D).

### D. The binding road — `pipelines/runtime/bindings.summarize.ts` ~1064 (row 33)

`core:task/read-answer@1` halts with "nothing to answer — this action was fired with no form; it answers a question a message put to you". A binding knows its run (`run.runId`, the closure `RenderRun`, as `reckoning-duties` uses it ~572) but not its node key: put the sentence in a `const`, call `notePeopleHalt(run.runId, sentence, sentence)` and `return halt(sentence)`.

### E. One existing test the rule changes

`sockets/sessions.actions.int.test.ts` ~1576–1597 ("M2a a6: a press whose run halts…"): the fixture halts on an unmarked wiring step and presses as a non-administrator owner, so the answer is plain words. Change only: `expect(res.reason).toMatch(/stop/)` → `expect(res.reason).toBe(PLAIN_RUN_ENDED_REASON)`, and delete `expect(told[0].frame.reason).not.toBe(res.reason)` (the two are equal now). List the lines. Touch nothing else in that file.

## Tests

- Per P row, one test that the run's record (or the receipt's stamp) carries the sentence **without** a node-key prefix. Group by helper; a table-driven test is fine. Cheapest that is truthful: `createHost(db, { runId, sessionId, userId, … })` and call `host.commit` / the read with a payload that hits the refusal, then `takePeopleSentence(runId, <the thrown message or returned halt>)` returns the sentence; for a class raise site where a host harness is costly, call the raising function and assert `peopleSentenceOf(err)` and `err.message`. `pipelines/runtime/builtins.int.test.ts` (~1077 row 4, ~1114 row 5), `setSeatBench.int.test.ts`, worker 1's `pipelines/runtime/peopleSentence.int.test.ts` show harnesses. Name any row you could not test and why.
- Unmarked siblings stay unmarked: at least `personLineOf`'s "this run has no user", `StoryClockRefusal("There is no session …")`, the `:86` seat-name wrap, `pluginLibraryRefusal`.
- Run, one at a time, each capped:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dg-1d-1-w2-<n>.log 2>&1"
```

(always at least one path; never pipe vitest into `head`). Done means green: your new tests; `sockets/sessions.actions.int.test.ts`; the existing tests of every file you changed (find them: `ls` beside each file, `grep -rln "<ClassName>\|<function>" src --include=*.test.ts`), including `sessions/offerMessage.int.test.ts` (351 and 421 untouched), `pipelines/runtime/builtins.int.test.ts`, `pipelines/runtime/setSeatBench.int.test.ts`; worker 1's tests (`haltExplanation.test.ts`, `host.types.peopleSentence.test.ts`, `peopleSentence.int.test.ts`); `src/lib/shared/conformance/commentHistory.test.ts`. If an untouched test fails, do not change it: report test, line, sentence. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors) and `npx prettier --check` on each file you changed (report, never `--write`).

## Rules you work under (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "It is a **session**, never a *chat*."
- "Comments state the rule, never the history": `commentHistory.test.ts` bans "no longer", "used to", "previously", "now" in comments of changed files.
- CLAUDE.md §Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." **Do not reword any sentence.** No new names beyond the constructor option `forPeople` and local `const`s.
- Prefer the site that raises the people sentence over a class pass-through; a pass-through marks only when the instance is marked (`peopleSentenceOf(e)`), except `SettledRefusal` (row 7) and `setSeatBench` (row 9) as above.

## Files owned (edit only these)

`pipelines/runtime/host.ts` (the P raise sites and pass-throughs listed, imports), `pipelines/runtime/host.loreWrites.ts` (rows 12, 13), `pipelines/runtime/bindings.summarize.ts` (row 33 only), `sessions/seatName.ts`, `state/storyTime.ts`, `characters/portrait.ts`, `sprites/attach.ts`, `sessions/backdrop.ts`, `library/writes.ts`, `sessions/convertRuleset.ts` (the class flag or marks only), `sockets/sessions.actions.int.test.ts` (the two lines in E), new test files.

## Out of scope

W and D rows; routine lines and the routine log (rows 22–28, another lane); `sessions/offerMessage.ts`, `messages/deletion.ts`; `state/write.ts`, `sessions/settle.ts`, `sessions/seats.ts` (unless a fourth bench refusal turns up: report it); worker 1's files other than as listed; client code; NOMENCLATURE; any rewording.

## Report

Write to `plans/REPORT-dg-1d-1-w2-2026-11-17.md`, under 500 words: the rows marked, each with file:line; rows you could not mark and why; tests (file, count, pass/fail, log path) and which rows each covers; existing test lines changed; prettier results; **Noticed, not done**.
