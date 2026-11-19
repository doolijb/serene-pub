# BRIEF — build lane `el-1` — a manual lock on an entry or a cast member: no pipeline write changes it (owner ruling EL1 of 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). SDK: expected unchanged (say so first if a published name is
needed). Supervisor: read `.claude/guides/multi-agent.md`, then the EL1 lines in
`plans/PLAN-programme-2026-11-15.md` ("third answers" and the B2 confirmation), `docs/lorebooks.md`,
`docs/lorebook-cast.md`, the docs page on change history / edit history (grep `docs/` for "change history"),
`plans/REPORT-ap-2a-2026-11-17.md` (how one write rule was threaded through every door; the read-only
decider `primerRowEditProblem` and its ~66 doors), the memory of direct writes and change history (in
`NOMENCLATURE.md`: rows **change history**, **redline**, **lore write mode**, **Apply**, **held changes**),
`STYLE-GUIDE.md` (settings rows; one sentence of help; absent, never disabled), `NOMENCLATURE.md` §1, §24, §23.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. Never run
prettier with `--write` or pipe its output into a file. **One generated migration** (`npm run db:generate`
after the schema edit; its index must exceed the highest applied: check `drizzle/meta/_journal.json`; never
hand-write it; never seed a row at a fixed id; a second boot changes nothing). Inside `db.transaction` only
`tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/el-1-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK build, no full run, no
`npm run build`. Comments state the rule, never the history. Views never toast.

## Owner (2026-11-17)

"Optionally we can probably add a manual lock to all entry types so pipelines can't make edits to individual
locked entries" · "We can probably add a cast member lock as well to prevent pipeline edits to cast members,
I.e. a pipeline that adjusts cast member details over time" · EL1: "Build it now, as described" (the
description he approved: any entry of any entry type, and any cast member (their details, words and sheet),
gets a lock a person switches on; while it is on no pipeline write changes it; the write is refused and the
run's record says it is locked; a person can still edit it by hand; one new stored field and one check where
every pipeline write passes). Context: "hand edits aren't treated differently. Just keep a change history so a
user can overwrite." Principles: P1 (every automatic action shows its cause and how to switch it off), P2
(one writer per thing), P3 (a setting answers who changes it, why, what breaks without it).

## Lead's reading (each ★ in the report)

- **What can be locked:** a lorebook entry of every entry type (lore, a place, a scene, a history day, …:
  whatever lives in the entries table) and a lorebook cast member (the member's own words and details, its
  sheet values, its art). One boolean each, stored on the row (🚧 name by §24; ★ with one alternative).
- **Who locks:** whoever may edit that entry or member by hand today (the lorebook's owner; for a session's
  notes, the session's owner). A provided lorebook is read-only anyway.
- **What the lock stops:** every write to that row made **by a run** (a pipeline's lore write, a state /
  attribute write on a locked member's sheet, a routine that adjusts details, the automatic Apply landing a
  held change on a locked entry, a summary or history-day rewrite). **Not stopped:** a person's hand edit,
  Apply or Take back pressed by a person (★: Apply pressed by a person on a locked entry: allowed, since a
  person chose it; alternative: refused until unlocked), import, the plugin's own sync of a provided
  lorebook.
- **What a refused write does:** nothing is written; the run does not fail for it (the step's other writes
  proceed: check how today's refusals of a single write behave, e.g. a write to a line that is an amendment,
  `host.ts:493`, and do the same); the run's record says which entry or member was locked, in a sentence for
  the session's owner (★), through the mechanism lane `dg-1d-1` builds for sentences for people if it has
  landed (`plans/briefs/BRIEF-dg-1d.md`), else as today's refusal text.
- **Deleting:** a run cannot delete or archive a locked entry or member; a person can.
- **Where it shows:** a lock control on the entry's and the member's page beside the existing edit controls,
  with one sentence of help; a small lock mark on rows in lists (★); shown read-only to people who can see
  the row and cannot edit it; absent for a provided lorebook's rows.
- **Change history:** locking and unlocking is not a content change and writes no history row (★).

## Step 0 — the write doors (in the report, before code)

Every place a run can write an entry or a cast member, with file:line: the host's lore-write doors
(`pipelines/runtime/host.loreWrites.ts`, `host.ts` entry writes), state / attribute writes on a member
(`state/write.ts`), member detail writes (grep the cast writers under `src/lib/server/cast/`,
`lorebooks/`), scene and history-day writers that write entries, the automatic Apply
(`lorebooks/ownBook.ts` `applyHeldAutomatically`), summaries written back as lore, routines. For each: is
it a run's write or a person's (how the code tells: an acting person, `actingPerson`, a `cause`), and where
one check would cover it. **The lock is checked in the fewest places that cover every run write** (ideally
the two or three writers every door funnels through), never per call site. If a run write cannot be told
from a person's write at the writer, stop and report.

## Build

1. Schema: the two booleans, default false; generated migration; the row types.
2. The check, in the funnel writers Step 0 found; one function "is this row locked against runs" (pure over
   the row), so a later rule (e.g. lock a whole lorebook) widens one place.
3. Sockets to set and clear the lock (the existing entry / member update doors if they can carry the field:
   prefer that over new events), with the same access check as a hand edit; scoped replies carry their scope
   key.
4. Client: the control and the list mark, on the entry page and the cast member page; at 400 px too.
5. The refused write's sentence and where a person reads it (the run record; the Apply review if the
   automatic Apply skipped a locked entry: the held change stays held, and the review says it is held because
   the entry is locked).
6. Docs (`docs/lorebooks.md`, `docs/lorebook-cast.md`, the change-history page); NOMENCLATURE rows with
   charters (what the lock stops, what it does not, who sets it); §25 quoting the owner's three sentences.

## Tests

Per write door from Step 0: a run's write to a locked row writes nothing, the rest of the step proceeds, the
record names the row; the same write to an unlocked row works; a person's hand edit of a locked row works.
The automatic Apply skips a locked entry and keeps the change held. A run cannot delete a locked row. Lock and
unlock: only by someone who may edit; refused in words otherwise. The migration applies; a second boot
changes nothing. Both prompt baselines: fingerprints identical; statements per reply not higher (the lock
is read with the row the writer already loads: say how you know). Client DOM for the control and the mark.
`tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`db/schema.ts` (the two columns) and the generated migration; the funnel writers Step 0 names (their check
only); the entry and member update sockets; the entry page and cast member page components; tests; docs;
NOMENCLATURE. Live lanes may hold `pipelines/runtime/host.ts`, `host.loreWrites.ts` (`dg-1d-1`),
`scenes/liveScenes.ts`, lorebook workspace components (`walk2-fix-B`), `client/components/sessionForms/*`
(`walk2-fix-A`), `pipelines/entities/prompts.ts` and the settings form (`ss-3b-2`): re-read right before each
edit, change only your own lines, and if a funnel writer sits in a file a live lane is rewriting, wait for it
(the lead will say when).

## Stop and ask when

CLAUDE.md §Decisions applies; a run's write cannot be told from a person's at the writer; the lock would need
more than one migration; a published SDK name would be needed; a refused write would have to fail the whole
run.

## Report

Final message = the report (lead saves `plans/REPORT-el-1-<date>.md`), under about 650 words: the Step 0
table; the columns and migration (name, index); where the check sits; what is stopped and what is not; the
sentence(s) and labels as ★ with one alternative; the readings as ★; tests; **Noticed, not done**.

## Cold review corrections (2026-11-17) — these rule over the text above

**Cut in two. `el-1a`: entries (launch after lane `dg-1d-1` has left `pipelines/runtime/host.ts`).
`el-1b`: cast members (after `el-1a`; its own launch note). One migration, generated in `el-1a`, carries the
columns for both.**

1. **A refused write never halts the reply.** Do **not** do "the same as `host.ts:493`": that throws, and
   `runTurn.ts` 1228–1240 turns a throw into a halted run and a failed reply row; refused state writes return
   `{ halt }` (`host.ts:4825`, `:6088`). Use the carrier that does not halt: a write's result
   `{ written, notes: [sentence] }` (`host.loreWrites.ts` 1121–1133, the "Kept in this session's notes: …"
   notes): a write to a locked row returns `written: false` and one note naming the row; it never throws
   `HostScopeError` or `StateRefusal` and never rolls back the step's transaction. No dependency on `dg-1d`.
   Test: the reply completes and its other writes land.
2. **Names (R1, R3).** "Lock" alone is taken: the **slot lock** (`SLOT_LOCKS none·people·all`,
   `state/write.ts` 1790–1817, "This stat is locked."), the **setting lock**, the **book lock**. Use the
   qualified names **entry lock** and **cast member lock** (🚧; the owner's word, qualified as its siblings
   are); each NOMENCLATURE row says how it differs from the slot lock (the slot lock stops everyone's writes
   to one stat everywhere; the entry / cast member lock stops **runs** writing one row).
3. **What the columns are on.** An entry (`lorebook entries` table): one column. A **scene** is its own
   table (`db/schema.ts:4842`): a second column, in the same migration, because the owner's "all entry types"
   and the lorebook's own list of kinds (`docs/lorebooks.md:56`) include scenes. A cast member: the third
   column (built on in `el-1b`). The check reads the **target** row the writer already loads as `stored`
   (`host.ts:424` and following), never the row being inserted: dated changes go into `entry_amendments`
   (`lorebooks/entryVersions.ts`), held and notes changes into separate rows of the notes
   (`holdLoreEntryChange`, `host.ts` 477–484): a run's change to a locked entry is refused **before** any of
   those rows is made, so it is never held.
4. **Held changes and the settle line.** A change held before the entry was locked stays in the Apply review
   for a person to Apply or Take back, and **does not hold the settle line back**
   (`lorebooks/ownBook.ts` 2650–2669, 3287–3292 never settle past the oldest held change): leave changes on a
   locked entry out of that minimum (★ in the report; alternative: discard them with a note when the lock is
   set). Close out ("applies whatever is left") skips a locked entry and says so.
5. **Two places the writer cannot tell a run from a person:** (a) an **accepted model proposal** is written
   with `updatedBy: proposal.proposedBy` (`state/write.ts:3079`; `isHandEdit` false): refuse the proposal
   **when the model makes it**; a person's Accept of an older proposal goes through, as a person's Apply does
   (★). (b) **Back, swipe, regenerate** take back a run's earlier writes (`lorebooks/imprints.ts` 632, 801;
   `docs/lorebooks.md:275` lists what keeps an added entry from being removed): a lock counts as "something
   else now stands on it": Back leaves a locked entry as it is and says so with the existing words for that
   case (★; alternative: Back still takes the run's change).
6. **`el-1b`, cast members (not this launch):** the member lock covers the member's own details and words
   (`characters/versions.ts`, `cast/cardless.ts`, `utils/characterBindingSync.ts`, …) and its **durable**
   sheet layer (`cast_member` owner) only; **session-layer values** (`seated_member`, `session_cast`,
   `player_seat`: dice-driven play) are untouched (★: the owner's example was "a pipeline that adjusts cast
   member details over time"). Session-layer writes do not load the member row, so nothing is added per
   reply.
7. **`el-1a` Step 0** still lists every run write of an entry or a scene (the review counted 21 non-test
   files writing entries: `entryVersions`, `historyEntryOfDate`, `ownBook` (9 sites), `rulesets/ties`,
   `entryKnowledge`, `dcCairns`, `forkHistory`, `state/write` …): say for each whether it is a run's write, a
   person's, or the compiler's own (history days, scene filing), and where the check sits. **A locked history
   day or scene:** the compiler does not rewrite it; what closing a scene or a day does then (it must not
   fail: it leaves the locked row and files nothing over it) is ★ with what you built.

## `el-1a` — launch note (2026-11-17 night) — rules over everything above where it differs

Build **`el-1a`: the entry lock and the scene lock**, per the "Cold review corrections" section. The diagnostics
lanes have left `pipelines/runtime/host.ts`; lane `dg-1d-1` added a marker for sentences for people
(`forPeople`, `plans/REPORT-dg-1d-1-2026-11-17.md`): **not used here** (a locked write does not halt; it
returns `written: false` with a note).

**The one migration carries four columns** (generate once; `npm run db:generate`; index above the highest in
`drizzle/meta/_journal.json`; never hand-written):
1. the entry lock on the lorebook entries table (boolean, default false);
2. the scene lock on `scenes` (boolean, default false);
3. the cast member lock on `lorebook_bindings` (boolean, default false): **column only**; its checks and
   screens are `el-1b`;
4. **who created a cast member**: a nullable user reference on `lorebook_bindings` (🚧 name by §24, e.g.
   `created_by_user_id`; `on delete set null`), needed by the owner's ruling HM2 (2026-11-17: "A seat the
   guest made is theirs; a cast member they took or were handed stays the owner's"): today nothing stored
   says who made a member (`plans/REPORT-*` of task `small-1`: `lorebook_bindings` has no creator column).
   In this lane: add the column and **write it on every path that creates a cast member where the creating
   person is known** (a guest naming a seat: `seatNamed`, `sessions/seatName.ts`; a shared-card copy:
   `cast/sharedCardCopy.ts`; the owner adding a member by hand or for someone; import and starter copies:
   the person doing it; a run minting a member: null). Existing rows stay null (no boot pass). **The HM2
   rule itself is not built here** (`el-1b` / a follow-up reads the column in `seatSheetHolder`,
   `state/handEdits.ts`: a card-less seat's sheet is its guest's when the guest created the member, the
   session owner's otherwise; a null creator keeps today's behaviour). List the creation paths you covered.
No other schema change. A second boot changes nothing.

Live lanes, not your files: `ss-3b-2` (`pipelines/entities/prompts.ts`, `sessions/settingsForm.ts`, the
pipeline panel, session settings form components), `ap-2b` (`lorebooks/starterKits.ts`,
`lorebooks/foldInParent.ts`, `sockets/sessions.create.ts`, `sockets/sessions.shared.ts`,
`sockets/starterKits.ts`, `StartSessionForm.svelte`, `createSession.svelte.ts`): for the creator column on
starter copies, if the write must go into a file `ap-2b` holds, list it under Noticed and leave it for the
lead. `shared/sockets/types.ts`, `docs/*`, `NOMENCLATURE.md`, `db/schema.ts` are shared: re-read right before
each edit. Never run prettier with `--write` or pipe its output into a file; no `npm run build`; no SDK
build. Logs `plans/el-1a-<n>.log`; report `REPORT-el-1a-<date>.md`.

## `el-1b` — launch note (2026-11-17 night) — rules over everything above where it differs

`el-1a` landed (`plans/REPORT-el-1a-2026-11-17.md`): migration `0169` holds `lorebook_bindings.cast_member_lock`
and `lorebook_bindings.created_by`; the entry and scene locks, `shared/lorebooks/runLocks.ts`, the
non-halting note, the control and the list mark are built. **No new migration in this lane.** Logs
`plans/el-1b-<n>.log`; report `REPORT-el-1b-<date>.md`.

Build two things:

**A. The cast member lock** (owner: "We can probably add a cast member lock as well to prevent pipeline edits
to cast members, I.e. a pipeline that adjusts cast member details over time"; EL1 "Build it now, as
described"), in the manner `el-1a` built the entry lock (reuse its helper, note shape and words pattern):
- While a member's lock is on, no **run** changes the member's own details and words (the member's row and
  its versions: `characters/versions.ts`, `cast/cardless.ts`, `utils/characterBindingSync.ts` and whatever
  else a run writes a member through: do a Step 0 table as `el-1a` did), its art (sprites, gallery,
  likeness) or its **durable sheet** (values under the `cast_member` owner / the lorebook's own member,
  `state/write.ts` 713–725): the write is skipped with the non-halting note; the reply completes.
  **Session-layer values** (`seated_member`, `session_cast`, `player_seat`: what dice and play change) are
  **not** stopped, and those writes must not load the member row for this (no statement added per reply:
  both prompt baselines' counts unchanged). A model **proposal** for a locked member's durable sheet is
  refused when the model makes it; a person's Accept of an earlier one goes through (`state/write.ts:3079`;
  correction 5a). A run cannot remove or archive a locked member. A person's edits, a person's Apply, import
  and the plugin's own sync are not stopped. Seating, benching, handing over and taking a member's seat are
  not edits of the member: not stopped.
- The control on the cast member's page beside its edit controls, with one sentence of help, the list mark,
  the read-only line for people who can see and not edit; absent on a provided lorebook's rows (the client
  cannot tell a provided lorebook's rows from a shared reader's today, `el-1a` Noticed: use the `readOnly`
  flag the book already carries; if a locked provided row would still show the reader line, say so). Words:
  follow `el-1a`'s (**Locked**; *Sessions and their routines leave this cast member as it is; you can still
  edit it.*), ★ with one alternative each.
- Docs (`docs/lorebook-cast.md`), NOMENCLATURE row **cast member lock** (how it differs from the slot lock
  and from the entry lock; that play's session values are untouched), §25.

**B. The card-less sheet rule, HM2** (owner 2026-11-17: "A seat the guest made is theirs; a cast member they
took or were handed stays the owner's"; it refines honour mode 2026-11-05 "cards the player owns + their
card-less seat"): in `seatSheetHolder` (`state/handEdits.ts`, lane `gs-3a3a`'s one function), for a card-less
seat whose person is a guest: the guest holds the sheet when **the guest created the member**
(`lorebook_bindings.created_by` equals the guest: a seat they named, their shared-card copy); the **session's
owner** holds it when someone else created the member (a cast member of the lorebook / notes the guest took
or was handed); **a null creator keeps today's rule** (the guest), so existing sessions do not change (★ in
the report). Carded seats keep `gs-3a3a`'s rule. Read `created_by` with the member row the judge already
loads, or say what it costs. Update the matrix in `state/handEdits.cardOwner.int.test.ts` (the card-less
rows × creator guest / owner / null × honour mode), `docs/group-sessions.md` / `docs/sessions.md` ("Whose a
value is"), NOMENCLATURE §25 quoting HM2.
Also write the creator on the three paths `el-1a` left: `lorebooks/starterKits.ts:855` and
`sessions/creationModes.ts:152` (the person starting the session, for members copied or minted for them:
decide per path whether "created by" should be the person or stay null for copied starter cast: a copied
starter member was not made by the guest: null is right unless the path mints a member **for** the person's
own named seat: say what you chose); `sockets/sessions.update.ts:1353` (an owner seating a guest by name:
the creator is the **owner**, so that seat's sheet is the owner's under HM2: confirm this matches "a cast
member they … were handed"): **`sessions.update.ts` is held by live lane `gs-3a3b-1`: re-read right before
the edit, change that one call only; if the file is mid-rewrite, list it under Noticed.** Duplicate / fold /
starter copies keeping the original maker's `createdBy` (`tableRegistry.ts:506`): a copy made by a person
for their own lorebook should not carry another person's id: set it to null on copy unless a test of
duplicate exactness forbids it (`el-1a` reverted such a change: read why, and if exactness must hold, leave
it and report).

Live lanes, not your files: `gs-3a3b-1` (`sessions/seatKeys.ts`, `sessions/seats.ts`, `sessions/guestSeats.ts`,
`sockets/sessions.update.ts`, `messages/permissions.ts`, `sessionPageProjections.ts` `canControlMessageAs`).
Shared files (`shared/sockets/types.ts`, `docs/*`, `NOMENCLATURE.md`): re-read right before each edit. Never
run prettier with `--write` or pipe its output into a file; no `npm run build`; no SDK build; no
`db:generate`. In tests, clean up only your own temp directories by exact path (never `rm -rf` on a glob).
