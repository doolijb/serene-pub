# BRIEF — build lane `ap-2b` — a session starts on its own copy of a provided lorebook; existing sessions are offered the merge; a provided lorebook always takes its source's updates (owner rulings AP2, AP3, AP4 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the three "Rulings page, third round" blocks in
`plans/PLAN-programme-2026-11-15.md` (AP1–AP4), `plans/REPORT-ap-2a-2026-11-17.md` (incl. "Follow-up fix":
the write rule, `liveProvidedBookSql`, what "provided" means, the kept-at-uninstall case),
`plans/REPORT-ap-1-2026-11-17.md` (the closed Apply card and the **Merge** link; the disabled-lorebook dead
end), the cold-review sections of `plans/briefs/BRIEF-ap-2.md` (objection 2: the two copy paths) and
`BRIEF-ap-1.md` (the book lock; the retired clone verb), `plans/PLAN-sdk-creation-seams-2026-10-30.md`
~500–512 (the 2026-11-05 rulings), `docs/lorebooks.md`, `docs/sessions.md`, `docs/plugins.md`,
`NOMENCLATURE.md` §1, §24, §23 and rows **provided lorebook**, **starter lorebook** / **starter kit**,
**primer**, **New world**, **notes**, **Merge … into these notes** / fold.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. Never run
prettier with `--write` or pipe its output into a file. **No migration, no boot pass, no rewrite of stored
rows.** Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ap-2b-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK build, no full run, no
`npm run build`. Comments state the rule, never the history. Views never toast.

## Owner

2026-11-17 AP2: "Let's just clone the starter lorebook instead on session start so we are never superimposing
on something that can get deleted." AP3: "Leave them as they are and offer the merge, also when the lorebook
was switched off". AP4: "A provided lorebook always takes its source's updates". AP1: "The plugins and core
catalogues starter lorebooks are not owned by users, but by the source … To mutate, the admin/user clones it
first".
2026-11-05 (still standing; AP2 confirms it): "There's no such thing as a pub wide book, unless it's a
primer/starter … And plugins books are starters"; "Plugins can only ship lorebooks as starters. They contain
cast, not cards."; existing sessions on a plugin's lorebook "keep reading it".
Standing: a session keeps the lorebook it started with; every session has a lorebook; starters are disabled,
never deleted; 0.6 is in users' hands (a second boot changes nothing).

## Build

1. **AP2 — start on a copy, by the starter path.** Two copy paths exist: the **starter path**
   (`lorebooks/starterKits.ts` 435–489: `resolveKit` → `bookFromKit` copies the kit **into the session's
   notes**; the session gets no attached lorebook; the provided mark is removed; cast is copied card-less,
   `makeCopyCardless`; `afterKitCopy` sets the cover) and **New world** (`duplicateLorebookRows`,
   `sockets/sessions.create.ts` 744–756: a standalone "‹name› (copy)" lorebook with the notes on top, keeping
   real `characterId`s, which would share a plugin's hidden carrier cards). **Use the starter path** ("They
   contain cast, not cards"). Today `resolveKit` / `kitReadRefusal` accept only kind `starter_kit`
   (`starterKits.ts` 164–169, 272–276) and a live provided lorebook of kind `book` chosen at start is read
   directly (`sockets/sessions.shared.ts` 119–141 `checkLorebookOwnership`, 126–127). Change: a **live
   provided lorebook of any kind** chosen at start goes down the starter path (let `resolveKit` /
   `kitReadRefusal` accept it; `checkLorebookOwnership` no longer admits a provided lorebook as the session's
   attached lorebook); the client's book pick sends a provided lorebook as `lorebookId`
   (`client/components/sessionForms/createSession.svelte.ts:570`): send it the way a starter is sent, and the
   start form says for it what it says for a starter today (no new copy). A branch / next chapter of an
   existing session keeps its lorebook (unchanged). Report what the copy keeps (timeline switch, cast, covers,
   knowledge ties, sprites, places) by reading `bookFromKit`.
2. **AP3 — existing sessions.** A session that already reads a provided lorebook is left exactly as it is
   (no rewrite). Its Apply card already shows the closed sentence and **Merge ‹book› into these notes** (lane
   `ap-1`). Make the merge work **also when the lorebook was switched off** (or its plugin disabled) while
   the session still reads it: today `providedBooksReadableBy` (`plugins/providedMarks.ts` 227–257) leaves
   disabled lorebooks out, so `assertReadableBook` refuses the merge with "Lorebook not found."
   (`lorebooks/foldInParent.ts` ~1707–1714). Change only this: **a session's owner may read, for the merge,
   the lorebook their own session already reads** (the session's stored link is the proof; no wider read
   access: the Lorebooks view and other people are unchanged). The card's sentence for that case: reuse the
   existing closed sentence; if it reads wrong for a switched-off lorebook, one new sentence (★ with one
   alternative). After a merge the session no longer depends on the provided lorebook (verify what
   `foldInParent` leaves).
3. **AP4 — a provided lorebook always takes its source's updates.** `plugins/providedBooks.ts` 26–45 applies a
   newer version as a diff under the enabling administrator's write mode (`state/loreWriteMode.ts` 45–53
   `bookLoreWriteMode`): under Review changes or Off the update is only held, and nobody can apply it now
   that the lorebook is read-only to people. Change: the source's own sync writes the provided lorebook
   **whatever anyone's write mode** (the sync is the source, not a person's play); anything previously held
   from a plugin update for a provided lorebook is applied by the next sync (say how: the sync recomputes
   from the source, so held rows for that lorebook from earlier syncs are superseded: find what they are and
   make sure none is left dangling; no boot pass: it happens when the sync runs, as today); "a person's edit
   wins over the plugin's update" no longer has a case for a live provided lorebook (nobody edits it): a
   lorebook kept at uninstall is the administrator's ordinary lorebook and is not synced (unchanged).
   Sessions are not changed under a player by this: new sessions play on copies; an existing session that
   still reads the provided lorebook does see the update (as it always did under Full): say so in the docs.
4. **Docs and names:** `docs/lorebooks.md`, `docs/sessions.md`, `docs/plugins.md`; NOMENCLATURE rows
   **provided lorebook** (charter: owned by its source; nobody writes it; always its source's current
   version; copied into the notes at session start), the starter path's row if it names kinds; §25 quoting
   AP2, AP3, AP4 and the 2026-11-05 rulings.

## Tests

Start on a live provided lorebook of kind `book` and of kind `starter_kit`: the session's notes hold the copy,
the session has no attached provided lorebook, cast is card-less, the provided lorebook's rows are
byte-identical, a second session makes its own copy; `checkLorebookOwnership` refuses a provided lorebook as
an attached lorebook (forged request). A branch of an existing session on a provided lorebook keeps reading
it. Existing session (rows as today's code creates them) on a live, a disabled-lorebook and a
disabled-plugin case: still plays; the merge works in all three; another person still cannot read the
disabled lorebook; the Lorebooks view is unchanged. Sync: with the administrator's mode at Review changes and
at Off, a plugin update lands in the provided lorebook; earlier held update rows are gone or superseded;
a kept-at-uninstall lorebook is not touched. Both prompt baselines unchanged; statements per reply not
higher. A second boot changes nothing. Client DOM: the start form's words for a provided lorebook. `tsc` 0;
`npm run check` 0 errors in lane files.

## Files owned

`lorebooks/starterKits.ts` (`resolveKit`, `kitReadRefusal`, what the copy needs), `sockets/sessions.shared.ts`
(`checkLorebookOwnership`), `sockets/sessions.create.ts` (the start path), `client/components/sessionForms/
createSession.svelte.ts` and `StartSessionForm.svelte` (the provided-lorebook pick and words),
`plugins/providedMarks.ts` (`providedBooksReadableBy` only as far as item 2 needs: prefer a narrow new read in
`foldInParent.ts` over widening it), `lorebooks/foldInParent.ts` (the read check for the merge),
`plugins/providedBooks.ts` (the sync's write mode), tests, the docs, NOMENCLATURE. Live lanes, not yours:
`dg-1d-1` (`pipelines/runtime/host*.ts`, `runTurn.ts`, `haltExplanation.ts`, `utils/runReply.ts`,
`sockets/sessions.pipelines.ts`, `sessions/seatName.ts`, `sessions/seats.ts`), `ss-3b-2` (prompts, the
settings form, the pipeline panel), `small-1` (`state/handEdits.ts`, `messages/debugMeta.ts`,
`sockets/utils/broadcastHelpers.ts`, session page projections, `SessionViewPanel.svelte`). Shared files
(`shared/sockets/types.ts`, `docs/*`, `NOMENCLATURE.md`): re-read right before each edit.

## Stop and ask when

CLAUDE.md §Decisions applies; the starter path cannot copy a kind-`book` provided lorebook as it is (say what
is missing); an existing session would stop working or be rewritten; the merge of a disabled lorebook would
need wider read access than "the lorebook my own session reads"; the sync cannot ignore the write mode
without also ignoring a person's hand edits to an **ordinary** lorebook.

## Report

Final message = the report (lead saves `plans/REPORT-ap-2b-<date>.md`), under about 650 words: the start path
(what is copied, what the session holds afterwards); existing sessions (unchanged: how you know; the merge in
the three cases); the sync (before → after, held rows); every new sentence as ★ with one alternative;
**Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

**AP4 (the sync) is cut out of this lane**: build nothing of Build 3. Under Full the sync keeps any row a
person edited or deleted ("the person edited it: the person wins", `plugins/providedBooks.ts` 1426–1431,
1135–1147, 1286–1288, 1359), and such rows exist in 0.6 data (the enabling administrator could edit these
lorebooks until today). Whether the source overwrites them is asked on the rulings page (AP5). This lane
builds AP2 and AP3.

1. **The copy itself works for kind `book`.** `bookFromKit` with a book row (`lorebooks/starterKits.ts`
   466–489) does `duplicateLorebookRows`, strips the `provided` mark, and `makeCopyCardless`: no kit manifest
   needed. `resolveKit` (163–175) and `kitOfRow` stop filtering on kind for a **live provided** row.
   `shapeViolations` has no "requires a lorebook" (`pipelines/entities/sessionGenres.ts` 362–367).
2. **A next chapter keeps its lorebook.** Next chapter runs the create checks: `sockets/sessions.create.ts`
   91–137 copies the followed session's `lorebookId` into `params.session`, then `kitReadRefusal` (174–177,
   refused at 208) and `checkLorebookOwnership` (185–193; its **only** caller is `sessions.create.ts:186`).
   Exempt `creationMode === "next-chapter"` where the book is the followed session's own `lorebookId` from
   both changes. Branch returns earlier (71–89) and is safe. Test: a next chapter of a session on a provided
   lorebook still reads that lorebook.
3. **The cast must survive the copy** (owner 2026-11-05, `plans/PLAN-sdk-creation-seams-2026-10-30.md:509`:
   seating is "the session's book = the attached book, else its starter copy (for every genre that declares
   castFromLorebook…)"). On the starter path today the cast is lost in four places, so a genre that declares
   `castFromLorebook` (an out-of-repo plugin does; core's own genres: check) would start with nobody:
   the server seats only when `lorebookId != null` and before the copy exists (`sessions.create.ts` 494–509);
   the start form's cast picker keys on `lorebookId` (`StartSessionForm.svelte` 1218–1240); `castMemberIds`
   picked from the provided lorebook are refused as outside the books (`sessions.create.ts` 560–565); the
   confirm line keys on `lorebookId` (`StartSessionForm.svelte` 444–446). Build: seat from **the copy**
   inside the create transaction (the source's member ids mapped through `duplicateLorebookRows`'
   `maps.bindings`, or `bookCastToSeat` run on the copy: whichever keeps one seating code path); picked
   `castMemberIds` of the provided lorebook are accepted and mapped to the copy's members; the picker and the
   confirm line work for a provided lorebook sent as a starter. The payload is built at
   `createSession.svelte.ts:527` (`:570` is a doc comment): map a provided `lorebookId` to `starterKit` there,
   which covers the book pick and a plugin launcher's prefill (`StartSessionForm.svelte` 420–421). Tests: a
   fixture genre with `castFromLorebook` started on a provided lorebook of kind `book` seats the copy's
   members; picked members map; a genre without it is unchanged.
4. **AP3, the three cases are:** a **live** provided lorebook; a **switched-off lorebook**
   (`setProvidedBookDisabled`, the only writer of `disabled`, `sockets/plugins.ts:705`); a lorebook **kept at
   uninstall** (the mark kept, the plugin row gone, `providedBooks.ts` 1532–1536: the administrator owns it,
   so a **member's** session on it fails `lorebookAccessFor`, `utils/ownedBook.ts` 117–137, and the merge
   refuses with "Lorebook not found."). Disabling a **plugin** does not hide its lorebooks
   (`providedMarks.ts` 247–255, 301–319): add a check that nothing changes there. The narrow read: at the one
   check in `lorebooks/foldInParent.ts` 1707–1710, "`session.userId === userId` and the book is
   `session.lorebookId`" stands in for `assertReadableBook` (`lockAndRead`, 116–149, re-reads without an
   access check); nothing else widens. The merge works in all three cases for the session's owner.
5. **After the merge** `sessions.lorebook_id` is null and `overlayOf` is null (`foldInParent.ts` 1672–1682),
   but `copyLorebookTables` keeps real `characterId`s, so the notes' members still link to the plugin's hidden
   carrier cards (made card-less only at uninstall by `deleteProvidedBooks`). Report exactly what links
   survive a merge of a provided lorebook; if the merged notes still depend on the plugin's cards, make the
   merge of a **provided** lorebook copy its cast card-less as the starter path does (`makeCopyCardless`),
   so "never superimposing on something that can get deleted" holds after a merge too; say what you did.
6. Files owned gains nothing outside the list above; `plugins/providedBooks.ts` is **not** edited.
