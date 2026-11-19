# BRIEF — worker `wt-1b-fix-w2` — one switch per pipeline for `speakerInCast` (fix 5), and the docs (fix 6)

Supervisor: lane `wt-1b-fix` (`plans/briefs/BRIEF-wt-1b-fix.md`). App repo `/home/jody/github/serene-pub`; SDK
`/home/jody/github/serene-pub-sdk` (docs and comments only). Background, read first:
`plans/REPORT-kn-5-2026-11-16.md` (lane `kn-5` built the ganged control for `knownToSpeaker`: your model),
`plans/REPORT-wt-1b-2026-11-17.md` (what `wt-1b` built). A parallel worker (w1) is moving the speaker-in-cast
judgement into the host's lore read; the **behaviour to document is stated below**, not what the code says today.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No `sdk:build` in this task: comment-only SDK edits.)

Both repos are staged by the lead: run **no git command that changes the index or the working tree** (no add,
reset, checkout, restore, stash, commit). Never in `../serene-pub-sdk` either. **Never `prettier --write`.** No
migration. No full test run, no `npm run build`.

## Part A — the panel (fix 5)

Today an administrator sees two switches both labelled *Only scenes the speaker was in* (on **Earlier scenes** and on
**History entries**) in Story's reply pipeline, because the ganged control is hard-wired to one param
(`src/lib/server/pipelines/config/panel/ganged.ts` 27–34: `GANGED_PATH` / `GANGED_LABEL` / `GANGED_DESCRIPTION`).

Build:
- In `ganged.ts`, replace the three constants with **one small table keyed by param path** (🚧, e.g.
  `GANGED_PARAMS: Record<string, { label: string; description: string }>`), holding:
  - `knownToSpeaker`: label *Only what the speaker knows*, description unchanged (*Leaves out what the speaking
    character does not know, on every lore read of this pipeline.*);
  - `speakerInCast`: label *Only scenes the speaker was in*, description ★ *Leaves out the earlier scenes the speaking
    character was not in, and those scenes' part of each history day, on every read of this pipeline.*
- `gangedMembersOf(decls, nodes, path)` takes the path. Update the header comment (it says "exactly one parameter";
  "Not a general registry. One constant path" becomes: a fixed table of the params core gangs, no option for others).
- Loop over the table at every call site, so each param gets its own gang, its own home and its own option id
  (`optionId(secret, GANGED_PSEUDO_NODE, home.slot, home.path)`: the path keeps ids distinct; check it):
  `read.ts` ~451–455 and ~835–871; `write.ts` ~119–124 (`locate` finds which gang the id names);
  `src/lib/server/sessions/settingsForm.ts` ~555 and ~631–790. **Lane `ss-3b-1` edited that file's prompt rows: re-read
  it first and touch only the ganged field code.**
- Result: one *Only what the speaker knows* and one *Only scenes the speaker was in* per pipeline with two or more
  reads declaring each, each writing / resetting **its own members' own stored addresses** in one transaction, as
  `kn-5` built for the first. A pipeline with one such read is unchanged. Report which step each gang's home sits on
  for Story respond (★ placement).

Files owned (Part A): `src/lib/server/pipelines/config/panel/{ganged.ts,read.ts,write.ts}`, `types.ts` (comment
only, if it names the one param), `src/lib/server/sessions/settingsForm.ts` (ganged code only),
`src/lib/server/pipelines/config/panel/ganged.int.test.ts`, `src/lib/server/pipelines/config/panel/index.int.test.ts`
(re-pin only), `src/lib/server/pipelines/boot/retrievalModeCull.int.test.ts` (re-pin only if it fails), and the
session settings form's test file if one asserts the ganged field (find it; name it).

Tests: in `ganged.int.test.ts`, for `speakerInCast`, the same cases it has for `knownToSpeaker` (one switch shown;
write and reset reach every member's own address; reads inheriting different values; the difference words; the
settings form shows one field). In `index.int.test.ts`, the admin view shows exactly one switch per ganged param.

## Part B — the docs (fix 6)

**The behaviour as built (w1), to document:**
- The judgement now happens **once, in the host's lore read**, so it holds **however the reply finds the day**: the
  History step's keywords, search by meaning, entity search, the triggers read (Look, narration, the side-character
  turn), keyword chains followed from other text, a link's far end, the core tools. A day the character missed part
  of reads, on every one of those paths, as the summaries of the scenes it was in; a day it was in none of (or whose
  kept scenes have no usable summary) is left out of the read itself, so nothing can bring it back.
- The switch lives on **Earlier scenes** and **History entries**; the History step's value switches its own read.
  Every other lore read (world lore, character lore, triggers, the listing, search by meaning, entity search, the link
  hop, entries named, the core tools) carries no switch and follows the default, **on**. (w1 lists the exact callers;
  the supervisor will correct the list if it differs.)
- **The cut (★):** a replaced day is at most **twice the day's own text** in length; when the summaries are longer,
  the day keeps them **from its start**, in story order, and drops from the end; the first scene's summary is always
  kept whole. The notes say *cut short*.
- **A scene whose cast was worked out but lists nobody is kept** (★), like a scene whose cast was never worked out.
- No more "published on exclusions" / "the run's ranking record says why" for this rule: the History step's **Notes**
  say what happened: *History for Mira: 2 days shown as the scenes Mira was in, 1 cut short, 1 left out*,
  *No history entries changed for Mira*, *Reads everything: not one cast member's turn*. The earlier-scenes notes are
  unchanged, and a session with no earlier scenes gets none.
- Unchanged: a fully attended day keeps its whole text (other sessions' scenes not judged); a hand-written day or one
  with only other sessions' scenes is never judged; `session-history@1` is not filtered; firsthand (⏳) is unchanged and
  its own limits paragraph stays as it is.

Edit (only these; read each section before editing):
- `docs/pipelines.md` *Only the scenes a character was in* (~364–378): the **History** bullet (cut rule, ×2, start
  kept), the **A scene is kept** bullet (empty cast), the **Left out for good** bullet (now: left out of the read
  itself, on every path), the Notes sentence, and **delete the Limits line** (~378) that states the meaning-search /
  triggers / keyword-chain gaps. Do not touch the firsthand section above it.
- `docs/lorebook-cast.md` ~86 and `docs/context-templates.md` ~391 and ~405: true as they stand? Correct only what is
  now false (e.g. say it holds however the day is found, if it reads otherwise).
- `docs/summarization.md` ~48: check; correct only if false.
- SDK `INTEGRATING.md` §1p (~1577–1600) and §1n (~1506), `guides/genres-presets-and-routines.md` (~504–520): remove
  any stated limit, state the cut and the empty cast; keep the ⏳ firsthand sentences.
- SDK `contracts/src/queries.ts` **comments only**: the `historyEntries` doc comment (~1256–1265: "never longer than
  the day's own text (oldest summaries dropped first) … published on `exclusions`" is now false) and the
  `earlierScenes` comment (~1559–1562, the empty cast). **Never change a declaration string** (`label`,
  `description`, defaults): they are hashed; and no build.
- `NOMENCLATURE.md`: the §14 row **in the scene's cast** (`speakerInCast`, ~972): its rule, receipts, and delete its
  "Limits:" clause about the meaning-search copy, the triggers read and keyword chains; the §25 ledger: one new entry
  dated 2026-11-17 *(lane wt-1b-fix …)* recording: the move into the host's lore read; ★ the cut rule; ★ the empty
  cast; *new internal names* (w1's list: the host read `speaker_in_cast`, the cap constant, any new loader / view
  names; the supervisor will hand you w1's final list, use placeholders you then fill only from that list, never
  invent); *retired* `inCastHistoryReason` and the two reason sentences, `GANGED_PATH` · `GANGED_LABEL` ·
  `GANGED_DESCRIPTION` → the table (its name), and the second ganged control's label and ★ description.

## Rules your work depends on (quoted)

- NOMENCLATURE §1: **R1** one word, one meaning · **R2** distinctive words for new concepts · **R3** qualify, never
  the bare noun · **R6** mark ⏳ transitional / 🚧 provisional vocabulary. §24: "Grep for it first — across `src`, the
  SDK, and the schema." · "UI labels are prose and need not match internal names — but must not _contradict_ them."
  CLAUDE.md: "When you add or rename a term, record it in **§25 Change ledger** in the same change."
- STYLE-GUIDE §1.8: "Sentence case, plain verbs. Labels are sentence case."
- CLAUDE.md: "It is a **session**, never a *chat*." · docs/<area>.md "update it in the same change when behaviour moves".
- Owner D36 (2026-11-16): "One switch for the pipeline's lore reads, under Advanced".
- P4: "Power controls are purposeful. Grouped by the task, each with one sentence of purpose."
- Every copy string you add is ★ (the owner rules copy); say so in the report.

## Stop and ask (report, do not decide) when

A file outside the two "Files owned" lists must change; a ganged write for one param would touch the other's
addresses; the docs would need to state something the behaviour list above does not give you.

## How to run tests (exactly; one at a time; always at least one path)

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/wt-1b-fix-w2-<n>.log 2>&1"
```

Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` must be 0 (w1 is
editing runtime files in parallel: an error in a file you do not own is theirs, report it, do not fix it), and
`npx prettier --check` on every file you touched (pre-existing failures: report, never `--write`).

## Report

Final message (under ~450 words): changed files with file:line; the table's name; each gang's home for Story respond;
tests run (log path, counts); every ★ copy string; NOMENCLATURE placeholders still to fill; Noticed, not done.
