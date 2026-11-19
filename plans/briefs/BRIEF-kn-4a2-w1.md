# BRIEF — worker `kn-4a2-w1` — three fixes to the entry's knowledge screens

Repo `/home/jody/github/serene-pub` (app; no SDK change). Supervisor: lane `kn-4a2`. Paths below are under
`src/lib/` unless they start with `src/`, `docs/` or `plans/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`. Never `git checkout` / `restore`. Never `prettier --write`, nor a scratch-copy
equivalent. No migration. No full test run, no build.)

## Goal

Lane `kn-4a1` built the owner's knowledge screens on an entry (the **Not common knowledge** toggle and the
**Known by** inspector tab) through the socket door `entryKnowledge:*` and one client store `BookKnowledge`
(`client/lorebooks/knowledge/bookKnowledge.svelte.ts`). A scope review found three faults. Fix them, each with a
test. Read first: `client/lorebooks/knowledge/knownByWords.ts` (all), `knownByWords.test.ts`,
`server/lorebooks/entryKnowledge.ts` lines 96–205 (`winningTies`, `winnersOf`, `beats`) and 600–796
(`readBookKnowledge`), `client/lorebooks/EntryWorkspace.svelte` 1206–1271 and the toggle at ~2602–2630,
`client/lorebooks/sections/EntryInspector.svelte` 80–111, and the existing tests named under Done means.

### Fix 1 — show both only when the owner-only read succeeded

The toggle and the Known by tab gate on `readOnly` / `mayEdit`, but `lorebookAccessFor` calls every member of a
session an owner of its notes book; the server refuses them (it gates on `book.userId === userId`), so they see
controls that only fail. Rule: **show both only when `knowledge.loaded`** (the store's marks read succeeded —
`BulkEditBar` already gates this way). A non-owner sees neither, and no refusal sentence.

- `EntryWorkspace.svelte` `knowledgeToggleShown`: replace `!readOnly` with `knowledge.loaded`; keep the other
  conditions.
- The `knowledge.showEntry(...)` effect (~1226): gate the id on `knowledge.loaded` instead of `!readOnly`, so the
  rows are asked only after the marks read succeeded (a refused member asks once and nothing more).
- Keep the `knowledge.open` effect's `if (readOnly) return`: a share reader and an administrator never ask (an
  existing test asserts no `entryKnowledge:list` is sent for them).
- `sections/EntryInspector.svelte` `knownByShown`: replace `mayEdit` with `knowledge.loaded`. Leave `mayEdit` on
  the other things that use it.
- ⚠ Store methods are untracked already; do not read store state you then write inside an effect-called method.

### Fix 2 — the note says the true reason, and dates only where dates play a part

Today `noteOf` says *‹Knows / Kept from›, but ‹what wins› is newer and wins.* whenever anything but the member's
own hand tie wins: also when the winner has the **same effect** as the switch, when it won only by being on a
nearer line, and when the Timeline is off (`winningTies` returns the row's raw date, so a row can also say
*as of ‹date›* where dates play no part).

**Server** (`server/lorebooks/entryKnowledge.ts`, the date only; the judging and the precedence do not change):
`winningTies` returns each winning row with the **timeline-aware date** `winnersOf` already computes (`Win.date`:
null when the book's Timeline is off), e.g. `[entryId, { ...w.row, date: w.date }]`. `readBookKnowledge` then
sends that date in `winner.date`. Update the comment on `winningTies` to say so.

**Precedence facts you rely on** (from `beats`, do not change them): later date, then nearer line, then *kept
from*. A hand tie is undated and on main, which reads on every line. So when something else wins over the hand
switch: a **dated** winner won by its date; an **undated knowing** winner (knows / was told / has been there /
ordinary link) over a hand *Kept from* can only have won by a **nearer line**; an **undated kept-from** winner
over a hand *Knows* won by a nearer line **or** by *kept from*'s tie-break (the row does not say which line a
tie is on, so do not claim either).

**Client** (`knownByWords.ts`), new `noteOf` (the ★ wording is the supervisor's proposal; build exactly this):

- No hand switch (`row.hand === null`): no note.
- "The winner keeps" = `winner.kind === "kept_from"`; "the switch keeps" = `row.hand === "kept_from"`. When a
  winner exists, it is not the member's own hand tie of the switch's kind, **and** the two differ:
  - winner dated → *‹Knows / Kept from›, but ‹what wins› is newer and wins.*
  - winner undated and the switch keeps → *Kept from, but ‹what wins› on this line wins.*
  - winner undated and the switch knows → *Knows, but ‹what wins› wins.*
- When the effect is the same: no override note.
- Otherwise, when the switch knows, the entry is not marked, and the winner is not *kept from*: *Changes nothing
  until the entry is marked not common knowledge.* (today only when the hand tie itself wins; now also when
  another knowing tie wins: it is just as true).
- ‹what wins› (`winsWords`): *“was told”*, *“has been there”*, *“‹relationship word›”* for an ordinary link (as
  today); for a *knows* / *kept from* tie: dated → *a tie dated ‹date›* (as today); undated → *another “knows”
  tie* / *another “kept from” tie* (replaces *a dated tie*, which is false for an undated tie).
- `resultOf` is unchanged: with the server's date it no longer says *as of ‹date›* when the Timeline is off.

### Fix 3 — docs

Not yours: the supervisor edits `docs/lorebooks.md` itself. Do not touch any `docs/` file.

## Files owned (edit only these)

- `src/lib/client/lorebooks/EntryWorkspace.svelte` (fix 1 only)
- `src/lib/client/lorebooks/sections/EntryInspector.svelte` (fix 1 only)
- `src/lib/client/lorebooks/knowledge/knownByWords.ts`, `knownByWords.test.ts`
- `src/lib/server/lorebooks/entryKnowledge.ts` (`winningTies` date only)
- Tests: `src/lib/client/lorebooks/entryWorkspace.knowledge.dom.test.svelte.ts`,
  `src/lib/client/lorebooks/knowledge/knownByTab.dom.test.svelte.ts`,
  `src/lib/client/lorebooks/knowledge/knownByList.dom.test.svelte.ts` (only the assertion on the note text, ~174),
  `src/lib/server/lorebooks/entryKnowledge.test.ts`, `src/lib/server/lorebooks/entryKnowledge.door.int.test.ts`.

A second worker is building, at the same time, in `client/lorebooks/knowledge/` (`bookKnowledge.svelte.ts`,
`KnownByList.svelte`, new files), `client/lorebooks/CastWorkspace.svelte` and new tests. **Do not touch those.**
It keeps `KnownByList`'s markup and `data-known-by-*` attributes, so its tests keep reading the same nodes.

## Files readable

Anything. `NOMENCLATURE.md` rows **hand tie**, **Known by**, **entry knowledge door** (§14, ~967–969).

## Out of scope

Changing the judging or the precedence (D39); a new wire field (the row does not carry the winner's line: do not
add one; `shared/sockets/types.ts` is not yours); the test-view cause line; docs; NOMENCLATURE.

## Stop and ask when

A fix needs a file not listed; a sentence other than those above seems needed; a test outside the list breaks.
Put the question in your report and stop.

## Rules you work under (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." "`$state(new Set())` / `new Map()` is not
  reactive on mutation — use `SvelteSet` / `SvelteMap`." "`socket.off(event)` with no handler removes every
  listener app-wide; always pass the handler." "Comments state the rule, not the story."
- Tests' house rule: no DOM node is ever handed to `expect` (assert on strings, booleans, counts).
- STYLE-GUIDE §9: "Every interactive element is a real `button`… with an accessible name."

## Done means

1. Tests, each run as (wait first; one run at a time; never pipe vitest into `head`):
   ```
   until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
   systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4a2-w1-<n>.log 2>&1"
   ```
   Paths: the seven test files above. New cases at least: a notes member whose book reads as `owner` but whose
   `entryKnowledge:list` is refused (dispatch `entryKnowledge:list:error` with its `requestId`) sees **no toggle,
   no Known by tab and no alert**, and no rows read is sent; the owner sees the toggle only after the marks read
   answers (update the existing "the owner sees it" test to answer the marks first); Known by is hidden while
   `loaded` is false whatever `mayEdit` says; each note case (same effect → null; dated → *newer*; undated
   knowing over hand Kept from → *on this line*; undated kept from over hand Knows → *wins.*; *another “knows”
   tie* wording; *Changes nothing…* when another knowing tie wins on an unmarked entry); the door with the
   Timeline off returns `winner.date === null` for a tie whose history entry is dated (and the date when on).
2. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/kn-4a2-w1-tsc.log 2>&1` → 0 errors
   (if errors are in files not yours, list them; do not fix them).
3. `npx prettier --check` on every file you changed.

## Report

Your final message: changed files; each test run (log path, files, passed/failed counts); tsc result; prettier
result; anything you could not do and why; **Noticed, not done**. Under 400 words.
