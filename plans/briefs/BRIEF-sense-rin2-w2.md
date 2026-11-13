# BRIEF — lane `sense-rin2`, worker 2 — the Read in? tab and line name the right gate

You are a `lane-worker`. Do only this. Supervisor: lane `sense-rin2`. Read every cited line before changing it.

## Background (what is true on the server — checked by the supervisor)

- The turn reads each entry **as the session reads it**: amendments on the session's line, by its clock, are
  applied before any mechanism sees the row (`src/lib/server/pipelines/runtime/host.ts` about 4320–4335). So a
  skip `"entry is disabled"` means **off at the turn's reading**, whatever the base row says.
- The keyword lane skips **archived before disabled** (`src/lib/server/pipelines/ranking/keywordQuery.ts`
  about 558–580). Rows off the session's line or dated after its clock never reach it at all (SQL, earlier still).
- A skipped `RetrievalRow`'s `entry.enabled` is the **base row's** live value (`retrievalEntriesFor` in
  `server/sockets/pipelines.ts` reads `lorebook_entries.enabled` with no amendment). `entry` is absent when the
  book could not be read.
- Worker 1 is adding **`skipReason?: string`** to `Sockets.Pipelines.RetrievalRow` (`src/lib/shared/sockets/types.ts`)
  and filling it on every skipped row that has a reason: the mechanism's raw reason, e.g. `"entry is archived"`.
  Read it directly. Do not edit `types.ts` or `pipelines.ts`; vitest does not typecheck, so your tests run before
  worker 1 lands.
- `marksAsRead` (`src/lib/client/lorebooks/editor/teachMarks.ts` about 87–111) gives the tab's `reading`:
  `MarksHere` when the session reads the entry; **null** when it does not; `undefined` (in the component) while
  unknown. Null, per `entries:sessionEntries` (`server/sockets/entries.ts` about 1386–1420 and its `ownerOnly`
  branch about 1336–1343): the entry is **archived** as the session reads it, **off its line**, or **dated after its
  clock**. (It would also be null for a book the asker may not read, but the tab only lists the asker's own sessions
  on the book being edited, so that cannot reach it — the supervisor reports this.)

## Goal — four fixes, all in `src/lib/client/lorebooks/editor/readIn.ts` and `editor/signals.ts`

### A. Stop parsing server prose (`readIn.ts` about 54–59, 93–100)

Delete `SKIPPED_PREFIX` and `skipReasonOf`. Everywhere the raw reason was recovered, read
`row.skipReason` (treat `""` as absent). Remove `skipReasonOf` from `signals.ts`'s import.

### B. Rename `verdict` to the canon's word (NOMENCLATURE)

The canon rules **verdict** as "the one function that judges a rule … ⚠ Not a **decision** (§7, selection's answer on
a candidate)", and **decision** as "Selection's verdict on a candidate: included or not, with a reason." These
sentences are selection's answer on a candidate, so:

- `ReadInFacts.verdict` (`readIn.ts` about 37–38) → **`decisionLine`**. `SignalFacts.verdict` (`signals.ts` about
  47–48) → **`decisionLine`**. Every read and write of those fields in both files and both tests.
- `skipVerdict` → **`skipDecisionLine`**; `storeVerdict` → **`storeDecisionLine`**.
- Keep `reason` (select's code) and `why` (the stored sentence) as they are.
- Do **not** rename `RetrievalRow.verdict` (the wire field): `row.verdict` stays wherever it is read.
- Local variables named `verdict` that hold one of these sentences: rename to `line` or `decisionLine`. Update doc
  comments that say "verdict" for these sentences to "decision line" / "sentence". Leave comments about the
  `RetrievalRow.verdict` wire field alone.

### C. One mapping for one skipped row, and the off sentence (`readIn.ts` about 112–119; `signals.ts` about 121–122)

Add in `readIn.ts`, exported:

```ts
/**
 * The off gate's sentence. Off in the base row → switched off; on in the base row but off as the
 * session reads it (an amendment) → off for a while. Unknown base row → switched off: the plain claim
 * that holds whichever way it is off, where "for a while" would assert an amendment nobody saw.
 */
export function offDecisionLine(baseEnabled: boolean | undefined): string {
	return baseEnabled === true ? GATE.offForAWhile : GATE.off
}
```

and change `skipDecisionLine(reason, baseEnabled?: boolean)`: `DISABLED_REASON` → `offDecisionLine(baseEnabled)`;
archived and hidden as today; anything else verbatim.

- The **line** (`readInFacts`, about 177–182): `skipDecisionLine(skipped.skipReason, skipped.entry?.enabled)`.
- The **tab** uses `offDecisionLine(opts.enabled)` for its off gate and `skipDecisionLine(skipReason, opts.enabled)`
  for a skipped row, so the same skipped row gives the same sentence on both.

### D. The tab names the gate that actually stopped it (`signals.ts` about 115–131)

Rename `GATE.notOnLine` → **`GATE.notReadHere`**, copy (provisional):
`"it is archived in this session, not on its line, or dated after its clock"` — exactly what a null reading can mean.

Replace the gate chain with, in this order (server order: archived, then off):

```ts
const skipped = skippedEntryRow(explanation, opts.entryId)
const skipReason = skipped?.skipReason || undefined
// Off as this session reads the entry: its reading when known; else the turn's own word (a disabled skip);
// else, with the reading not yet known and the turn silent on it, the base row.
const off = opts.reading
	? opts.reading.off
	: skipReason === DISABLED_REASON ||
		(opts.reading === undefined && !row && !skipped && opts.enabled === false)

if (skipReason === ARCHIVED_REASON) facts.decisionLine = GATE.archived
else if (off) facts.decisionLine = offDecisionLine(opts.enabled)
else if (opts.reading === null && !row && !skipped) facts.decisionLine = GATE.notReadHere
else if (row) facts.decisionLine = judged
else if (skipped) facts.decisionLine = skipDecisionLine(skipReason, opts.enabled)
else facts.decisionLine = explanation.ranked ? "nothing reported on it" : "this turn ranked nothing at all"
```

Consequences to keep: an entry off in the base row but **on** at the reading (reading `{off:false}`), judged and
left out for budget, says the budget sentence; a judged row with the reading unknown and the base row off also
says the judged sentence (the turn read it on). Update the `opts.enabled` / `opts.reading` doc comments in
`signalFactsFrom` to say this. The early `if (facts.read) return facts` stays.

`src/lib/client/components/lorebookForms/EntryFireTest.svelte` about 270–278 already passes `enabled` (base row)
and `reading: marksHere`; change it only if the facts field rename makes it necessary (it reads `facts` only through
`signalsResult`, so it should not). Report whether you touched it.

### E. Tests (`readIn.test.ts`, `signals.test.ts`)

Update the test helpers that build skipped rows to set `skipReason` (and keep a `verdict` sentence). Rename
`.verdict` reads of facts to `.decisionLine`. Then add, each failing before and passing after:

1. Base row off, reading `{ off: false, pinned: false }`, judged row `outcome: "excluded"`, `reason: "excluded_budget"`,
   `verdict: "The budget was full before it got there."` → that sentence, not "it is switched off". Also with the
   reading `undefined`.
2. Archived and off: base row off, skipped `"entry is archived"` → `"it is archived"`; also with reading `{off:true}`.
3. A null reading names what null means: reading `null`, no row → `GATE.notReadHere`, and the sentence contains
   `"archived"`. Base row off with reading null and no row → also `GATE.notReadHere` (the line/clock/archived gates
   come before off).
4. Off for a while: base on, reading `{off:true}` → `GATE.offForAWhile`; base off, reading `{off:true}` → `GATE.off`.
5. The raw reason is read from the row: a skipped row whose `verdict` is some other wording entirely
   (e.g. `"Declined early: whatever."`) with `skipReason: "entry is archived"` gives `"it is archived"` on both the
   line and the tab; a skipped row with a `verdict` in the old prefix form but **no** `skipReason` names no gate
   (line: the catch-all / weighed wording it uses today for a reasonless skip).
6. Same sentence, line and tab: for each of `"entry is archived"`, `"entry is disabled"` with base on,
   `"entry is disabled"` with base off, `"not visible to the current speaker"`, and a miss sentence, build one
   skipped row with `entry: { …, enabled: base }` and `skipReason`, and assert
   `readInFacts(id, x).decisionLine === signalFactsFrom(x, { entryId: id, enabled: base }).decisionLine`.
   Also: a disabled skip with no `entry` on the row → the line says `"it is switched off"`.
7. Remove or rewrite the old tests that pinned the prefix parsing or the old `notOnLine` sentence.

### F. Docs

`docs/lorebooks.md` line 94 (the paragraph under "Why was it read in, or not?"): change only
`"it is switched off or archived, it is off for a while at this point in the story, it is not on this session's line or
is dated after its clock,"` to the server's order and what a null reading means:
`"it is archived or switched off, it is off for a while at this point in the story, this session does not read it
(archived there, off its line, or dated after its clock),"`. Nothing else in the file.

## Files owned

`src/lib/client/lorebooks/editor/readIn.ts`, `src/lib/client/lorebooks/editor/signals.ts`,
`src/lib/client/lorebooks/editor/readIn.test.ts`, `src/lib/client/lorebooks/editor/signals.test.ts`,
`src/lib/client/components/lorebookForms/EntryFireTest.svelte` (the one `signalFactsFrom` call, only if needed),
`docs/lorebooks.md` (line 94 only).

## Files readable

Anything. Not owned and not to touch: `retrievalReadout.svelte.ts`, `ReadInLine.svelte`, `teachMarks.ts`,
`types.ts`, `pipelines.ts`, `NOMENCLATURE.md`.

## Out of scope

The ranker and its gates; `entries:recentDecisions`; renaming `RetrievalRow.verdict`; any other copy change than
the ones above; anything about who knows what.

## Stop and ask when

You would need a name, field, file or sentence not listed here. Put the question in your report.

## Done means

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/editor/readIn.test.ts src/lib/client/lorebooks/editor/signals.test.ts"`
passes; `grep -n "verdict" readIn.ts signals.ts` shows only reads of the wire field `row.verdict` (and comments about
it); `grep -n "Never reached the ranker" src/lib/client` finds nothing outside test fixtures' `verdict` strings;
`npx prettier --check` on each changed file (if one already failed before you, say so and do not reformat it).

## Report

Final message: changed files, every renamed symbol (old → new), every sentence added or changed, test command and
result (counts), whether `EntryFireTest.svelte` changed, anything noticed and not done.

## Rules (verbatim from the guide and the lane brief)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash`. Do not start a dev server.
  Never pipe vitest into `head`.
- Browser code runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`.
  `$state(new Set())` is not reactive: use `SvelteSet`.
- It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
