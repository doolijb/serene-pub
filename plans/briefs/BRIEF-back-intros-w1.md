# Worker brief — `back-intros` W1 — Back's unit has no floor in a message-step genre (server)

Read first, in full: `plans/briefs/BRIEF-back-intros.md` (the lane's brief: **What is true today**, **The rule to
build**, Build items 1–3, Stop and ask, Done means) and `src/lib/server/sessions/rewind.ts` (its header states the
rules). You implement Build items 1, 2 and 3 only. Items 4 and 5 (the `step` field, the words, the docs) are
another worker's: do not touch `src/lib/shared/sessions/rewind.ts`, any client file, or the SDK.

## Your files

`src/lib/server/sessions/rewind.ts` and a NEW test file `src/lib/server/sessions/rewind.noFloor.int.test.ts`. You
may read anything. If item 2 or 3 shows a server path that must change outside `rewind.ts`, stop and report it
with the evidence; do not edit it.

## What to build

1. In `buildTurnUnit`, Back's branch (`opts.includePersonLines`, `at === null`), when the genre's step is
   `message` (`backStepOf`): no first-person-line floor. The newest live story-lane row is found from the rows
   themselves (the replay `lines` leave greetings out, `takesTurn` in `pipelines/routines/moments.ts`), a greeting
   and a character's first reply before any person line included. The unit is that row, the rows filed on it
   (`metadata.anchorMessageId`) and what its creating run wrote at or after it, by the existing one-message rules.
   An opening greeting's run is the session's create run (`replyRunOf` treats a create pipeline as no run): the
   unit must hold only what that run wrote at or after the greeting, and taking a greeting must take back nothing
   the create run wrote elsewhere (check `takeRunWritesElsewhere`'s `outside` test, ~871–872). The settle line,
   the fork refusal and the archived refusal are unchanged. `rewindStateOf` must report `backTakes.newestMessage`
   for such a unit. A genre whose step is `turn` keeps its floor and everything else exactly as it is. Regenerate's
   branch is untouched.
2. Update the header comment of `rewind.ts` (~9–19, ~33–35) to state the rule as it now is. Comments state the
   rule, not the story: no "no longer", "used to", "deliberately not".

## Tests (the new file; it must NOT mock `getGenre`)

Use real sessions on the real registered genres (`core:genre/story`, `core:genre/lair`); look at how
`src/lib/server/sessions/settle.int.test.ts` and `scenes/liveScenes.rewind.int.test.ts` build sessions and press
Back and Forward without mocking the genre. Cases: in Story, Back takes opening greetings one per press down to an
empty session and Forward restores each, the session's rows byte-identical afterwards; a character's first reply
before any person line is taken; a first scene opened at the first greeting goes with it and comes back; a line
written into an emptied session discards what was ahead; taking a greeting takes back nothing else the create run
wrote; the settle line, a fork (`metadata.copyOf`) and an archived session still refuse; in the Lair, with only
non-person lines before the first person line, Back still answers that there is nothing to go back to.

## Rules

Never `git commit`, `stash`, `checkout` or `restore`. Never `kill -9`. Remove a test's temp directory by its exact
name only. Inside `db.transaction(async (tx) => …)` use only `tx`. Run tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > <log> 2>&1"`,
one run at a time, targeted files only: your new file plus `src/lib/server/sessions/rewind.int.test.ts`,
`settle.int.test.ts`, `oneUndoRule.int.test.ts`, `seatKeys.gate.int.test.ts`,
`src/lib/server/messages/rewindMirror.int.test.ts`, `src/lib/server/scenes/liveScenes.rewind.int.test.ts`. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`. Another session is building in this checkout:
stay off `src/lib/server/pipelines/runtime/liveRow.ts`, `src/lib/server/messages/store.ts`,
`src/lib/server/sockets/utils/broadcastHelpers.ts`, `src/lib/server/plugins/**`, `src/lib/server/utils/llmQueue.ts`.

## Report

Write `plans/REPORT-back-intros-w1-2026-11-13.md` and return it as your final message: what you changed; what a
greeting's write does and how each part goes back and comes forward; how an empty session behaves on the server;
test results; anything you stopped on; noticed, not done.
