# Worker brief — `back-intros` W2 — the `step` field and the words

Read first, in full: `plans/briefs/BRIEF-back-intros.md` (the lane's brief: **What is true today**, Build items 4
and 5, Done means). You implement items 4 and 5 only. The server's unit-building in
`src/lib/server/sessions/rewind.ts` `buildTurnUnit` is another worker's and is being edited now: in that file
touch only what sends the rewind state (`rewindStateOf` ~135–215 and its return type), adding the field, and
nothing else.

## What to build

1. An optional `step: "message" | "turn"` on the rewind state (absent reads as `turn`), sent whether or not Back
   may be pressed. Server: `rewindStateOf` in `src/lib/server/sessions/rewind.ts` answers the genre's step
   (`backStepOf`). Carry it through every place that today would drop it:
   `src/lib/shared/sessions/rewind.ts` (the type ~52–60, the client reader `rewindStateOf` ~63–116,
   `rewindStateWith` ~163–169), `src/lib/client/components/sessionPage/sessionPageProjections.ts` (the rewind state
   near ~881–883 ONLY), `src/routes/sessions/[id]/+page.svelte` ~333–339, `src/app.d.ts` `SessionHeaderRewind`
   ~507–519, and the SDK's `ConversationRewindV1` (`../serene-pub-sdk/sdk/src/sessionDossier.ts` ~408; optional,
   additive).
2. The words. `src/lib/client/components/Header.svelte` ~105–125 and `FullscreenExit.svelte` ~79–112: where the
   step is `message`, *Back one message* and *Forward one message* (labels and titles); otherwise *Back one turn*
   and *Forward one turn* as today. *Regenerate the last turn* keeps its words everywhere. SDK:
   `core-catalog/src/shared/ui/conversation/rewindStrip.ts` (`turnsAheadText` ~53 and the replace line ~100–101)
   and `core-catalog/components/shared/composer/ComposerWidget.svelte` ~62–64: *1 message ahead*,
   *2 messages ahead will be replaced if you write now.* where the step is `message`; *turn* otherwise.
3. Docs: `docs/sessions.md` ~243–254. Back in Story takes the newest message of any kind, greetings included,
   down to an empty session; the sentence near ~254 that says the greetings and the opening stay now holds only
   for genres that take a whole turn; the wording *Back one message*. NOMENCLATURE: a §25 row for the `step`
   field and the copy. Write "greeting", never "intro".

## Tests

Update the tests that pin these strings and types (grep `Back one turn`, `turn ahead`, `turnsAheadText`,
`rewindStateWith`, `SessionHeaderRewind` under `src/**/*.test.*` and `../serene-pub-sdk/sdk-tests`); add cases for
`step: "message"` reaching the header's labels, the full-screen strip, `turnsAheadText` and the composer's line,
and for an absent `step` reading as `turn`. Never weaken a test.

## Rules

Never `git commit`, `stash`, `checkout` or `restore`. Never `kill -9`. Never `prettier --write` a directory.
**Do not run `npm run sdk:build`**: the lead builds once at the end; an SDK test that needs the built package is
left for the lead (say which). Run app tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > <log> 2>&1"`,
one run at a time, targeted files only; then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`.
Comments state the rule, not the story: no "no longer", "used to", "deliberately not". Another session is building
in this checkout: stay off `src/lib/client/components/Layout.svelte`, `src/lib/client/sessions/store/**`,
`src/lib/client/components/sessionPage/sessionPageData.svelte.ts`, `src/lib/server/messages/store.ts`,
`src/lib/server/plugins/**`.

## Report

Write `plans/REPORT-back-intros-w2-2026-11-13.md` and return it as your final message: every place `step` is
carried; the strings verbatim; tests changed and added; what needs the SDK build to verify; noticed, not done.
