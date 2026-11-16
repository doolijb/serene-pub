# BRIEF — build lane `back-intros` — Back takes an intro, and Story's Back says "message"

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `docs/sessions.md` ~241–290 (Back,
Forward, Regenerate, Deleting a message), `src/lib/server/sessions/rewind.ts` in full (its header comment states
the rules), `src/lib/server/sessions/greetings.ts`, CLAUDE.md Hard rules, Principles and "0.6 is in users' hands",
NOMENCLATURE §1, §23, §24, §25. Line numbers below are from a look on 2026-11-13: re-read before editing.

Words. A **build lane** is this stream of work; a **channel** is a session's message channel. A **greeting** is a
message whose `metadata.isGreeting` is true (written by `sessions/greetings.ts` ~260); the owner calls it an intro.

## Rulings that bind (owner, 2026-11-13)

- "I think story back/forward should move one message at a time on main, not the whole round." Done the same day:
  Story's `history.back: "message"` now reaches the registry (it had sat inside the genre's `shape`).
- "Also should allow character intro messages to be deleted before the next round", then, asked how: **"Back takes
  any intro"** — Back takes a greeting like any message, a new session's opening greetings included; a session left
  with no messages is accepted.
- Wording in Story: **"Back one message / 1 message ahead (Recommended)"** — Story says *message*; the Lair and the
  Dungeon Crawler, which take a whole turn, keep *turn*.
- Standing: "A turn owns what it wrote"; Back and Forward are the way to take things out, Delete stays off.

## What is true today (corrected by the cold review, 2026-11-13)

- **Only Story writes greetings, and only when a session is created.** `metadata.isGreeting` is written in one
  place (`sessions/greetings.ts` ~230–270), called by the create fallback (`sockets/sessions.ts` ~1937–1957) and by
  the `seed-greetings` outlet (`pipelines/runtime/host.ts` ~8814), which only the create pipelines use. The Lair,
  the Dungeon Crawler and Chat turn greetings off. Nothing writes a greeting when a seat is added, and nothing
  re-posts one. So "an intro" on screen is one of two things: a new session's **opening greeting**, or a character's
  **first reply before anybody has written** (Story lets a seat that has not spoken yet speak first,
  `pipelines/runtime/speakerRotation.ts` ~19–21).
- Back's floor is the session's first person line (`rewind.ts` ~319–332; header ~9–19, ~33–35; design of
  2026-10-23: "Never a row before the session's first person line… the greetings and the opening stay";
  `docs/sessions.md` ~254). With only greetings, or with a character's reply before any person line, Back answers
  *There is nothing to go back to yet.*
- Write **greeting** in code, comments and docs; "intro" is the owner's casual word and is not adopted as a term
  (NOMENCLATURE R1, R4).
- The rewind state's type is declared in `src/lib/shared/sessions/rewind.ts` ~52–60. The client's reader there
  (`rewindStateOf` ~63–116) keeps only the fields it knows and `rewindStateWith` (~163–169) builds a fresh object;
  the composer's replace line is drawn by `core-catalog/components/shared/composer/ComposerWidget.svelte` ~62–64
  from the conversation's rewind state, which `client/components/sessionPage/sessionPageProjections.ts` ~881–883
  builds from `ahead`, `back` and `forward`; the header's labels come through
  `src/routes/sessions/[id]/+page.svelte` ~333–339 and `SessionHeaderRewind` (`src/app.d.ts` ~507–519). The
  labels' strings are in `src/lib/client/components/Header.svelte` ~105–125 and `FullscreenExit.svelte` ~79–112;
  the count is `turnsAheadText` (`core-catalog/src/shared/ui/conversation/rewindStrip.ts` ~53, ~100–101).

## The rule to build, in three sentences

In a genre whose Back steps by message (Story), Back has **no first-person-line floor**: one press takes the
newest live line on the story lane whatever it is, a greeting and a character's first reply included, with any
line filed on it, down to a session with no messages; Forward puts each back. This replaces, for those genres,
the 2026-10-23 rule that the greetings and the opening stay (owner 2026-11-13: "Back takes any intro"); a genre
whose Back takes a whole turn (the Lair, the Dungeon Crawler) keeps its floor and everything else exactly as it
is. Where the genre steps by message the interface says *Back one message*, *Forward one message* and *1 message
ahead*; elsewhere it keeps *turn*.

## Build

1. **Back's unit with no floor** (`rewind.ts` `buildTurnUnit`, Back's branch, `at === null`, message step only).
   The newest live story-lane row is found from the rows themselves, since the replay leaves greetings out
   (`takesTurn`, `pipelines/routines/moments.ts` ~76–81). The unit is that row, the rows filed on it
   (`metadata.anchorMessageId`) and what its creating run wrote **at or after it** (the existing one-message rule,
   ~443–452, ~470). An opening greeting's run is the session's create run, which `replyRunOf` treats as no run:
   the unit holds only that run's output at or after the greeting, never the whole create run, and
   `takeRunWritesElsewhere`'s `outside` test (~871–872, which also matches writes with no anchor) must be checked
   so that taking a greeting does not take back what creating the session wrote elsewhere. The settle line, the
   fork refusal (`metadata.copyOf`) and the archived refusal apply unchanged. `rewindStateOf` (~135–215) reports
   `backTakes.newestMessage` for it. Regenerate's branch is untouched (*a greeting is swiped, not regenerated*
   stays).
2. **What goes back with it.** The first scene opens at the first greeting; `takeSceneBoundariesAt` takes it and
   Forward restores it. Find anything else a greeting or a first reply writes (a clock stamp, swipes for alternate
   greetings) and prove the round trip: after Back then Forward the session's rows are byte-identical to before.
   If something cannot be taken back by the existing retraction, stop and report; no second undo path.
3. **An empty session.** With every message taken the page must still work, and writing a new line replaces what
   is ahead. A session with no messages already exists (Chat starts empty; Story with nobody seated), so check and
   test rather than build: the composer, Forward offered, Scene 1 opening at the new first line (the rewound
   opening cue is discarded with its rows).
4. **The words.** An optional `step: "message" | "turn"` on the rewind state (absent reads as `turn`), sent
   whether or not Back may be pressed, carried through every place that today drops it:
   `src/lib/shared/sessions/rewind.ts` (the type, `rewindStateOf`, `rewindStateWith`),
   `sessionPageProjections.ts` ~881–883, `src/routes/sessions/[id]/+page.svelte` ~333–339, `src/app.d.ts`
   `SessionHeaderRewind`, and the SDK's `ConversationRewindV1` (`sdk/src/sessionDossier.ts` ~408; additive). Then
   `Header.svelte` and `FullscreenExit.svelte` say *Back one message* / *Forward one message* where the step is
   `message`, and `turnsAheadText` and the composer's line say *1 message ahead* / *2 messages ahead will be
   replaced if you write now.* *Regenerate the last turn* keeps its words everywhere.
5. **Docs and ledgers in the same change:** `docs/sessions.md` ~243–254 (Back takes the newest message of any
   kind in Story, greetings included; the sentence at ~254 that says they stay; the wording), the `rewind.ts`
   header (~9–19, ~33–35), NOMENCLATURE and §25 for `step` and the copy. No ledger row for "intro".

## Files owned

`src/lib/server/sessions/rewind.ts`, `src/lib/shared/sessions/rewind.ts`,
`src/lib/client/components/sessionPage/sessionPageProjections.ts` (carrying `step` only),
`src/routes/sessions/[id]/+page.svelte` (the same), `src/app.d.ts` (`SessionHeaderRewind`),
`src/lib/client/components/Header.svelte` and `FullscreenExit.svelte` (the Back and Forward strings only), their
tests. SDK: `core-catalog/src/shared/ui/conversation/rewindStrip.ts`,
`core-catalog/components/shared/composer/ComposerWidget.svelte` (the replace line only), `sdk/src/sessionDossier.ts`
(`ConversationRewindV1`), their tests. Docs above.

## Out of scope

A Delete button; Regenerate; swiping a greeting; anything in a genre that steps by turn; writing a greeting when a
character joins mid-session (none is written today); the settle line; any migration, setting or new event.

## Stop and ask when

Something a greeting writes cannot be taken back by the existing retraction; taking an opening greeting would take
back something the create run wrote elsewhere; an empty session breaks a server path that cannot be fixed inside
`rewind.ts`; a published SDK name or field would have to change (an optional new field is additive: say so);
stored data would need a pass.

## Done means

Tests on the real registered genres (read the step with `getGenre`, never a test's own stand-in): in Story, Back
takes opening greetings one per press to an empty session and Forward restores each, rows byte-identical; a
character's first reply before any person line is taken; a line written into an emptied session replaces what was
ahead and Scene 1 opens at it; taking a greeting takes back nothing the create run wrote elsewhere; the settle
line, a fork and an archived session still refuse; in the Lair the floor is unchanged; the words for each step
reach the header, the full-screen strip and the composer's line. The existing Back suites pass
(`sessions/rewind.int`, `sessions/settle.int`, `messages/rewindMirror.int`, `scenes/liveScenes.rewind.int`,
`sessions/oneUndoRule.int`, `sessions/seatKeys.gate.int`).
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean;
`NODE_OPTIONS=--max-old-space-size=12288 npm run check` no new errors. Tests run only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`,
never two runs at once. **One** `npm run sdk:build`, only after `pgrep -af "vite dev"` shows no serene-pub dev
server. Do not re-pin hashes: list any that moved. Never `git commit`, `stash`, `checkout` or `restore`. Comments
state the rule, not the story.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-back-intros-2026-11-13.md`):
the rule as built; what a greeting writes and how each part goes back and comes forward; how an empty session
behaves; the `step` field and every place it is carried; provisional copy verbatim; changed files in each repo; tests and results; open ★;
**Noticed, not done**. Say plainly that nothing was looked at in a running app.
