# BRIEF — worker `sense-doc-w1` — the ledgers the other lanes queued, and "Remove this pick"

Supervisor: lane `sense-doc`. You edit words only: the vocabulary ledger, the style guide, and the named strings,
comments and one test name. No behaviour. Repo: `/home/jody/github/serene-pub` (use absolute paths).

## Goal

A. **`NOMENCLATURE.md`**: record, as §25 (Change ledger) subsections, the names the build's lanes made, and correct
   two §15 rows. B. **`STYLE-GUIDE.md`**: two lines in §6.11 and §6.17. C. The leftover-pick button was renamed
   **Use the pub's** → **Remove this pick** on screen; the server's refusal sentences, comments and one test name still
   say the old words. Bring them in line.

## Files owned (the only files you may edit)

- `NOMENCLATURE.md` — §15 rows **variable template** (about line 956) and ⏳ **leftover pick** (about line 960), and
  new §25 subsections appended after the last one (`### time a function counts on, time a genre keeps — 2026-11-11`,
  about line 3612, before `## 26. Shell`). Nothing else in the file.
- `STYLE-GUIDE.md` — §6.11 the **Variable layouts** sentence (about lines 1564–1572) and §6.17 the **Variable
  layouts** bullet (about lines 2097–2110). Nothing else.
- `src/lib/server/pipelines/config/leftoverPicks.ts` — string and comment text only: comments at about lines 13 and
  456; the refusal sentences at about lines 719, 756 and 892.
- `src/lib/client/components/pipelines/leftoverPicks.svelte.ts` — the comment at about line 4.
- `src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts` — the header comment at about line 5 and the test name
  at about line 333.

## Files readable

The lane reports `plans/REPORT-sense-{eng,eng2,lay,mod,mod2,mod3,rin,rin2}-2026-11-11.md`; the code they name; the
rest of NOMENCLATURE (to copy the house format and to grep for collisions).

## The rules your work depends on (quoted from NOMENCLATURE and CLAUDE.md)

- NOMENCLATURE "Maintaining it": "A change that renames a concept updates this file **in the same change**." "Mark
  anything impermanent per **R6** — ⏳ transitional or 🚧 provisional."
- **R1** "One word, one meaning. Where a word is already load-bearing in one place, the _other_ use renames."
  **R3** "Qualify, never abbreviate to the bare noun."
- §24: "Grep for it first — across `src`, the SDK, and the schema." "Say what it is **not**, in the declaration, if a
  near-neighbour exists." "UI labels are prose and need not match internal names — but must not _contradict_ them."
- §23 (Retired words): never reintroduce one. Never write "no lorebook", never *chat* for a session.
- CLAUDE.md: "When you add or rename a term, record it in **§25 Change ledger** in the same change."
- The comment-history check (`src/lib/shared/conformance/commentHistory.test.ts`): "A comment states the rule, not
  the story." No "used to", "previously", "no longer", no dated narrative in a code comment.
- No reference to any other project or product, anywhere.

## Format of a §25 subsection (copy the house style exactly; see the `round tick` and `variable layouts` ones)

```
### <short subject> — 2026-11-11 (<owner GO or ruling>; PLAN-sensible-engine-2026-11-11, lane <id>)

| Was | Is | Cost |
| --- | --- | --- |
| <old thing, or _(new)_> | 🚧 <names, with what each is> | <files> |
```

The plan's owner go for this build is `PLAN-sensible-engine-2026-11-11` Part 5 ("Hashed, 2026-11-11"). Mark new names
🚧 (provisional). Mark every copy string that a report lists as provisional with 🚧 and put it in _italics_ (sentences)
or **bold** (button and heading labels), as the neighbours do. Grep each new name across `src`, `../serene-pub-sdk`
and `src/lib/server/db/schema.ts` before you record it, and confirm the name exists in the code as the report says
(the reports were written before scope reviews changed some; the code wins — record what the code has, and list any
mismatch in your report).

## The subsections to write (one per lane group)

1. **variable layouts: where a variable differs, and why a layout was used** (lane `sense-lay`). From its report:
   `LayoutReason` is now `leftover · preset · pub · template · authored · default · automatic · no-layout`
   (`default` narrowed to the variable's default row; `authored` = the pipeline author's pick for the step;
   `automatic`; `no-layout`); the inspector words _named by the template_ · _leftover pick_ · _the preset's_ ·
   _the pub's_ · _the pipeline's choice for this step_ · _the variable's default_ (was _the default_) · _automatic_ ·
   _no layout for it_; `VariableLayoutDifference`, `variableLayoutView`'s `differs`, `differencesOf`, `isAutomaticRow`
   (exported), client `differenceLine`; heading **Where this differs**, description _These write this variable out
   with another layout than the one in use._, and the lines listed in the report; the button **Use the pub's** →
   **Remove this pick**; the render error sentence in the report. Files from the report.
2. **models set up: the first model fills Reply, the managed address, why a model was unloaded** (lanes `sense-mod`,
   `sense-mod2`, `sense-mod3`): `fillReplyIfEmpty` (`koboldcpp/fillReplyOnArrival.ts`), `managedBaseUrl`
   (`koboldcpp/managedEndpoint.ts`), `noteCoLoadReason`, `coLoadReason` (on the subprocess status response,
   `shared/sockets/types.ts`), `coLoadUnmeasured` (`koboldcppManager/coLoadReading.ts`), `doneHeading`, `replyFilled`,
   `doneSentence` (`connections/setupChatFlow.ts`); removed: `firstModelToRegister`, the `onChooseJobModel` prop of
   `SetupChatFlow`. Copy 🚧 from the mod report's "Provisional copy" and mod2's hint ("Follows the port. Change the
   port in KoboldCPP's settings in the usual interface."). Confirm each name in the code first (`grep -rn`).
3. **the story clock starts on a move** (lanes `sense-eng`, `sense-eng2`): `storyMoveStartOf(db, sessionId, row)` →
   `{ start, present }` in `state/storyTime.ts`, the one reader of where a move starts (session clock, else the line's
   present, else the story's first day); `FIRST_STORY_DAY` is private to that file. Was: a move by an amount refused
   on a story with no clock.
4. **read in, or not: decision lines** (lanes `sense-rin`, `sense-rin2`): from rin2's "Names for §25":
   `ReadInFacts.verdict` → `decisionLine`; `SignalFacts.verdict` → `decisionLine`; `skipVerdict` →
   `skipDecisionLine`; `storeVerdict` → `storeDecisionLine`; new `offDecisionLine(baseEnabled)`; `GATE.notOnLine` →
   `GATE.notReadHere`; new `skippedEntryRow`, `GATE`; new wire field `RetrievalRow.skipReason`; removed
   `SKIPPED_PREFIX`, `skipReasonOf`. `reason` (the code) and `why` (the stored sentence) keep their names and now sit
   on `ReadInFacts` as on `RetrievalRow` and `ranking_decisions`. Say why the rename: **verdict** is load-bearing in §4
   (the one function that judges a rule), so the read-in sentence is a **decision line** (R1); note that the wire
   field `RetrievalRow.verdict` keeps its name (⏳, noticed by rin2, not renamed). Copy 🚧 from the rin and rin2
   reports' "Provisional copy" (the prefixes and the gate sentences, and `GATE.notReadHere`'s sentence). Confirm each
   name in `src/lib/client/lorebooks/editor/readIn.ts`, `signals.ts`, `src/lib/shared/sockets/types.ts` first.

## The two §15 rows to correct

- **variable template** row: its "Resolution, in order" and the `LayoutReason` list are stale. The code's order (lane
  `sense-lay`, matching `docs/context-templates.md` ~244): a layout a template names · a ⏳ leftover pick · the
  preset's choice · the pub's layout · the author's pick for the step · the variable's default row (which may be the
  automatic one) · no row; reasons `template` · `leftover` · `preset` · `pub` · `authored` · `default` · `automatic` ·
  `no-layout`. Check that order against `src/lib/server/pipelines/config/world.ts` (the layout-reason block) before
  writing it.
- ⏳ **leftover pick** row: "shown on its pipeline step with **Use the pub's** and **Move into the template**" →
  **Remove this pick**.

## STYLE-GUIDE

- §6.11, the **Variable layouts** sentence: after the layouts `AdminInline` description, add one clause for the
  **Where this differs** fieldset as built in `src/lib/client/admin/sections/variable-layouts/VariablePage.svelte`
  (about lines 343–360): an `AdminFieldset` with that title and description, absent when nothing differs, one `text-sm`
  line per difference with one `anchor` link (to the template, preset or step). Keep the paragraph's voice.
- §6.17, the **Variable layouts** bullet: "with a tonal **Use the pub's**" → "with a tonal **Remove this pick**".
  Check `src/lib/client/components/pipelines/StepVariableLayouts.svelte` for the button's class first.

## The leftover-pick strings

Replace the old button name with **Remove this pick** in each sentence, keeping the sentence otherwise as it is:

- ~719: "Use the pub's on the one you don't want, then move the rest." → "Remove this pick on the one you don't want,
  then move the rest." (Make it read naturally, e.g. "Press Remove this pick on the one you don't want, then move the
  rest."; quote your final wording in the report.)
- ~756: "… so there is nothing to move. Use the pub's instead." → "… Remove the picks instead." or similar naming the
  button; quote it.
- ~892: "open that preset's step and use the pub's there first." → name **Remove this pick**; quote it.
- Comments ~13 and ~456 (`**Use the pub's**`), `leftoverPicks.svelte.ts:4`, the int test header ~5 and the test name
  ~333 ("Use the pub's removes it, …" → "Remove this pick removes it, …").
- No test asserts those refusal strings today (`grep -rn` to confirm); if one does, update its expected string.

## Out of scope

Any behaviour; any other NOMENCLATURE or STYLE-GUIDE section; any other file; editing older §25 subsections (they are
history — add new ones); `stepVariableLayouts.dom.test.ts` (its assertion that no "Use the pub's" button exists is
still true; leave it, note it).

## Stop and ask when

A name in a report is not in the code, or collides with a load-bearing word (R1) and the report does not say so:
record it as the code has it and list the question in your report. A §23 word would come back. Anything outside the
files above.

## Done means

- `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts src/lib/shared/conformance/commentHistory.test.ts"`
  passes (the int test needs no change beyond its name; if the comment-history test is red only on files outside
  yours, say which, as it was red before this lane on 9 files).
- Any NOMENCLATURE guard test: `grep -rln "NOMENCLATURE" src --include=*.test.ts` and run those found, in the same
  capped form.
- `npx prettier --check <file>` on each `.ts` file you changed; report, don't reformat lines you didn't write.
- Your report (your final message): changed files, each §25 row you wrote with the code file:line that confirms each
  name, every name you could not confirm, tests with results.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never pipe vitest
  into `head`. Do not start a dev server.
