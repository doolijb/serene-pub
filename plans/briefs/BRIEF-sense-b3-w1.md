# BRIEF — worker `sense-b3-w1` — the own-book write route reads both books (host side)

Supervisor: lane `sense-b3`. Repo: /home/jody/github/serene-pub (SDK at ../serene-pub-sdk — you do not edit it).
Use absolute paths. Your report is your final message to the supervisor (no report file).

## Verbatim rules (binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build` at all.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.
  Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently). Pass `tx` to every
  helper you call inside a transaction (e.g. `sessionEntriesAsRead(tx, …)`, `entriesAsRead(tx, …)`).
- No migration, no schema change. If you think you need one, stop and report.
- It is a **session**, never a *chat*. Every session has a lorebook (its own notes, or an attached one): never write "no lorebook".
- No reference to any other project or product in code, comments, tests or docs.
- Tests only in a capped scope, never the whole suite, never piped into `head`:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`
  An int test that opens a DB inside an `it` needs a 60 s timeout. `npx prettier --check <file>` on each file you changed.
  Typecheck: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report only errors in your files; other
  sessions are editing the repo — do not fix theirs). Do not start a dev server.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything (line numbers drift).
- Every sentence a person or a modder can see that you add is provisional: mark it `// 🚧 Provisional copy` and list it
  verbatim in your report. Any new exported name: list it in your report (NOMENCLATURE R2/R3: distinctive, qualified,
  never a bare generic noun; grep it across `src`, the SDK and the schema first).

## The hardest rule

**The route and what the Full write setting does are not changed.** `loreWriteRoute`, `loreWriteTargetFor`,
`sessionLoreWriteTo`'s routing rule and the `book` route's behaviour stay exactly as they are. Everything below applies
only on the **own-book route for a session that reads an attached lorebook** (route `"own-book"` and the session has an
attached lorebook: Review or Off on your own lorebook, or a member's session on someone else's lorebook). A session whose
lorebook is its own notes alone (no attached book) is unchanged too. **Every existing test must pass unchanged**; if one
would have to change, stop and report it. When you change a shared function that the Full route also calls
(`findLoreMatch`, `resolveBind`, `linksOnReadingThatWay`, `historyEntryOfDate`, `resolveLoreLinkEnd`, `writeLoreLink`,
`exitsLineLinks`, `fileOntoHistoryDay`), keep its existing call shape behaving byte-for-byte as before (add an optional
parameter; never change a default).

## Files owned (edit only these)

- `src/lib/server/pipelines/runtime/host.ts` — only: `resolveLoreLinkEnd`, `writeLoreLink`, `exitsLineLinks`,
  `sessionLoreWriteTo`'s own-book return (to carry the session's reading; not its routing), `loreWriteLineOf`'s callers
  on the own-book route, `imprintAnchor` use on the own-book route, `fileOntoHistoryDay`, the `create-lore-entry`,
  `link-lore-entries` cases, the prompt's `currentDate` (~5787–5805), a new module-internal helper for item D, and the
  JSDoc at ~1377–1408.
- `src/lib/server/pipelines/runtime/loreMatch.ts`
- `src/lib/server/utils/relationshipGuards.ts` (`linksOnReadingThatWay` only)
- `src/lib/server/scenes/historyEntryOfDate.ts`
- New tests: `src/lib/server/pipelines/runtime/host.ownBookRoute.int.test.ts` (and, if you want, a second file
  `host.ownBookRoute.history.int.test.ts`); additions to `src/lib/server/scenes/historyEntryOfDate.int.test.ts`.

Readable: everything. **Not** `state/storyTime.ts`, `state/reading.ts`, `lorebooks/ownBook.ts` (another worker owns it
now), `annotations/index.ts`, `utils/graphEntryLinks.ts`, `state/write.ts`.

## One-book assumptions on this path (the supervisor's inventory; confirm each, add any you find, report what each does now)

- A1 `sessionLoreWriteTo` (host ~1584–1646): on the own-book route with an attached lorebook it returns `line.reading`
  = the own book's main head and `lorebookId` = the own book, so every resolver downstream reads the own book only.
- A2 `create-lore-entry`'s `match` (~11386–11394): `findLoreMatch` over the own book only → an entry the lorebook holds
  is created again in the own book (a duplicate).
- A3 `resolveBind` (`loreMatch.ts`): the member must be in the own book's cast (`row.lorebookId === at.lorebookId`).
- A4 `resolveLoreLinkEnd` (~1409–1465): reads one book; refuses an end in the lorebook with "… Both ends of a link live
  in one book."; JSDoc ~1404–1407 says so.
- A5 `writeLoreLink` (~1750–1830): `linksOnReadingThatWay` asks one book (`saying.lorebookId`), so a link the lorebook
  already holds is written again in the own book.
- A6 `exitsLineLinks` (~1873–1924): places from the own book only.
- A7 `link-lore-entries` (~11793–11907): `from` resolved over the own book only.
- A8 `fileOntoHistoryDay` (~2189–2319): on this route `assertDateLands`, `historyEntryOfDate`'s own `assertDateLands`
  and the note's `bookCalendarOf` use the **own book's** calendar (born from the genre or core's default, so it can
  differ from the lorebook's); the default date (no year in `fields`) is `sessionStoryNowOf`, which ignores own-book days.
- A9 the own-book line on this route carries `historyEntryId: null` (~1633–1643): own-book links are undated.
- A10 the prompt's `currentDate` (~5795–5805) is `sessionStoryNowOf`, which ignores own-book history days.
- A12 `imprintAnchor` (~1990–2002) returns null for an `action`-family run with no turn message: links and history-day
  paragraphs written then get no made/field imprint, while an own-book entry still anchors to the newest message through
  its `source_message_id` (`turnAnchorOf`).

## What to build

**A. Carry the session's reading on this route.** When the route is `"own-book"` and the session reads an attached
lorebook, the host also has: the attached lorebook id and the session's reading (`sessionReadingOf(db, sessionId)`,
which carries `holderBookId` = the own book). Rows are still written to the own book, `branch_id` null, exactly as today.
Your choice how to carry it (e.g. optional fields on the own-book target / `LoreWriteLine`); name the choice.

**B. Item 1 — match over what the session reads, own book first.**
- `findLoreMatch`: look in the **own book first** (exactly today's call). Only when the own book has **no** hit, look in
  the attached lorebook's entries as the session reads them: `entriesAsRead(tx, attachedId, sessionReading, "session",
  [typeId])`, unseen filtered as today. A hit there is changed by `changeLoreEntry`, which already holds a change to an
  entry not in the own book (`holdLoreEntryChange`) — no new write path. "Two or more hits" refuses **within one book**,
  never across the two: own book has 2 → refuse (today's sentence); own book 0, lorebook 2 → refuse naming the
  lorebook's. `{ entryId }`: found in the own book, else in the lorebook (as the session reads it), else today's refusal.
  Implement as an optional second book on `findLoreMatch` (e.g. `then?: { lorebookId, reading }`); the one-book call
  is unchanged. A history write never reads `match` (unchanged).
- `resolveBind`: accepts a member of the own book's cast, and — only when the caller passes the attached lorebook too —
  a member of the attached lorebook's cast. Own book first, for both `character:<id>` and `seated-member:<id>`. Neither:
  today's sentence. The one-book call is unchanged.
- `exitsLineLinks`: per signpost name (its longer readings first, as today), look among the own book's places; only
  when the own book answers `none` for all its readings, look among the lorebook's places on the session's reading.
  A `tie` or `unseen` in the own book stops the search for that signpost (as today's `break`). A hit in the lorebook is
  linked cross-book (item C).

**C. Item 2 — a link may join the two books.**
- `resolveLoreLinkEnd` on this route: an **id** is found in the own book (at its main head, as today) or in the lorebook
  (as the session reads it); a **name** is looked up in the own book first and only on `none` in the lorebook (a `tie`
  refuses within its book; `unseen` refuses as today). Use `sessionEntriesAsRead(tx, …)` or two `entriesAsRead` reads —
  your choice, but own book first for names. The sentence "… Both ends of a link live in one book." is **not** said on
  this route; for an id found in neither book say instead (🚧) `entry ‹id› is not in this session's lorebook or its
  notes, so there is nothing here to link it to.` Under Full and for a notes-alone session the sentences stay exactly as
  they are ("stays for any other"). Update the JSDoc at ~1377–1408 to say both.
- `link-lore-entries`: `from` and `to` both resolved this way.
- The link row is stored in the **own book** (`lorebook_id` = own book, `branch_id` null), its ends may be own-book
  entries or the lorebook's entries. Precedent for that shape: `rulesets/ties.ts` `rowForSide` ~343–464 (read only).
- `linksOnReadingThatWay` (`relationshipGuards.ts` ~337): finds a standing link in **either** book — the lorebook's rows
  on the session's reading (as today) and the own book's rows at its main head. An own-book row with
  `rules_run_id IS NOT NULL` (a ruleset tie's copy of a lorebook row) **never** counts as a standing own-book link here.
  Add this as an optional extra book; the one-book call is unchanged. So a link the lorebook already holds is not written
  twice: `writeLoreLink` answers with the standing row (`written: false`), and the `link-lore-entries` result's
  `lorebookId` names the book of the row it answers with (the shape is unchanged).
- `assertRelationshipWrite` is unchanged.

**D. Item 4 (host half) — count the own book's history days, through one helper called only from `host.ts`.**
Write one module-internal helper in `host.ts` (not exported, not in `state/`). `writeDatingAt` and `sessionStoryNowOf`
are **not** changed: stat values, `recordToTimeline`, cast versions and place stats date their rows through them and
must keep dating by the lorebook alone. Uses:
1. The **dating** of a row this route writes (a link's `history_entry_id`): today null (A9). Now: the newest history day
   the session sees among (a) the lorebook's, `writeDatingAt(db, sessionReading)`, and (b) the own book's history
   entries (dated, at or before the reading's moment when it has one). Newest date wins; on equal dates the
   lorebook's day. Only on this route — under Full `loreWriteLineOf` is unchanged.
2. The **default date** of a history write on this route (no year in `fields`): `sessionStoryNowOf` when its `from` is
   `session` or `clock`; when it is `history` or null, the newer of it and the own book's newest dated day. Only on
   this route.
3. The prompt's **`currentDate`** (~5795–5805): the same rule as 2, for any session that reads an attached lorebook
   and has an own book (a read, so under Full too). Report exactly what a Full session now reads (it can differ only
   when its own book holds history days, e.g. from an earlier Review period) and add one Full test for it.

**E. Item 3 — history days: always the own book's.** On this route a history write files onto **the own book's entry
for that day, one per date there** (today's `historyEntryOfDate` on the own book), whether or not the lorebook has that
date. It is **never** a held change (no `entry_amendments` row) to the lorebook's day. Changes:
- Dates are checked against the **attached lorebook's calendar**: `assertDateLands(tx, attachedId, date)`, and
  `historyEntryOfDate` gets an optional `calendarBookId` its internal `assertDateLands` uses (absent = today). The
  "filed onto ‹date›'s entry" note is spelled through the lorebook's calendar.
- Add, in `historyEntryOfDate.ts`, **the one function** that answers "does the lorebook hold this day" — the lorebook's
  history entry for a date on the session's line (`historyEntryOfDate(tx, { lorebookId, branchId, date }, { create:
  false })`'s rule), or null. Every caller asks through it (a later worker's Apply and list will). Its JSDoc says the
  ruled, unbuilt "coarser covers finer" (E4, owner 2026-11-11) will change it. Name it distinctively (grep first) and
  report the name. Unit-test it in `historyEntryOfDate.int.test.ts`. The host does not need to call it.
- Do not widen or remove the history write; under Full it stays written through (`writeThrough: true`).

**F. Item 5 (host half) — a press-started run.** Find what happens today on this route for each kind when the run is an
`action`-family run with no turn message (A12): a new own-book entry, a new own-book history day, a paragraph onto an
existing own-book day, a held change, a link. Report each in one sentence. Then make **links behave as entries do**: on
this route, when `imprintAnchor` gives null, a link the write made is imprinted (`imprintMade`, subject `relationship`,
`lorebookId` own book) with the anchor `{ sessionId, messageId: target.sourceMessageId, runId: scope.runId ?? null }`
when `target.sourceMessageId` is not null. Nothing else changes for the other kinds. Under Full nothing changes.

## Tests (new file(s); real outlets, as `host.heldEntryChange.int.test.ts` does — read its `world` / `sessionOn` helpers)

Every case on **both** situations: (i) your own lorebook under Review (`userSettings.loreWriteMode: "review"`), and
(ii) a member's session on someone else's lorebook (session `userId` ≠ lorebook `userId`; Full mode for that member).
1. `create-lore-entry` with `match: { name }` naming an entry only the lorebook holds → a held change (one
   `entry_amendments` row with `base` in the own book), no new own-book entry. And with the own book already holding a
   copy of that name → the own-book copy is changed, the lorebook untouched, nothing held.
2. Two lorebook entries answering one name, own book none → refused naming both; own book one + lorebook one → own book's.
3. `bind: character:<id>` for a member of the lorebook's cast → the own-book entry's `lorebook_binding_id` is that member.
4. A place with `Exits: north → ‹lorebook room›` → a link in the own book from the new own-book room to the lorebook room.
5. `link-lore-entries` between an own-book room and a lorebook room (by name and by id) → one own-book row, ends as given;
   between two lorebook entries → one own-book row; repeated → `written: false`, no second row; a link the lorebook
   already holds between those two → `written: false` with the lorebook row's id and `lorebookId`, nothing written; an
   own-book tie copy (`rules_run_id` set) saying the same → does **not** count (the link is written).
6. An id in a third book → the new 🚧 sentence; under Full the old sentence (exact text).
7. Two history writes for one date → one own-book day, the second a paragraph; the lorebook has that date → still the
   own-book day (no `entry_amendments` row, the lorebook's day untouched); a date valid in the lorebook's calendar but not
   the own book's (give the lorebook a calendar with 13 months) lands; one invalid in the lorebook's is refused.
8. Dating: a link written on this route carries the newest day of the two books; the default history date follows the
   newest own-book day when the session has no clock.
9. Prompt `currentDate` (see `state/sessionStoryClock.int.test.ts` ~359 for how a template reads it): counts the own
   book's newest day on this route; one Full-route case (state in your report what Full reads).
10. Press run (`action` family, no turn): a link is imprinted at the newest message; the others as reported.

**Regression set — must pass unchanged** (run them all at the end, in the capped scope, in batches of ≤ 8 files):
`pipelines/runtime/host.heldEntryChange.int.test.ts`, `host.historyWrites.int.test.ts`, `host.forkTiming.int.test.ts`,
`loreSources.int.test.ts`, `loreMatch.seatedMember.int.test.ts`, `loreReading.int.test.ts`,
`lorebookEntries.withLinks.int.test.ts`, `relationshipLinkHop.int.test.ts`, `state/sessionLoreWrites.int.test.ts`,
`state/placeSight.doors.int.test.ts`, `state/ownNotesLine.int.test.ts`, `state/sessionStoryClock.int.test.ts`,
`messages/loreLinks.int.test.ts`, `messages/writes.int.test.ts`, `sockets/sessions.lairKnock.int.test.ts`,
`sockets/sessions.lairFileRoom.int.test.ts`, `sockets/sessions.lairWalk.int.test.ts`,
`sockets/narrativeGraph.guards.int.test.ts`, `scenes/historyEntryOfDate.int.test.ts` (all under `src/lib/server/`).
A failure that is not yours (another session's file): report it with the file and line, do not fix it.

## Stop and report (do not decide) when

A migration or schema change seems needed; an existing test would have to change; a published SDK name, port or result
shape would change other than additively; you need to edit a file not listed above; the lorebook's calendar and the own
book's cannot be reconciled by checking against the lorebook's.

## Report (your final message)

Changed files; the one-book assumptions (A1–A12 and any you add) and what each does now; the helper's and the new
function's names and signatures; every 🚧 sentence verbatim; what a Full session now reads (D3); each kind's press-run
behaviour (F); tests run with pass/fail counts; `tsc` result for your files; Noticed, not done.
