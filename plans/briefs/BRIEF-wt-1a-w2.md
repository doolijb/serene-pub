# BRIEF — worker `wt-1a-w2`: the scene summary review's seed lists speakers only

Repo `/home/jody/github/serene-pub` (app). The SDK repo `/home/jody/github/serene-pub-sdk` is **read-only** for you.
Supervisor: lane `wt-1a`. Report back as your final message (under ~400 words).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` in this task: do not run one.)

The repo is staged by the lead: run **no git command** that changes the index or the working tree. Never run prettier with `--write`, never pipe its output into a file. No migration, no schema change. No `npm run build`, no full test run.

## Goal (owner rulings, quoted)

- D57 (2026-11-16): "Attended = spoke in the scene" … "For core catelogue, we will go with: Spoke at least once, and further filtering by cast members position."
- B1 (2026-11-17): "Active means spoke at least once in the scene".
- B2 (2026-11-17): "hand edits aren't treated differently. Just keep a change history so a user can overwrite." (Change history is NOT built here.)
- Lead's cold-review ruling for this lane: "the live compiler and the summary review's seed list speakers only (who spoke is something code decides, P1; the model's `cast` extraction no longer adds participants to the seed; a person can still add anyone by hand in the review, and a hand edit through `scenes:update` / `scenes:create` stays a person's write, unfiltered)."

## What exists

- The live compiler's rule is already built (worker w1) in `src/lib/server/scenes/liveScenes.ts`: exported
  `sceneCastSpeakers(db, sessionId, lines, seats?) → Promise<Set<number>>` — the sender card ids (`characterId ?? personaId`) of `lines` (`{ id, characterId, personaId, castMemberId }[]`) that sent at least one line and that the place rule does not rule out (the member's own `core:slot/location@1` as of its line vs the scene's place at that line; no declared place key → everyone who spoke). Read its doc comment; do not change it.
- The review seed: `processScene` in `src/lib/server/sockets/scenes.ts` (~1879). Around 2394–2456 (re-verify): the model's `cast` node output (`result.participantCharacters`) is resolved by `resolveCharacterRefs` against `knownCast` into participant ids and **suggested names** (`suggestedParticipants`, which the Review & Save window pre-adds and creates on Save unless the person removes them, `ProcessSceneModal.svelte` 207–216); then every distinct sender (`charIds`, `personaIds`, built ~2133 from `rawMessages`) is added through `resolveOrCreateBinding`, and `reconcileParticipantsAndMentioned` joins them. The result goes to `pendingResult` (`participantCharacters`, `suggestedParticipantCharacters`, …) on the activity.

## Build (only `src/lib/server/sockets/scenes.ts`, only the seed block)

1. The seed's participants are **the senders that `sceneCastSpeakers(db, scene.sessionId!, rawMessages)` keeps** (resolved to members by the existing `resolveOrCreateBinding` loop, unchanged otherwise). The model's `cast` output no longer adds anything: no participant ids from it and **no suggested participant names** (`suggestedParticipantCharacters: []`); suggested mentioned stays `[]` as today. Keep `pendingResult`'s shape unchanged (same keys).
2. Keep `result.participantCharacters` / `mentionedCharacters` on `result` (the run still reports them); add a short comment in the manner of the existing "⚠ ICED" note saying the seed no longer reads the model's cast (D57/B1: who spoke is code's to decide, P1) and a person adds anyone else by hand in the review.
3. Remove imports that become unused in this file (only if unused: `resolveCharacterRefs`, `reconcileSuggestedNames`). Do not touch `knownCast` if the pipeline input still uses it. Update the comment at ~93 only if it names the seed's model resolution as current.
4. Do not change anything else in `scenes.ts`: not `scenes:update`, not `scenes:create`, not `saveSceneSummary`, not the routine's Full path, not `scenes:openScenes`.

## Tests

New file `src/lib/server/sockets/scenes.reviewSeed.int.test.ts` (60 s timeouts; its own `/tmp/serene-pub-vitest-reviewseed-*` dir, released in `afterAll`), modelled on the harness of `src/lib/server/sockets/scenes.summaryReview.int.test.ts` (read it: how it runs `processScene` / the handler with a fake model and reads `pendingResult` off `activityStore`):
- a scene whose lines are sent by Mira (character) and Tomas (player) while Pell is seated and silent, and the model's `cast` names Pell, a stranger "Grust" and Mira: `pendingResult.participantCharacters` holds exactly Mira's and Tomas's members; `suggestedParticipantCharacters` is `[]`; Pell is not in it; no member is minted for Grust.
- if the harness can run a genre that declares a place key (see `src/lib/server/scenes/liveScenes.castRule.int.test.ts`, how it registers a place slot and writes values), one test where a speaker whose own place at its line differs from the scene's place is not seeded; if that is not feasible in this harness within reason, say so in the report (the rule itself is pinned in `liveScenes.castRule.int.test.ts`).
Then run the existing seed-adjacent files and fix only assertions this change breaks (report each, file:line, before → after): `src/lib/server/sockets/scenes.summaryReview.int.test.ts`, `src/lib/server/sockets/scenes.routineSummary.int.test.ts`, `src/lib/server/sockets/summarize.int.test.ts`, `src/lib/server/sockets/scenes.participantValidation.int.test.ts`, `src/lib/server/sockets/scenes.captureAndLine.int.test.ts`.

## Rules you depend on (quoted from the project's CLAUDE.md)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id."
- P1: "Code decides what code can; the model only judges. Same inputs, same result."
- "It is a **session**, never a *chat*." Never the word *attendance* (taken by the Who's here widget).
- Do what was asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.

## How to run tests (exactly)

Before every run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Then
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <paths> > plans/wt-1a-w2-<n>.log 2>&1"` (always at least one path; never pipe vitest into `head`). Typecheck: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report errors in your files only). `scenes.ts` already fails `prettier --check` before your change: match the surrounding style, never reformat it; the new test file must pass `npx prettier --check`.

## Done means

Green: the new `scenes.reviewSeed.int.test.ts` and the five files above; `tsc` 0 errors in `scenes.ts` and your test.

## Report

The diff in words; tests run with results and log names; each changed assertion; **Noticed, not done** (e.g. whether the summarize pipeline's `cast` step still costs a model call whose output nothing now reads).
