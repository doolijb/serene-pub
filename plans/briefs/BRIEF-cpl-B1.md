# BRIEF — build lane `cpl-B1` — turns and rounds follow the genre's story channel (programme 3.1, first half)

Repos `/home/jody/github/serene-pub` (app); SDK `/home/jody/github/serene-pub-sdk` **read-only, not changed**.
Supervisor: read `.claude/guides/multi-agent.md`, then `plans/PLAN-core-genre-couplings-2026-11-17.md` §1, §2
**3.1** (and 3.2 for what is *not* this lane), §3, §4 row `cpl-B1` (**re-verify every file:line: the plan was
written from a read-only pass**), `plans/REPORT-cpl-A-2026-11-17.md` (how the sibling lane was held to "nothing
moves"), `plans/REPORT-perf-3-2026-11-17.md` (what just changed in `sessions/rewind.ts`), `docs/group-sessions.md`
and `docs/genres.md` where they speak of channels, `NOMENCLATURE.md` §1, §24 and rows **channel**, **lane**,
**story channel** (if any), **round**, **session moments**, **turn tally**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. **No migration.** Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/cpl-B1-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc`. No SDK edit or build, no full run, no `npm run build`.
Comments state the rule, never the history. Lane `perf-4` is live in `sessions/settings.ts`,
`pipelines/speech/sessionSpeech.ts`, `sessions/actionsPush.ts`, `sockets/sessions.pipelines.ts`: not yours.

## Owner

Programme, Phase 3 (owner's ordered build list, 2026-11-15: "core stops special-casing genres"), 3.1: scenes
and summaries follow the story channel. Principles: P1 (core does nothing a genre has not declared), P5
(derived from the SDK), P6. "Genres expect, never lock."

## What this lane is

The SDK already lets a genre say which channel carries its story: `ChannelDecl.lore: 'story' | 'aside' |
'never'` and `channelLoreRole` (`../serene-pub-sdk/sdk/src/descriptors.ts` ~1425–1437, ~1561; today `main` is
refused anything but `story`, ~1680). Core's turn and round code reads the literal `main` instead. This lane
makes those sites read one helper. **Nothing changes for any shipped genre**: for each, the helper answers
`main`.

Scenes, summaries, close-out, the scene-boundaries spec and the SDK validation rule (★3.1-A, one story channel
per genre) are lane `cpl-B2` and wait for the owner: **not this lane**. The ruleset round (3.2) is `cpl-C`: not
this lane.

## Build

1. **The helper.** New file `src/lib/server/channels/storyChannel.ts` (check the directory and the nearest
   existing channel helpers first; if a function already answers "which channel is this genre's story", use it
   and add nothing). `storyChannelOf(shape)`: the id of the channel the genre's shape declares as `story`
   through `channelLoreRole`; with none declared or no shape, `main`; **with more than one, `main` when `main`
   is among them, otherwise the first in declaration order** (the SDK does not yet refuse two; this rule keeps
   today's behaviour and is deterministic; report it as ★ tied to ★3.1-A). Pure, no database read; a thin
   session-level wrapper only if a call site has a session id and no shape in hand (reuse how that site
   already gets its genre; add no new read on a hot path: say per site what it costs).
2. **The sites** (plan §2 3.1, the turn/round list): `pipelines/routines/moments.ts` 56–61, 115, 260, 407;
   `routines/turnTally.ts` 42, 190; `routines/evaluate.ts` 371–385; `sessions/rewind.ts` 90, 152, 178, 317,
   870–882 (line numbers moved with lane `perf-3`: find the `main` literals). For each: is the literal "the
   story channel" (replace) or really "the channel named main" (leave, and say why)? A site inside
   `rewindStateOf`'s shared read set keeps the lane `perf-3` property: no extra statement per call (re-run
   `sessions/rewind.sharedReads.int.test.ts`; its statement-count test must not move).
3. **No statement added per reply**: both prompt baselines (`plans/perf-3-shas-final.txt`; ask the lead's
   report `REPORT-perf-3` for the test paths) keep their shas, and the statement counts per world do not rise.
   If a site would need a new read, stop on that site and report.
4. **Names and docs:** NOMENCLATURE row for the helper (§24: is "story channel" already a term? reuse it;
   charter: what it answers, what it does not: it does not pick where scenes are filed, that is `cpl-B2`),
   §25. No user-facing doc changes (nothing a user sees moves); if a doc sentence says core reads `main`, fix
   it.

## Tests

- Pure: `storyChannelOf` for each shipped genre's shape (all `main`), a fixture shape whose second channel is
  `story` beside `main`, one with no `lore` at all, no shape.
- The plan's pins stay green **unchanged**: `routines/turnTally.test.ts`, `sessions/rewind.int.test.ts`
  (967–1072 region), `messages/rewindMirror.int.test.ts`, `routines/moments*` tests,
  `routines/evaluate*` tests, `sessions/rewind.sharedReads.int.test.ts`, `pipelines/boot/specHashes.test.ts`.
  **If any existing tally or Back test has to change, stop and report** (plan §4 "Stop if").
- `tsc` 0.

## Files owned

`src/lib/server/channels/storyChannel.ts` (new) and its test; `pipelines/routines/moments.ts`,
`routines/turnTally.ts`, `routines/evaluate.ts`, `sessions/rewind.ts` (the `main` literals only);
`NOMENCLATURE.md` (one row, §25). Nothing in `scenes/`, `sockets/`, `host.ts`, `closeOut.ts`, the SDK.

## Stop and ask when

CLAUDE.md §Decisions applies; a shipped genre's helper answer is not `main`; a site needs a database read it
does not make today; an existing test must change; the helper would need a published SDK name changed.

## Report

Final message = the report (lead saves `plans/REPORT-cpl-B1-<date>.md`), under about 450 words: the helper and
its rule; the table of sites (replaced / left, why, cost); tests; shas and statement counts unchanged; ★ items
(the more-than-one rule); **Noticed, not done**.

## HELD (2026-11-17, cold review) — do not launch

The helper would answer `main` for every genre the SDK can accept today (`main` is always declared, defaults to
`story` and is refused anything else: `sdk/src/descriptors.ts` 1530–1531, 1561–1569, 1680–1683), so the lane is
a rename with no reachable branch ("nothing for later"). A single id does not survive the "many story channels"
answer to ★3.1-A (the owner's line says "the channel**s** a genre declares as story"); the shape that survives
both is the existing per-lane test `channelLoreRole(shape, ch) === 'story'`. The tie-break here would disagree
with `summarizeScene`'s `channels.story` (`core-catalog/src/shared/summarize/summarizeScene.ts` 150–169). No
listed site has the genre shape in hand. `STORY_LANE` (`routines/turnTally.ts:42`) is already the one constant;
copies also at `sessions/turnPlan.ts` 390–393 and `src/lib/shared/sessions/rewind.ts` 127, 151, 187.
**Fold into `cpl-B2` after the owner rules ★3.1-A.**
