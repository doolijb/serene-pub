# BRIEF — build lane `ap-2` — a provided lorebook belongs to its source: nobody writes it, and a new session copies it at start (owner rulings AP1, AP2 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the block "Rulings page, third round, second answers" in
`plans/PLAN-programme-2026-11-15.md`, `plans/REPORT-ap-1-2026-11-17.md` (`canWriteLorebook`, the AP1 pin test,
the disabled-lorebook dead end, "Scope review fix"), `plans/briefs/BRIEF-ap-1.md` (its cold review
corrections: the book lock, the retired clone verb, the cases that exist, `providedMarks.ts`),
`plans/REPORT-lb-1-*.md` (provided books kept in use on uninstall, `bookDeleteRefusal`),
`docs/lorebooks.md` (provided lorebooks, starters, **New world**, sharing), `docs/sessions.md` (starting on a
lorebook), `docs/system-settings.md` / plugin docs where they describe a plugin's lorebooks,
`NOMENCLATURE.md` §1, §24, §23 (retired words) and rows **provided lorebook**, **starter**, **New world**,
**notes**, `canWriteLorebook`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only; never `--write`, never pipe prettier's output into a file. **No migration, no boot pass, no
rewrite of stored rows** (existing sessions are an open owner question, AP3). Inside `db.transaction` only
`tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ap-2-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.
Comments state the rule, never the history. Views never toast. Live lanes, not yours: `gs-3b`
(`sockets/sessions.update.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`, `sessions/seatName.ts`, seat
components, `EditSessionForm.svelte`), `dg-1-fix` (`pipelines/runtime/haltExplanation.ts`,
`utils/runReply.ts`, `sockets/sessions.pipelines.ts`, `sockets/utils/broadcastHelpers.ts`,
`messages/debugMeta.ts`, `utils/generationStatus.ts`, `utils/activityStore.ts`). `shared/sockets/types.ts`,
`docs/sessions.md`, `NOMENCLATURE.md` are shared: re-read right before each edit.

## Owner (2026-11-17)

AP1: "The plugins and core catalogues starter lorebooks are not owned by users, but by the source. Admins have
limited management and can't mutate or delete them, only disable them or remove the plugin. To mutate, the
admin/user clones it first"
AP2: "Let's just clone the starter lorebook instead on session start so we are never superimposing on something
that can get deleted."
Standing: starters are disabled, never deleted; plugin books are starters (2026-11-05: "nobody's play (the
enabling admin's included) touches the original"); a session keeps the lorebook it started with; every session
has a lorebook; 0.6 is in users' hands; "Clone with changes and attach" is retired (the existing copy paths
are **New world** / starter copy at start and **Merge ‹book› into these notes**: use those, coin no verb).

## Lead's reading (each ★ in the report)

- **AP1: nobody writes a provided lorebook.** A lorebook a plugin or core provides is stored with the
  enabling administrator as `userId` (`plugins/providedBooks.ts` 5–8). That stays as stored (no migration),
  but **`canWriteLorebook` answers no for a provided lorebook, for everyone**, so Apply, Take back, the
  automatic Apply, direct session writes (`loreWriteRoute`) and every entry / cast / link / knowledge edit
  from the lorebook's own screens are refused, in words that say whose it is and what to do (make your own
  copy). What an administrator may still do: disable it, enable it, remove the plugin (as today).
  Delete: refused (`bookDeleteRefusal` or its neighbour: find what a delete of a provided lorebook does today).
- **AP2: a new session never plays directly on a provided lorebook.** Starting a session on one copies it at
  start, exactly as starting on a starter does today (find that path: `sessions.create.ts` ~178–217,
  `duplicateLorebookRows`, `kitReadRefusal`; reuse it, no second copy mechanism), and the session plays on
  the session owner's own copy. The start form's words for a provided lorebook match what a starter says
  today.
- **Existing sessions on a provided lorebook are not touched** (AP3 is open): they keep reading it; the Apply
  review there shows the closed sentence and the existing **Merge** as built by `ap-1`.

## Build

1. **The write rule.** Extend `canWriteLorebook` (`utils/ownedBook.ts`) so a provided lorebook is not writable
   by anyone. It is pure over (person, lorebook row) today: find how "provided" is known for a row
   (`plugins/providedMarks.ts`, a column or a marks lookup); if it needs a lookup, keep the predicate pure by
   passing the fact in, and resolve the fact where the row is loaded (`findOwnedBook` and the four Apply
   sites), adding no statement on the reply path (the automatic Apply and `loreWriteRoute` run per reply:
   say what it costs; both prompt baselines' statement counts must not rise: paths in
   `plans/REPORT-perf-4-2026-11-17.md`). Then the callers the review of `ap-1` listed as standing apart:
   the eight `book.userId !== input.userId` checks in `entryKnowledge.ts` and any other lorebook-screen write
   door that does not go through `findOwnedBook` / `assertOwnedBook`: route them through the predicate (list
   each). The refusal sentence for a provided lorebook: reuse an existing one if it fits; else one new
   sentence (★ with one alternative), the same at every door.
2. **Flip the AP1 pin** in `lorebooks/applyWritePredicate.int.test.ts` (the test named "AP1 (open) …"): the
   enabling administrator's own session no longer applies into the provided lorebook; rename the test to
   state the rule.
3. **Client.** A provided lorebook opened by the enabling administrator shows its entries read-only, the way
   it shows for any other person today (find that state: `providedBooksReadableBy`, the "provided" badge),
   with the existing way to make a copy offered; edit controls absent, not disabled. No new screen.
4. **Start on a copy.** `checkLorebookOwnership` (`sockets/sessions.shared.ts` 119–141) admits "a book you own
   or a live provided book": a provided book chosen at start is copied like a starter and the session is
   created on the copy. The start form (`StartSessionForm.svelte`: not a live lane's file) says what a
   starter says today. A session **branch / next chapter** of an existing session on a provided lorebook
   keeps its lorebook (the book lock; unchanged). Report what the copy keeps (timeline switch, cast, covers,
   knowledge ties, sprites) by reading the existing starter-copy path.
5. **Docs and names:** `docs/lorebooks.md`, `docs/sessions.md`, the plugin doc that describes provided
   lorebooks; NOMENCLATURE rows **provided lorebook** (charter: owned by its source; nobody writes it; copied
   at session start) and `canWriteLorebook`; §25 quoting AP1 and AP2; note in §25 what this replaces
   (playing on a live provided lorebook pub-wide) with the earlier ruling's date if the row cites one.

## Tests

The predicate table gains provided × (enabling administrator / another administrator / member). Every write
door × provided lorebook × enabling administrator: refused in the one sentence, nothing changed (Apply, Take
back, automatic Apply does nothing, an entry edit, a cast edit, a link, a knowledge tie, delete). Disable /
enable / plugin removal still work. Starting a session on a provided lorebook: one copy owned by the session's
owner, the session's lorebook is the copy, the provided lorebook's rows are byte-identical, a second session
makes its own copy. An existing session on a provided lorebook (rows inserted as today's code creates them)
still reads it and still merges. Both prompt baselines unchanged, statement counts not higher. A second boot
changes nothing. Client DOM: the enabling administrator's read-only view; the start form's words. `tsc` 0;
`npm run check` 0 errors in lane files.

## Files owned

`utils/ownedBook.ts`, `lorebooks/ownBook.ts` (the Apply sites and `loreWriteRoute`), `lorebooks/entryKnowledge.ts`
(the ownership checks), other lorebook write doors found in step 1 (their ownership line only),
`plugins/providedMarks.ts` / `providedBooks.ts` (read helpers only), `sockets/sessions.shared.ts`
(`checkLorebookOwnership`), `sockets/sessions.create.ts` (the start path for a provided lorebook),
`StartSessionForm.svelte` (the provided-lorebook words), the lorebook workspace's read-only state for the
enabling administrator, tests, the docs, NOMENCLATURE.

## Stop and ask when

CLAUDE.md §Decisions applies; "provided" cannot be known without a per-reply read; the starter-copy path
cannot copy a provided lorebook as it is (say what is missing); making the enabling administrator read-only
would hide a management action they have today (disable, enable, plugin settings); an existing session would
stop working; anything would rewrite stored rows.

## Report

Final message = the report (lead saves `plans/REPORT-ap-2-<date>.md`), under about 650 words: how "provided"
is known and what it costs; the doors and the one sentence; the start path (what is copied); what the enabling
administrator sees; existing sessions (unchanged: how you know); every new sentence as ★ with one alternative;
the readings as ★; **Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

**The lane is cut. This brief builds `ap-2a`: the write rule. The start path (AP2) is `ap-2b`, briefed after
this lands: build nothing of "Start on a copy" here, and no client screen beyond what item 1 changes.**

1. **The read-only mechanism already exists: extend it, add no second one.** `primerRowEditProblem`
   (`src/lib/server/plugins/providedMarks.ts` 157–182) is "the one decider for 'a person may not edit this
   book'"; about 66 doors in 15 socket files call it (`entries.ts`, `amendments.ts`, `scenes.ts`,
   `narrativeGraph*.ts`, `sockets/entryKnowledge.ts` 76–79, `lorebooks:update` at `sockets/lorebooks.ts`
   1041–1044, import-overwrite 6039–6040); it never runs for the plugin syncs or for disable / enable. Its
   words: `primerRowEditRefusal` (`src/lib/shared/lorebooks/primerRow.ts`; client
   `client/lorebooks/starterKitCards.ts:67`). The client state: `readOnly` on the list row and the open book
   (`sockets/lorebooks.ts` 531, 862; `shared/sockets/types.ts` ~8670). Delete of a live provided lorebook is
   already refused (`sockets/lorebooks.ts` 1254–1257). So AP1 already holds for core and plugin **primers**
   (kind `starter_kit`); the gap is a plugin's `provides.lorebooks` rows of kind `book`, excluded by a kind
   test at three places: `providedMarks.ts:176`, `lorebooks.ts:531`, `lorebooks.ts:862`. **Build: drop the
   kind test at those three places** so every live provided lorebook is read-only to people, the enabling
   administrator included. The sentence today says "This starter lorebook comes with…": generalise it to fit
   any provided lorebook (★ with one alternative; one sentence, used by server and client).
2. **`findOwnedBook` stays about ownership only**: do not put "provided" into it (every door calls it first
   and would answer "Lorebook not found." before the worded refusal). `canWriteLorebook`
   (`utils/ownedBook.ts`) takes the provided fact as an argument and answers no for a provided lorebook **at
   the Apply and write-routing sites only**: `lorebooks/ownBook.ts` Apply, Take back, automatic Apply,
   `overlayAccessOf`, and `loreWriteRoute`, whose facts come from its own `select userId` at ~445–451, 535,
   569, 3254: fold the provided fact into those existing selects (the row's `uuid`, `extra_json` mark, and an
   `EXISTS` on `plugins` for "owner present") so **no statement is added per reply** (prompt baselines'
   counts must not rise). The "eight checks in `entryKnowledge.ts`" already pass through `findOwnedBook`
   (`lorebooks/entryKnowledge.ts` 498–500) and their socket layer already calls the primer check: nothing to
   route there; delete that item.
3. **"Provided" means what the existing deciders mean: the row carries its own mark AND its owner (the plugin
   or core) is present** (`providedMarks.ts:177`, `lorebooks.ts:1256`, `providedBooksReadableBy`). A lorebook
   **kept at uninstall** because sessions still read it (mark kept, `disabled` dropped, `providedBooks.ts`
   1532–1536) has no owner present: it is the administrator's ordinary lorebook, writable and deletable as
   delete already treats it (★ in the report).
4. **One more write door:** the delete safeguard in `state/durable.ts` 183–191 writes into the attached
   lorebook on an inline `bookOwnerId !== sessionOwnerId` test, bypassing `loreWriteRoute` and
   `canWriteLorebook`: route it through the predicate with the provided fact.
5. **Flip the AP1 pin** as in Build 2 above.
6. **Not changed, reported as ★:** a plugin's newer version of a provided lorebook is applied as a diff under
   the enabling administrator's write mode (`providedBooks.ts` 26–45, `state/loreWriteMode.ts` 45–53; the
   lorebook's own column is set through `lorebooks:update`, which the read-only rule now refuses). Under
   Review changes or Off the update is only held, and nobody can apply it any more. Asked on the rulings page
   (AP4). Leave `syncProvidedBooks` and the write-mode column exactly as they are; say what an administrator
   sees.
7. **Enable, disable, plugin removal** (`setProvidedBookDisabled`, `deleteProvidedBooks`, `syncProvidedBooks`)
   use neither `findOwnedBook` nor `canWriteLorebook`: confirm by test that all three still work.
8. **Files owned (`ap-2a`):** `plugins/providedMarks.ts` (the kind test), `sockets/lorebooks.ts` (lines ~531
   and ~862 only), `shared/lorebooks/primerRow.ts` (the sentence), `client/lorebooks/starterKitCards.ts` if
   the sentence's use needs it, `utils/ownedBook.ts`, `lorebooks/ownBook.ts` (the Apply sites and the
   `loreWriteRoute` selects), `state/durable.ts` (that one test), `lorebooks/applyWritePredicate.int.test.ts`
   and other tests, `docs/lorebooks.md` and the plugin doc sentence about editing a provided lorebook,
   NOMENCLATURE (rows **provided lorebook**, `canWriteLorebook`; §25 quoting AP1 and the 2026-11-05 ruling
   "There's no such thing as a pub wide book, unless it's a primer/starter … And plugins books are starters",
   `plans/PLAN-sdk-creation-seams-2026-10-30.md:503`). Live lanes, not yours: `wt-1a` (`scenes/liveScenes.ts`,
   `utils/sceneCast*.ts`, `sockets/scenes.ts` review seed, `utils/activityStore.ts`), `dg-2`
   (`messages/debugMeta.ts`, `sockets/sessions.messages.ts`, `pipelines/runtime/liveRow.ts`,
   `utils/runReply.ts`, `utils/generationStatus.ts`).
9. **Tests:** every door family × a live provided lorebook of kind `book` × the enabling administrator →
   refused with the one sentence, nothing changed (an entry edit, a scene edit, a cast edit, a knowledge tie,
   `lorebooks:update`, import-overwrite, Apply, Take back, the automatic Apply does nothing, the delete
   safeguard, delete); a primer behaves as before; a kept-at-uninstall lorebook is writable; enable / disable
   / removal / sync work; the list row and the open book carry `readOnly` for a kind-`book` provided
   lorebook; both prompt baselines unchanged, counts not higher.
