# BRIEF — worker `dg-1d-1-w1` — the people-sentence marker, the stamp, `receiptHaltFor`, the reply and action surfaces, rows 1–3, 8, 16, 18

Repo `/home/jody/github/serene-pub` (app). The SDK (`../serene-pub-sdk`) and core-catalog are **read-only**.
Supervisor: lane `dg-1d-1`. All paths below are under `src/lib/server/` unless they start with `src/` or `plans/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: no SDK edit is allowed.) The repo is staged by the lead: run **no git command that changes the index or the working tree** (`git diff`, `git status` are fine). Never run prettier with `--write` and never pipe its output into a file. No `npm run build` (a built app may be running for a UI walk: do not stop it). No migration. No full test run.

## Goal (owner ruling DG1, 2026-11-17)

Owner: "Regular users see the error and a basic generic user friendly description of the problem and a suggestion to notify admin." "For the future, never publish raw errors directly to the message body." A refusal a member can act on stays readable.

The rule: **a halt's words are for the people in the session only when the code that raises it says so; everything else is detail.** Decided at the raise site by a marker, never by matching text. A non-administrator reads an unmarked halt as the surface's plain sentence plus `ADMINISTRATOR_SUGGESTION`; an administrator reads the reason as today; a marked halt (and a review rejection) reads the people sentence — **without any `${node.key}: ` prefix** — for every reader.

## What to build

### 1. The marker and the run's record — `pipelines/runtime/host.types.ts`

`host.types.ts` has only `import type` lines, so a value export there is a runtime leaf (refusal-class files elsewhere may import it later). Add, beside `HostScopeError`, with a short doc comment each (🚧 provisional):

- `forPeople<T extends object>(value: T, sentence: string | undefined): T` — attaches the people sentence to `value` under a `Symbol.for("serene-pub.peopleSentence")` key and returns `value`. Does nothing when `sentence` is not a non-empty string (so a pass-through can write `forPeople(x, peopleSentenceOf(e))`).
- `peopleSentenceOf(value: unknown): string | undefined` — reads it back (any object; `undefined` otherwise).
- A run-keyed record (module-level `Map<runId, Array<{ said: string; sentence: string }>>`; the same pattern as `routineRunOf` in `pipelines/routines/runs.ts`, because a binding knows its run id but not its node key or the scope):
  - `notePeopleHalt(runId: string | undefined, said: string, sentence: string): void` — no-op without a run id.
  - `takePeopleSentence(runId: string, haltReason: string | undefined): string | undefined` — returns the `sentence` of the entry whose `said === haltReason` (the last such entry), and **always forgets the run's entries**. The equality only identifies which recorded halt ended the run; whether it is for people was decided by the raise site.

### 2. The host's three roads — `pipelines/runtime/host.ts` (only the wrapper at ~7593–7649 here)

- The `read` / `call` / `commit` catches (`throw plain(e, node)`, ~7624, 7634, 7644): before `plain`, when `peopleSentenceOf(e)` is a string and `e instanceof Error`, `notePeopleHalt(scope.runId, e.message, sentence)`.
- The `commit` wrapper (~7639–7648): on the returned value, when `peopleSentenceOf(r)` is a string and `typeof r.halt === "string"`, `notePeopleHalt(scope.runId, r.halt, sentence)`; return `r` unchanged. (`bindings.ts:1418` turns a commit's `{ halt }` into `halt(result.halt)`; `bindings.outlets.ts` passes 9 more through.)
- Update the wrapper's doc comment in one or two sentences (rule only).

### 3. The P rows this worker marks (re-verify each line first; the inventory is `plans/INVENTORY-halt-sentences-2026-11-17.md`)

- **Rows 1–3** — `personLineOf`'s `refuse` (host.ts:1463) raises 4 people sentences and 5 wiring ones. Add a for-people variant beside it (e.g. `refuseForPeople(why)` that throws `forPeople(new HostScopeError(`${node.key}: ${why}`), why)`) and use it **only** at 1488, 1504 ("You can only send messages with personas you own."), 1492 ("a person's message is written as the person who sent it") and 1513 ("a person's message speaks from their own seat, not another's"). The other `refuse(...)` calls stay as they are. The thrown message stays byte-identical.
- **Row 16** — host.ts:6040 `return { halt: "Only the session's owner can change its rules." }` → `forPeople({ halt: … }, …)` with the same sentence.
- **Row 8** — `SeatNameRefusal`: mark at its people raise sites in `sessions/seatName.ts` (125, 128/246, 152, 154, 161, 204, 206, 243 per the inventory: re-verify; **not** the `:85` wrap of any `Error`), as `throw forPeople(new SeatNameRefusal(msg), msg)` (or the same through a constructor option if the class is raised from a helper; keep the message byte-identical). At the pass-through host.ts:4607 `return { halt: e.message }` → `return forPeople({ halt: e.message }, peopleSentenceOf(e))`, so only a marked instance is marked.
- **Row 18** (review rejection) is structural: no raise-site change (step 5).

### 4. The stamp — `pipelines/runtime/runTurn.ts` (`runSpec` only)

In the `onRunEnd` hook (~1218), after `receiptWithoutQueryText(end.receipt)`: `const people = takePeopleSentence(runId, end.receipt.haltReason)`; when `end.receipt.outcome` is `halt` or `err` and `people` is a string, set `end.receipt.meta = { ...(end.receipt.meta ?? {}), peopleSentence: people }` (the SDK's `ReceiptMeta` has an index signature, `receipt.ts` 167–170; `end.receipt` is the same object `run()` returns, `executor.ts` 2716–2734). Then, before `live.finish`, when `receiptPeopleSentence(end.receipt)` (step 5) is a string and `end.kind` is `err` or `halt`, call `live.failedWith(new ComposedError(thatSentence))` so the failed row stores the people sentence (the row's redaction rule lives in `persistGenerationErrorRow`, which shows a `ComposedError`'s message as written; `liveRow.ts` is not yours: do not edit it). In the `.catch` (~1278), call `takePeopleSentence(runId, undefined)` so a run that threw before its hook leaves nothing behind. `haltBeforeRun` runs no node: no stamp. A receipt stored before this change has no stamp and reads as detail.

### 5. `receiptHaltFor` and friends — `pipelines/runtime/haltExplanation.ts`

- Move the review-rejection test out of `answerStanding` (`pipelines/runtime/reviewGate.ts` 560–580) into `haltExplanation.ts` as an exported pure `rejectedAtReview(receipt: { outcome: string; haltReason?: string; reviews?: ReadonlyArray<{ action: string }> }): boolean` with the **exact** same logic (outcome `halt` and (any review `action === 'reject'` or, on a compacted receipt whose reviews were dropped, `haltReason === REVIEW_REJECTED_REASON`)), and export `REVIEW_REJECTED_REASON = "rejected at review"` from there. `answerStanding` calls `rejectedAtReview` (the one edit in `reviewGate.ts`: no second text test anywhere).
- `receiptPeopleSentence(receipt)`: `receipt.meta?.peopleSentence` when it is a non-empty string; else `REVIEW_REJECTED_REASON` when `rejectedAtReview(receipt)`; else `undefined`.
- `receiptHaltFor(reader, surface, receipt, said)` (widen its `Pick` to `"outcome" | "nodes" | "haltReason" | "reviews" | "meta"`): people sentence → that, for every reader; else an administrator (`connectionsVisibleTo(reader)`) → `said`; else → `haltExplanationFor(reader, surface, said)` (plain sentence + suggestion). A model-call failure keeps today's result (plain for a non-administrator, `said` for an administrator).
- `haltStepShownTo(reader, receipt): boolean` — `connectionsVisibleTo(reader) && receiptPeopleSentence(receipt) === undefined`: only an administrator is sent the step a run stopped at, and a people sentence names no step.
- Keep `haltedAtModelCall` and `plainReplyFailure` (still used). Rewrite the module doc comment's "Why the step is not named" / "Who reads the reason" paragraphs to state the rule as it stands (no history words).

### 6. The surfaces

- `utils/runReply.ts`:
  - The verb row (~691–700): a people sentence → `new ComposedError(sentence)`; else as today.
  - The refusal (~705–713) keeps calling `receiptHaltFor`.
  - The catch road with no receipt (~739–745): the `no published version` branch becomes `haltExplanationFor(socket.user, "reply", err.message)` (plain for a non-administrator; the message for an administrator). Do not change the `ComposedError` branch or the generic fallback, or how the row is stored there.
  - The terminal frame (~783–810): `haltNodeKey` and `haltStep` only when `receipt && haltStepShownTo(socket.user, receipt)` (and `haltStepOf` is called only then: it must never be called more often than today).
- `sockets/sessions.pipelines.ts`: `finished` (~786–826): `error` keeps `receiptHaltFor`; `haltNodeKey` / `haltStep` only when `receipt && haltStepShownTo(socket.user, receipt)` (same rule for `haltStepOf`). `settle`'s `fail(receiptHaltFor(...))` (~905–918) unchanged in shape. Do **not** change `sessions:runEnded` (`haltExplanationFor(null, …)`).

### 7. Stored row for a review rejection

`utils/replyRoad.int.test.ts` ~1229–1234 expects `plainReplyFailure()` on a rejected reply's row. With step 4 the row stores `REVIEW_REJECTED_REASON`: change those two expectations to the review sentence (and the comment to the rule). List the lines in your report.

## Tests (new or changed; under `src/lib/server/`)

- `pipelines/runtime/haltExplanation.test.ts`: `receiptHaltFor` × (non-administrator owner, guest = non-administrator, administrator): an unstamped wiring halt naming a step and a spec (e.g. `outcome: 'halt'`, `haltReason: "assemble: no published version of 'core:spec/x'…"`) → plain + suggestion / plain + suggestion / the reason; a stamped receipt → the stamp for all three; a review rejection with `reviews: [{ action: 'reject' }]` → `REVIEW_REJECTED_REASON` for all; a **compacted** review rejection (no `reviews`, `haltReason: "rejected at review"`) → the same; an old receipt with no stamp → detail; a model-call failure → as before. `haltStepShownTo` cases. The existing test at ~215 ("Only the session's owner…") gains a stamp in its fixture if it needs one: list it.
- A small test for `forPeople` / `peopleSentenceOf` / `notePeopleHalt` / `takePeopleSentence` (forgets after take; equality picks the entry; an unmarked error class → `undefined`).
- `sockets/sessions.actions.modelCallWording.int.test.ts` 106–124 and `utils/runReply.modelCallWording.int.test.ts` ~110–125: the "Rejected at review." case gets `reviews: [{ action: 'reject', nodeKey }]` and `haltReason: "rejected at review"` (the executor's wording) and expects that; the seat-name and owner-only cases gain `meta: { peopleSentence: <the sentence> }`; the "embedding recovered, then a refusal" test gains the stamp. Add per surface a wiring-halt case (owner, guest → plain + suggestion and no `haltNodeKey` / `haltStep`; administrator → the reason). List every changed line.
- End to end (real run, no mocked `runTurn`): rows 1 (or 2) and 16 reach `receipt.meta.peopleSentence` with no node-key prefix, and the failed row (where the run made one) stores that sentence. Use an existing harness (`sessions/offerMessage.int.test.ts`, `pipelines/runtime/builtins.int.test.ts`, `sockets/sessions.ownerCardForGuest.int.test.ts` show how a real run is driven); a new `*.int.test.ts` file is fine. Row 8 likewise if a harness reaches the seat-name write cheaply.

Run, one at a time, each capped:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dg-1d-1-w1-<n>.log 2>&1"
```

(always at least one path; never pipe vitest into `head`). Done means green: `haltExplanation.test.ts`, your new tests, the two modelCallWording int tests, `utils/replyRoad.int.test.ts`, `pipelines/runtime/reviewGate.int.test.ts`, `sessions/offerMessage.int.test.ts` (351 and 421 untouched and green), `sockets/sessions.actions.int.test.ts` (untouched), `sockets/sessions.ownerCardForGuest.int.test.ts`, `pipelines/runtime/builtins.int.test.ts`, and `src/lib/shared/conformance/commentHistory.test.ts`. If an untouched test fails because an unmarked halt now reads plain for a non-administrator, **do not change the test**: report the test, the line and the halt's sentence. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors in your files) and `npx prettier --check` on each file you changed (report, never `--write`).

## Rules you work under (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never `kill -9` the dev server." "It is a **session**, never a *chat*."
- "Comments state the rule, never the history" — `src/lib/shared/conformance/commentHistory.test.ts` bans "no longer", "used to", "previously", "now" in comments of changed files: run it.
- CLAUDE.md §Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." Do not reword any sentence; the thrown or returned message stays byte-identical, the mark rides beside it.
- Name nothing beyond the names in this brief. A new name, setting, event or migration → stop and report.
- Views never toast; do not touch client code.

## Files owned (edit only these)

`pipelines/runtime/host.types.ts`, `pipelines/runtime/host.ts` (the wrapper at ~7593–7649, `personLineOf` 1457–1518, line 4607, line 6040, and the import lines), `sessions/seatName.ts` (marking only), `pipelines/runtime/runTurn.ts` (`onRunEnd` and the `.catch` in `runSpec`, imports), `pipelines/runtime/haltExplanation.ts`, `pipelines/runtime/reviewGate.ts` (only `answerStanding` calling `rejectedAtReview`, and the constant moving out), `utils/runReply.ts` (the halt paths above), `sockets/sessions.pipelines.ts` (`finished` above), test files.

## Out of scope

The other P rows (worker 2), routine lines and the routine log, `sessions/offerMessage.ts`, `messages/deletion.ts`, `liveRow.ts`, `sessions:runEnded`, client code, NOMENCLATURE (the supervisor writes it), any rewording.

## Report

Write to `plans/REPORT-dg-1d-1-w1-2026-11-17.md`, under 500 words: each change with file:line; the names added; tests run (file, count, pass/fail, log path); lines changed in existing tests; any untouched test that failed and why; prettier results; **Noticed, not done**.
