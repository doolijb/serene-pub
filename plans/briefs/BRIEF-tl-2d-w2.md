# BRIEF — worker `tl-2d-w2` — a new dated session starts today; `asks` refuses; no Year 1 on the clock outlet; the start form shows the date

Supervisor: lane `tl-2d`. App repo `/home/jody/github/serene-pub` (SDK `/home/jody/github/serene-pub-sdk`: you do
not edit it). The working tree holds a full day of uncommitted work by earlier lanes: **re-read each file right
before editing it; small targeted edits; never a whole-file rewrite.** Always absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You never run `sdk:build`. Never `git checkout / restore / stash`. Never `prettier --write` (nor a scratch-copy
equivalent). No `npm run build`, no full `npm test`.

**Tests wait for the SDK build.** Another worker is changing the SDK now and the supervisor will rebuild its
`dist/` under the app. Before your **first** vitest run, wait for the marker:
`until [ -f /home/jody/github/serene-pub/plans/tl-2d-sdk-built.done ]; do sleep 20; done`. Write code and run
`tsc` meanwhile (a `tsc` error inside `@serene-pub/*` types while you wait may be the build swapping: re-run
after the marker). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <paths> > plans/tl-2d-w2-<n>.log 2>&1"`
(never pipe vitest into `head`; an int test that opens a DB inside an `it` needs a 60 s timeout).
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (and the same for `npm run check` once at the end).

## Rules that apply (quoted)

- Owner 2026-11-16: "With dating on, default to real calendar." Asked whether that is the real calendar at
  today's real date: "Yes". "Go with the safest option for existing lorebooks". "There shouldn't be a scenario
  where it defaults to 1-1-1. The exception would be if the genre/presets session init pipeline changes the date."
- Lane `tl-2b`'s rules stand (its brief's "Cold review corrections"): **an existing lorebook with a present gets
  nothing written** (a session on it stores no clock and follows the line; owner 2026-09-28, "ruling 15", pinned by
  `src/lib/server/state/sessionStoryClock.int.test.ts` ~155–184: keep it green); **nothing gives an
  already-created session a date**; **no boot pass writes lorebook lines**; never derive a book's present from its
  sessions' clocks or message stamps.
- CLAUDE.md: inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently).
  "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or
  `emitToUser` silently sends nothing." Views register listeners for local state and never call `toaster`.
  `socket.off(event)` with no handler removes every listener app-wide: always pass the handler.
  `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`. Browser code: no
  `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a *chat*.
- STYLE-GUIDE §10: sentence case; "errors say what went wrong and what to do"; "Help is one sentence."
- NOMENCLATURE R3: qualify, never the bare noun. The new reply field is 🚧 `start` (on the `lorebooks:storyTime`
  reply); no other new name without asking (write it in your report as a question instead).

## What exists (re-verify every line number)

- `src/lib/server/state/storyTime.ts`: `storyStartOf` (~909; causes `undated` · `present` · `latest` · `today` ·
  `asks`), `storyToday(timeZone, at)` (~849), `ownerTimeZoneOf(db, userId)` (~879), `FIRST_STORY_DAY` (~389),
  `storyMoveStartOf` (~466: the clock move's start: own clock, else line present, else `FIRST_STORY_DAY`),
  `moveSessionStoryClock` (~476), `StoryClockRefusal` (~392).
- `src/lib/server/sockets/sessions.create.ts` ~803–830: in the create transaction, when the create named no clock
  (`requestedClockYear == null`), `storyStartOf` is asked and only `latest` writes the **session's** clock
  (`clockColumns`, under `lockBookCalendar`). The genre's create pipeline runs **after** the transaction
  (~1102–1125), so its clock writes win. The own book is inserted in the same transaction (`insertOwnBook`, ~771;
  its calendar `OWN_BOOK_CALENDAR`; another worker switches that constant to the new real calendar later: do not
  touch `lorebooks/ownBook.ts`). `refuse(sentence)` (~204) is how create refuses (returned, never thrown: the
  socket catch-all replaces thrown messages). `next-chapter` closes out the session it follows **before** the
  transaction (~709–722).
- Clock-move readers of `storyMoveStartOf`: `state/clockProposal.ts` `clockMoveProblem` (~83–112, the dry run
  used by `pipelines/runtime/bindings.state.ts` ~922), `sessions/clockMoveBack.ts` ~248 (reads `.present` only).
  The outlet `core:outlet/advance-story-clock@1` is `pipelines/runtime/host.ts` ~5165–5240: it catches
  `StoryClockRefusal` and applies the step's `onRefusal` (`halt` → `HostScopeError`; `skip` → a receipt note).
- `src/lib/server/sockets/lorebookStoryTime.ts` `storyTimeReply(lorebookId)` (~61) is the `lorebooks:storyTime`
  reply, also relayed to every reader of the book (`relayStoryTime`); type `Sockets.Lorebooks.BookStoryTime`
  (`src/lib/shared/sockets/types.ts` ~8450). The default line for a new session is `mostRecentBranchOf(db, book)`
  (`state/reading.ts`; used by `sessionLinePatch`, `sockets/sessions.shared.ts` ~1566).
- Client: `src/lib/client/lorebooks/time/bookTime.svelte.ts` (`BookTime`, the reader of that family);
  `src/lib/client/components/sessionForms/StartSessionForm.svelte` (3.5k lines: read only the parts you need;
  the chosen book is `flow.fields.lorebookId`, `lorebookList` / `lorebookOptions` carry `timelineEnabled` and the
  name; an own surfaced book offers *Continue the latest line* / *Branch off at a point*, the latter showing
  `SessionLorebookReading` bound to `surfacedBranchId` / `surfacedClock` (~2499); `sendCreate` ~1578 adds
  `storyClock*` to `payload.session`); its store `createSession.svelte.ts`; `SessionLorebookReading.svelte`
  (the existing line and story clock control; ~177 starts an own clock at `{ year: 1 }` when the line has no
  present: a Year 1 default this lane removes).
- Guard `src/lib/server/state/noYearOneFallback.guard.test.ts`: `ALLOWED` holds only `state/storyTime.ts`
  (`FIRST_STORY_DAY`).

## Build

1. **Create's `today` and `asks`** (`sessions.create.ts`, where `latest` is handled):
   - `today`: write the **session's** clock at `storyToday(await ownerTimeZoneOf(tx, userId))` (the create
     transaction's `tx`; `storyStartOf` already computes today: pass it the owner's `timeZone`), as `latest` does.
     `present` and `undated` still write nothing.
   - `asks` (today does not land on the book's calendar) with no clock given by the form: create refuses with ★
     *Today's date doesn't fit ‹lorebook name›'s calendar. Choose the date the story begins on.* — nothing made
     (roll the transaction back: throw a small typed error inside, catch it outside and `return refuse(...)`; or
     decide it before the transaction when the book is already known, which also keeps `next-chapter` from closing
     out the old session first: prefer that where possible and say what you did). With a clock given (the
     existing `storyClock*` fields, checked by `sessionLinePatch`), it is accepted and stored as today.
   - A date set by the genre's or preset's create pipeline still wins: test with a **fixture** create pipeline
     that sets a clock (find how the existing create-pipeline tests register a fixture genre / spec; Dungeon
     Crawler cannot show it: its create moves the clock to `08:00 today`, which a clock already at the current time
     refuses to move back; record in your report what Dungeon Crawler's create receipt says now).
   - Comments at ~803–810 say the new truth (no "wait on D49b").
2. **`FIRST_STORY_DAY` goes.** A clock move (advance by an amount, or `to` a moment) on a session with no clock and
   no present is refused with `StoryClockRefusal` ★ *This story has no date yet, so its clock can't move. Set the
   story clock in the lorebook's Book settings first.* — nothing written; the outlet's existing `onRefusal`
   contract applies unchanged (prove both `halt` and `skip` in a test). `clockMoveProblem` returns that sentence
   instead of throwing. Keep the change smallest: e.g. `storyMoveStartOf` returns the present or null, the move and
   the dry run refuse on null; touch `clockProposal.ts` / `clockMoveBack.ts` only as far as the type change needs
   (say so). Doc comments that promise "starts on its first day" (~398–432, ~460–465, `clockProposal.ts` ~76–81)
   say the refusal instead. The guard's `ALLOWED` ends **empty** (`{}`), and its tests still pass.
3. **The reply's `start`.** `Sockets.Lorebooks.BookStoryTime` gains 🚧 `start: { branchId: number | null; date:
   StoryClock | null; cause: StoryStart["cause"] }` — where a new session on this book would start: the branch is
   `mostRecentBranchOf(db, lorebookId)`, the rest from `storyStartOf` (date null for `undated` / `asks`). The
   `today` case needs a time zone: compute the reply with the asking user's (`ownerTimeZoneOf(db, socket.user.id)`)
   and a relay with the acting user's; say this in your report (a reader in another time zone may see today's
   date of the actor's zone; create recomputes at create). `lorebookId` stays top-level in the payload (scoped).
   `BookTime` exposes it.
4. **The start form shows the date** (`StartSessionForm.svelte` and, only if needed, its store), for a chosen
   existing lorebook (`flow.fields.lorebookId != null`, no starter kit) whose timeline is on, in the modes that
   start on it (`new`, `new-world`): read `lorebooks:storyTime` for that book (the form's existing
   `requestWithInterest` / `declareInterest` pattern, as `lorebooks:bindingList` ~1058) and show **one line**
   under the book (a 12px muted sentence, `data-testid="start-story-date"`, `data-cause` = the cause):
   - `present` / `latest`: ★ *The story begins on ‹date›, where ‹lorebook name› last was.*
   - `today`: ★ *The story begins today, ‹date›.*
   - `asks`: the existing date control (below) is shown and required — **Start** is disabled until it holds a date
     that lands — with one sentence above it: ★ *Today's date doesn't fit this lorebook's calendar, so choose the
     date the story begins on.*
   - `undated` (timeline off): nothing.
   ‹date› is spelled with `formatDate(date, readStoryCalendar(calendar))` from `$lib/shared/lorebooks/storyDate`
   (the book's own calendar from the same reply).
   **Change:** reuse the form's existing clock control, `SessionLorebookReading` (do **not** build a second date
   picker). For `asks` it is the required field. For the other dated causes, a quiet text button **Change** after
   the line reveals it, bound to a draft line (starting at `start.branchId`) and clock; when the control is open
   and holds a clock, `sendCreate` sends `storyClock*` (and `lorebookBranchId`) — **without** `lineOnFirstWrite`
   (that stays the *Branch off at a point* path). When the own surfaced book's *Branch off at a point* is chosen,
   that control already shows: no line, no Change. Leave room for lane `tl-3` (next: an on / off choice for a new
   lorebook's timeline on this form); build nothing for a session with no lorebook chosen.
   If `SessionLorebookReading`'s *Follow the line's present* option makes the required-date case unworkable
   without a new prop, add the smallest prop you need and name it in your report (★).
5. **`SessionLorebookReading.svelte` ~177:** a first own clock starts at the followed present, else the reply's
   `start.date`, else empty inputs (no year), never `{ year: 1 }`; the existing *The clock needs a year.* hint
   covers the empty case.

## Tests (each case)

- `state/storyStart.int.test.ts` (extend): `today` with an injected instant and time zone.
- Create (extend the closest existing int test, e.g. `sockets/sessions.ownBookCreate.int.test.ts` or a new
  `sockets/sessions.createStoryStart.int.test.ts`): a new dated session with no lorebook gets today's clock (fake
  `Date` only: `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`, restored after; and the owner's
  `users.timeZone` honoured); `present` writes nothing (the ruling-15 test stays green); `latest` unchanged;
  `asks` refused with the sentence and nothing made; `asks` with a form clock accepted; timeline off writes
  nothing; the fixture create pipeline's date wins.
- The clock outlet with no clock and no present: refused with the sentence, `halt` and `skip`; `clockMoveProblem`
  returns it. Find the existing advance-story-clock tests (`grep -rln "advance-story-clock\|advanceSessionStoryClock" src/lib/server --include=*.test.ts`)
  and change any that pinned the Year 1 start **on purpose**, listing each (old → new) in your report.
- The guard test (`ALLOWED` empty).
- The reply's `start` (a lorebookStoryTime test: find or add).
- The start form: a DOM test (`*.dom.test.svelte.ts`, follow an existing start-form or session-form DOM test's
  harness) for the line in each state and the required field for `asks`; `SessionLorebookReading` starts at the
  start date, never 1 (extend `sessionLorebookReadingTimeline.dom.test.svelte.ts`).
- Also run `state/sessionStoryClock.int.test.ts`, `sockets/sessions.timelineDefault.int.test.ts`,
  `sockets/sessions.dungeonCrawler.int.test.ts` and every test that failed for a reason your change explains.

## Files owned

`src/lib/server/state/storyTime.ts`; `src/lib/server/state/clockProposal.ts` and
`src/lib/server/sessions/clockMoveBack.ts` (only to follow the move start's type);
`src/lib/server/sockets/sessions.create.ts`; `src/lib/server/sockets/lorebookStoryTime.ts`;
`src/lib/shared/sockets/types.ts` (the `BookStoryTime` type only); `src/lib/client/lorebooks/time/bookTime.svelte.ts`;
`src/lib/client/components/sessionForms/StartSessionForm.svelte`, `createSession.svelte.ts`,
`SessionLorebookReading.svelte`; `src/lib/server/pipelines/runtime/host.ts` (the `advance-story-clock` case,
only if the refusal needs it); `src/lib/server/state/noYearOneFallback.guard.test.ts`; the test files above.

## Files readable

Anything. Context: `plans/REPORT-tl-2b-2026-11-16.md`, `plans/briefs/BRIEF-tl-2d.md`, `docs/sessions.md`,
`docs/lorebook-time.md`.

## Out of scope

`lorebooks/ownBook.ts`, the lorebook create handler, the calendar editors, history entries
(`sockets/entries.ts`), import / export, docs and `NOMENCLATURE.md` (the supervisor), the SDK; which sessions start
with a timeline and the form's on / off choice (lane `tl-3`); play's writes (lane `tl-2c`); dating existing
sessions or lorebooks.

## Stop and ask when

CLAUDE.md §Decisions applies; a name or sentence beyond those above; a migration; a shipped genre's first turn
fails or refuses a lore write; a prompt baseline changes for a session that already had a date; the ruling-15 test
would have to change. Stop = write it in your report and finish what you can.

## Done means

The tests above green (log paths and counts), `tsc` 0, `npm run check` 0 errors in your files,
`npx prettier --check` on touched files (report, do not fix formatting you did not cause).

## Report

Your final message: changed files; create's branches as built; what is refused and the sentence; the reply field;
the start form's line in each state and how Change works; tests run with results; pinned tests changed (old →
new); every new sentence / name / prop (★); Dungeon Crawler's create receipt now; **Noticed, not done**.
