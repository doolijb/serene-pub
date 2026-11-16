# BRIEF — build lane `ui-working` — the session says when work runs in the background

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `docs/sessions.md` ~142–146 (the
turn line), ~410–431 (routines), `docs/group-sessions.md` ~25–44, STYLE-GUIDE.md's copy rules and the turn line's
section, CLAUDE.md Hard rules, Principles, **Standing rulings › Sockets**, NOMENCLATURE §1, §23, §24, §25,
`../serene-pub-sdk/INTEGRATING.md` where it covers the session dossier and widget data. Line numbers below are from
a look on 2026-11-13: re-read before editing.

Words. A **build lane** is this stream of work; a **channel** is a session's message channel.

## The owner's words (2026-11-13)

"when tasks/routines are running in the background, there's no indicator, the status still says 'waiting for a
message or pick who speaks next'"

## What is true today (corrected by the cold review, 2026-11-13)

The turn line above the composer has two halves. The right half says who is due (*Waiting for a message — or pick
who speaks next*). The left half says what is happening, but only for a **reply**: *Wren is thinking*, *Last run
failed · …*, *Review N changes* (`core-catalog/components/shared/messages/TurnLine.svelte` ~75–134). The page
already receives both facts needed for the rest; nothing shows them:

- **A scene being summarized.** `setSummaryStatus` (`src/lib/server/sockets/scenes.ts` ~1983–2005) is the one
  writer of `summaryStatus` and pushes `scenes:list` on every change, start and every end. The status reaches the
  turn line's own dossier as `scenes[].summaryStatus` (`sdk/src/sessionDossier.ts` ~131;
  `client/components/sessionPage/liveSceneProjection.ts` ~88, ~115), is in the first load, and a stuck `running` is
  reset at boot (`scenes/summaryStatus.ts` ~35–58).
- **A routine's run.** `sessions:runStatus` already carries `kind: "routine"` (`shared/sockets/types.ts`
  ~4766–4787), goes to the session's users (`pipelines/runtime/runStatus.ts` ~365, ~390) and is kept as
  `sessionStore.runsOf(sessionId)`. But a frame goes out only once a status is shown, and a routine that calls a
  model may send none for a while. A routine run's one start is `runRegistry.start` (`pipelines/routines/run.ts`
  ~318) and its one end is the `.finally` → `runRegistry.finish` (~363); refusals, skips and cap pauses return
  before the start.

## The rule to build, in four sentences

While a routine's run that has lasted longer than a moment, or a scene's summary, is under way for a session, the
turn line's left half says so in one short line: 🚧 *Summarizing Scene 3*, *‹routine name› is running*, or for
more than one *2 things are running in the background* with the list in the line's tooltip. A reply being written,
a failed run and *Review N changes* always win the left half; the background line shows only when none of those
does. The right half is unchanged and nothing is blocked: the line informs and offers no Stop. **No new event, no
new table, no server list module**: the two signals above are the source.

## Build

1. **Summaries: read what is already there.** `TurnLine.svelte` reads its dossier's scenes whose `summaryStatus` is
   `running` and names each by the scene's shown name. No new field, no server change. The owner sees these; a
   member does not, because the summary's pushes go only to the person who started it or to the owner
   (`scenes.ts` ~2003–2005, ~2990–3001), and that stays so.
2. **Routines: one frame at the start, one at the end.** At `routines/run.ts` ~318 send one `sessions:runStatus`
   frame for the run (kind `routine`, the routine's display name, as ~281 has it), and beside ~363 the frame that
   clears it (`status: null`, as a reply's end does). **A run parked at a review gate is not running**: clear it
   at `onParked` (~345) as well, since a parked run stays registered until the person decides (`runTurn.ts`
   ~412–421) and the left half already says *Review N changes* for it. Then one optional, additive dossier field
   (🚧 name per §24) built from the same `runsOf` the page already uses for `liveRunIds`
   (`sessionDossier.ts` ~296–303), holding for each live routine run its name only.
   **First load:** add the session's in-flight routine runs (`runRegistry.active()`) to the session read that
   seeds `runsOf`, which today is filled only from pushes (`client/sessions/store/sessionStore.svelte.ts` ~96–110).
   Say in the report what else reads `runsOf` or `sessions:runStatus` and now sees routine frames (the session
   list's row status, `sockets/sessions.ts` ~536–544): each must keep showing what it showed, so filter routine
   kinds out there unless it already handled them.
3. **No flicker.** *Each round moves the clock* runs every round and *Find where scenes begin* every two, with no
   model, in milliseconds. A background run shows only once it has lasted past a delay; reuse the existing rule for
   a queue wait (`runStatus.ts` ~80–90, `QUEUE_STATUS_DELAY_MS`, ~431–441) rather than a second timer scheme. The
   line must not re-announce to a screen reader when its text has not changed.
4. **The turn line.** Left half only, when no reply is live or failed and nothing waits for review. One item: its
   line. Several: the count line, with the items in the tooltip and in the existing popover (`TurnLine.svelte`
   ~151–155). Copy: sentence case, the routine's own name as Routines shows it, no ellipsis-only text. The right
   half and *Waiting for a message — or pick who speaks next* stay exactly as they are. Members see routine names
   only (they may already read `sessions:routines`); never a connection, a model or a run id.
5. **Left out on purpose:** a spoken-line run. It is line-bound by ruling (2026-10-29: shown only on that line,
   "never … the turn line", `runtime/runRegistry.ts` ~81–90), and *Mira is speaking…* already shows through the
   session banners.
6. **Docs and ledgers in the same change:** `docs/sessions.md` ~142–146, NOMENCLATURE for the new field and §25,
   the SDK guide or `INTEGRATING.md` line for the optional field.

## Files owned

`src/lib/server/pipelines/routines/run.ts` (the two or three frames), `src/lib/server/pipelines/runtime/runStatus.ts`
only if the delay rule must be shared, the session read that seeds runs and any `runsOf` / `sessions:runStatus`
reader that must filter routine kinds, the client projection that builds the dossier field. SDK:
`core-catalog/components/shared/messages/TurnLine.svelte`, `sdk/src/sessionDossier.ts`, their tests. Docs above.

## Out of scope

A new event, table, column or server list module; a Stop for background work; progress; the Activity sidebar; the
Routines list; when anything runs; the right half and the Turn order widget; spoken-line runs; what a member may
see of scene summaries; whether background work should make the page read as "generating" (`sessionBusy` versus
the client's `generatingOf`, an open owner question).

## Stop and ask when

A published SDK name or widget field would have to change (an optional new field is additive: say so); a reader of
`sessions:runStatus` cannot be kept as it was without changing the event's shape; the delay cannot reuse the
existing rule.

## Done means

Tests: a routine run longer than the delay shows and clears; one shorter never shows; a parked run clears; a failed
run clears; a page opened mid-run shows it from the first load; a running summary shows for the owner and not for a
member; one item, several items, none; a live reply, a failed run and a waiting review each win the left half; the
session list's row status is unchanged. The touched suites pass.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean and
`NODE_OPTIONS=--max-old-space-size=12288 npm run check` shows no new errors. Tests run only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`,
never two runs at once. **One** `npm run sdk:build` (the turn line is SDK code), and only after
`pgrep -af "vite dev"` shows no serene-pub dev server. Do not re-pin hashes: list any that moved. Never
`git commit`, `stash`, `checkout` or `restore`. Comments state the rule, not the story
(`shared/conformance/commentHistory.test.ts`).

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-ui-working-2026-11-13.md`):
the rule as built; where the routine frames are sent and what clears them; the dossier field's name and shape;
how the first load carries live runs; every other reader of the run frames and what it does now; provisional copy
verbatim; changed files
in each repo; tests and results; open ★; **Noticed, not done**. Say plainly that nothing was looked at in a
running app.
