# BRIEF — sense-st2 worker 1 — two undo cases in the app (code + call sites)

You are a `lane-worker` for lane `sense-st2` (supervisor: the agent that launched you). App repo:
`/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message (changed files, tests run
with exact results, anything you could not do, Noticed-not-done). Do not write a report file.

## The owner's ruling (2026-11-11, verbatim)

"Yes, a turn owns what it wrote" — "Swipe, regenerate and Back all take back the same set: state, clock moves,
scene boundaries, draws. A genre can declare what it keeps across a re-tell. One undo rule for modders."

## Goal

`retractStateAnchoredTo` (`src/lib/server/state/write.ts` ~811) today takes three option flags (`ticks`, `scenes`,
`annex`) and its five callers pass four different combinations. Replace the flags with **one required case**:

```ts
export async function retractStateAnchoredTo(db: Db, messageId: number, turnCase: "replaced" | "leaves")
```

- **`"replaced"`** — the message stays and is told again: swipe, regenerate, a failed run's cleanup.
- **`"leaves"`** — the message leaves the history: Back, delete.

Both take back everything the message wrote: values, configurations, proposals, clock moves, **scene boundaries
(`takeSceneBoundariesAt`, now in BOTH cases)**, scene notes, zone snapshots, lore (`retractLoreAnchoredTo`), cast
versions, library changes, ruleset conversions, seat benches, annex deltas. Exactly two differences, both written
in the doc comment:

1. **The round's tick (interim, open ★ST2-1).** In `"replaced"` keep exactly today's tick rule: call
   `revertClockMovesAnchoredTo(t, [messageId], { keepTicks: true })` and delete proposals with `notATickSql`.
   In `"leaves"` take every clock move including ticks. Reason, to put in the comment: the per-reply tick is gone;
   every `cause: 'tick'` move is now a round's tick (`core:spec/round-tick`, or the Lair keeper's round worth),
   filed on `round-ended`, anchored to the message that closed the round. A replaced line keeps its message id
   and the turn tally never counts an id twice (`tallyTurn`, `messageId <= prev.lastMessageId`), so the re-driven
   line does not end its round again and would never tick again. Until the owner rules ★ST2-1 the replaced case
   keeps the round's tick. Mark it `🚧 ★ST2-1`.
2. **`keepOnRetell` annex fields.** In `"replaced"`, an annex field whose declaration has `keepOnRetell: true` keeps
   its value; in `"leaves"` it goes like everything else. The SDK flag lands later (another worker); read it now
   with a narrow cast: `(d as { keepOnRetell?: unknown }).keepOnRetell === true` over
   `annexFieldsOfOwner(t, genreId, owner)` (`src/lib/server/sessions/annexFields.ts`; genre from
   `sessionGenreOf(t, sessionId)`), session scope only. Pass the `t` handle, never the outer `db`.

## The annex half (`src/lib/server/sessions/annexChanges.ts`)

Deltas are whole-document per owner (`before`/`after` = `{ document, audiences }`). **Do not change the table or its
columns** (that is the next lane's work). Add an option:

```ts
retractAnnexDeltasAnchoredTo(tx, messageId, opts: { keep?: (owner: string) => Promise<ReadonlySet<string>> } = {})
```

For each row (newest first, as now), with `kept` = the keep keys whose value differs between `before.document` and
`after.document` (compare with JSON equality; ignore the owner's `TIMELESS` keys):

- `kept` empty → exactly today's behaviour (delete the row; land `before` when no later delta stands).
- every differing non-timeless key is in `kept` → leave the row untouched; nothing landed, nothing pushed to `taken`
  (the row stays anchored, so a later Back still takes it).
- otherwise **narrow** it: `after'` = `before.document` with each kept key set from `after.document` (or deleted
  where `after.document` lacks it); audiences likewise from `before.audiences` with kept keys from `after.audiences`.
  `before.document === null` → `after'` is `null` unless a kept key is present. Update the row's `after` to
  `{ document: after', audiences: audiences' }` (row stays, same id). Land `after'` when no later delta stands
  (`reverted`). Push `{ row: <the original row>, reverted, narrowed: true }`.

`AnnexDeltaTaken` gains `narrowed?: true`. `restoreAnnexDeltas` puts rows back with
`onConflictDoUpdate` on the id setting `before` and `after` (so a narrowed row returns to its original), then lands
as today.

## `restoreRetractedState` (write.ts ~1281)

Its first line takes back what a failed run anchored: make it `retractStateAnchoredTo(db, taken.messageId,
"replaced")` (the failed run replaced nothing; the round's tick and kept fields the swipe left stay, and the original
taken rows go back over them). Comment the reason in one line.

## The five call sites — those lines and their adjacent comments only

Re-read each; the line numbers have moved.

| File | Line | Verb | New case |
|---|---|---|---|
| `src/lib/server/sockets/sessions.ts` | ~9326 | regenerate (`sessionMessagesRegenerateHandler`) | `"replaced"` |
| `src/lib/server/sockets/sessions.ts` | ~9962 | swipe right (drops `annex: "keep"`) | `"replaced"` |
| `src/lib/server/sessions/rewind.ts` | ~646 | Back (`rewindTurn`) | `"leaves"` |
| `src/lib/server/pipelines/runtime/host.ts` | ~9842 | delete (`core:outlet/delete-message`) | `"leaves"` (now also takes scene boundaries) |
| `src/lib/server/utils/generationStatus.ts` | ~243 | a failed run's cleanup | `"replaced"` |

Update the comments at each to say which case and why, in one or two lines (the swipe comment at ~9952 says
"all but a tick" — say "all but the round's tick (★ST2-1)"; the swipe's `clockRetractProblem(..., { keepTicks: true })`
at ~9935 stays as it is). `sessions.ts` and `host.ts` are shared files: touch only those lines.

## A press anchors its annex writes (host.ts `writeAnnexDocument`, ~2378)

Today `const anchor = await imprintAnchor(sessionId)` is null for a run a person started with a press that opened no
row (`currentRunFamily() === "action"`), so its annex write records no delta and is permanent at once. New rule: such
a run anchors to the session's newest message, as own-book lore writes already do (`turnAnchorOf`). Exception: a
person's own value set through an annex field's action — the run of `ANNEX_FIELD_SPEC_ID`
(`'core:spec/set-annex-field'`, exported by `@serene-pub/sdk`), i.e. `scope.specId === ANNEX_FIELD_SPEC_ID` — is the
person's own edit and stands (no anchor). Shape:

```ts
const anchor =
	(await imprintAnchor(sessionId)) ??
	(scope.specId === ANNEX_FIELD_SPEC_ID
		? null
		: await imprintAnchorFor(db, sessionId, { turnMessageId: null, runId: scope.runId ?? null }))
```

(`imprintAnchorFor` is in `src/lib/server/lorebooks/imprints.ts`.) Change only the annex write's anchor;
`imprintAnchor` itself (lore imprints, *File as a room*) stays as it is.

## Comments to correct (owned files only)

- write.ts: the doc comment of `retractStateAnchoredTo` (lines ~769–830: the old "A reply's tick stays… the
  re-driven reply never ticks again" sentence describes the removed reply tick) and of `restoreRetractedState`.
- `src/lib/server/state/clockMoves.ts` header (~25–34) and `notATickSql` / `revertClockMovesAnchoredTo` doc
  comments: say the kept tick is the round's tick, kept on a replacement only, ★ST2-1. No code change there.
- `src/lib/server/sessions/rewind.ts` module comment ~25–28 only if it contradicts.
- `src/lib/server/sessions/annexChanges.ts` module comment: Back and a replacement both take deltas; a replacement
  keeps `keepOnRetell` fields.

## Existing tests that call the old flags

Update their call arguments only (no other change): `src/lib/server/state/retractCastVersions.int.test.ts`,
`src/lib/server/state/worldScope.int.test.ts`, `src/lib/server/library/writes.int.test.ts`,
`src/lib/server/scenes/sceneNotes.int.test.ts` — `{ ticks: "take", scenes: "take" }` and `{ ticks: "take" }` →
`"leaves"`; a call with no options → `"replaced"`. `grep -rn "retractStateAnchoredTo(" src` for any other caller and
list it in your report (do not change non-test callers beyond the five).

## New tests (this worker)

Add `src/lib/server/sessions/annexChanges.keepOnRetell.int.test.ts` (model it on
`src/lib/server/sessions/annexChanges.int.test.ts`): with a `keep` option — untouched row when every changed key is
kept; narrowed row (mixed keys) lands `after'` and a later full retraction (no keep) takes the kept key too;
`restoreAnnexDeltas` puts a narrowed row back to its original and lands it. Then run the targeted tests below.

## Files owned (only these)

`src/lib/server/state/write.ts`, `src/lib/server/state/clockMoves.ts` (comments), `src/lib/server/sessions/annexChanges.ts`,
`src/lib/server/sessions/rewind.ts` (the call and its comment), the listed lines of `sockets/sessions.ts`,
`pipelines/runtime/host.ts`, `utils/generationStatus.ts`, the four test files above (call arguments), and the new test
file. Readable: anything.

## Out of scope

`src/lib/server/sessions/retakeTurn.ts` (`deleteTurnYield`), `messages/store.ts`, `pipelines/routines/*`,
`sessions/coreAnnex.ts`, the turn tally, the settle line (`assertRetractable` stays first and untouched), the
`annex_deltas` schema, any migration, any UI, the SDK repo, docs. Findings go under Noticed-not-done.

## Stop and report when

A migration or stored-data reshape seems needed; a type or function name would be exported that is not named here;
the two cases need a third difference; a test you did not write fails for a reason in your change and the fix is
outside your files.

## Done means

- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean (report the exact tail of its output).
- Targeted tests, capped (one command, capped scope):
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/annexChanges.keepOnRetell.int.test.ts src/lib/server/sessions/annexChanges.int.test.ts src/lib/server/state/write.int.test.ts src/lib/server/state/clockMoves.int.test.ts src/lib/server/state/retractCastVersions.int.test.ts src/lib/server/state/worldScope.int.test.ts src/lib/server/library/writes.int.test.ts src/lib/server/scenes/sceneNotes.int.test.ts src/lib/server/sessions/rewind.int.test.ts src/lib/server/sockets/sessions.retractAnnounce.int.test.ts"`
  and report pass/fail counts per file. A failure that existed before your change: say so with evidence.
- `npx prettier --check <file>` on each file you changed.

## Verbatim rules (from `.claude/guides/multi-agent.md` and `plans/briefs/BRIEF-sense-clk.md`)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not build the SDK in this task.)
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
- **Re-read the cited lines before changing anything.**
- CLAUDE.md Hard rules apply: no top-level `await` in `db/index.ts`; inside a transaction only `tx`.
