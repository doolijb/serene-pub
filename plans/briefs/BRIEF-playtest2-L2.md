# BRIEF playtest2-L2 — own names everywhere a member is named; the provided-book holes (lane L follow-on)

Lane id `playtest2-L2` · wave 3b · report `plans/REPORT-playtest2-L2-2026-11-04.md` · you are a `lane-supervisor`: read `.claude/guides/multi-agent.md` first, then `review.md` §2.

## Goal
Read `plans/REPORT-playtest2-L-2026-11-04.md` (§ Noticed, not done is your list) and `src/lib/shared/lorebooks/memberIdentity.ts` (the ONE reader: `memberNames`, `memberShownName`, `withMemberNames`, `memberFaceMediaId`; the session carries `castNames` + `castFaces`, client `castNameOf`). Build:
1. **Every reader that names a cast member reads through the helper** (own name over the card's; own face where a face is drawn): client `TurnPicker.svelte:44`, `PickSpeakerModal.svelte:146/158`, `routes/sessions/[id]/+page.svelte:740` `participantOf` (also `castFaces`), `sessionPage/messageControls.svelte.ts:251`, `pressRouting.svelte.ts:580`, `CharacterLoreEditor.svelte:29`, `SummarizeLoreModal.svelte:225`, `lorebooks/time/worldRoster.ts:86` (name by member first, so the workspace's card-less workaround can go); server `sessions/rowProjection.ts:93` (session cards), `pipelines/runtime/runStatus.ts:221` `{speaker}`, `fireAction.ts:1258`, `pipelines/scripts/chains.ts:774`, `transcript.ts:117`, `sideCharacter.ts:295`, `sockets/narrativeGraph.ts:1027-1045`, `entryManager.ts:~118` `substituteBindings`, `characterLoreVisibility.ts:38`. Where a reader has no member row, read `castNames` off the session; never a second rule (R1).
2. **Provided-book holes:** the dated `faceMediaId`/`retold` change in `sockets/amendments.ts` (~397, ~506-523) calls `providedCastProblem` and refuses with `PROVIDED_BOOK_CAST_REFUSAL` (in `plugins/providedMarks.ts`); `uploadMemberFaceHandler` (`sockets/lorebooks.ts` ~1831-1900) only adds a picture to the book's list — refuse the UPLOAD to a provided book with the same sentence family (say "a provided book's picture list" in the report, not "a face change").
2b. **The refusal follows M2e's decider:** `providedCastProblem` (`lorebooks/castOwnNames.ts:51`) refuses whenever `markedBook` is non-null, but M2e's rule is "core's, and any plugin still installed" (`providedOwnerPresent`, `sockets/lorebooks.ts` ~1029; list/get show `provided` only then). Gate the cast refusal the same way — `mark && await providedOwnerPresent(db, mark.plugin)` — or, if M2e exposes one `providedHere(db, book)` decider, call that; test: a book whose plugin was uninstalled accepts own names.
3. Remove the unused `CastRow.character.userId?` (`castPool.ts`) if nothing else reads it.
Docs: none expected; `docs/lorebook-cast.md` only if a sentence becomes wrong.

## Files owned (by name; re-read each immediately before editing)
The files listed above, `src/lib/server/lorebooks/castOwnNames.ts`, `src/lib/client/lorebooks/castPool.ts`, and tests beside each (add one case per reader group: a member with an own name shows it in the turn picker, the speaker picker, the session card, the run status, the transcript, the graph; a face upload and a dated face change on a `markedBook` row are refused).
NOT yours: `memberIdentity.ts` (extend only if a reader needs a signature it lacks — say so), `NOMENCLATURE.md`, `providedMarks.ts` beyond importing, the M2e stay-out list.

## Files readable
Everything. NOMENCLATURE §8 (cast member, face, alias rows) and today's §25 lane-L row (tail).

## Out of scope — never built
Faces in the book file (★L-2); the nickname rule (★L-3, ruled by the lead: keep); any setting; a second name rule.

## Stop and ask when
A reader cannot reach a member row or `castNames` without a new socket field; a name is new; CLAUDE.md §Decisions applies.

## Done means
Green: the tests beside each touched file, `castPool.test.ts`, `sessionPageProjections*.test.ts`, `rowProjection*.test.ts`, `runStatus*.test.ts`, `transcript*.test.ts`, `narrativeGraph*.int.test.ts` touched, `lorebooks.*.int` for the two refusals, plus the new cases above.
## Standing rules for every playtest2 lane (verbatim from the lead)
- **Scope is the ruled set in § Rulings.** Every ruling there is final; nothing else is in scope. The M2e programme (`plans/PLAN-sdk-creation-seams-2026-10-30.md` §19) builds in the same trees right now: claim files by name, re-read before every edit, and never edit the stay-out list in § Build plan 2.
- **Names.** Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24, then your area's group section. No lane edits `NOMENCLATURE.md`: list every new or changed term in your report under **Canon rows needed** with the row text.
- **Stored data.** 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that); anything else is a migration (`db:generate`, index above the highest applied) and a second-boot-changes-nothing test.
- **P1.** A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off.
- **Sockets.** One domain context per event family is the only listener and the only place that toasts. A `SCOPED_EVENTS` event carries its scope key in the payload. `socket.off(event, handler)` always with the handler.
- **DB.** Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a fixed id. No top-level await in `src/lib/server/db/index.ts`.
- **Workers.** `lane-worker` agents, at most 2 at once, briefs at `plans/briefs/BRIEF-playtest2-L2-w<n>.md`, each carrying the rules it needs inline plus the verbatim lines below. Check each worker's diff against its brief before accepting.
- **Tests.** Only the targeted test files under **Done means** (plus any you add). Never a full `npm test`, `npm run check`, `tsc` over the project, or `npm run sdk:test` whole. Run vitest as: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-L2-<n>.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
- **SDK edits** happen in `/home/jody/github/serene-pub-sdk`. If an app test needs the rebuilt dist: first `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from the app root.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- **Report** at the path above: Changed files (both repos) · Tests run, exact command, pass/fail counts · Stopped, needs owner · Canon rows needed · Queued for other lanes (file:line + exact text) · Noticed, not done. The harness may refuse the report write from a subagent; if so, put the full report text in your final hand-back and the lead saves it.
