# BRIEF — `time-t4b` worker 6 — docs, NOMENCLATURE and STYLE-GUIDE for the cast member's versions rail

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4b`. The rules section at the end of this file is part of this brief. You edit prose only; no code.

## What was built (describe this, in plain words, for people)

In a lorebook that keeps a timeline, a cast member's **Member** tab now shows the member's versions on the same rail as an entry's (lane `time-t4a`, already documented under "Versions of an entry" in `docs/lorebook-time.md`):

- The rail lists *From the beginning* (the member before any dated change), then each dated version in story order. Wide, a list beside the fields; narrow, a strip of chips above them. Selecting one shows that version in the form and moves the moment bar to its date. The page opens on the version in force at the lorebook's present (or at the moment being read).
- **Save** saves the version selected. **Save as a new version…** asks for a date and saves what you changed as a version starting then, on the line you're reading; a date that already has your version says *‹date› already has a version on this line. Saving changes that version.* **+ Add a version here** (between versions) does the same at a date in that gap. Both need a change first (*Change something first: a version holds what differs from the one before.*): a version holds what differs from the one before.
- A dated version of your own: **Change its date**, **Delete this version** (*Delete the version dated ‹date›? From then on ‹name› reads as the version before it, and this version's edit history goes with it.*).
- **Several versions at one date** are each their own row, with a chip saying what each is: *written in ‹session›* (or *written in a session* when you can't open it), *at ‹n› in their life* for a version dated against their own life, *at every point in their life* otherwise; the one the lorebook reads at that date says *read at this date*. A version a session wrote is shown and selected only: it is changed from that session (Save says *A session wrote this version, so it is changed from that session.*).
- On a line forked from another, the versions it inherits say *from ‹line›* with **Open on ‹line›**, and Save is off for them (*This version is ‹line›'s; open it on ‹line› to change it.*); **Save as a new version…** still adds this line's own. Versions on lines this one doesn't read are under **Elsewhere**.
- **Change later versions too** and *N later versions keep their own words.* apply to Save of the selected version (for *From the beginning*: the dated versions on main; for a dated one: the later ones on its line).
- The name in this book, the nickname in this book and the voice are not dated: whichever version is selected, they save to the member as the lorebook's present has them (as before).
- The card's **Change** / **Unlink** and their dated sentence are unchanged.
- Each version's **Edit history** rows sit under it on the rail for the version selected (only that one asks for its history), behind the **Edits** toggle; narrow, in a fold under the fields (*Edits to this version · ‹n›*).
- With the timeline off: no rail, no dates; one plain form whose Save saves the member as before, with its Edit history fold.
- A reader of a shared lorebook can select versions to read them; nothing is saved.
- Gone from the member page: **Save as of ‹date›**, its menu's **Change the member**, and the *Amendments* list under the tabs. (A history entry keeps its Save as of, Change the base and list.)
- The moment bar's sentence while reading at a date is now one sentence for entries and cast members: *Saving here changes the version this date shows; Save as a new version… adds one.*

## Files owned (edit only the passages named; never rewrite a file)

- `docs/lorebook-cast.md`: "A member's page" (~28–50, the *Amendments* bullet at ~41) and "Changing a member over time" (~142–157): rewrite to the rail; keep the card-change and lore paragraphs that still hold (check each sentence against the list above).
- `docs/lorebook-time.md`: the "Dated saving" bullet (~47: the cast member's **Save as of** / **Change the base** become the cast member's versions rail), the moment bar sentence (~107), and in "Versions of an entry" (~113–139) one short paragraph or line pointing to the cast member's versions in `lorebook-cast.md` (keep the anchor `#versions-of-an-entry`).
- `docs/lorebooks.md`: the cast member's Edit history paragraph (~84: "under the dated changes" no longer holds; rows sit under the selected version on the rail; Restore is off while the form has unsaved changes, as before).
- `docs/characters.md`: only if a sentence describes the member page's dated saving (check ~139; change nothing otherwise and say so).
- `NOMENCLATURE.md` (**by Edit only, never rewrite the file; another session is adding its own §25 rows at the same time, so re-read just before each Edit and touch only your lines**):
  - §8 **entry version** row (~382): its "Does not own … the cast page's dated changes (lane `time-t4b`)" becomes that the **version rail** also draws a member's **cast versions** on the member page (`castVersions`, `cast/castVersions.ts`, ordered by the server's reader `versionInForce`, one node per version even at one date), and that `RailVersion` / `RailElsewhere` are the rail's subject-neutral shapes. Keep R3: *cast version* qualified.
  - §23 row ~1693 (**Save as of ‹date›** · **Change the base** · *Amendments*): its "⚠ Still drawn … on the cast member page until lane `time-t4b`" becomes retired there too (2026-11-14, lane `time-t4b`), with the cast page's **Change the member** named; History keeps them.
  - §25: a new `###` section after the `time-t4a` one ("an entry's versions on a timeline rail — 2026-11-14 …", ~3901), titled like it: *a cast member's versions on the rail — 2026-11-14 (owner rulings 2026-11-13 "make a pass on cast history … familiar across the entire lorebook", "provide a vertical time view like i suggested for other entries"; 2026-11-14 "Yes, move the moment bar", "The selected version", "Each as its own node"; lane time-t4b)*, a `| Was | Is | Why/where |` table, with rows for (all 🚧):
    - the cast page's **Save as of ‹date›**, **Change the member** and *Amendments* list → the rail; labels and sentences as listed above;
    - wire: `CastRowVersion.baseVersionId` (and the client `CastRow.baseVersionId`), `UpdateBinding.Params.castVersionId` (only the base's id is accepted; it writes the base; absent = the version at the book's present, as before) with its refusal *That version can't be saved here: only this cast member's first version is saved from the member page.*, `Amendments.CastRow.writeOrder`, `sourceSessionId`, `sourceSessionName` (named only to someone who may open the session);
    - rail: `RailVersion` (`movable`, `editIds`, `locked`, `chip`, `readHere`), `RailElsewhere`, `VersionRail` props `onRedate`, `onDelete`, `describe`, `deleteSentence`, `takenAt`, `addBlocked`, `defaultDeleteSentence`; *read at this date*; `VersionDateDialog`'s `taken` takes any subject;
    - cast helpers: `CastVersion`, `CastElsewhere`, `castVersions`, `castVersionChip`, `castVersionAt`, `castTakenAt`, `castLaterCount`, `UNDATED_MEMBER_KEYS`, `castVersionSave`, `castNewVersionSave`, `castChangesWords`, `castDeleteSentence` (`cast/castVersions.ts`), `rowAtVersion` (`cast/castVersionRead.ts`), `updateCastAmendment`, `fileCastVersion`, `deleteCastAmendment` (`cast/castSave.ts`), field words *the name in this book*, *the nickname in this book*, *the voice*; `CastMemberForm` props `onSaveNew`, `onSaveAt`, `saveOff` and its `discard()` / `saveNewAt()`;
    - copy: the chips, *changes ‹fields›* for a member, the delete sentence, the two Save-off sentences, *Change something first: …*, *The version could not be saved.*, *Saved as a new version at ‹date›[ on ‹line›]*, *The version was not saved*;
    - removed: `ENTRY_MOMENT_SAVE_SENTENCE`, `momentSaveSentence`, `MomentBar`'s `onCast`; `MOMENT_SAVE_SENTENCE` now holds the versions sentence; `CastMemberForm`'s `onAmend`;
    - a last row: *No new setting, socket event, migration or published SDK name.*
  - Also add one bullet in the `## 25` dated list only if the file's convention for this kind of lane is a bullet rather than a `###` section (look at what `time-t4a` did and do the same; do not do both).
- `STYLE-GUIDE.md`: §6.1 (~776–779): the split-button example is now a history entry's **Save as of** in the lorebook editor alone (`EntryWorkspace.svelte`, `amendSave`), the cast member form no longer; §6.19's version rail paragraph (~2240): it is the partner of the entry form **and the cast member page**; add one sentence: several versions at one date are each a row, with a chip under the date (`text-surface-700-300 text-xs`) and *read at this date* on the one read there; a version changed elsewhere (a session's) is shown and selected only; §6.14's railed sentence (~1873): "a lorebook entry drawn with its entry versions" also covers a cast member's versions.

## Rules for the prose

- STYLE-GUIDE §10: sentence case; plain words; a button is named as it reads, in bold; quoted sentences in italics; one name per thing; it is a **session**, never a chat. No other product's name anywhere (no "SillyTavern" etc. in new text).
- Keep 🚧 where the docs mark provisional behaviour, as the `time-t4a` passages do.
- Change only the passages named; leave other paragraphs as they are, even if you would word them differently (put those under Noticed).
- Run `npx prettier --check` on nothing here (prose files are not formatted by it in this repo unless the file already is; do not run `--write`).

## Done means

Each named passage matches the list above; no reference to the cast page's **Save as of** / **Change the member** / *Amendments* list remains in the four docs except as history ("gone"); NOMENCLATURE edits are only yours. Report every passage changed (file and heading), and any sentence in the docs you found that contradicts the list but was outside your passages.

---

# Rules every `time-t4b` worker works under (quoted by the supervisor; read with your own brief)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Owner rulings (verbatim)

- 2026-11-13: "Also make a pass on cast history and make sure it behaves similar so it's familiar across the entire lorebook."
- 2026-11-13 (the vertical time view): "Also provide a vertical time view like i suggested for other entries."
- 2026-11-13 (versions): "show the option to change the effective date of that version. Save edits that version, but also need a button to save as a new dated version … navigate the dated versions like a vertical timeline, adding new versions before or after."
- 2026-11-14: the chosen screen (the rail beside the fields, a strip when narrow) and "Yes, move the moment bar".
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled": with the Timeline off, no rail, no dates; one plain form with its edit-history fold.
- 2026-11-14: **Save writes the selected version** ("The selected version"). The page still OPENS on the version in force at the lorebook's present; after a version is picked on the rail, Save writes that one.
- 2026-11-14: **several versions at one date: "Each as its own node."**
- Standing: cast members get no Beginning and no Decay; members never see or touch model plumbing; it is a **session**, never a chat.

## Hard rules (each has cost data or hours)

- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- `socket.off(event)` with no handler removes every listener app-wide: always `socket.off(event, handler)`.
- Views never call `toaster`/`notify` for socket replies they did not ask for; the page's own awaited write may say how it went through `notify` as it does today. Refusals are toasted by the shell.
- An event in `SCOPED_EVENTS` must carry its scope key (`lorebookId`, …) in the payload.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- No migration, no new socket event, no new setting. Stop and report instead.
- Comments state the rule, not the story (no "lane X added", no "was …").
- Never `prettier --write` a whole file; format only the lines you changed (check with `npx prettier --check <file>` and leave unrelated hunks alone).
- Edit only the files your brief owns. Anything else you need goes in your report.
- Every new name, label, sentence or prop goes in your report's list (the supervisor records them in NOMENCLATURE §25); mark new copy 🚧 in a comment where the sentence is defined.

## STYLE-GUIDE rules (quoted)

- §5.3 / §6.19: the rail is one component, two layouts from its own box (`@container/versions`, two columns at `@min-[36rem]/versions:`, never the viewport). Wide: a vertical list of buttons beside the fields, the selected one `aria-current`, quiet **+ Add a version here** buttons between them named for where they add (*Add a version between Year 7 and Year 9*), each version's edit rows under it behind an **Edits** toggle (`preset-pressed`, `aria-pressed`). Narrow: a row of chips above the fields (`preset-pressed` when selected). The fields render once in both.
- §6.1: one primary button per surface (`preset-filled-primary-500`); a destructive action is never the primary; removing something saved is `preset-tonal-error`.
- §6.14: unsaved means different from what is saved; "Ask first, then discard — never the other way round": a selection change that would close an edit awaits `loreRoute.confirmLeave()` and only on Leave drops the draft. On a railed form a move of the moment bar that would show another version asks once and, on Stay, puts the moment back.
- §9: every interactive element is a real `button` with an accessible name; never an interactive inside an interactive; `aria-current` on the selected row; nothing hover-only; 44px targets on touch (`min-h-11`, `pointer-coarse:min-h-11`).
- §10: sentence case; a button says what happens; help is one sentence; one name per thing.

## Tests

Run only your targeted files, from the repo root, one at a time, each as:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t4b-<name>.log 2>&1"`

Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait while one runs (another session runs tests in this checkout). Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors in your files).

Another Claude session is editing `src/lib/client/components/Layout.svelte`, `components/pipelines/**`, `components/modals/{CharacterCreatorModal,CharacterSelectModal}.svelte`, `src/routes/+page.svelte`, `src/lib/shared/utils/docsPages.ts`: never touch them; errors there are not yours.

## Report

Your final message: changed files; what you built against each numbered item of your brief; tests run with pass/fail counts and log paths; every name, label and sentence added; anything you could not do or decided (with the reason); Noticed, not done.
