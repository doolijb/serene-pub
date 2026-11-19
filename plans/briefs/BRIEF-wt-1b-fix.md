# BRIEF — fix lane `wt-1b-fix` — the speaker-in-cast filter, closed on every path a day reaches a prompt

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (docs / guide only unless a
contract comment must change; no build expected: if you must build, follow the usual checks). Supervisor: read
`.claude/guides/multi-agent.md`, then `plans/REPORT-wt-1b-2026-11-17.md`, `plans/briefs/BRIEF-wt-1.md` (its
"Cold review corrections"), `plans/REPORT-tl-4-2026-11-16.md` §3 (how one filter in the host's lore read
covered every path for the timeline rule), `plans/REPORT-kn-2a-2026-11-16.md` (the `knownToSpeaker` block in
the host read; how the speaker is resolved once), `plans/REPORT-kn-5-2026-11-16.md` (the panel's ganged
control). Re-verify every file:line below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Owner: 2026-11-14 "a character who missed part of a day gets the summaries of the scenes it attended … Build
that query behavior as part of the core tooling"; 2026-11-15 "Stored cast list … Scenes/history are what
persist." and "a toggle that's on by default"; D36 (2026-11-16) "One switch for the pipeline's lore reads,
under Advanced".

Both repos are staged by the lead: run no git command that changes the index or the working tree.
`npx prettier --check` only, **never `--write`**. No migration. Inside `db.transaction` only `tx`. Tests only
as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/wt-1b-fix-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`. No
other lane is editing code.

## Fixes

1. **The replacement happens in the host's lore read, so every path follows it.** Today a day is replaced only
   on the history lane (`pipelines/runtime/bindings.retrieval.ts` ~473–481). But search by meaning ships
   Automatic (`core-catalog/src/genres/story/respond.ts:167`), its hits take their text from the
   `lorebook_entries` read (`bindings.retrieval.ts` 1281–1295, `readiedOf`), the vector copy is keyed
   `historyEntry:N` and the lane copy `history:N`, and `concat-candidates` compares keys literally
   (`bindings.ts:1464`): a speaker who missed scene B gets A's summary from the lane **and the whole day** from
   meaning search. The side-character turn's triggers read (`narrateCharacter.ts:269`, a history band, a
   character speaking) and keyword chains have the same gap. Do the judging and the replacement **once, in
   `pipelines/runtime/host.read.lorebookEntries.ts`, beside the `knownToSpeaker` block (~865–873)**: a history
   row handed to a run for a speaker who missed part of that day carries the attended scenes' summaries as its
   content; one the speaker was in none of is left out there (so no lane, search or trigger can bring it
   back); a fully attended or hand-written day is untouched. The history lane then needs no replacement of its
   own and **no `exclusions` for a partly missed day** (today a half-known day the lane did not itself return
   is excluded everywhere, so the speaker gets nothing of it, against the 2026-11-14 ruling): remove that. The
   param still switches it (off → today's behaviour, byte-identical) and is read from the query that asked (a
   read that does not carry the param follows the default, on: say which reads those are). Receipts: once per
   read as now, not duplicated.
2. **The cut is the read's budget, not the day's own size.** `fitSummaries` is capped at `candidate.tokens`
   (the day's own token count, `bindings.retrieval.ts:473`); a compiled day is merged prose
   (`docs/summarization.md:94`), so the attended scenes' summaries are often longer and get cut down to
   nothing, and the day is then excluded: a speaker who was in two of three scenes can get no day at all. Cap
   at the read's own token budget instead (the lane's `maxTokens` / the row's share of it: find what the read
   has at the point of fix 1; if the host read has no budget, cap each replaced day at a fixed multiple of the
   day's own size and report it as ★), and when it must cut, keep the scenes in story order from the **start**
   of the day and drop from the end (a day must not lose how it began), saying in the receipt that it was cut.
3. **A scene resolved with an empty cast is treated as unresolved** (`sessions/speakerInCast.ts:96` leaves it
   out for everyone, which makes any day holding one "partly missed" for every speaker): kept, like a scene
   whose cast was never worked out (★ in the report).
4. **Cost.** Each load runs `seatOf` and `membersAsRead` even with nothing to judge
   (`bindings.outlets.ts:289` with empty `sceneIds`); Story rose by 21 statements a turn and the Lair by 11 in
   worlds with no scenes. Return early when there are no scenes; with fix 1 the speaker is already resolved in
   the host read for `knownToSpeaker`: load the stored casts **once per run** and share it between the
   earlier-scenes read and the lore read. Report statement counts per baseline world against
   `plans/wt-1b-shas-before.txt`: a world with no scenes costs **exactly** what it did before lane `wt-1b`.
5. **One switch in the panel.** The administrator sees two switches both labelled *Only scenes the speaker was
   in* (Earlier scenes; History entries). The one-switch mechanism is hard-wired to one param
   (`pipelines/config/panel/ganged.ts` 28–34: `GANGED_PATH` / `LABEL` / `DESCRIPTION`): make it a small table
   keyed by param path, give `gangedMembersOf` the path, and loop over the table at `read.ts` ~453 / ~859,
   `write.ts` ~122 and `sessions/settingsForm.ts` ~636 / ~772 (lane `ss-3b-1` edited that file's prompt rows:
   re-read first; touch only the ganged field code). Result: one *Only what the speaker knows* and one *Only
   scenes the speaker was in* per pipeline, each writing its members' own addresses, as lane `kn-5` built for
   the first. Tests as `ganged.int.test.ts` has, for the second param.
6. **Docs say what is true:** `docs/pipelines.md` ~373–378 (with fix 1 the rule holds however the reply finds
   the day, including by meaning and on the side-character turn: remove the stated limit), `docs/lorebook-cast.md`
   and `docs/context-templates.md` (the new paragraphs), the SDK guide and `INTEGRATING.md` if they state the
   limit; NOMENCLATURE §25.

## Tests

The fixture world (`pipelines/runtime/speakerInCast.reply.int.test.ts`) extended: search by meaning returning
the half-missed day (the prompt holds A's summary once and nothing of B: assert the day's full text appears
nowhere in the prompt); the side-character turn; a keyword chain into the day; a speaker in two of three
scenes gets those two summaries although together they are longer than the day's own text; the cut keeps the
start of the day; a resolved-empty cast is kept; param off is byte-identical to before `wt-1b`; the narrator
reads everything. Both existing baselines byte-identical, with statement counts as fix 4 says. The panel tests
for fix 5. `tsc` 0; `npm run check` 0 errors in lane files.

## Workers

At most 2 at once: one for fixes 1–4 (the host read, the bindings, `speakerInCast.ts`, the fixture world), one
for fix 5 (the panel) and fix 6 (docs). Briefs `plans/briefs/BRIEF-wt-1b-fix-w<n>.md`.

## Stop and ask when

CLAUDE.md §Decisions applies; doing the replacement in the host read changes a prompt for a world where every
speaker was in every scene; the host read cannot tell which session's scenes a day holds without a query per
row (then batch it and report the cost); a baseline with no scenes costs more than before `wt-1b`.

## Report

Final message = the report (lead appends it to `plans/REPORT-wt-1b-2026-11-17.md`): per fix what changed
(file:line); the paths now covered and the test proving each; the cut rule as built (★); statement counts per
world; the panel; **Noticed, not done**. Under about 550 words.
